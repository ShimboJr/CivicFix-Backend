const asyncHandler = require('express-async-handler');
const cloudinary   = require('../config/cloudinary');

// ─── Folder allowlist ──────────────────────────────────────────────────────────
// Every folder that browser clients are permitted to upload into must appear here.
// An arbitrary folder value supplied by a client is NEVER accepted — the signature
// would be valid for the wrong folder, allowing media to accumulate outside the
// expected Cloudinary structure and bypassing any folder-level access policies.
//
// To add a new upload destination:
//   1. Add the Cloudinary folder string to this set.
//   2. Pass `folder=<that string>` from the corresponding frontend upload flow.
const ALLOWED_FOLDERS = new Set([
  'civicfix/issues',
  'civicfix/emergency-reports',
]);

// ─── @desc    Return a signed payload for a direct browser-to-Cloudinary upload
// ─── @route   GET /api/uploads/signature?folder=civicfix/issues
// ─── @access  Private (any authenticated user)
//
// The browser uses these five values to POST a file directly to:
//   https://api.cloudinary.com/v1_1/{cloudName}/auto/upload
//
// File bytes never pass through the serverless function, which sidesteps
// Vercel's platform-level ~4.5 MB request body limit entirely.
//
// Security notes:
//   - `apiSecret` is used only to compute the HMAC signature; it is NEVER
//     included in the response.
//   - The signature covers both `timestamp` and `folder`, so a captured
//     signature cannot be reused for a different folder or after it expires.
//   - Signatures expire after ~1 hour on Cloudinary's side; the timestamp
//     is returned so Cloudinary can enforce that window server-side.
//   - The `folder` parameter is validated against ALLOWED_FOLDERS — only
//     pre-approved destinations are accepted.
const getUploadSignature = asyncHandler(async (req, res) => {
  const { folder } = req.query;

  if (!folder || !ALLOWED_FOLDERS.has(folder)) {
    res.status(400);
    throw new Error(
      `Invalid folder. Allowed values: ${[...ALLOWED_FOLDERS].join(', ')}`
    );
  }

  const timestamp    = Math.floor(Date.now() / 1000);
  const paramsToSign = { timestamp, folder };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  res.status(200).json({
    signature,
    timestamp,
    apiKey:    process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
  });
});

module.exports = { getUploadSignature };
