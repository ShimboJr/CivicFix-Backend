const express = require('express');
const router  = express.Router();

const { protect }            = require('../middleware/authMiddleware');
const { getUploadSignature } = require('../controllers/uploadController');

// ─────────────────────────────────────────────────────────────────────────────
// /api/uploads
//
// Shared upload-signature endpoint used by ALL direct-to-Cloudinary upload
// flows in the application.  Clients specify which Cloudinary folder they need
// via the `folder` query parameter; the controller validates it against an
// explicit allowlist before signing.
//
// Currently used by:
//   - Issue photo uploads      (folder=civicfix/issues)
//   - Emergency report media   (folder=civicfix/emergency-reports)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/uploads/signature?folder=<allowed-folder>
//   Returns a server-signed payload for a direct browser-to-Cloudinary upload.
//   File bytes never pass through this serverless function, which sidesteps
//   Vercel's platform-level ~4.5 MB request body limit.
//   Returns: { signature, timestamp, apiKey, cloudName, folder }
router.get('/signature', protect, getUploadSignature);

module.exports = router;
