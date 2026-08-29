const asyncHandler   = require('express-async-handler');
const mongoose       = require('mongoose');
const Issue          = require('../models/Issue');
const Comment        = require('../models/Comment');
const Notification   = require('../models/Notification');

// ─── @desc    Create a new issue
// ─── @route   POST /api/issues
// ─── @access  Private (any authenticated user)
const createIssue = asyncHandler(async (req, res) => {
  const { title, description, category, severity } = req.body;

  // location can arrive as nested JSON or flat fields
  let location;
  try {
    location =
      typeof req.body.location === 'string'
        ? JSON.parse(req.body.location)
        : req.body.location;
  } catch {
    res.status(400);
    throw new Error('Invalid location format — expected JSON object');
  }

  if (!title || !description || !category || !location?.address) {
    res.status(400);
    throw new Error('Please provide title, description, category, and location.address');
  }

  // Map each uploaded file to its Cloudinary URL
  // multer-storage-cloudinary places the full HTTPS URL on f.path
  const images = req.files ? req.files.map((f) => f.path) : [];

  const issue = await Issue.create({
    title,
    description,
    category,
    location,
    severity,
    images,
    reportedBy: req.user._id,
  });

  const populated = await issue.populate([
    { path: 'category', select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
  ]);

  res.status(201).json(populated);
});

// ─── @desc    Get all issues (filterable, paginated)
// ─── @route   GET /api/issues
// ─── @access  Public
const getIssues = asyncHandler(async (req, res) => {
  const {
    category,
    status,
    severity,
    search,
    sortBy = 'newest',
    page  = 1,
    limit = 10,
  } = req.query;

  // ── Build filter object ──────────────────────────────────────────────────
  const filter = {};

  if (category) filter.category = category;
  if (status)   filter.status   = status;
  if (severity) filter.severity = severity;

  if (search) {
    filter.$or = [
      { title:       { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // ── Sort ─────────────────────────────────────────────────────────────────
  const SORT_MAP = {
    newest:   { createdAt: -1 },
    oldest:   { createdAt:  1 },
    upvotes:  { upvotes:   -1 },
    severity: { severity:  -1 },
  };
  const sort = SORT_MAP[sortBy] || SORT_MAP.newest;

  // ── Pagination ────────────────────────────────────────────────────────────
  const pageNum  = Math.max(parseInt(page,  10) || 1, 1);
  const limitNum = Math.min(parseInt(limit, 10) || 10, 50); // cap at 50
  const skip     = (pageNum - 1) * limitNum;

  const [issues, total] = await Promise.all([
    Issue.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate('category',   'name icon')
      .populate('reportedBy', 'name')
      .populate('assignedTo', 'name')
      .lean(),
    Issue.countDocuments(filter),
  ]);

  res.status(200).json({
    issues,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum),
  });
});

// ─── @desc    Get a single issue by ID (with comments)
// ─── @route   GET /api/issues/:id
// ─── @access  Public
const getIssueById = asyncHandler(async (req, res) => {
  // Validate the id before hitting Mongoose to avoid a CastError
  // (e.g. when id is literally "null", "undefined", or a malformed string).
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const issue = await Issue.findById(req.params.id)
    .populate('category',   'name icon')
    .populate('reportedBy', 'name email location')
    .populate('assignedTo', 'name email');

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  // Fetch associated comments separately for clear population control
  const comments = await Comment.find({ issue: issue._id })
    .sort({ createdAt: 1 }) // oldest first — chronological thread
    .populate('user', 'name role');

  res.status(200).json({ issue, comments });
});

// ─── @desc    Update an issue
// ─── @route   PUT /api/issues/:id
// ─── @access  Private — reporter (while Pending) OR admin
const updateIssue = asyncHandler(async (req, res) => {
  const issue = await Issue.findById(req.params.id);

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const isAdmin    = req.user.role === 'admin';
  const isReporter = issue.reportedBy.toString() === req.user._id.toString();
  const isPending  = issue.status === 'Pending';

  // Reporter can only edit their own issue while it hasn't been picked up yet
  if (!isAdmin && !(isReporter && isPending)) {
    res.status(403);
    throw new Error(
      'Not authorised — only the reporter (while Pending) or an admin can edit this issue'
    );
  }

  const EDITABLE_FIELDS = ['title', 'description', 'category', 'severity', 'location'];

  EDITABLE_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      issue[field] = req.body[field];
    }
  });

  // Admins can also update status and assignment
  if (isAdmin) {
    if (req.body.status)     issue.status     = req.body.status;
    if (req.body.assignedTo) issue.assignedTo = req.body.assignedTo;
  }

  const updated = await issue.save();

  await updated.populate([
    { path: 'category',   select: 'name icon' },
    { path: 'reportedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' },
  ]);

  res.status(200).json(updated);
});

// ─── @desc    Delete an issue
// ─── @route   DELETE /api/issues/:id
// ─── @access  Private, admin only
const deleteIssue = asyncHandler(async (req, res) => {
  const issue = await Issue.findById(req.params.id);

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  // Best-effort cleanup of dependent documents.
  // Wrapped in try/catch so a cleanup failure never blocks the actual delete.
  try {
    await Promise.all([
      Comment.deleteMany(     { issue: issue._id }),
      Notification.deleteMany({ issue: issue._id }),
    ]);
  } catch (cleanupErr) {
    // Log but do not rethrow — the issue deletion should still complete.
    console.error('[deleteIssue] Cleanup error (non-fatal):', cleanupErr.message);
  }

  await issue.deleteOne();

  res.status(200).json({ message: `Issue ${issue.issueId} deleted successfully` });
});

// ─── @desc    Get the logged-in user's issues (with status summary counts)
// ─── @route   GET /api/issues/my-issues
// ─── @access  Private
const getMyIssues = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const issues = await Issue.find({ reportedBy: userId })
    .sort({ createdAt: -1 })
    .populate('category',   'name icon')
    .populate('assignedTo', 'name')
    .lean();

  // Status summary — mirrors the resident dashboard stat cards
  const summary = {
    total:      issues.length,
    pending:    issues.filter((i) => i.status === 'Pending').length,
    inProgress: issues.filter((i) =>
      ['Under Review', 'Assigned', 'In Progress'].includes(i.status)
    ).length,
    resolved:   issues.filter((i) => i.status === 'Resolved').length,
    rejected:   issues.filter((i) => i.status === 'Rejected').length,
  };

  res.status(200).json({ summary, issues });
});

