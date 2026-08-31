const mongoose = require('mongoose');

/**
 * AuditLog — one document per status change on an issue.
 *
 * This is a queryable historical record, separate from the comment thread.
 * Comments are transient discussion; audit entries are a tamper-evident log.
 *
 * Fields
 * ──────
 *   issue      — which issue was changed
 *   changedBy  — the admin or staff member who made the change (req.user._id)
 *   fromStatus — issue.status BEFORE the write
 *   toStatus   — issue.status AFTER the write
 *   reason     — optional; populated for rejections from Issue.rejectionReason
 *   createdAt  — the meaningful timestamp (when the change happened)
 */
const auditLogSchema = new mongoose.Schema(
  {
    issue: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Issue',
      required: true,
      index:    true,   // queried by issue id on every detail page load
    },
    changedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    fromStatus: { type: String, required: true },
    toStatus:   { type: String, required: true },
    reason:     { type: String },   // populated for 'Rejected' transitions
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
