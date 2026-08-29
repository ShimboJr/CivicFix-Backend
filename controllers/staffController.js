const asyncHandler = require('express-async-handler');
const Issue        = require('../models/Issue');
const Comment      = require('../models/Comment');

// ─── Allowed status transitions for staff members ─────────────────────────────
// Staff can only move issues forward through their section of the workflow.
// Admins handle rejection and any backward/override transitions.
const STAFF_TRANSITIONS = {
  'Assigned':    'In Progress',
  'In Progress': 'Resolved',
};

// ─── @desc    Get all issues assigned to the logged-in staff member
// ─── @route   GET /api/staff/my-issues
// ─── @access  Private, staff
const getAssignedIssues = asyncHandler(async (req, res) => {
  const staffId = req.user._id;

  const issues = await Issue.find({ assignedTo: staffId })
    .sort({ createdAt: -1 })
    .populate('category',   'name icon')
    .populate('reportedBy', 'name')
    .lean();

  // Status summary counts — mirrors resident dashboard shape for UI consistency
  const summary = {
    total:      issues.length,
    assigned:   issues.filter((i) => i.status === 'Assigned').length,
    inProgress: issues.filter((i) => i.status === 'In Progress').length,
    resolved:   issues.filter((i) => i.status === 'Resolved').length,
  };

  res.status(200).json({ summary, issues });
});

// ─── @desc    Move an assigned issue forward in status + optional progress note
// ─── @route   PATCH /api/staff/issues/:id/progress
// ─── @access  Private, staff
const updateProgress = asyncHandler(async (req, res) => {
  const { note } = req.body;
  const staffId  = req.user._id;

  const issue = await Issue.findById(req.params.id);

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  // Only the assigned staff member can update this issue
  if (!issue.assignedTo || issue.assignedTo.toString() !== staffId.toString()) {
    res.status(403);
    throw new Error('Not authorised — this issue is not assigned to you');
  }

  const nextStatus = STAFF_TRANSITIONS[issue.status];

  if (!nextStatus) {
    res.status(400);
    throw new Error(
      `Cannot advance status from "${issue.status}" — only "Assigned" and "In Progress" can be moved forward by staff`
    );
  }

  issue.status = nextStatus;
  await issue.save();

  // If a note was provided, post it as a Comment so residents see it in-thread
  if (note && note.trim()) {
    await Comment.create({
      issue: issue._id,
      user:  staffId,
      text:  `[Progress Update — ${nextStatus}] ${note.trim()}`,
    });
  }

  await issue.populate([
    { path: 'category',   select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' },
  ]);

  res.status(200).json(issue);
});

// ─── @desc    Upload a resolution proof image (before/after)
// ─── @route   PATCH /api/staff/issues/:id/proof
// ─── @access  Private, staff
const uploadResolutionProof = asyncHandler(async (req, res) => {
  const staffId = req.user._id;

  const issue = await Issue.findById(req.params.id);

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  if (!issue.assignedTo || issue.assignedTo.toString() !== staffId.toString()) {
    res.status(403);
    throw new Error('Not authorised — this issue is not assigned to you');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('No image file uploaded — include an image under the "afterImage" field');
  }

  const afterImagePath = `/uploads/${req.file.filename}`;

  // Mirror the first issue image to beforeImage if not already set
  // so both sides of the before/after comparison are always available
  if (!issue.beforeImage && issue.images && issue.images.length > 0) {
    issue.beforeImage = issue.images[0];
  }

  issue.afterImage = afterImagePath;
  await issue.save();

  await issue.populate([
    { path: 'category',   select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' },
  ]);

  res.status(200).json(issue);
});

module.exports = { getAssignedIssues, updateProgress, uploadResolutionProof };
