const { body, validationResult } = require('express-validator');
const cloudinary               = require('../config/cloudinary');

// ─── Shared error handler ─────────────────────────────────────────────────────
/**
 * Reads the accumulated validation errors from express-validator.
 * If any exist, responds immediately with 400.
 *
 * Response shape mirrors the rest of the API:
 *   { message: "<first human-readable summary>", errors: [{ field, message }] }
 *
 * The `errors` array gives the frontend enough structure to highlight individual
 * form fields without parsing the summary string.
 *
 * Use this handler for JSON-body routes (register, login).  For multipart routes
 * that run Multer first, use handleUploadValidationErrors instead so that any
 * already-uploaded Cloudinary assets are cleaned up before the 400 is sent.
 */
const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array().map((e) => ({
    field:   e.path,
    message: e.msg,
  }));

  return res.status(400).json({
    message: errors[0].message,
    errors,
  });
};

// ─── Upload-aware error handler ───────────────────────────────────────────────
/**
 * Same as handleValidationErrors, but for routes where Multer runs first
 * (i.e. multipart/form-data with file uploads).
 *
 * Why this exists: Multer must run before express-validator on multipart
 * requests because req.body is only populated after Multer parses the stream.
 * That means images may already be sitting in Cloudinary by the time validation
 * runs.  If validation then fails, this handler deletes those orphaned assets
 * before returning 400, keeping the Cloudinary media library clean.
 *
 * Cleanup is best-effort: a failed destroy() call is logged but never allowed
 * to suppress the validation 400 response.
 *
 * multer-storage-cloudinary sets file.filename to the Cloudinary public_id,
 * which is what cloudinary.uploader.destroy() expects.
 */
const handleUploadValidationErrors = async (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  // Clean up any files already uploaded to Cloudinary during this request.
  if (req.files && req.files.length > 0) {
    try {
      await Promise.all(
        req.files.map((file) =>
          cloudinary.uploader.destroy(file.filename)
        )
      );
    } catch (cleanupErr) {
      // Log but never block the error response — cleanup is best-effort.
      console.error(
        '[CivicFix] Cloudinary cleanup after validation failure:',
        cleanupErr.message
      );
    }
  }

  const errors = result.array().map((e) => ({
    field:   e.path,
    message: e.msg,
  }));

  return res.status(400).json({
    message: errors[0].message,
    errors,
  });
};

// ─── Register ─────────────────────────────────────────────────────────────────
/**
 * Validates POST /api/auth/register.
 * Lengths are generous upper bounds — this is about blocking runaway payloads
 * and obvious garbage, not imposing UX constraints tighter than the UI already has.
 */
const registerValidationRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 })
    .withMessage('Name must be 100 characters or fewer'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),  // matches User model minimum

  body('location')
    .trim()
    .notEmpty()
    .withMessage('Location is required'),
];

// ─── Login ────────────────────────────────────────────────────────────────────
/**
 * Validates POST /api/auth/login.
 * Deliberately kept minimal — the goal here is to reject structurally-invalid
 * payloads (e.g. a missing body or a non-string email field) without giving an
 * attacker signal about what a "valid" credential looks like.
 */
const loginValidationRules = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

// ─── Create Issue ─────────────────────────────────────────────────────────────
/**
 * Validates POST /api/issues.
 *
 * IMPORTANT — middleware order on this route:
 *   protect → uploadArray → createIssueValidationRules
 *     → handleUploadValidationErrors → createIssue
 *
 * Multer must run first on multipart/form-data requests because req.body is
 * empty until the stream is parsed — so validation runs after the upload.
 * handleUploadValidationErrors then cleans up any Cloudinary assets that were
 * already created if validation subsequently fails.
 */
const createIssueValidationRules = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 })
    .withMessage('Title must be 200 characters or fewer'),

  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ max: 2000 })
    .withMessage('Description must be 2 000 characters or fewer'),

  body('category')
    .trim()
    .notEmpty()
    .withMessage('Category is required')
    .isMongoId()
    .withMessage('Category must be a valid ID'),

  body('severity')
    .isIn(['Low', 'Medium', 'High', 'Critical'])
    .withMessage('Severity must be one of: Low, Medium, High, Critical'),

  body('location.address')
    .trim()
    .notEmpty()
    .withMessage('Location address is required'),
];

// ─── Future candidates (not implemented in this pass) ─────────────────────────
// The following routes would benefit from the same treatment:
//
//   updateIssue  (PUT /api/issues/:id)
//     — same title/description/severity rules as createIssue; category change
//       would also need isMongoId().
//
//   addComment   (POST /api/issues/:id/comments)
//     — body text: notEmpty(), isLength({ max: 1000 }).
//
//   resetPassword (PUT /api/auth/reset-password/:token)
//     — password: isLength({ min: 6 }) (already guarded in the controller but
//       worth moving here for consistency).
//
//   Admin/staff user-management routes (role assignment, status updates)
//     — role: isIn([...valid roles]), status: isIn([...valid statuses]).

module.exports = {
  handleValidationErrors,
  handleUploadValidationErrors,
  registerValidationRules,
  loginValidationRules,
  createIssueValidationRules,
};
