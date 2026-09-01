/**
 * middleware/emergencyUploadMiddleware.js
 *
 * ⚠️  DEPRECATED — no longer wired to any route.
 *
 * This file is kept to avoid breaking any test files that import from it
 * directly.  It should not be imported in production code.
 *
 * WHY IT WAS REMOVED:
 *   The emergency-report media upload flow was migrated to direct browser-to-
 *   Cloudinary uploads (signed server-side via GET /upload-signature) to
 *   sidestep Vercel's platform-level ~4.5 MB request body limit, which was
 *   causing a raw 413 before Express/Multer ever ran on large phone photos.
 *
 *   The POST /api/emergency-reports route now accepts a plain JSON body
 *   containing already-uploaded Cloudinary asset descriptors.  Server-side
 *   video duration enforcement is now in createEmergencyReport via the
 *   Cloudinary Admin API rather than this middleware.
 *
 * RELATED RISK (out of scope for this fix):
 *   The regular issue-photo upload path (issueRoutes.js → uploadMiddleware.js)
 *   still uses multipart/form-data and will hit the same platform ceiling if a
 *   user submits a sufficiently large photo there.
 *
 * Original purpose (preserved below for reference):
 *   Dedicated upload stack for EmergencyReport media.  Kept separate from
 *   uploadMiddleware.js because the two have materially different requirements:
 *
 *   Feature              | uploadMiddleware (issues)  | this file (emergency)
 *   ─────────────────────┼───────────────────────────┼──────────────────────
 *   Cloudinary folder    | civicfix/issues            | civicfix/emergency-reports
 *   Allowed types        | images only                | images + short video
 *   Max file size        | 5 MB                       | 25 MB
 *   resource_type        | image (default)            | auto (image OR video)
 *   Duration gate        | n/a                        | ≤ 15 s (16 s with buffer)
 *   Eager transformation | none                       | 720p / 2 Mbps cap (video)
 *
 * Exports two Express middlewares that are chained in the route:
 *
 *   protect → uploadEmergencyMedia → checkVideoDurations → createEmergencyReport
 *
 * uploadEmergencyMedia  — streams files to Cloudinary, enforces size cap and
 *                          MIME type list BEFORE any asset is fully stored.
 *                          Converts MulterErrors to consistent HTTP responses.
 *
 * checkVideoDurations   — inspects the Cloudinary response (available on
 *                          req.files after upload) for video duration.
 *                          If any clip exceeds 16 s the whole submission is
 *                          rejected and ALL just-uploaded assets are deleted
 *                          so nothing is left orphaned on Cloudinary.
 */


const multer                = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary            = require('../config/cloudinary');

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES       = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES_PER_REPORT      = 5;
// 15-second user-facing cap + 1-second buffer for encoding rounding.
// Cloudinary's `duration` field is the authoritative source; client-side timers
// can be bypassed by a modified client — this is the server-side backstop.
const MAX_VIDEO_DURATION_SECONDS = 16;

// ─── Allowed MIME types ───────────────────────────────────────────────────────
const ALLOWED_IMAGE_MIMETYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];
const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/quicktime', // .mov — common iOS export format
  'video/webm',
];
const ALL_ALLOWED_MIMETYPES = [...ALLOWED_IMAGE_MIMETYPES, ...ALLOWED_VIDEO_MIMETYPES];

// ─── CloudinaryStorage ────────────────────────────────────────────────────────
// `params` is a function so we can apply video-specific settings only when the
// uploaded file is actually a video — the `resource_type: 'auto'` option is
// required on all files so Cloudinary correctly identifies each one regardless.
const emergencyStorage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => {
    const isVideo = file.mimetype.startsWith('video/');

    const base = {
      folder:          'civicfix/emergency-reports',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
      // 'auto' lets Cloudinary detect image vs video from the content stream —
      // required to handle both types through a single StorageEngine instance.
      resource_type:   'auto',
    };

    if (!isVideo) return base;

    // ── Video-specific settings ───────────────────────────────────────────────
    // eager: cap the stored rendition at 720p / 2 Mbps via Cloudinary's
    //        server-side transcoding.  This acts as a final safety net even
    //        if a client bypasses the frontend file-size / resolution constraints.
    // eager_async: true — Cloudinary responds with the original upload immediately
    //        and transcodes in the background; the duration field on the response
    //        reflects the original clip, which is what we need for our gate.
    return {
      ...base,
      eager: [
        {
          width:       1280,
          height:      720,
          crop:        'limit',      // never upscale — only shrink if needed
          quality:     'auto:good',
          bit_rate:    '2m',         // 2 Mbps — comfortable for 720p at 15 s
          video_codec: 'auto',       // let Cloudinary pick h.264 / vp9 as appropriate
        },
      ],
      eager_async: true,
    };
  },
});

