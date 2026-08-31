const express = require('express');
const router  = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');

const {
  getDashboardStats,
  getAnalytics,
  getAllUsers,
  updateUserRole,
  deleteUser,
  getStaffWorkload,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  assignIssue,
  updateIssueStatus,
  bulkAssignIssues,
  bulkRejectIssues,
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

// GET /api/admin/staff-workload — each staff member + their active issue count,
// sorted lightest-load-first.  Admin-only (guard applied at router level above).
router.get('/staff-workload', getStaffWorkload);

// ── Category Management ───────────────────────────────────────────────────────
router.route('/categories')
  .get(getCategories)
  .post(createCategory);

router.route('/categories/:id')
  .put(updateCategory)
  .delete(deleteCategory);

// ── Issue Management ───────────────────────────────────────────────────────
// IMPORTANT: bulk-action routes MUST come before /:id routes so Express does
// not try to match the literal string "bulk-assign" as a MongoDB ObjectId.
router.post('/issues/bulk-assign',  bulkAssignIssues);
router.post('/issues/bulk-reject',  bulkRejectIssues);

// Single-issue actions
router.patch('/issues/:id/assign', assignIssue);
router.patch('/issues/:id/status', updateIssueStatus);

module.exports = router;
