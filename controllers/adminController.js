const asyncHandler        = require('express-async-handler');
const mongoose            = require('mongoose');
const Issue               = require('../models/Issue');
const User                = require('../models/User');
const Category            = require('../models/Category');
const Comment             = require('../models/Comment');
const { notifyStatusChange } = require('../utils/notify');

// ══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD & ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════

// ─── @desc    Admin dashboard — headline stats
// ─── @route   GET /api/admin/stats
// ─── @access  Private, admin
const getDashboardStats = asyncHandler(async (_req, res) => {
  // Run all queries in parallel for speed
  const [totalReports, statusGroups, totalUsers, totalCategories] =
    await Promise.all([
      Issue.countDocuments(),

      // Group issue count by status in one aggregation pass
      Issue.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort:  { _id:  1 } },
      ]),

      User.countDocuments(),
      Category.countDocuments(),
    ]);

  // Flatten the aggregation result into a predictable object shape
  const byStatus = {};
  statusGroups.forEach(({ _id, count }) => { byStatus[_id] = count; });

  res.status(200).json({
    totalReports,
    totalUsers,
    totalCategories,
    byStatus: {
      pending:     byStatus['Pending']      || 0,
      underReview: byStatus['Under Review'] || 0,
      assigned:    byStatus['Assigned']     || 0,
      inProgress:  byStatus['In Progress']  || 0,
      resolved:    byStatus['Resolved']     || 0,
      rejected:    byStatus['Rejected']     || 0,
    },
  });
});

// ─── @desc    Analytics data for charts
// ─── @route   GET /api/admin/analytics
// ─── @access  Private, admin
const getAnalytics = asyncHandler(async (_req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [byCategory, resolutionData, byMonth, topLocations] = await Promise.all([

    // Issues grouped by category — for bar/pie chart
    Issue.aggregate([
      {
        $lookup: {
          from:         'categories',
          localField:   'category',
          foreignField: '_id',
          as:           'cat',
        },
      },
      { $unwind: { path: '$cat', preserveNullAndEmpty: false } },
      { $group: { _id: '$cat.name', icon: { $first: '$cat.icon' }, count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
    ]),

    // Resolved vs total for resolution rate
    Issue.aggregate([
      {
        $group: {
          _id:      null,
          total:    { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
        },
      },
    ]),

    // Issue counts grouped by month — last 6 months
    Issue.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year:  { $year:  '$createdAt' },
            month: { $month: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),

    // Top 5 locations by report volume
    Issue.aggregate([
      { $group: { _id: '$location.address', count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: 5 },
      { $project: { location: '$_id', count: 1, _id: 0 } },
    ]),
  ]);

  const { total = 0, resolved = 0 } = resolutionData[0] || {};
  const resolutionRate = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0.0';

  res.status(200).json({
    byCategory,
    resolutionRate: `${resolutionRate}%`,
    byMonth,
    topLocations,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── @desc    Get all users
// ─── @route   GET /api/admin/users
// ─── @access  Private, admin
const getAllUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).select('-password');
  res.status(200).json(users);
});

// ─── @desc    Update a user's role
// ─── @route   PATCH /api/admin/users/:id/role
// ─── @access  Private, admin
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  const VALID_ROLES = ['resident', 'staff', 'admin'];
  if (!role || !VALID_ROLES.includes(role)) {
    res.status(400);
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.role = role;
  await user.save();

  res.status(200).json({
    _id:   user._id,
    name:  user.name,
    email: user.email,
    role:  user.role,
  });
});

// ─── @desc    Delete a user
// ─── @route   DELETE /api/admin/users/:id
// ─── @access  Private, admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Prevent an admin from accidentally deleting themselves
  if (user._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error('You cannot delete your own account');
  }

  await user.deleteOne();
  res.status(200).json({ message: `User "${user.name}" deleted successfully` });
});

// ══════════════════════════════════════════════════════════════════════════════
//  CATEGORY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── @desc    Get all categories
// ─── @route   GET /api/admin/categories
// ─── @access  Private, admin
const getCategories = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.status(200).json(categories);
});

// ─── @desc    Create a category
// ─── @route   POST /api/admin/categories
// ─── @access  Private, admin
const createCategory = asyncHandler(async (req, res) => {
  const { name, icon } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Category name is required');
  }

  const exists = await Category.findOne({ name: name.trim() });
  if (exists) {
    res.status(409);
    throw new Error(`Category "${name}" already exists`);
  }

  const category = await Category.create({ name: name.trim(), icon });
  res.status(201).json(category);
});

// ─── @desc    Update a category
// ─── @route   PUT /api/admin/categories/:id
// ─── @access  Private, admin
const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  if (req.body.name) category.name = req.body.name.trim();
  if (req.body.icon) category.icon = req.body.icon;

  const updated = await category.save();
  res.status(200).json(updated);
});

// ─── @desc    Delete a category
// ─── @route   DELETE /api/admin/categories/:id
// ─── @access  Private, admin
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  // Warn if issues still reference this category
  const linkedCount = await Issue.countDocuments({ category: category._id });
  if (linkedCount > 0) {
    res.status(409);
    throw new Error(
      `Cannot delete — ${linkedCount} issue(s) still reference this category`
    );
  }

  await category.deleteOne();
  res.status(200).json({ message: `Category "${category.name}" deleted` });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ISSUE MANAGEMENT (ADMIN)
// ══════════════════════════════════════════════════════════════════════════════

// ─── @desc    Assign an issue to a staff member
// ─── @route   PATCH /api/admin/issues/:id/assign
// ─── @access  Private, admin
const assignIssue = asyncHandler(async (req, res) => {
  const { staffId } = req.body;

  if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) {
    res.status(400);
    throw new Error('A valid staffId is required');
  }

  const [issue, staffUser] = await Promise.all([
    Issue.findById(req.params.id),
    User.findById(staffId),
  ]);

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }
  if (!staffUser || staffUser.role !== 'staff') {
    res.status(400);
    throw new Error('The provided user either does not exist or is not a staff member');
  }

  issue.assignedTo = staffId;
  issue.status     = 'Assigned';
  await issue.save();

  // Notify the reporter that their issue has been assigned
  await notifyStatusChange(issue._id, issue.reportedBy, 'Assigned');

  await issue.populate([
    { path: 'category',   select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' },
  ]);

  res.status(200).json(issue);
});

// ─── @desc    Directly update issue status (admin override)
// ─── @route   PATCH /api/admin/issues/:id/status
// ─── @access  Private, admin
const updateIssueStatus = asyncHandler(async (req, res) => {
  const { status, rejectionReason } = req.body;

  const VALID_STATUSES = [
    'Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected',
  ];

  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const issue = await Issue.findById(req.params.id);
  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  issue.status = status;

  // Capture rejection reason when rejecting; clear it on any other transition
  if (status === 'Rejected' && rejectionReason) {
    issue.rejectionReason = rejectionReason.trim();
  } else if (status !== 'Rejected') {
    issue.rejectionReason = undefined;
  }

  const updated = await issue.save();

  // Notify the reporter of every admin-driven status change (including Rejected)
  await notifyStatusChange(updated._id, updated.reportedBy, status);

  await updated.populate([
    { path: 'category',   select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' },
  ]);

  res.status(200).json(updated);
});

module.exports = {
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
};
