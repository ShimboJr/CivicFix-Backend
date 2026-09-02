const asyncHandler = require('express-async-handler');
const cloudinary   = require('../config/cloudinary');

// ─── Folder allowlist ──────────────────────────────────────────────────────────
// To add a new upload destination:
//   1. Add the Cloudinary folder string to this set.
//   2. Pass `folder=<that string>` from the corresponding frontend upload flow.
const ALLOWED_FOLDERS = new Set([
  'civicfix/issues',
  'civicfix/emergency-reports',
]);

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
