const asyncHandler      = require('express-async-handler');
const mongoose          = require('mongoose');
const EmergencyReport   = require('../models/EmergencyReport');

// ══════════════════════════════════════════════════════════════════════════════
//  VISIBILITY CONTRACT (enforced at route level, stated here for clarity)
//  ─────────────────────────────────────────────────────────────────────────
//  createEmergencyReport   → any authenticated user (protect)
//  getMyEmergencyReports   → any authenticated user (protect)  — own reports only
//  getAllEmergencyReports   → admin only (protect + authorize('admin'))
//  acknowledgeReport        → admin only (protect + authorize('admin'))
//  updateReportStatus       → admin only (protect + authorize('admin'))
//
//  Deliberately absent:
//    - No public read endpoint
//    - No staff access
//    - No upvote / comment functionality
//    - No endpoint exposing another resident's reports to them
// ══════════════════════════════════════════════════════════════════════════════


// ─── @desc    Submit a new emergency report
// ─── @route   POST /api/emergency-reports
// ─── @access  Private (any authenticated user)
const createEmergencyReport = asyncHandler(async (req, res) => {
  const { type, description, location, media } = req.body;

  // ── Basic presence checks ─────────────────────────────────────────────────
  if (!type) {
    res.status(400);
    throw new Error('Emergency type is required');
  }
  if (!description || !description.trim()) {
    res.status(400);
    throw new Error('Description is required');
  }
  if (!location || !location.address) {
    res.status(400);
    throw new Error('Location with a valid address is required');
  }
  if (location.latitude === undefined || location.longitude === undefined) {
    res.status(400);
    throw new Error('Location latitude and longitude are required');
  }

  // ── Validate enum ─────────────────────────────────────────────────────────
  const VALID_TYPES = [
    'Armed Robbery',
    'Physical Assault / Violence',
    'Domestic Violence',
    'Fire',
    'Medical Emergency',
    'Kidnapping / Abduction',
    'Active Threat',
    'Other Life-Threatening Emergency',
  ];
  if (!VALID_TYPES.includes(type)) {
    res.status(400);
    throw new Error(`Invalid emergency type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // ── Create ────────────────────────────────────────────────────────────────
  // Status defaults to 'New' via the schema; reporter is the authenticated user.
  // `media` is accepted as a pre-populated array from the request body — the
  // upload/processing pipeline (Prompt 2) will produce this array before
  // calling this endpoint.  An absent media field defaults to [] via the schema.
  const report = await EmergencyReport.create({
    reporter:    req.user._id,
    type,
    description: description.trim(),
    location:    {
      address:   location.address,
      latitude:  parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
    },
    media:       Array.isArray(media) ? media : [],
    status:      'New',
  });

  res.status(201).json(report);
});


// ─── @desc    Get the logged-in user's own submitted emergency reports
// ─── @route   GET /api/emergency-reports/my-reports
// ─── @access  Private (any authenticated user — OWN reports only)
//
// This is the reporter's feedback channel: they can see that their report
// was received and check whether an admin has acknowledged it yet.
const getMyEmergencyReports = asyncHandler(async (req, res) => {
  const reports = await EmergencyReport.find({ reporter: req.user._id })
    .sort({ createdAt: -1 })          // newest first
    .populate('acknowledgedBy', 'name'); // helpful context if already acknowledged

  res.status(200).json(reports);
});


// ─── @desc    Get ALL emergency reports (admin dashboard)
// ─── @route   GET /api/emergency-reports
// ─── @access  Private, admin only
//
// Sort order: 'New' reports are the most urgent (no one has looked at them).
// Within each status bucket, sort newest-first.
//
// We implement the custom status-priority sort in MongoDB's aggregation $addFields
// + $sort rather than in JS, so it works correctly on large datasets without
// pulling all documents into memory.
const getAllEmergencyReports = asyncHandler(async (_req, res) => {
  const reports = await EmergencyReport.aggregate([
    // ── Assign a numeric urgency score to each status ─────────────────────
    // Lower number = shown first.  'New' = 0 (most urgent, unacknowledged).
    {
      $addFields: {
        _statusOrder: {
          $switch: {
            branches: [
              { case: { $eq: ['$status', 'New'] },          then: 0 },
              { case: { $eq: ['$status', 'Acknowledged'] },  then: 1 },
              { case: { $eq: ['$status', 'Escalated'] },     then: 2 },
              { case: { $eq: ['$status', 'Resolved'] },      then: 3 },
              { case: { $eq: ['$status', 'False Alarm'] },   then: 4 },
            ],
            default: 9,
          },
        },
      },
    },

    // ── Primary: urgency order.  Secondary: newest first within each group ─
    { $sort: { _statusOrder: 1, createdAt: -1 } },

    // ── Drop the helper field from the output ─────────────────────────────
    { $unset: '_statusOrder' },

    // ── Populate reporter (name + email for follow-up contact) ────────────
    {
      $lookup: {
        from:         'users',
        localField:   'reporter',
        foreignField: '_id',
        pipeline:     [{ $project: { name: 1, email: 1, phone: 1 } }],
        as:           'reporter',
      },
    },
    // $lookup always produces an array — unwrap to a single object
    {
      $unwind: {
        path:                       '$reporter',
        preserveNullAndEmptyArrays: true, // keep the report even if user was deleted
      },
    },

    // ── Populate acknowledgedBy (name only for display) ───────────────────
    {
      $lookup: {
        from:         'users',
        localField:   'acknowledgedBy',
        foreignField: '_id',
        pipeline:     [{ $project: { name: 1 } }],
        as:           'acknowledgedBy',
      },
    },
    {
      $unwind: {
        path:                       '$acknowledgedBy',
        preserveNullAndEmptyArrays: true,
      },
    },
  ]);

  res.status(200).json(reports);
});


// ─── @desc    Acknowledge an emergency report
// ─── @route   PUT /api/emergency-reports/:id/acknowledge
// ─── @access  Private, admin only
//
// Sets status → 'Acknowledged', records WHICH admin acknowledged it and WHEN.
// The reporter's getMyEmergencyReports response will surface this — meaningful
// reassurance that a human has seen the report in an urgent situation.
const acknowledgeReport = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  const report = await EmergencyReport.findById(req.params.id);
  if (!report) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  // Idempotent guard — re-acknowledging an already-acknowledged report is a
  // no-op rather than an error; avoids confusion if admin double-clicks.
  if (report.status !== 'New') {
    return res.status(200).json({
      message: `Report is already in '${report.status}' status — no change made`,
      report,
    });
  }

  report.status          = 'Acknowledged';
  report.acknowledgedBy  = req.user._id;
  report.acknowledgedAt  = new Date();

  await report.save();

  await report.populate([
    { path: 'reporter',       select: 'name email' },
    { path: 'acknowledgedBy', select: 'name' },
  ]);

  res.status(200).json(report);
});


// ─── @desc    Update emergency report status (Escalated / Resolved / False Alarm)
// ─── @route   PUT /api/emergency-reports/:id/status
// ─── @access  Private, admin only
//
// 'New' and 'Acknowledged' are not valid targets here — 'New' is the initial
// default and 'Acknowledged' is set by the dedicated acknowledgeReport endpoint.
const updateReportStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  const VALID_STATUSES = ['Escalated', 'Resolved', 'False Alarm'];
  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400);
    throw new Error(
      `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}. ` +
      `Use the /acknowledge endpoint to set 'Acknowledged'.`
    );
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  const report = await EmergencyReport.findById(req.params.id);
  if (!report) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  report.status = status;
  await report.save();

  await report.populate([
    { path: 'reporter',       select: 'name email' },
    { path: 'acknowledgedBy', select: 'name' },
  ]);

  res.status(200).json(report);
});


module.exports = {
  createEmergencyReport,
  getMyEmergencyReports,
  getAllEmergencyReports,
  acknowledgeReport,
  updateReportStatus,
};
