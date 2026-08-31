const asyncHandler           = require('express-async-handler');
const mongoose               = require('mongoose');
const Issue                  = require('../models/Issue');
const User                   = require('../models/User');
const Category               = require('../models/Category');
const { notifyStatusChange } = require('../utils/notify');
const { logStatusChange }    = require('../utils/auditLog');


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
// ─── @route   GET /api/admin/analytics?months=12
// ─── @access  Private, admin
const getAnalytics = asyncHandler(async (req, res) => {
  // Accept ?months query param (default 12).  Clamp to sane bounds.
  const months     = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 60);
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - months);

  const [
    byCategory,
    resolutionData,
    byMonth,
    topLocations,
    problemAreas,
    resolutionTimeOverall,
    resolutionTimeByCategory,
  ] = await Promise.all([

    // ── Issues grouped by category — for bar/pie chart ─────────────────────
    Issue.aggregate([
      {
        $lookup: {
          from:         'categories',
          localField:   'category',
          foreignField: '_id',
          as:           'cat',
        },
      },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$cat.name', icon: { $first: '$cat.icon' }, count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
    ]),

    // ── Resolved vs total — for resolution rate ────────────────────────────
    Issue.aggregate([
      {
        $group: {
          _id:      null,
          total:    { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
        },
      },
    ]),

    // ── Issue counts grouped by month — last N months (param-driven) ───────
    Issue.aggregate([
      { $match: { createdAt: { $gte: windowStart } } },
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

    // ── Top 5 locations by raw address (legacy — kept for existing UI) ─────
    Issue.aggregate([
      { $group: { _id: '$location.address', count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: 5 },
      { $project: { location: '$_id', count: 1, _id: 0 } },
    ]),

    // ── Problem areas — coordinate-bucketed top 10 ─────────────────────────
    // Round lat/lng to 3 decimal places (≈ 100 m grid cell) so nearby reports
    // for the same real-world spot are grouped even when the raw address strings
    // differ.  For each bucket we also capture the address of the earliest
    // report as a human-readable label.
    Issue.aggregate([
      // Drop any issue that has no coordinates
      {
        $match: {
          'location.latitude':  { $exists: true, $ne: null },
          'location.longitude': { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            lat: { $round: ['$location.latitude',  3] },
            lng: { $round: ['$location.longitude', 3] },
          },
          count:           { $sum: 1 },
          // $first over createdAt ascending gives the earliest-reported address
          representativeAddress: { $first: '$location.address' },
          earliestDate:          { $min:   '$createdAt' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id:     0,
          lat:     '$_id.lat',
          lng:     '$_id.lng',
          address: '$representativeAddress',
          count:   1,
        },
      },
    ]),

    // ── Average resolution time — overall (hours) ──────────────────────────
    // For Resolved issues, subtract createdAt from updatedAt (ms), take the
    // average, then convert ms → hours.
    Issue.aggregate([
      { $match: { status: 'Resolved' } },
      {
        $group: {
          _id: null,
          avgMs: {
            $avg: { $subtract: ['$updatedAt', '$createdAt'] },
          },
        },
      },
      {
        $project: {
          _id:     0,
          avgHours: { $round: [{ $divide: ['$avgMs', 3_600_000] }, 1] },
        },
      },
    ]),

    // ── Average resolution time — per category ─────────────────────────────
    Issue.aggregate([
      { $match: { status: 'Resolved' } },
      {
        $lookup: {
          from:         'categories',
          localField:   'category',
          foreignField: '_id',
          as:           'cat',
        },
      },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id:   { $ifNull: ['$cat.name', 'Uncategorised'] },
          avgMs: { $avg: { $subtract: ['$updatedAt', '$createdAt'] } },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id:      0,
          category: '$_id',
          avgHours: { $round: [{ $divide: ['$avgMs', 3_600_000] }, 1] },
          count:    1,
        },
      },
      { $sort: { avgHours: -1 } },
    ]),
  ]);

  const { total = 0, resolved = 0 } = resolutionData[0] || {};
  const resolutionRate = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0.0';

  res.status(200).json({
    // ── Existing fields (unchanged) ────────────────────────────────────────
    byCategory,
    resolutionRate: `${resolutionRate}%`,
    byMonth,
    topLocations,
    // ── New fields ────────────────────────────────────────────────────────
    months,          // echo back so the client knows the window it received
    problemAreas,
    avgResolutionTime: {
      overall:     resolutionTimeOverall[0]?.avgHours ?? null,
      byCategory:  resolutionTimeByCategory,
    },
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
// ─── @desc    Get all staff members with their current active issue count
// ─── @route   GET /api/admin/staff-workload
// ─── @access  Private, admin
//
// "Active" means Assigned or In Progress — issues the staff member is currently
// working on.  Resolved and Rejected issues are done and must not count toward
// someone's current load.
const getStaffWorkload = asyncHandler(async (_req, res) => {
  // ── Step 1: all staff users ──────────────────────────────────────────────
  const staffUsers = await User.find({ role: 'staff' })
    .select('_id name email')
    .lean();

  // ── Step 2: active assignment counts per staff member ───────────────────
  // One aggregation pass — far cheaper than N individual count() calls.
  const activeCounts = await Issue.aggregate([
    {
      $match: {
        status:     { $in: ['Assigned', 'In Progress'] },
        assignedTo: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id:   '$assignedTo',
        count: { $sum: 1 },
      },
    },
  ]);

  // Build a lookup map: staffId (string) → active count
  const countMap = {};
  activeCounts.forEach(({ _id, count }) => {
    countMap[_id.toString()] = count;
  });

  // ── Step 3: merge counts onto the user list, default 0 ──────────────────
  const workload = staffUsers
    .map((u) => ({
      _id:         u._id,
      name:        u.name,
      email:       u.email,
      activeCount: countMap[u._id.toString()] || 0,
    }))
    // Sort ascending: lightest-loaded staff member appears first.
    // This is the key ergonomic feature — admins shouldn’t have to scan
    // every number to find who has the most capacity.
    .sort((a, b) => a.activeCount - b.activeCount);

  res.status(200).json(workload);
});


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

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Issue not found');
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

  // Capture the pre-write status for the audit log
  const fromStatus = issue.status;

  issue.assignedTo = staffId;
  issue.status     = 'Assigned';
  await issue.save();

  // Notify the reporter that their issue has been assigned
  await notifyStatusChange(issue._id, issue.reportedBy, 'Assigned');

  // Write an audit entry: who assigned it, from what status, to 'Assigned'
  await logStatusChange(issue._id, req.user._id, fromStatus, 'Assigned');

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

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const issue = await Issue.findById(req.params.id);
  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  // Capture the pre-write status for the audit log
  const fromStatus = issue.status;

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

  // Write an audit entry; pass rejectionReason as `reason` for Rejected transitions
  await logStatusChange(
    updated._id,
    req.user._id,
    fromStatus,
    status,
    status === 'Rejected' ? rejectionReason : undefined
  );

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
  getStaffWorkload,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  assignIssue,
  updateIssueStatus,
};
