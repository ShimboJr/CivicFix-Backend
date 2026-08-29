const cloudinary = require('cloudinary').v2;

// ─── Configure Cloudinary SDK ─────────────────────────────────────────────────
// Credentials are read exclusively from environment variables — never hard-code
// them in source code.  Add the three vars below to your .env file.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
