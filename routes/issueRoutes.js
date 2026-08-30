const express = require('express');
const router  = express.Router();

const {
  createIssue,
  getIssues,
  getIssueById,
  updateIssue,
  deleteIssue,
  getMyIssues,
  toggleUpvote,
  addComment,
  getComments,
} = require('../controllers/issueController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadArray }        = require('../middleware/uploadMiddleware');
const { parseLocation }      = require('../middleware/parseLocation');
const {
  handleUploadValidationErrors,
  createIssueValidationRules,
} = require('../middleware/validators');

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: specific named paths (e.g. /my-issues) MUST be declared BEFORE
// the /:id param route — otherwise Express treats "my-issues" as an id value.
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/issues/my-issues   — authenticated user's own issues + summary
router.get('/my-issues', protect, getMyIssues);

// GET  /api/issues             — public, filterable, paginated
// POST /api/issues             — create issue (authenticated + upload + validation)
//
// Middleware order rationale:
//   1. protect           — reject unauthenticated requests first (cheap)
//   2. uploadArray       — Multer must run before anything reads req.body;
//                          multipart/form-data is opaque until Multer parses it
//   3. parseLocation     — rehydrates req.body.location from the JSON string
//                          the frontend appends via FormData.append('location',
//                          JSON.stringify({...})) so the validator can read
//                          location.address as a nested property
//   4. createIssueValidationRules + handleUploadValidationErrors
//                        — validate fields; clean up any Cloudinary uploads
//                          before returning 400 if validation fails
//   5. createIssue       — controller (only reached on a fully-valid request)
router
  .route('/')
  .get(getIssues)
  .post(
    protect,
    uploadArray,
    parseLocation,
    createIssueValidationRules,
    handleUploadValidationErrors,
    createIssue,
  );

// GET    /api/issues/:id       — single issue detail (public)
// PUT    /api/issues/:id       — update issue (reporter while Pending, or admin)
// DELETE /api/issues/:id       — delete issue (admin only)
router
  .route('/:id')
  .get(getIssueById)
  .put(protect, updateIssue)
  .delete(protect, authorize('admin'), deleteIssue);

// POST /api/issues/:id/upvote  — toggle "I also experience this"
router.post('/:id/upvote', protect, toggleUpvote);

// GET  /api/issues/:id/comments — list comments (public)
// POST /api/issues/:id/comments — add comment (authenticated)
router
  .route('/:id/comments')
  .get(getComments)
  .post(protect, addComment);

module.exports = router;
