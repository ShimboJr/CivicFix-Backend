const mongoose = require('mongoose');

/**
 * Notification — stores in-app alerts for a single user.
 *
 * Used for three distinct notification paths:
 *   1. Issue status changes     → recipient is the reporter; issue is set
 *   2. New issue (admin)        → recipient is an admin; issue is the new issue
 *   3. Emergency report (admin) → recipient is an admin; issue is absent;
 *                                  priority is 'urgent'; category is 'emergency'
 *
 * `issue` is intentionally optional (required: false) to support path 3 above.
 * All existing callers that always supply an issue ref continue to work unchanged.
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
    // Optional — absent for emergency-report notifications which have no
    // corresponding Issue document.  Required for all other notification types.
    issue: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Issue',
      required: false,         // was `required: true` — relaxed for emergency path
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
