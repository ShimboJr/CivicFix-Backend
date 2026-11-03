const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');

const {
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
} = require('../controllers/liveLocationController');

// ══════════════════════════════════════════════════════════════════════════════
//  /api/live-location
//
//  Visibility contract:
//    POST  /start                   → any authenticated user (protect)
//    POST  /:id/ping                → session owner only (enforced in controller)
//    POST  /:id/end                 → session reporter OR admin (enforced in controller)
//    PATCH /:id/note                → session owner only (enforced in controller)
//    POST  /:id/messages            → admin only (protect + authorize('admin'))
//    GET   /:id/messages            → session owner OR admin (protect; controller checks)
//    POST  /:id/confirm-safe        → session owner only (protect; controller checks)
//    GET   /by-report/:reportId     → admin only (protect + authorize('admin'))
//    GET   /:id                     → admin only (protect + authorize('admin'))
//
//  Route ordering note:
//    /start and /by-report/:reportId MUST appear before /:id so that Express
//    does not try to match those literal strings as MongoDB ObjectIds.
//    Sub-resource routes (/:id/messages, /:id/ping, etc.) are more specific
//    than /:id and are therefore safe at any position above the bare GET /:id.
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

// PATCH /:id/extend
//   Body: { additionalMinutes: number }
//   Pushes the expiresAt of an active session forward without ending it.
//   The same session, location trail, and admin view are preserved — no new
//   EmergencyReport is created and no admin notification fires.
//   Owner-only check is enforced in the controller.
router.patch('/:id/extend', protect, extendSession);

// PATCH /:id/note
//   Body: { note: string }
//   Lets the session owner add/update a free-text description of what is
//   happening.  Stored on the linked EmergencyReport so admins see it.
//   Owner-only check is enforced in the controller.
router.patch('/:id/note', protect, addSessionNote);

// ── Messaging routes ─────────────────────────────────────────────────────────

// POST /:id/messages
//   Body: { text: string, isPreset?: boolean }
//   Admin sends a one-way status message to the resident.
//   ⚠️  Strictly silent — no push, no OS notification, no sound, no vibration.
//   Delivery is via the resident's client polling GET /:id/messages.
router.post('/:id/messages', protect, authorize('admin'), sendSessionMessage);

// GET /:id/messages
//   Returns all messages for the session, oldest first.
//   Access: the session's own reporter OR any admin.
//   The owner-vs-admin check is enforced inside the controller (not at route
//   level) so we can apply the same protect middleware to both roles without
//   branching here.
router.get('/:id/messages', protect, getSessionMessages);

// POST /:id/confirm-safe
//   No body required.
//   The resident taps "I'm Safe" — stamps reporterConfirmedSafeAt on the
//   session.  Session status and tracking are intentionally NEVER altered here.
//   Owner-only check is enforced in the controller.
router.post('/:id/confirm-safe', protect, confirmSafe);

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

