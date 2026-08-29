const multer                  = require('multer');
const { CloudinaryStorage }   = require('multer-storage-cloudinary');
const cloudinary              = require('../config/cloudinary');

// ─── Storage Engine (Cloudinary) ──────────────────────────────────────────────
// multer-storage-cloudinary sets `req.files[i].path` to the full Cloudinary
// HTTPS URL after upload — the same property name Multer used for local paths —
// so every controller that was already reading `req.file.path` / `req.files[i].path`
// receives the Cloudinary URL with zero changes required.
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'civicfix/issues',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  },
});

// ─── File Type Filter ─────────────────────────────────────────────────────────
const fileFilter = (_req, file, cb) => {
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        'Only JPG, JPEG, PNG, and WEBP images are allowed'
      ),
      false
    );
  }
};

// ─── Multer Instance ──────────────────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
  },
});

// Export ready-to-use middleware: up to 5 images under the field name "images"
module.exports = upload.array('images', 5);
