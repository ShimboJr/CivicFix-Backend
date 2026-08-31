const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');
const {
  uploadEmergencyMedia,
  checkVideoDurations,
} = require('../middleware/emergencyUploadMiddleware');

const {
  createEmergencyReport,
  getMyEmergencyReports,
  getAllEmergencyReports,
  acknowledgeReport,
  updateReportStatus,
} = require('../controllers/emergencyController');

// ══════════════════════════════════════════════════════════════════════════════
//  /api/emergency-reports
//
//  Visibility contract (mirroring the controller comment):
//    POST  /            → any authenticated user    (protect)
//    GET   /my-reports  → any authenticated user    (protect)   — own reports only
//    GET   /            → admin only                (protect + authorize('admin'))
//    PUT   /:id/acknowledge → admin only            (protect + authorize('admin'))
//    PUT   /:id/status      → admin only            (protect + authorize('admin'))
//
//  Deliberately missing:
//    - No public GET
//    - No staff access
//    - No endpoint to view another user's reports
// ══════════════════════════════════════════════════════════════════════════════

// ── Reporter-accessible routes (any authenticated user) ───────────────────────
// IMPORTANT: /my-reports MUST be declared BEFORE /:id so Express does not try
// to match the literal string "my-reports" as a MongoDB ObjectId.
//
// POST / middleware chain:
//   protect              — JWT auth gate
//   uploadEmergencyMedia — streams files to Cloudinary, enforces size cap
//   checkVideoDurations  — rejects + cleans up if any video exceeds 15 s
//   createEmergencyReport — validates body fields, builds media array, persists
router.post(
  '/',
  protect,
  uploadEmergencyMedia,
  checkVideoDurations,
  createEmergencyReport
);
router.get( '/my-reports', protect, getMyEmergencyReports);

// ── Admin-only routes ─────────────────────────────────────────────────────────
// All of the following require both authentication AND the 'admin' role.
// A 'staff' user who passes `protect` will be rejected at `authorize('admin')`.
router.get('/',                        protect, authorize('admin'), getAllEmergencyReports);
router.put('/:id/acknowledge',         protect, authorize('admin'), acknowledgeReport);
router.put('/:id/status',              protect, authorize('admin'), updateReportStatus);

module.exports = router;
