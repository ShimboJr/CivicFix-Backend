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
  getIssueAuditLog,
  getNearbyIssues,
} = require('../controllers/issueController');

const { protect, authorize } = require('../middleware/authMiddleware');
const {
  handleValidationErrors,
  createIssueValidationRules,
} = require('../middleware/validators');

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: specific named paths (e.g. /my-issues, /nearby) MUST be declared
// BEFORE the /:id param route — otherwise Express treats those strings as id values.
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/issues/my-issues   — authenticated user's own issues + summary
router.get('/my-issues', protect, getMyIssues);

// GET  /api/issues/nearby?latitude=&longitude=&category=
// Duplicate-detection: returns open issues in the same category within ~55 m.
// Public — no auth required (same pattern as GET /api/issues).
router.get('/nearby', getNearbyIssues);

// GET  /api/issues             — public, filterable, paginated
// POST /api/issues             — create issue (authenticated + JSON body + validation)
//
// Body is now plain JSON — Multer is no longer on this route.
// Middleware order:
//   1. protect                  — reject unauthenticated requests first (cheap)
//   2. createIssueValidationRules — validate the JSON body fields
//   3. handleValidationErrors   — return 400 with field details if any rule fails
//   4. createIssue              — controller (only reached on a fully-valid request)
//
// Note: parseLocation and handleUploadValidationErrors are no longer needed here
// because location is a real nested object in a JSON body and there are no
// Multer-uploaded files to clean up on validation failure.
router
  .route('/')
  .get(getIssues)
  .post(
    protect,
    createIssueValidationRules,
    handleValidationErrors,
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

// GET  /api/issues/:id/audit-log — status-change history (public)
// No auth required — matches the public-read pattern of getIssueById and getComments.
router.get('/:id/audit-log', getIssueAuditLog);

module.exports = router;
