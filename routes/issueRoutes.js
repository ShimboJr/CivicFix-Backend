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
const upload                 = require('../middleware/uploadMiddleware');

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: specific named paths (e.g. /my-issues) MUST be declared BEFORE
// the /:id param route — otherwise Express treats "my-issues" as an id value.
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/issues/my-issues   — authenticated user's own issues + summary
router.get('/my-issues', protect, getMyIssues);

// GET  /api/issues             — public, filterable, paginated
// POST /api/issues             — create issue (authenticated + file upload)
router
  .route('/')
  .get(getIssues)
  .post(protect, upload, createIssue);

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
