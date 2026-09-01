const mongoose = require('mongoose');

/**
 * Notification — stores in-app alerts for a single user.
 *
 * Used for four distinct notification paths:
 *   1. Issue status changes     → recipient is reporter; `issue` is set
 *   2. New issue (admin)        → recipient is an admin; `issue` is the new issue
 *   3. Staff assignment         → recipient is staff;   `issue` is the first assigned issue
 *   4. Emergency report (admin) → recipient is an admin; `emergencyReport` is set;
 *                                  `issue` is intentionally absent;
 *                                  priority is 'urgent'; category is 'emergency'
 *
 * WHY TWO SEPARATE OPTIONAL FIELDS:
 *   `issue` is a Mongoose ref pointing at the Issue collection.  Storing an
 *   EmergencyReport ObjectId there causes Mongoose's populate() to look for a
 *   matching Issue document, find nothing, and return null — triggering the
 *   "(issue no longer available)" fallback in the frontend even for a perfectly
 *   healthy emergency report.  The fix is a separate `emergencyReport` field
 *   pointing at the correct collection.
 *
 * `priority` lets the NotificationBell apply a red/urgent accent to emergency
 * notifications so they stand out visually from routine civic-issue reports.
 *
 * `category` lets client code filter or group by notification type without
 * having to parse the message string.
 */
const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,          // fast lookup by user
    },
    // Optional — absent for emergency-report notifications (path 4 above).
    // Required for all other notification types (paths 1–3).
    issue: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Issue',
      required: false,
      default:  undefined,
    },

    // Set ONLY for emergency-report notifications (path 4).
    // Stored separately from `issue` because `issue` is a ref to the Issue
    // collection — populating an EmergencyReport ObjectId through it always
    // returns null and triggers the "no longer available" fallback incorrectly.
    emergencyReport: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'EmergencyReport',
      required: false,
      default:  undefined,
    },
    message: {
      type:     String,
      required: true,
      trim:     true,
    },
    read: {
      type:    Boolean,
      default: false,
    },
    // ── Visual / filtering metadata ─────────────────────────────────────────
    // `priority: 'urgent'` is set on emergency-report notifications so the
    // NotificationBell can render them with a red accent rather than the
    // default styling used for routine pothole / streetlight reports.
    priority: {
      type:    String,
      enum:    ['normal', 'urgent'],
      default: 'normal',
    },
    // `category` lets client code distinguish emergency alerts from routine
    // issue-lifecycle notifications without parsing the message string.
    category: {
      type:    String,
      enum:    ['issue', 'emergency'],
      default: 'issue',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
