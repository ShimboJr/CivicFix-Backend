const { body, validationResult } = require('express-validator');

// ─── Shared error handler ─────────────────────────────────────────────────────
/**
 * Reads the accumulated validation errors from express-validator.
 * If any exist, responds immediately with 400 so the request never reaches
 * the controller (and — critically for createIssue — never triggers the
 * Multer/Cloudinary upload middleware that follows in the chain).
 *
 * Response shape mirrors the rest of the API:
 *   { message: "<first human-readable summary>", errors: [{ field, message }] }
 *
 * The `errors` array is optional but gives the frontend enough structure to
 * highlight individual form fields without parsing the summary string.
 */
const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array().map((e) => ({
    field:   e.path,
    message: e.msg,
  }));

  // Use the first error as the top-level message so callers that only look at
  // `message` (e.g. the existing error interceptor in the frontend) still get
  // a readable string rather than "[object Object]".
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
 * This runs BEFORE the Multer/Cloudinary upload middleware on purpose — an
 * invalid payload is rejected here so we never burn a real Cloudinary upload
 * slot on a request that would have failed anyway at the controller level.
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
  registerValidationRules,
  loginValidationRules,
  createIssueValidationRules,
};
