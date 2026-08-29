const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');
const upload                 = require('../middleware/uploadMiddleware');

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
// Reuse the upload middleware but accept a single file under "afterImage" field
router.patch(
  '/issues/:id/proof',
  (req, res, next) => {
    // The uploadMiddleware exports array('images', 5); here we only need one
    // file under a different field name — override with upload.single inline
    const multer = require('multer');
    const path   = require('path');
    const singleUpload = require('../middleware/uploadMiddleware');

    // uploadMiddleware already exports upload.array — we need upload.single for proof.
    // Re-require multer directly to get a single-field version using the same storage.
    const fs      = require('fs');
    const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename:    (_req, file, cb) => {
        const sanitized = file.originalname
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9.\-]/g, '');
        cb(null, `${Date.now()}-${sanitized}`);
      },
    });

    const proof = multer({
      storage,
      fileFilter: (_req, file, cb) => {
        const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        ALLOWED.includes(file.mimetype)
          ? cb(null, true)
          : cb(new Error('Only JPG, PNG, and WEBP images are allowed'), false);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }).single('afterImage');

    proof(req, res, next);
  },
  uploadResolutionProof
);

module.exports = router;
