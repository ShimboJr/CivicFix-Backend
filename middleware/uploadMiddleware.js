const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ─── Ensure uploads directory exists ─────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Storage Engine ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },

  filename: (_req, file, cb) => {
    // Sanitize original filename: replace spaces/special chars with hyphens
    const sanitized = file.originalname
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9.\-]/g, '');

    const uniqueName = `${Date.now()}-${sanitized}`;
    cb(null, uniqueName);
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
