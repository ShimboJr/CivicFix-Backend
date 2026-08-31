const AuditLog = require('../models/AuditLog');

/**
 * logStatusChange — write one AuditLog entry for a status transition.
 *
 * Kept separate from utils/notify.js's notifyStatusChange intentionally:
 *   - notify.js  → transient, outbound (email/in-app notification to the reporter)
 *   - auditLog.js → persistent, inward-facing (queryable history for any viewer)
 *
 * Both are called from the same code paths but serve different purposes.
 *
 * Audit logging is best-effort — a failure here must never block or roll back
 * the status update that triggered it, so errors are caught and logged rather
 * than rethrown.  This mirrors the pattern used in deleteIssue's cleanup block.
 *
 * @param {ObjectId|string} issueId         — the issue being updated
 * @param {ObjectId|string} changedByUserId — req.user._id (admin or staff)
 * @param {string}          fromStatus      — issue.status BEFORE the write
 * @param {string}          toStatus        — issue.status AFTER the write
 * @param {string}          [reason]        — optional; rejection reason if present
 */
const logStatusChange = async (issueId, changedByUserId, fromStatus, toStatus, reason) => {
  try {
    await AuditLog.create({
      issue:      issueId,
      changedBy:  changedByUserId,
      fromStatus,
      toStatus,
      // Only write reason to the document if it's a non-empty string;
      // leaving it undefined keeps the field absent from the BSON document
      // rather than storing an explicit null.
      ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
    });
  } catch (err) {
    console.error('[auditLog] logStatusChange failed (non-fatal):', err.message);
  }
};

module.exports = { logStatusChange };
