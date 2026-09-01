const mongoose = require('mongoose');

// ─── Media sub-schema ─────────────────────────────────────────────────────────
// A lightweight attachment record.  `durationSeconds` is meaningful only for
// video clips (ignored for images), but storing it on the base schema avoids
// a separate model and keeps queries simple.
const mediaSchema = new mongoose.Schema(
  {
    url: {
      type:     String,
      required: true,
      trim:     true,
    },
    type: {
      type:     String,
      enum:     ['image', 'video'],
      required: true,
    },
    // Seconds of video footage — populated by the upload handler (Prompt 2).
    // Optional and intentionally absent for image attachments.
    durationSeconds: {
      type: Number,
    },

    // Cloudinary public_id — stored so the server can call the Admin API to
    // re-verify video duration and call destroy() for cleanup.
    // Optional: absent for legacy documents created before the direct-upload
    // migration (those were stored without this field).
    publicId: {
      type: String,
      trim: true,
    },
  },
  { _id: false } // no extra ObjectId per attachment — url is the natural key
);

// ─── Location sub-schema ──────────────────────────────────────────────────────
// Address is the human-readable label (street, landmark, etc.).
// Lat/lng are captured from the device GPS or map picker.
// All three are required — first responders need every bit of information
// in an active emergency.
const locationSchema = new mongoose.Schema(
  {
    address: {
      type:     String,
      required: [true, 'Location address is required'],
      trim:     true,
    },
    latitude: {
      type:     Number,
      required: [true, 'Location latitude is required'],
    },
    longitude: {
      type:     Number,
      required: [true, 'Location longitude is required'],
    },
  },
  { _id: false }
);

// ─── EmergencyReport schema ───────────────────────────────────────────────────
/**
 * EmergencyReport
 *
 * Strictly private resource — visible only to the reporter themselves
 * (via getMyEmergencyReports) and to admin users (via getAllEmergencyReports).
 * Never exposed to staff or the public.
 *
 * Lifecycle:
 *   New → Acknowledged → Escalated → Resolved
 *                                  → False Alarm
 *
 * Intentionally NOT a category on the existing Issue model: visibility rules,
 * urgency, and lifecycle are fundamentally different from civic issue reports.
 */
const emergencyReportSchema = new mongoose.Schema(
  {
    // ── Who reported it ───────────────────────────────────────────────────────
    // Always required — anonymous emergency reports defeat the purpose of
    // follow-up contact and accountability.
    reporter: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Reporter is required'],
      index:    true,   // fast lookup for getMyEmergencyReports
    },

    // ── What kind of emergency ────────────────────────────────────────────────
    type: {
      type:     String,
      enum:     [
        'Armed Robbery',
        'Physical Assault / Violence',
        'Domestic Violence',
        'Fire',
        'Medical Emergency',
        'Kidnapping / Abduction',
        'Active Threat',
        'Other Life-Threatening Emergency',
      ],
      required: [true, 'Emergency type is required'],
    },

    // ── What is happening ─────────────────────────────────────────────────────
    description: {
      type:     String,
      required: [true, 'Description is required'],
      trim:     true,
    },

    // ── Where it is happening ─────────────────────────────────────────────────
    // The single most critical field — embedded sub-document so all three
    // fields (address, lat, lng) are validated atomically.
    location: {
      type:     locationSchema,
      required: [true, 'Location is required'],
    },

    // ── Evidence / media attachments ──────────────────────────────────────────
    // Populated by the upload handler introduced in Prompt 2.
    // An empty array is valid (no photos/video at time of report).
    media: {
      type:    [mediaSchema],
      default: [],
    },

    // ── Lifecycle status ──────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['New', 'Acknowledged', 'Escalated', 'Resolved', 'False Alarm'],
      default: 'New',
      index:   true,  // used in the admin sort (New first)
    },

    // ── Admin acknowledgement ─────────────────────────────────────────────────
    // Deliberately separate from status to preserve both "who acted on this"
    // and "when" — useful for audit and for reassuring the reporter.
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
    acknowledgedAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

module.exports = mongoose.model('EmergencyReport', emergencyReportSchema);
