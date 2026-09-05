const mongoose = require('mongoose');

// ─── Location ping sub-schema ─────────────────────────────────────────────────
// Reused for both `currentLocation` (single reading) and each entry in
// `locationTrail` (the rolling history).  `accuracy` is the device-reported
// horizontal accuracy in metres — passed through as-is from the client; we
// do not validate the value server-side because different devices/browsers
// report it differently (some always report 0, some omit it entirely).
const locationPingSchema = new mongoose.Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy:  { type: Number },               // metres, optional
    timestamp: { type: Date,   default: Date.now },
  },
  { _id: false } // no extra ObjectId per ping — timestamp is the natural key
);

// ─── LiveLocationSession schema ───────────────────────────────────────────────
/**
 * LiveLocationSession
 *
 * Represents one active or recently-ended live-location sharing session
 * initiated by a resident in personal danger.
 *
 * Lifecycle:
 *   active  → ended   (resident or admin explicitly ends the session)
 *   active  → expired (expiresAt passed, detected lazily on the next write or
 *                       read rather than by a background cron job — because this
 *                       is a serverless deployment without persistent workers)
 *
 * Every session is always tied to exactly one EmergencyReport (auto-created at
 * the moment the resident activates sharing).  This means the existing urgent
 * admin notification pipeline fires automatically — no separate submission step
 * is needed.
 *
 * locationTrail is capped at 200 entries (the 200 most-recent pings) to prevent
 * unbounded array growth in a long session.  Older pings are shifted out as new
 * ones arrive (see liveLocationController.addLocationPing).
 */
const liveLocationSessionSchema = new mongoose.Schema(
  {
    // ── Who is sharing ────────────────────────────────────────────────────────
    reporter: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Reporter is required'],
      index:    true,
    },

    // ── Linked emergency report ───────────────────────────────────────────────
    // Always present — created atomically with the session in startSession.
    // Stored here so EmergencyDetail can query this collection by report id
    // (via getActiveSessionForReport) to know whether to render a live map.
    emergencyReport: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'EmergencyReport',
      required: [true, 'Emergency report reference is required'],
      index:    true,
    },

    // ── Lifecycle status ─────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['active', 'ended', 'expired'],
      default: 'active',
      // Compound index declared below — do NOT add index:true here;
      // it would create a redundant single-field index alongside the compound.
    },

    // ── Time bounds ───────────────────────────────────────────────────────────
    startedAt: {
      type:    Date,
      default: Date.now,
    },

    // Set at creation time based on the resident's chosen durationMinutes.
    // Required — every session must have a finite lifetime so that an admin
    // viewing an old session is never shown a stale 'active' label forever.
    expiresAt: {
      type:     Date,
      required: [true, 'Expiry time is required'],
    },

    // Populated by endSession (either resident or admin-initiated termination).
    endedAt: {
      type: Date,
    },

    // ── Location data ─────────────────────────────────────────────────────────
    // `currentLocation` is overwritten on every ping — always the freshest fix.
    currentLocation: {
      type: locationPingSchema,
    },

    // Rolling history — capped at 200 entries in the controller; not enforced
    // at the schema level so we can use $push/$slice in a single atomic update
    // rather than a read-then-write pattern.
    locationTrail: {
      type:    [locationPingSchema],
      default: [],
    },

    // Timestamp of the most-recent successful ping — used to detect stale
    // sessions (e.g. the device went offline mid-session).
    lastPingAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// lazyExpireIfNeeded (called by addLocationPing, getSessionById,
// getActiveSessionForReport) queries:
//   { status: 'active', expiresAt: { $lte: now } }
// ESR: status is an equality filter, expiresAt is a range filter.
// The compound index below makes this a bounded IXSCAN rather than a COLLSCAN
// on status alone followed by in-memory filtering on expiresAt.
liveLocationSessionSchema.index({ status: 1, expiresAt: 1 });

// getActiveSessionForReport: findOne({ emergencyReport: reportId })
// emergencyReport already has index:true declared inline above.

module.exports = mongoose.model('LiveLocationSession', liveLocationSessionSchema);
