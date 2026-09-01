const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');

const {
  getUploadSignature,
  createEmergencyReport,
  getMyEmergencyReports,
  getAllEmergencyReports,
  getEmergencyReportById,
  acknowledgeReport,
  updateReportStatus,
  getEmergencyNumber,
} = require('../controllers/emergencyController');

// ══════════════════════════════════════════════════════════════════════════════
//  /api/emergency-reports
//
//  Visibility contract (mirroring the controller comment):
//    GET   /upload-signature → any authenticated user    (protect)
//    POST  /                 → any authenticated user    (protect)
//    GET   /my-reports       → any authenticated user    (protect)  — own reports only
//    GET   /                 → admin only                (protect + authorize('admin'))
//    PUT   /:id/acknowledge  → admin only                (protect + authorize('admin'))
//    PUT   /:id/status       → admin only                (protect + authorize('admin'))
//
//  Deliberately missing:
//    - No public GET
//    - No staff access
//    - No endpoint to view another user's reports
// ══════════════════════════════════════════════════════════════════════════════

// ── Public routes (no authentication required) ───────────────────────────────
// MUST be declared before any /:id routes so Express does not try to match
// the literal string "emergency-number" as a MongoDB ObjectId.
//
// GET /emergency-number?country=XX
//   Returns verified police/fire/ambulance numbers for the given ISO 3166-1
//   alpha-2 country code, or 404 if the country is not in the dataset.
//   The client MUST show a generic fallback on 404 — never a guessed number.
router.get('/emergency-number', getEmergencyNumber);

// ── Reporter-accessible routes (any authenticated user) ───────────────────────
// IMPORTANT: literal-string paths (/upload-signature, /my-reports) MUST be
// declared BEFORE /:id so Express does not try to match those strings as
// MongoDB ObjectIds.

// GET /upload-signature
//   Returns a server-signed payload for a direct browser-to-Cloudinary upload.
//   File bytes never pass through this serverless function, which sidesteps
//   Vercel's platform-level ~4.5 MB request body limit.
//   Returns: { signature, timestamp, apiKey, cloudName, folder }
router.get('/upload-signature', protect, getUploadSignature);

// POST /
//   Accepts a plain JSON body:
//     { type, description, location, media: [{ url, type, durationSeconds, publicId }] }
//   No Multer middleware — file bytes were already uploaded directly to Cloudinary
//   before this endpoint is called.  The controller re-fetches video duration from
//   the Cloudinary Admin API and rejects any clip exceeding 15 s.
router.post('/', protect, createEmergencyReport);

// GET /my-reports
//   Returns the authenticated reporter's own submitted reports, newest first.
router.get('/my-reports', protect, getMyEmergencyReports);

// ── Admin-only routes ─────────────────────────────────────────────────────────
// All of the following require both authentication AND the 'admin' role.
// A 'staff' user who passes `protect` will be rejected at `authorize('admin')`.
router.get('/',                        protect, authorize('admin'), getAllEmergencyReports);
router.get('/:id',                     protect, authorize('admin'), getEmergencyReportById);
router.put('/:id/acknowledge',         protect, authorize('admin'), acknowledgeReport);
router.put('/:id/status',              protect, authorize('admin'), updateReportStatus);

module.exports = router;