// ─── @desc    Toggle upvote ("I also experience this")
// ─── @route   POST /api/issues/:id/upvote
// ─── @access  Private
const toggleUpvote = asyncHandler(async (req, res) => {
  const issue  = await Issue.findById(req.params.id);
  const userId = req.user._id;

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const alreadyUpvoted = issue.upvotes.some(
    (id) => id.toString() === userId.toString()
  );

  if (alreadyUpvoted) {
    // Remove the upvote
    issue.upvotes = issue.upvotes.filter(
      (id) => id.toString() !== userId.toString()
    );
  } else {
    issue.upvotes.push(userId);
  }

  await issue.save();

  res.status(200).json({
    upvoteCount: issue.upvotes.length,
    upvoted:     !alreadyUpvoted,
  });
});

// ─── @desc    Add a comment to an issue
// ─── @route   POST /api/issues/:id/comments
// ─── @access  Private
const addComment = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    res.status(400);
    throw new Error('Comment text is required');
  }

  const issue = await Issue.findById(req.params.id);
  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const comment = await Comment.create({
    issue: issue._id,
    user:  req.user._id,
    text:  text.trim(),
  });

  await comment.populate('user', 'name role');

  res.status(201).json(comment);
});

// ─── @desc    Get all comments for an issue
// ─── @route   GET /api/issues/:id/comments
// ─── @access  Public
const getComments = asyncHandler(async (req, res) => {
  const issue = await Issue.findById(req.params.id).select('_id');

  if (!issue) {
    res.status(404);
    throw new Error('Issue not found');
  }

  const comments = await Comment.find({ issue: issue._id })
    .sort({ createdAt: 1 }) // oldest first
    .populate('user', 'name role');

  res.status(200).json(comments);
});

module.exports = {
  createIssue,
  getIssues,
  getIssueById,
  updateIssue,
  deleteIssue,
  getMyIssues,
  toggleUpvote,
  addComment,
  getComments,
};