// ─── File-type filter ─────────────────────────────────────────────────────────
// Runs before the file is streamed to Cloudinary — unknown MIME types are
// rejected immediately with no upload attempt.
const fileFilter = (_req, file, cb) => {
  if (ALL_ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(null, true);
  }
  cb(
    new multer.MulterError(
      'LIMIT_UNEXPECTED_FILE',
      'Only JPG, PNG, WEBP images and MP4, MOV, WEBM videos are allowed'
    ),
    false
  );
};

// ─── Multer instance ──────────────────────────────────────────────────────────
const upload = multer({
  storage:    emergencyStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,    // enforced before Cloudinary upload begins
    files:    MAX_FILES_PER_REPORT,   // max 5 per submission
  },
});

// ─── uploadEmergencyMedia ─────────────────────────────────────────────────────
// Wraps upload.array() in a callback-to-next bridge so MulterErrors become
// proper HTTP responses rather than crashing the default error handler.
//
//   LIMIT_FILE_SIZE  → 413 with a human-readable message
//   other MulterError → 400
//   non-Multer error  → 500 (Cloudinary connection failure, etc.)
//
// When the size cap is hit, Multer aborts the multipart stream before the
// file is fully sent to Cloudinary — no orphaned asset, no cleanup needed.
const uploadEmergencyMedia = (req, res, next) => {
  upload.array('media', MAX_FILES_PER_REPORT)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const isTooBig = err.code === 'LIMIT_FILE_SIZE';
      res.status(isTooBig ? 413 : 400);
      return next(
        new Error(
          isTooBig
            ? `File too large — each file must be under ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB. ` +
              'Please compress or trim before submitting.'
            : err.message || 'File upload error'
        )
      );
    }

    // Non-Multer error (network / Cloudinary API failure)
    console.error('[emergency-upload] Unexpected upload error:', err.message);
    res.status(500);
    return next(new Error('Media upload failed — please try again'));
  });
};

// ─── checkVideoDurations ──────────────────────────────────────────────────────
// Runs AFTER uploadEmergencyMedia so req.files is populated with the full
// Cloudinary API response (multer-storage-cloudinary v4 spreads the response
// onto each file object, exposing `duration`, `resource_type`, `filename`, etc.).
//
// If ANY video exceeds MAX_VIDEO_DURATION_SECONDS:
//   1. ALL uploaded assets are deleted from Cloudinary (not just the offending
//      clip — the whole submission is rejected, so keeping the others would
//      create orphans).
//   2. The request is failed with a descriptive 400 error.
const checkVideoDurations = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  // Identify overlong clips.  A file is a video when its MIME type starts with
  // 'video/' OR when Cloudinary set resource_type to 'video' on the response.
  const overlong = req.files.filter(
    (f) =>
      (f.mimetype?.startsWith('video/') || f.resource_type === 'video') &&
      typeof f.duration === 'number' &&
      f.duration > MAX_VIDEO_DURATION_SECONDS
  );

  if (overlong.length === 0) return next();

  // ── Delete ALL uploaded assets before rejecting ────────────────────────────
  const destroyAll = req.files.map((f) => {
    const resourceType =
      f.mimetype?.startsWith('video/') || f.resource_type === 'video'
        ? 'video'
        : 'image';
    return cloudinary.uploader
      .destroy(f.filename, { resource_type: resourceType })
      .catch((e) =>
        // Log but never rethrow — cleanup failure must not mask the real error.
        console.error(
          `[emergency-upload] Cloudinary cleanup failed for ${f.filename}:`,
          e.message
        )
      );
  });

  await Promise.allSettled(destroyAll);

  // Clear req.files so the controller cannot accidentally use the now-deleted URLs.
  req.files = [];

  const durationsStr = overlong
    .map((f) => `${Math.ceil(f.duration)}s`)
    .join(', ');

  res.status(400);
  next(
    new Error(
      `Video too long — maximum ${MAX_VIDEO_DURATION_SECONDS - 1} seconds allowed ` +
      `(submitted: ${durationsStr}). Please trim your clip and resubmit.`
    )
  );
};

module.exports = {
  uploadEmergencyMedia,
  checkVideoDurations,
  MAX_VIDEO_DURATION_SECONDS,
};
