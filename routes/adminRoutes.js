const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');

const {
  getDashboardStats,
  getAnalytics,
  getAllUsers,
  updateUserRole,
  deleteUser,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  assignIssue,
  updateIssueStatus,
} = require('../controllers/adminController');

// ─────────────────────────────────────────────────────────────────────────────
// All routes in this file are protected AND restricted to admin role.
// Apply the guard pair once at router level for clarity and DRY enforcement.
// ─────────────────────────────────────────────────────────────────────────────
router.use(protect, authorize('admin'));

// ── Dashboard & Analytics ────────────────────────────────────────────────────
router.get('/stats',     getDashboardStats);
router.get('/analytics', getAnalytics);

// ── User Management ───────────────────────────────────────────────────────────
router.get('/users',              getAllUsers);
router.patch('/users/:id/role',   updateUserRole);
router.delete('/users/:id',       deleteUser);

// ── Category Management ───────────────────────────────────────────────────────
router.route('/categories')
  .get(getCategories)
  .post(createCategory);

router.route('/categories/:id')
  .put(updateCategory)
  .delete(deleteCategory);

// ── Issue Management ──────────────────────────────────────────────────────────
router.patch('/issues/:id/assign', assignIssue);
router.patch('/issues/:id/status', updateIssueStatus);

module.exports = router;
