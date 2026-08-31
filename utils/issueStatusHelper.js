'use strict';

/**
 * utils/issueStatusHelper.js
 *
 * Single shared helper for every place that changes an issue's status.
 * Both single-issue (adminController.assignIssue / updateIssueStatus) and
 * bulk (bulkAssignIssues / bulkRejectIssues) call this instead of duplicating
 * the notify + audit-log side-effects inline.
 *
 * This is the "one place to touch" guarantee: if the notification or audit-log
 * signature ever changes, update it here and everything that calls it picks up
 * the change automatically.
 */

const { notifyStatusChange } = require('./notify');
const { logStatusChange }    = require('./auditLog');

/**
 * changeIssueStatus — mutate an issue's status and fire all side-effects.
 *
 * @param {object}          opts
 * @param {mongoose.Document} opts.issue          — pre-fetched Mongoose document
 * @param {string}          opts.newStatus        — the target status string
 * @param {ObjectId|string} opts.changedByUserId  — req.user._id (admin or staff)
 * @param {ObjectId|string} [opts.assignedTo]     — only for 'Assigned' transitions
 * @param {string}          [opts.reason]         — rejection reason (optional)
 *
 * @returns {Promise<mongoose.Document>} — the saved document (populated by caller
 *   if needed; this helper does NOT populate to keep it lean for bulk calls)
 */
const changeIssueStatus = async ({ issue, newStatus, changedByUserId, assignedTo, reason }) => {
  // Capture the before-state so the audit log entry has a meaningful fromStatus.
  // Must happen before any mutation.
  const fromStatus = issue.status;

  // Apply mutations
  if (assignedTo !== undefined) {
    issue.assignedTo = assignedTo;
  }

  issue.status = newStatus;

  // Rejection reason: set when rejecting with a reason, clear when moving away
  if (newStatus === 'Rejected' && reason) {
    issue.rejectionReason = reason.trim();
  } else if (newStatus !== 'Rejected') {
    issue.rejectionReason = undefined;
  }

  await issue.save();

  // ── Side-effects (both best-effort — see utils/auditLog.js for rationale) ──

  // Notify the original reporter
  await notifyStatusChange(issue._id, issue.reportedBy, newStatus);

  // Write the audit log entry
  await logStatusChange(
    issue._id,
    changedByUserId,
    fromStatus,
    newStatus,
    newStatus === 'Rejected' ? reason : undefined
  );

  return issue;
};

module.exports = { changeIssueStatus };
