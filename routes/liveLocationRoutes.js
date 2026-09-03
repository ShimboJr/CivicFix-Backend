const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');

const {
  startSession,
  addLocationPing,
  endSession,
  getSessionById,
  getActiveSessionForReport,
} = require('../controllers/liveLocationController');

// ══════════════════════════════════════════════════════════════════════════════
//  /api/live-location
//
//  Visibility contract:
//    POST  /start                   → any authenticated user (protect)
//    POST  /:id/ping                → session owner only (enforced in controller)
//    POST  /:id/end                 → session reporter OR admin (enforced in controller)
//    GET   /:id                     → admin only (protect + authorize('admin'))
//    GET   /by-report/:reportId     → admin only (protect + authorize('admin'))
//
//  Route ordering note:
//    /start and /by-report/:reportId MUST appear before /:id so that Express
//    does not try to match those literal strings as MongoDB ObjectIds.
// ══════════════════════════════════════════════════════════════════════════════

// ── Resident-accessible routes ────────────────────────────────────────────────

// POST /start
//   Body: { durationMinutes?, latitude, longitude, accuracy?, address? }
//   Creates a LiveLocationSession + linked EmergencyReport, fires urgent admin
//   notification, and returns { sessionId, reportId, expiresAt }.
router.post('/start', protect, startSession);

// POST /:id/ping
//   Body: { latitude, longitude, accuracy? }
//   Records a new GPS fix.  Controller rejects non-owners (403) and
//   expired/ended sessions (410).
router.post('/:id/ping', protect, addLocationPing);

// POST /:id/end
//   No body required.
//   Either the session's reporter or an admin can call this.
router.post('/:id/end', protect, endSession);

// ── Admin-only routes ─────────────────────────────────────────────────────────

// GET /by-report/:reportId
//   Returns { session } where session is the active LiveLocationSession linked
//   to the given EmergencyReport id, or { session: null } if none.
//   Used by EmergencyDetail.jsx to know whether to render a live map.
//
//   IMPORTANT: declared BEFORE /:id so Express does not match "by-report"
//   as a MongoDB ObjectId and return a CastError.
router.get('/by-report/:reportId', protect, authorize('admin'), getActiveSessionForReport);

// GET /:id
//   Fetches a single session by its own _id.  Performs lazy expiry check before
//   returning so the admin always sees accurate status.
router.get('/:id', protect, authorize('admin'), getSessionById);

module.exports = router;
