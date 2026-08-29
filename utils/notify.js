const Notification = require('../models/Notification');
const Issue        = require('../models/Issue');

/**
 * notifyStatusChange(issueId, recipientId, newStatus)
 *
 * Creates a single Notification document for the issue reporter whenever
 * any status change is committed. All three status-changing controllers
 * (adminController.assignIssue, adminController.updateIssueStatus,
 * staffController.updateProgress) call this one helper — message wording
 * is centralised here so it never drifts out of sync.
 *
 * The helper is deliberately fire-and-forget: if it throws (e.g. the
 * issue lookup fails), the error is swallowed so it never surfaces as an
 * HTTP 500 for the admin/staff user who triggered the status change.
 * Notifications are a best-effort feature; they must not block core actions.
 *
 * @param {string|ObjectId} issueId     — the issue whose status changed
 * @param {string|ObjectId} recipientId — the reporter (reportedBy) user id
 * @param {string}          newStatus   — the status just written to the DB
 */
async function notifyStatusChange(issueId, recipientId, newStatus) {
  try {
    // We need the human-readable issueId (e.g. "CF-2026-00124"), not the _id.
    // Fetch only that field to keep this lightweight.
    const issue = await Issue.findById(issueId).select('issueId').lean();

    if (!issue) return; // issue was deleted between status write and notify — skip

    const message = `Your report ${issue.issueId} status changed to ${newStatus}`;

    await Notification.create({
      recipient: recipientId,
      issue:     issueId,
      message,
    });
  } catch (err) {
    // Log for observability but never re-throw — notifications are non-critical
    console.error('[notify] notifyStatusChange failed:', err.message);
  }
}

module.exports = { notifyStatusChange };
