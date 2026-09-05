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
        // Auto-created when a resident activates live location sharing.
        // Distinct from witnessed-incident types so admins can filter and
        // render the live map panel rather than a static location label.
        'Live Location SOS',
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

    // ── Optional contact phone number ─────────────────────────────────────────
    // Stored in E.164 format (e.g. "+2348012345678") — a single combined string
    // that already includes the country calling code.  This is the normalized
    // output produced by libphonenumber-js (via react-phone-number-input on the
    // client), not a raw user-typed string.
    //
    // Optional: some reporters may not want to share a direct call-back number,
    // and the reporter's account email is already available on the User document.
    // When present, it is surfaced in:
    //   - notifyAdminsEmergency (the alert email)
    //   - EmergencyDetail.jsx (the admin detail view)
    contactPhone: {
      type:  String,
      trim:  true,
      match: [
        /^\+\d{7,15}$/,
        'contactPhone must be a valid E.164 number (e.g. "+2348012345678")',
      ],
    },

    // ── Lifecycle status ─────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['New', 'Acknowledged', 'Escalated', 'Resolved', 'False Alarm'],
      default: 'New',
      // Index declared as a compound below — do NOT add index:true here;
      // that would create a redundant single-field index alongside the compound.
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

// ─── Indexes ──────────────────────────────────────────────────────────────────
// getAllEmergencyReports aggregation sorts by a computed _statusOrder field
// (derived from status) then by createdAt descending within each status bucket.
// The compound index lets MongoDB service the most-latency-sensitive branch:
// 'New' reports (status = 'New') sorted newest-first, which is also the
// staleNew $match in getEmergencyStats ({ status:'New', createdAt:{ $lt:X } }).
// ESR guidance: status (equality) → createdAt (sort/range).
emergencyReportSchema.index({ status: 1, createdAt: -1 });

// getMyEmergencyReports: EmergencyReport.find({ reporter: userId }).
// reporter already has index:true declared inline above.

module.exports = mongoose.model('EmergencyReport', emergencyReportSchema);
