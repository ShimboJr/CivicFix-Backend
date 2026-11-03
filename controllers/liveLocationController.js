const EmergencyReport      = require('../models/EmergencyReport');
const LiveLocationSession  = require('../models/LiveLocationSession');
const SessionMessage       = require('../models/SessionMessage');
const Notification         = require('../models/Notification');
const User                 = require('../models/User');
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
 * Trail cap: the locationTrail array is capped at 3 000 entries — a ceiling
 * that is comfortably above the maximum realistic trail length even for the
 * longest allowed session plus a generous buffer (a full session is a few
 * hundred KB at most, well within MongoDB's 16 MB document limit).  Old entries
 * are NOT evicted during a live session; history is preserved in full.
 *
 * Piggybacked message delivery:
 *   The response includes a `newMessages` array so the resident's web client
 *   can receive admin messages through the ping it is already sending, without
 *   a separate polling loop.  Pass `lastSeenMessageAt` (an ISO timestamp) in
 *   the body to receive only messages created after that point; omit it (or
 *   send null/undefined) to receive all messages for the session — this covers
 *   the first ping after mount, before any message timestamp is known.
 *
 *   `newMessages` is purely additive — it does not change any existing response
 *   field and does not affect the native mobile app, which reads only the
 *   fields it already knows about.
 *
 * Body:
 *   { latitude: number, longitude: number, accuracy?: number,
 *     lastSeenMessageAt?: string }   ← ISO timestamp, optional
 */
const addLocationPing = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, accuracy, lastSeenMessageAt } = req.body;

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

    // Append the new ping atomically using MongoDB's $push + $slice.
    // The ceiling of 3 000 is far above what any realistic session can reach
    // (10-second pings × 60-minute max ≈ 360 points), so it will never be
    // hit in practice — it exists purely as a safety bound against runaway
    // documents, not as a deliberate history-trimming mechanism.
    await LiveLocationSession.findByIdAndUpdate(id, {
      $set:  { currentLocation: newPing, lastPingAt: now },
      $push: {
        locationTrail: {
          $each:  [newPing],
          $slice: -3000,  // safety ceiling — full history preserved in practice
        },
      },
    });

    // ── Piggyback: fetch any admin messages the client hasn't seen yet ─────────
    // Build the filter: if lastSeenMessageAt is a valid timestamp, return only
    // messages created strictly after it.  Otherwise (first ping after mount, or
    // no messages ever received) return the entire message list for the session
    // so the client can backfill without a separate GET call.
    //
    // This query runs AFTER the location update so a location-write failure (the
    // $push above) short-circuits before we even reach this point — messages are
    // never returned for a failed ping.
    const msgFilter = { session: id };
    const parsedCutoff = lastSeenMessageAt ? new Date(lastSeenMessageAt) : null;
    if (parsedCutoff && !isNaN(parsedCutoff.getTime())) {
      msgFilter.createdAt = { $gt: parsedCutoff };
    }

    const newMessages = await SessionMessage.find(msgFilter)
      .sort({ createdAt: 1 })
      .populate('sender', 'name role');

    return res.status(200).json({
      message:     'Ping recorded',
      newMessages,          // always present; empty array when nothing new
    });
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
 * Returns the LiveLocationSession linked to the given EmergencyReport id,
 * regardless of its current status (active, ended, or expired).
 *
 * Used by EmergencyDetail.jsx to render both the live tracking map (when the
 * session is active) and the static Movement History view (once it has ended
 * or expired).  Returning null only when NO session exists at all; a finished
 * session still has a full locationTrail worth showing.
 *
 * For active sessions a lazy expiry check is performed so the admin never sees
 * a stale 'active' label on a session whose expiresAt has already passed.
 */
const getActiveSessionForReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    // Find any session for this report — active, ended, or expired.
    // Sort by createdAt descending so the most-recent session wins if somehow
    // more than one exists for the same report.
    const session = await LiveLocationSession.findOne({
      emergencyReport: reportId,
    })
      .sort({ createdAt: -1 })
      .populate('reporter', 'name email');

    if (!session) {
      // No session has ever been created for this report.
      return res.status(200).json({ session: null });
    }

    // For active sessions only: lazily flip to 'expired' if the clock has
    // passed expiresAt.  We still return the session — the client uses the
    // updated status to choose the correct rendering mode.
    if (session.status === 'active') {
      await lazyExpireIfNeeded(session);
    }

    return res.status(200).json({ session });
  } catch (err) {
    console.error('[liveLocation] getActiveSessionForReport error:', err.message);
    res.status(500).json({ message: 'Server error fetching session for report' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  extendSession
//  PATCH /api/live-location/:id/extend
//  Access: protected — session owner only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Extends an active session's expiry window in-place by advancing expiresAt.
 *
 * This is the correct way to add time to an existing session.  It preserves:
 *   - The same session _id (the background location task keeps pinging without
 *     any change to SecureStore)
 *   - The same EmergencyReport (admins stay on the same detail page)
 *   - The complete locationTrail accumulated so far
 *   - All admin messages sent during the session
 *
 * Crucially, it does NOT fire notifyAdminsEmergency — admins are already
 * monitoring the situation and must NOT receive a second urgent alert just
 * because the resident needed more time.
 *
 * The new expiresAt is computed by adding additionalMinutes to the session's
 * CURRENT expiresAt (not to "now"), so consecutive extensions stack correctly
 * even if the resident clicks quickly.
 *
 * Body:
 *   { additionalMinutes: number }  — must be a positive finite number
 */
const extendSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalMinutes } = req.body;

    const minutes = Number(additionalMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ message: 'additionalMinutes must be a positive number' });
    }

    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // Ownership: only the resident who started the session can extend it
    if (session.reporter.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner can extend this session',
      });
    }

    // Guard: cannot extend an already-ended or expired session
    if (session.status !== 'active') {
      return res.status(410).json({
        message: `Session is '${session.status}' — only active sessions can be extended`,
      });
    }

    // Lazy expiry: if the clock has already passed expiresAt, flip to expired
    // and reject — the client should start a fresh session instead.
    const expired = await lazyExpireIfNeeded(session);
    if (expired) {
      return res.status(410).json({
        message: 'Session has just expired — please start a new session',
      });
    }

    // Advance expiresAt from its current value so consecutive extensions stack.
    session.expiresAt = new Date(session.expiresAt.getTime() + minutes * 60 * 1000);
    await session.save();

    return res.status(200).json({
      message:      'Session extended',
      newExpiresAt: session.expiresAt,
    });
  } catch (err) {
    console.error('[liveLocation] extendSession error:', err.message);
    res.status(500).json({ message: 'Server error extending live location session' });
  }
};

//  PATCH /api/live-location/:id/note
//  Access: protected — session owner only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Lets the resident add or update a free-text note describing what is happening.
 * Stored on the linked EmergencyReport's description field so admins see it
 * alongside the live map on EmergencyDetail.
 *
 * Body: { note: string }
 */
const addSessionNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    if (!note || !String(note).trim()) {
      return res.status(400).json({ message: 'note must be a non-empty string' });
    }

    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // Ownership: only the resident who started the session can add a note
    if (session.reporter.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner can update this note',
      });
    }

    // Update the linked report's description — this is where admins read it
    await EmergencyReport.findByIdAndUpdate(
      session.emergencyReport,
      { $set: { description: String(note).trim() } }
    );

    return res.status(200).json({ message: 'Note saved' });
  } catch (err) {
    console.error('[liveLocation] addSessionNote error:', err.message);
    res.status(500).json({ message: 'Server error saving session note' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  sendSessionMessage
//  POST /api/live-location/:id/messages
//  Access: admin only (enforce via authorize('admin') on the route)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Allows an admin to send a one-way status message to the resident who owns
 * the session.
 *
 * ⚠️  SILENT BY DESIGN — NO PUSH / SYSTEM NOTIFICATION:
 *   This controller MUST NOT call any push-notification or OS-alert function
 *   (webPush, FCM, APNs, etc.).  The resident's device must not make a sound,
 *   vibrate, or display a banner.  Any OS-level interruption is actively
 *   dangerous if the resident is hiding the phone from a threat.
 *   Messages are delivered exclusively via client-side polling of
 *   GET /:id/messages.
 *
 * Body:
 *   { text: string, isPreset?: boolean }
 */
const sendSessionMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, isPreset = false } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: 'text must be a non-empty string' });
    }

    // ── Fetch session ─────────────────────────────────────────────────────────
    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // ── Create the message ────────────────────────────────────────────────────
    // No push / system notification — silent poll-based delivery only.
    const message = await SessionMessage.create({
      session:  session._id,
      sender:   req.user._id,
      text:     String(text).trim(),
      isPreset: Boolean(isPreset),
    });

    return res.status(201).json({
      message: 'Message sent',
      data:    message,
    });
  } catch (err) {
    console.error('[liveLocation] sendSessionMessage error:', err.message);
    res.status(500).json({ message: 'Server error sending session message' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  getSessionMessages
//  GET /api/live-location/:id/messages
//  Access: protected — session owner (resident) OR any admin
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Returns all messages for a session in chronological order (oldest first).
 *
 * The resident's client calls this endpoint on a short polling interval to
 * surface admin messages without any OS-level notification.
 * Admins can also call it to review the message thread.
 *
 * Authorization:
 *   - The session's own reporter may read their session's messages.
 *   - Any admin may read any session's messages.
 *   - Anyone else receives 403.
 */
const getSessionMessages = async (req, res) => {
  try {
    const { id } = req.params;

    // ── Fetch session (lean — we only need reporter + _id) ────────────────────
    const session = await LiveLocationSession.findById(id).select('reporter').lean();
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // ── Authorization: owner or admin ─────────────────────────────────────────
    const isOwner = session.reporter.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner or an admin can read these messages',
      });
    }

    // ── Fetch messages, oldest first ──────────────────────────────────────────
    const messages = await SessionMessage.find({ session: id })
      .sort({ createdAt: 1 })
      .populate('sender', 'name role');

    return res.status(200).json({ messages });
  } catch (err) {
    console.error('[liveLocation] getSessionMessages error:', err.message);
    res.status(500).json({ message: 'Server error fetching session messages' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  confirmSafe
//  POST /api/live-location/:id/confirm-safe
//  Access: protected — session owner only
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Records the moment the resident tapped "I'm Safe" by setting
 * `reporterConfirmedSafeAt` to the current time.
 *
 * ⚠️  CRITICAL SAFETY INVARIANT — enforced here and documented on the model:
 *   This function MUST NOT alter session.status or stop location tracking.
 *   A coerced "I'm safe" tap under duress (a threat actor making the resident
 *   confirm while watching) must not be able to end the session on its own.
 *   Only the resident's explicit POST /:id/end or an admin ending the session
 *   can transition the session out of 'active'.
 *
 * After stamping the timestamp an in-app Notification is fanned out to all
 * admins so the confirmation is not missed if nobody currently has the report
 * open.  This notification goes only to admins — it deliberately does NOT
 * target the resident's device (no push, no vibration, no sound).
 *
 * Idempotent: calling this more than once simply updates the timestamp to "now"
 * each time, which is safe and expected (e.g. network retry).
 */
const confirmSafe = async (req, res) => {
  try {
    const { id } = req.params;

    // ── Fetch session ─────────────────────────────────────────────────────────
    const session = await LiveLocationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Live location session not found' });
    }

    // ── Ownership: only the resident who owns this session can confirm ─────────
    if (session.reporter.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Not authorised — only the session owner can send an "I\'m Safe" confirmation',
      });
    }

    // ── Stamp the timestamp — session status is intentionally untouched ───────
    // DO NOT set session.status here.  See the safety invariant above.
    const confirmedAt = new Date();
    session.reporterConfirmedSafeAt = confirmedAt;
    await session.save();

    // ── Notify admins (in-app only, normal priority) ──────────────────────────
    // This is the only place in the messaging flow where the existing
    // notification system is used — and only on the admin side, so there is
    // no stealth requirement.  We use Promise.allSettled so one bad admin
    // record never blocks the 200 response.
    notifyAdminsConfirmedSafe(session, req.user).catch((err) => {
      console.error('[liveLocation] confirmSafe admin notification failed:', err.message);
    });

    return res.status(200).json({
      message:             'Confirmation recorded',
      reporterConfirmedSafeAt: confirmedAt,
      // Explicitly echo the unchanged status so the client can assert that
      // tracking is still running.
      sessionStatus:       session.status,
    });
  } catch (err) {
    console.error('[liveLocation] confirmSafe error:', err.message);
    res.status(500).json({ message: 'Server error recording safe confirmation' });
  }
};

// ─── Private helper: fan-out "resident confirmed safe" to all admins ──────────
/**
 * Creates one in-app Notification per admin user when the resident taps
 * "I'm Safe".  Uses normal (non-urgent) priority — the emergency is still
 * ongoing and tracked; this is informational only.
 *
 * Fire-and-forget: the caller wraps this in .catch() so failures here never
 * affect the HTTP response to the resident.
 *
 * @param {import('../models/LiveLocationSession')} session
 * @param {import('../models/User')}                reporter — req.user
 */
async function notifyAdminsConfirmedSafe(session, reporter) {
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (!admins.length) return;

  const reporterName = reporter.name || 'The resident';
  const message = `${reporterName} has tapped "I'm Safe" on their live location session — tracking is still active`;

  const tasks = admins.map((admin) =>
    Notification.create({
      recipient:       admin._id,
      emergencyReport: session.emergencyReport, // links bell click to EmergencyDetail
      message,
      priority:        'normal',
      category:        'emergency',
    })
  );

  await Promise.allSettled(tasks);
}

module.exports = {
  startSession,
  addLocationPing,
  endSession,
  extendSession,
  getSessionById,
  getActiveSessionForReport,
  addSessionNote,
  sendSessionMessage,
  getSessionMessages,
  confirmSafe,
};

