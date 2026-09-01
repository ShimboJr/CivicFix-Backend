const asyncHandler              = require('express-async-handler');
const mongoose                  = require('mongoose');
const EmergencyReport           = require('../models/EmergencyReport');
const cloudinary                = require('../config/cloudinary');
const { notifyAdminsEmergency } = require('../utils/notify');

// ─── Constants ─────────────────────────────────────────────────────────────────
// 15-second user-facing cap + 1-second buffer for encoding rounding.
// The server re-fetches this from Cloudinary's Admin API for every video in the
// submitted media array — the client-reported value is NEVER trusted.
const MAX_VIDEO_DURATION_SECONDS = 16;

// ─── Static emergency-number dataset ──────────────────────────────────────────
// Loaded once at startup; never queried from an LLM — every entry in this file
// was manually verified against Wikipedia and official sources.
const EMERGENCY_NUMBERS = require('../data/emergencyNumbers.json');

// ─── cleanupFiles ─────────────────────────────────────────────────────────────
// Deletes every asset in `mediaItems` from Cloudinary using Promise.allSettled
// so a single failing destroy never prevents the others from being attempted.
//
// Accepts an array of plain objects shaped as:
//   { publicId: string, type: 'image' | 'video' }
//
// Called whenever validation fails AFTER files have already been uploaded to
// Cloudinary directly from the browser, to prevent orphaned media accumulating
// in the emergency-reports Cloudinary folder.
const cleanupFiles = async (mediaItems = []) => {
  if (!mediaItems.length) return;
  await Promise.allSettled(
    mediaItems.map(({ publicId, type }) => {
      if (!publicId) return Promise.resolve(); // nothing to clean up
      const resourceType = type === 'video' ? 'video' : 'image';
      return cloudinary.uploader
        .destroy(publicId, { resource_type: resourceType })
        .catch((e) =>
          console.error(
            `[emergencyController] Cloudinary cleanup failed for ${publicId}:`,
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
// Expects a plain JSON body (Content-Type: application/json) with:
//   type, description, location { address, latitude, longitude },
//   media (optional array of already-uploaded Cloudinary assets):
//     [{ url, type, durationSeconds, publicId }, …]
//
// The file bytes have already been uploaded directly from the browser to
// Cloudinary before this endpoint is called — no multipart/form-data,
// no Multer middleware on this route.
//
// For every video entry, this handler independently re-fetches the
// authoritative duration from Cloudinary's Admin API and rejects (+ destroys)
// any clip that exceeds MAX_VIDEO_DURATION_SECONDS.  The client-reported
// durationSeconds value is NEVER trusted — a tampered client could lie
// about duration to bypass the cap.
//
// If any validation fails after assets are already uploaded, cleanupFiles()
// deletes every asset that was part of this submission so nothing is left
// orphaned in the Cloudinary folder.
const createEmergencyReport = asyncHandler(async (req, res) => {
  // `media` is an array of already-uploaded asset descriptors from the browser.
  // We normalise it to [] if absent so the rest of the handler is uniform.
  const submittedMedia = Array.isArray(req.body.media) ? req.body.media : [];

  // ── Helper: reject with cleanup ───────────────────────────────────────────
  // Deletes every asset that was uploaded as part of this submission attempt
  // before throwing — prevents orphaned media in the Cloudinary folder.
  const rejectWithCleanup = async (statusCode, message) => {
    await cleanupFiles(submittedMedia);
    res.status(statusCode);
    throw new Error(message);
  };

  // ── Parse + validate location ─────────────────────────────────────────────
  // Body is plain JSON now — no multipart parsing needed.
  const location = req.body.location;

  const { type, description, contactPhone } = req.body;

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

  // ── Media count validation ────────────────────────────────────────────────
  if (submittedMedia.length > 5) {
    await rejectWithCleanup(400, 'Maximum 5 media files are allowed per report');
  }

  // ── Per-item shape validation + server-side video duration gate ───────────
  // For each video, we call Cloudinary's Admin API to get the REAL duration.
  // The client-reported durationSeconds is logged for debugging but NEVER used
  // for enforcement — a tampered client could send any value it likes.
  const verifiedMedia = [];
  const toDestroy     = []; // assets we need to clean up on rejection

  for (const item of submittedMedia) {
    const { url, type: mediaType, publicId } = item;

    if (!url || !mediaType) {
      await rejectWithCleanup(400, 'Each media item must include url and type');
    }
    if (!['image', 'video'].includes(mediaType)) {
      await rejectWithCleanup(400, `Invalid media type "${mediaType}" — must be 'image' or 'video'`);
    }

    if (mediaType === 'video') {
      if (!publicId) {
        await rejectWithCleanup(400, 'Video media items must include a publicId for server-side duration verification');
      }

      // Re-fetch authoritative duration from Cloudinary Admin API.
      // This is the real enforcement backstop — not Multer, not the client.
      let realDuration;
      try {
        const info  = await cloudinary.api.resource(publicId, { resource_type: 'video' });
        realDuration = info.duration; // seconds, float
      } catch (err) {
        console.error(
          `[createEmergencyReport] Failed to fetch Cloudinary metadata for ${publicId}:`,
          err.message
        );
        // If we can't verify, err on the safe side and reject
        toDestroy.push({ publicId, type: 'video' });
        await cleanupFiles([...toDestroy]);
        res.status(400);
        throw new Error(
          'Could not verify video duration — please re-upload and try again'
        );
      }

      if (realDuration > MAX_VIDEO_DURATION_SECONDS) {
        // Mark this specific asset for destruction; also clean up any already-
        // accepted assets so the whole submission is rolled back atomically.
        toDestroy.push({ publicId, type: 'video' });
        // Also queue everything already accepted for this submission
        verifiedMedia.forEach((m) => {
          if (m.publicId) toDestroy.push({ publicId: m.publicId, type: m.type });
        });
        await cleanupFiles(toDestroy);
        res.status(400);
        throw new Error(
          `Video too long — maximum ${MAX_VIDEO_DURATION_SECONDS - 1} seconds allowed ` +
          `(submitted clip is ${Math.ceil(realDuration)}s). Please trim your clip and resubmit.`
        );
      }

      verifiedMedia.push({
        url,
        type:            'video',
        durationSeconds: realDuration,  // use the authoritative value, not the client's
        publicId,
      });
    } else {
      // Image — no duration to verify
      verifiedMedia.push({
        url,
        type: 'image',
        ...(publicId ? { publicId } : {}),
      });
    }
  }

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
    media:  verifiedMedia,
    status: 'New',
    // Only write contactPhone when the reporter supplied one — keeps the field
    // absent from documents where no number was provided rather than storing ''.
    ...(contactPhone ? { contactPhone: String(contactPhone).trim() } : {}),
  });

  // Notify all admins (fire-and-forget) ──────────────────────────────────────
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


// ─── @desc    Fetch a single emergency report by ID (admin detail view)
// ─── @route   GET /api/emergency-reports/:id
// ─── @access  Private, admin only
//
// Used by the EmergencyDetail page to display the full report, including all
// media, reporter contact details, acknowledgement info, and status controls.
// Returned in the same populated shape as getAllEmergencyReports so the frontend
// can reuse the same field names across both the list and detail views.
const getEmergencyReportById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  const report = await EmergencyReport.findById(req.params.id)
    .populate('reporter',       'name email phone')
    .populate('acknowledgedBy', 'name');

  if (!report) {
    res.status(404);
    throw new Error('Emergency report not found');
  }

  res.status(200).json(report);
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


// ─── @desc    Operational stats for the admin monitoring strip
// ─── @route   GET /api/emergency-reports/stats
// ─── @access  Private, admin only
//
// Returns three metrics in a single round-trip (all computed inside MongoDB
// via $facet so they run in parallel):
//
//   avgAckMinutes  — average minutes between createdAt and acknowledgedAt
//                    for all reports where acknowledgedAt is set.
//                    null when no reports have been acknowledged yet.
//
//   staleNewCount  — number of reports still in 'New' status that were
//                    submitted more than STALE_MINUTES ago (10 min, matching
//                    the threshold already used on individual report cards).
//
//   byType         — [{ type, count }] for ALL reports regardless of status,
//                    sorted by count descending.  Used as a short type-breakdown
//                    list in the stats strip.
const STATS_STALE_MINUTES = 10;

const getEmergencyStats = asyncHandler(async (_req, res) => {
  const staleThreshold = new Date(Date.now() - STATS_STALE_MINUTES * 60 * 1000);

  const [result] = await EmergencyReport.aggregate([
    {
      $facet: {
        // ── Facet 1: average acknowledgment time ──────────────────────────
        // Filter to reports that have been acknowledged (acknowledgedAt exists),
        // compute the diff in milliseconds, then average and convert to minutes.
        ackTime: [
          { $match: { acknowledgedAt: { $exists: true, $ne: null } } },
          {
            $group: {
              _id: null,
              avgMs: {
                $avg: {
                  $subtract: ['$acknowledgedAt', '$createdAt'],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              avgMinutes: {
                $round: [{ $divide: ['$avgMs', 60000] }, 1],
              },
            },
          },
        ],

        // ── Facet 2: stale unacknowledged reports ─────────────────────────
        // 'New' reports older than STATS_STALE_MINUTES minutes.
        staleNew: [
          {
            $match: {
              status:    'New',
              createdAt: { $lt: staleThreshold },
            },
          },
          { $count: 'count' },
        ],

        // ── Facet 3: count by type ────────────────────────────────────────
        // All reports, grouped by type, sorted by volume descending.
        byType: [
          {
            $group: {
              _id:   '$type',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          {
            $project: {
              _id:   0,
              type:  '$_id',
              count: 1,
            },
          },
        ],
      },
    },
  ]);

  res.status(200).json({
    avgAckMinutes:  result.ackTime[0]?.avgMinutes ?? null,
    staleNewCount:  result.staleNew[0]?.count     ?? 0,
    byType:         result.byType,
  });
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
  getEmergencyReportById,
  acknowledgeReport,
  updateReportStatus,
  getEmergencyNumber,
  getEmergencyStats,
};
