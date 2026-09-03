const EmergencyReport      = require('../models/EmergencyReport');
const LiveLocationSession  = require('../models/LiveLocationSession');
const { notifyAdminsEmergency } = require('../utils/notify');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lazily flip a session's status from 'active' → 'expired' when its expiresAt
 * has already passed.  Called on write (addLocationPing) and on read
 * (getSessionById, getActiveSessionForReport) to keep status accurate without
 * needing a background cron job.
 *
 * Mutates the in-memory `session` document AND persists the change.
 * Returns true if the session was expired, false if nothing changed.
 *
 * @param {import('../models/LiveLocationSession')} session — a live Mongoose doc
 * @returns {Promise<boolean>}
 */
async function lazyExpireIfNeeded(session) {
  if (session.status === 'active' && session.expiresAt <= new Date()) {
    session.status = 'expired';
    await session.save();
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
//  startSession
//  POST /api/live-location/start
//  Access: protected — any authenticated resident (or admin/staff)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Activates live location sharing for the calling resident.
 *
 * Flow:
 *   1. Parse `durationMinutes` (default 60).
 *   2. Create a minimal EmergencyReport (type: 'Live Location SOS').
 *   3. Create a LiveLocationSession linked to that report.
 *   4. Fire `notifyAdminsEmergency` immediately — activation IS the alert.
 *   5. Return the new session id.
 *
 * Body:
 *   { durationMinutes?: number, latitude: number, longitude: number,
 *     accuracy?: number, address?: string }
 */
const startSession = async (req, res) => {
  try {
    const {
      durationMinutes = 60,
      latitude,
      longitude,
      accuracy,
      address = 'Live location — see map',
    } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (latitude == null || longitude == null) {
      return res.status(400).json({
        message: 'latitude and longitude are required to start a live location session',
      });
    }

    const duration = Number(durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ message: 'durationMinutes must be a positive number' });
    }

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

    // ── Step 1: Create the linked EmergencyReport ─────────────────────────────
    // The report acts as the notification trigger — reusing the existing urgent
    // admin email/notification pipeline without any parallel system.
    const report = await EmergencyReport.create({
      reporter:    req.user._id,
      type:        'Live Location SOS',
      description: 'Live location sharing activated',
      location: {
        address,
        latitude,
        longitude,
      },
    });

    // ── Step 2: Create the LiveLocationSession ────────────────────────────────
    const initialPing = { latitude, longitude, accuracy, timestamp: now };

    const session = await LiveLocationSession.create({
      reporter:        req.user._id,
      emergencyReport: report._id,
      expiresAt,
      currentLocation: initialPing,
      locationTrail:   [initialPing],
      lastPingAt:      now,
    });

    // ── Step 3: Notify admins (fire-and-forget — never blocks the 201 response) ─
    notifyAdminsEmergency(report).catch((err) => {
      console.error('[liveLocation] notifyAdminsEmergency failed:', err.message);
    });

    return res.status(201).json({
      message:   'Live location session started',
      sessionId: session._id,
      reportId:  report._id,
      expiresAt,
    });
  } catch (err) {
    console.error('[liveLocation] startSession error:', err.message);
    res.status(500).json({ message: 'Server error starting live location session' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  addLocationPing
//  POST /api/live-location/:id/ping
//  Access: protected — session owner only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Records a new GPS reading for an active session.
 *
 * Guards:
 *   - Caller must be the session's reporter (ownership check).
 *   - Session status must be 'active'.
 *   - expiresAt must not have passed; if it has, lazily flip to 'expired'
 *     and reject with 410 Gone (the client should stop sending pings).
 *
 * Trail cap: the locationTrail array is capped at 200 entries.  When a 201st
 * ping would be added we $slice the array to keep only the last 200, ensuring
 * no session can grow the document unboundedly.
 *
 * Body: { latitude: number, longitude: number, accuracy?: number }
 */
const addLocationPing = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    // ── Fetch session ─────────────────────────────────────────────────────────
    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // ── Ownership check ───────────────────────────────────────────────────────
    if (session.reporter.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner can send pings',
      });
    }

    // ── Status guard (includes lazy expiry) ───────────────────────────────────
    if (session.status !== 'active') {
      return res.status(410).json({
        message: `Session is '${session.status}' — pings are no longer accepted`,
      });
    }

    // Lazy expiry check: if the clock has passed expiresAt, flip and reject
    const expired = await lazyExpireIfNeeded(session);
    if (expired) {
      return res.status(410).json({
        message: 'Session has expired — pings are no longer accepted',
      });
    }

    // ── Persist the new ping ──────────────────────────────────────────────────
    const now      = new Date();
    const newPing  = { latitude, longitude, accuracy, timestamp: now };

    // Build the full updated trail in memory so we can enforce the 200-entry cap
    // atomically without a read-then-write race.  For the trail we append and
    // then slice, keeping only the newest 200 entries.
    //
    // Using findByIdAndUpdate with $push + $slice (MongoDB's atomic array
    // update) is safer than mutating session.locationTrail and calling save(),
    // because concurrent pings won't corrupt the document.
    await LiveLocationSession.findByIdAndUpdate(id, {
      $set:  { currentLocation: newPing, lastPingAt: now },
      $push: {
        locationTrail: {
          $each:  [newPing],
          $slice: -200,   // keep only the 200 most-recent entries
        },
      },
    });

    return res.status(200).json({ message: 'Ping recorded' });
  } catch (err) {
    console.error('[liveLocation] addLocationPing error:', err.message);
    res.status(500).json({ message: 'Server error recording location ping' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  endSession
//  POST /api/live-location/:id/end
//  Access: protected — session's reporter OR any admin
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Terminates an active session, setting status → 'ended' and recording endedAt.
 *
 * Both the resident who started sharing AND any admin can end the session.
 * This covers:
 *   - The resident signalling they are safe.
 *   - An admin closing the session after reaching the resident.
 */
const endSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // ── Authorization: reporter OR admin ──────────────────────────────────────
    const isOwner = session.reporter.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner or an admin can end this session',
      });
    }

    // Idempotent: already ended/expired sessions are fine to "end" again;
    // we just update endedAt and status without error so the client can
    // safely retry on network failure.
    session.status  = 'ended';
    session.endedAt = new Date();
    await session.save();

    return res.status(200).json({ message: 'Session ended', sessionId: session._id });
  } catch (err) {
    console.error('[liveLocation] endSession error:', err.message);
    res.status(500).json({ message: 'Server error ending live location session' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  getSessionById
//  GET /api/live-location/:id
//  Access: admin only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Returns a single session document, performing a lazy expiry check first so
 * an admin viewing an old session always sees accurate status rather than a
 * stale 'active' label left over from before expiresAt passed.
 */
const getSessionById = async (req, res) => {
  try {
    const session = await LiveLocationSession.findById(req.params.id)
      .populate('reporter',        'name email')
      .populate('emergencyReport', 'type description location status createdAt');

    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // Lazy expiry check before returning to admin
    await lazyExpireIfNeeded(session);

    return res.status(200).json(session);
  } catch (err) {
    console.error('[liveLocation] getSessionById error:', err.message);
    res.status(500).json({ message: 'Server error fetching live location session' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  getActiveSessionForReport
//  GET /api/live-location/by-report/:reportId
//  Access: admin only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Returns the active LiveLocationSession linked to the given EmergencyReport id,
 * or null if none exists or the session has already ended/expired.
 *
 * Used by EmergencyDetail.jsx to decide whether to render a live map panel.
 *
 * Also performs a lazy expiry check so the admin never sees an 'active' session
 * that has actually timed out.
 */
const getActiveSessionForReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    const session = await LiveLocationSession.findOne({
      emergencyReport: reportId,
      status:          'active',
    }).populate('reporter', 'name email');

    if (!session) {
      // No session, or already ended/expired — return null payload so the
      // client can simply check `data.session` without special-casing 404.
      return res.status(200).json({ session: null });
    }

    // Lazy expiry: if it's nominally 'active' but the clock has passed,
    // flip it now and return null (the live map should not render)
    const expired = await lazyExpireIfNeeded(session);
    if (expired) {
      return res.status(200).json({ session: null });
    }

    return res.status(200).json({ session });
  } catch (err) {
    console.error('[liveLocation] getActiveSessionForReport error:', err.message);
    res.status(500).json({ message: 'Server error fetching session for report' });
  }
};

module.exports = {
  startSession,
  addLocationPing,
  endSession,
  getSessionById,
  getActiveSessionForReport,
};
