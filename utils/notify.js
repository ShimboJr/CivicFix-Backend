const Notification            = require('../models/Notification');
const Issue                   = require('../models/Issue');
const User                    = require('../models/User');
const { transporter, FROM_ADDRESS } = require('../config/email');

/**
 * notifyStatusChange(issueId, recipientId, newStatus)
 *
 * Creates a single Notification document for the issue reporter whenever
 * any status change is committed. All three status-changing controllers
 * (adminController.assignIssue, adminController.updateIssueStatus,
 * staffController.updateProgress) call this one helper — message wording
 * is centralised here so it never drifts out of sync.
 *
 * After the in-app Notification document is saved, a plain-text status-update
 * email is dispatched via the configured SMTP transporter.  Both effects are
 * independently wrapped in try/catch so a failure in either one never blocks
 * or surfaces to the HTTP caller.
 *
 * @param {string|ObjectId} issueId     — the issue whose status changed
 * @param {string|ObjectId} recipientId — the reporter (reportedBy) user id
 * @param {string}          newStatus   — the status just written to the DB
 */
async function notifyStatusChange(issueId, recipientId, newStatus) {
  // ── Step 1: in-app Notification (unchanged behaviour) ────────────────────
  let humanIssueId; // reused in the email step below

  try {
    // Fetch only the human-readable issueId field (e.g. "CF-2026-00124")
    const issue = await Issue.findById(issueId).select('issueId').lean();

    if (!issue) return; // issue deleted between status write and notify — skip

    humanIssueId = issue.issueId;
    const message = `Your report ${humanIssueId} status changed to ${newStatus}`;

    await Notification.create({
      recipient: recipientId,
      issue:     issueId,
      message,
    });
  } catch (err) {
    // Log for observability but never re-throw — notifications are non-critical
    console.error('[notify] in-app notification failed:', err.message);
    return; // No point trying to email if we couldn't even read the issue
  }

  // ── Step 2: email delivery (fire-and-forget, never throws) ───────────────
  // Guard: skip silently if SMTP is not configured
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  try {
    // Fetch the recipient's email address
    const user = await User.findById(recipientId).select('email name').lean();
    if (!user?.email) return; // no email on record — nothing to send

    const subject = `CivicFix — ${humanIssueId} status update`;
    const text    = [
      `Hi ${user.name || 'there'},`,
      '',
      `Your report ${humanIssueId} has been updated.`,
      `New status: ${newStatus}`,
      '',
      'Log in to CivicFix to view the full details and track progress.',
      '',
      '— The CivicFix Team',
    ].join('\n');

    const info = await transporter.sendMail({
      from:    FROM_ADDRESS,
      to:      user.email,
      subject,
      text,
    });

    // ── Ethereal dev preview URL ──────────────────────────────────────────
    // Ethereal is a catch-all test inbox — clicking this URL shows exactly
    // what the recipient would have received, without sending a real email.
    const isEthereal = (process.env.SMTP_HOST || '').toLowerCase().includes('ethereal');
    if (isEthereal) {
      const { getTestMessageUrl } = require('nodemailer');
      const previewUrl = getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[notify] 📧  Ethereal preview → ${previewUrl}`);
      }
    } else {
      console.log(`[notify] 📧  Email sent to ${user.email} (messageId: ${info.messageId})`);
    }
  } catch (err) {
    // A flaky SMTP connection or bad credentials must never break the
    // underlying status-change request — log and swallow.
    console.error('[notify] email delivery failed:', err.message);
  }
}

module.exports = { notifyStatusChange };
