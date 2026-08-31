const asyncHandler              = require('express-async-handler');
const mongoose                  = require('mongoose');
const EmergencyReport           = require('../models/EmergencyReport');
const cloudinary                = require('../config/cloudinary');
const { notifyAdminsEmergency } = require('../utils/notify');

// ─── Static emergency-number dataset ──────────────────────────────────────────
// Loaded once at startup; never queried from an LLM — every entry in this file
// was manually verified against Wikipedia and official sources.
const EMERGENCY_NUMBERS = require('../data/emergencyNumbers.json');

// ─── cleanupFiles ─────────────────────────────────────────────────────────────
// Deletes every asset in `files` from Cloudinary using Promise.allSettled so a
// single failing destroy never prevents the others from being attempted.
// Called whenever validation fails AFTER files have already been uploaded, to
// prevent orphaned media accumulating in the emergency-reports folder.
const cleanupFiles = async (files = []) => {
  if (!files.length) return;
  await Promise.allSettled(
    files.map((f) => {
      const resourceType =
        f.mimetype?.startsWith('video/') || f.resource_type === 'video'
          ? 'video'
          : 'image';
      return cloudinary.uploader
        .destroy(f.filename, { resource_type: resourceType })
        .catch((e) =>
          console.error(
            `[emergencyController] Cloudinary cleanup failed for ${f.filename}:`,
            e.message
          )
        );
    })
  );
};

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
//
// Expects multipart/form-data with:
//   type, description, location (JSON string or object), and up to 5 files
//   in the 'media' field — processed by uploadEmergencyMedia +
//   checkVideoDurations BEFORE this handler runs.
//
// If validation fails here (after the upload middleware has already sent files
// to Cloudinary), cleanupFiles() deletes every just-uploaded asset so nothing
// is left orphaned in the emergency-reports Cloudinary folder.
const createEmergencyReport = asyncHandler(async (req, res) => {
  const uploadedFiles = req.files || [];

  // ── Helper: reject with cleanup ───────────────────────────────────────────
  // Inline so we can return a throw-style error without losing the status code.
  const rejectWithCleanup = async (statusCode, message) => {
    await cleanupFiles(uploadedFiles);
    res.status(statusCode);
    throw new Error(message);
  };

  // ── Parse location ────────────────────────────────────────────────────────
  // The form is submitted as multipart/form-data (because of file uploads).
  // FormData cannot natively represent nested objects so the frontend sends
  // location as JSON.stringify({ address, latitude, longitude }).  We handle
  // both the stringified and already-parsed cases.
  let location;
  try {
    location =
      typeof req.body.location === 'string'
        ? JSON.parse(req.body.location)
        : req.body.location;
  } catch {
    await rejectWithCleanup(400, 'Invalid location format — expected a JSON object');
  }

  const { type, description } = req.body;

  // ── Presence validation ───────────────────────────────────────────────────
  if (!type) {
    await rejectWithCleanup(400, 'Emergency type is required');
  }
  if (!description || !String(description).trim()) {
    await rejectWithCleanup(400, 'Description is required');
  }
  if (!location?.address) {
    await rejectWithCleanup(400, 'Location with a valid address is required');
  }
  if (location?.latitude === undefined || location?.longitude === undefined) {
    await rejectWithCleanup(
      400,
      'Location latitude and longitude are required'
    );
  }

  // ── Type enum validation ──────────────────────────────────────────────────
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
    await rejectWithCleanup(
      400,
      `Invalid emergency type. Must be one of: ${VALID_TYPES.join(', ')}`
    );
  }

  // ── Build media array from uploaded files ─────────────────────────────────
  // multer-storage-cloudinary v4 spreads the full Cloudinary API response onto
  // each file object, giving us:
  //   f.path          — the Cloudinary secure_url (used as the stored URL)
  //   f.resource_type — 'image' or 'video' as determined by Cloudinary
  //   f.duration      — seconds of video (present only for video resources)
  //   f.filename      — public_id (used by cleanupFiles for destroy calls)
  const media = uploadedFiles.map((f) => {
    const isVideo =
      f.mimetype?.startsWith('video/') || f.resource_type === 'video';
    return {
      url:  f.path,                                        // Cloudinary secure_url
      type: isVideo ? 'video' : 'image',
      // durationSeconds is only meaningful for video; omit the key for images
      // so the schema's optional field doesn't store a spurious null/undefined.
      ...(isVideo && typeof f.duration === 'number'
        ? { durationSeconds: f.duration }
        : {}),
    };
  });

  // ── Persist ───────────────────────────────────────────────────────────────
  const report = await EmergencyReport.create({
    reporter:    req.user._id,
    type,
    description: String(description).trim(),
    location: {
      address:   location.address,
      latitude:  parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
    },
    media,
    status: 'New',
  });

  // Notify all admins (fire-and-forget) ──────────────────────────────────
  // Wrapped in try/catch + .catch() so any failure here never prevents the
  // 201 response from reaching the reporter — their submission always succeeds.
  try {
    notifyAdminsEmergency(report).catch((err) =>
      console.error(
        '[createEmergencyReport] notifyAdminsEmergency unhandled rejection:',
        err.message
      )
    );
  } catch (err) {
    console.error(
      '[createEmergencyReport] notifyAdminsEmergency threw synchronously:',
      err.message
    );
  }

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


// ─── @desc    Look up emergency telephone numbers for a country (public)
// ─── @route   GET /api/emergency-reports/emergency-number?country=XX
// ─── @access  Public — no auth required (call before login is possible)
//
// Returns the verified numbers from emergencyNumbers.json, or a 404 if the
// country code is not in the dataset.  The client MUST fall back to a generic
// "dial your local emergency number" message on 404 — never show a guessed
// number.  Numbers are sourced from a static, human-verified JSON file, NOT
// generated by a language model.
const getEmergencyNumber = asyncHandler(async (req, res) => {
  // Accept either uppercase or lowercase ISO 3166-1 alpha-2 codes
  const countryCode = (req.query.country || '').toUpperCase().trim();

  if (!countryCode || countryCode.length !== 2) {
    res.status(400);
    throw new Error(
      'Missing or invalid country parameter. ' +
      'Provide a 2-letter ISO 3166-1 alpha-2 code, e.g. ?country=NG'
    );
  }

  // Skip the _meta key — it is not a country entry
  const entry = EMERGENCY_NUMBERS[countryCode];

  if (!entry) {
    // Not found — client must show a generic fallback, not attempt to guess
    res.status(404).json({
      found:       false,
      countryCode,
      message:
        `Emergency numbers for country code "${countryCode}" are not in the ` +
        'CivicFix dataset. Please dial your local emergency number.',
    });
    return;
  }

  res.status(200).json({
    found:       true,
    countryCode,
    numbers:     entry,
    // Surface the data's verification date so clients can display it if desired
    lastVerified: EMERGENCY_NUMBERS._meta?.lastVerified || null,
  });
});


module.exports = {
  createEmergencyReport,
  getMyEmergencyReports,
  getAllEmergencyReports,
  acknowledgeReport,
  updateReportStatus,
  getEmergencyNumber,
};
