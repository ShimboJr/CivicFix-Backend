const express = require('express');
const router  = express.Router();

const { protect, authorize }        = require('../middleware/authMiddleware');
const { uploadSingle }              = require('../middleware/uploadMiddleware');

const {
  getAssignedIssues,
  updateProgress,
  uploadResolutionProof,
} = require('../controllers/staffController');

// ─────────────────────────────────────────────────────────────────────────────
// All routes in this file are protected AND restricted to staff role.
// ─────────────────────────────────────────────────────────────────────────────
router.use(protect, authorize('staff'));

// ── Assigned issues list + summary counts ────────────────────────────────────
router.get('/my-issues', getAssignedIssues);

// ── Move issue forward through the status workflow ───────────────────────────
router.patch('/issues/:id/progress', updateProgress);

// ── Upload after-photo proof of resolution (single image field: afterImage) ──
// uploadSingle uses multer-storage-cloudinary — no local files are written.
router.patch('/issues/:id/proof', uploadSingle, uploadResolutionProof);

module.exports = router;
