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

/**
 * notifyAdminsNewIssue(issue)
 *
 * Fires after a resident successfully creates a new issue.
 * For every user with role 'admin' it:
 *   1. Creates an in-app Notification document.
 *   2. Sends an email (subject + rich-text body) via the shared transporter.
 *
 * Both steps are bundled per admin and the full fan-out uses Promise.allSettled,
 * so one admin's bad email address (or a transient SMTP hiccup) never stops the
 * remaining admins from being notified.
 *
 * The call site in createIssue wraps this in its own try/catch so that any
 * unexpected top-level failure here never blocks the HTTP 201 response sent to
 * the resident — their report always goes through.
 *
 * @param {import('../models/Issue')} issue — the freshly saved Issue document
 *                                            (must have at minimum: _id, issueId,
 *                                             title, category, severity, reportedBy)
 */
async function notifyAdminsNewIssue(issue) {
  // ── Resolve the human-readable reporter name ─────────────────────────────
  // `issue.reportedBy` may be an ObjectId (not yet populated) or an object
  // (already populated by createIssue's .populate() call).  We normalise both.
  let reporterName = 'a resident';
  try {
    if (issue.reportedBy?.name) {
      reporterName = issue.reportedBy.name;
    } else if (issue.reportedBy) {
      const reporter = await User.findById(issue.reportedBy).select('name').lean();
      if (reporter?.name) reporterName = reporter.name;
    }
  } catch {
    // Non-critical — fall back to the generic label
  }

  // ── Resolve a readable category label ───────────────────────────────────
  // category may be populated (object with .name) or still an ObjectId.
  const categoryLabel =
    typeof issue.category === 'object' && issue.category?.name
      ? issue.category.name
      : String(issue.category);

  const issueLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/issue/${issue._id}`;

  // ── Fetch all admins ─────────────────────────────────────────────────────
  const admins = await User.find({ role: 'admin' }).select('_id name email').lean();

  if (!admins.length) return; // nothing to do

  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
  const isEthereal = smtpConfigured &&
    (process.env.SMTP_HOST || '').toLowerCase().includes('ethereal');

  // ── Build one promise per admin ──────────────────────────────────────────
  const tasks = admins.map(async (admin) => {
    // 1. In-app notification
    await Notification.create({
      recipient: admin._id,
      issue:     issue._id,
      message:   `New issue reported: ${issue.issueId} — ${issue.title}`,
    });

    // 2. Email (skip gracefully if SMTP is not configured)
    if (!smtpConfigured || !admin.email) return;

    const subject = `CivicFix — New issue reported: ${issue.issueId}`;
    const text = [
      `Hi ${admin.name || 'Admin'},`,
      '',
      'A new civic issue has just been reported on CivicFix and needs your attention.',
      '',
      `  Issue ID : ${issue.issueId}`,
      `  Title    : ${issue.title}`,
      `  Category : ${categoryLabel}`,
      `  Severity : ${issue.severity || 'Not specified'}`,
      `  Reported by: ${reporterName}`,
      '',
      'View and manage the issue here:',
      `  ${issueLink}`,
      '',
      '— The CivicFix System',
    ].join('\n');

    const info = await transporter.sendMail({
      from:    FROM_ADDRESS,
      to:      admin.email,
      subject,
      text,
    });

    if (isEthereal) {
      const { getTestMessageUrl } = require('nodemailer');
      const previewUrl = getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[notify] 📧  Ethereal preview (admin ${admin.email}) → ${previewUrl}`);
      }
    } else {
      console.log(`[notify] 📧  New-issue email sent to admin ${admin.email} (messageId: ${info.messageId})`);
    }
  });

  // ── Fan-out with allSettled — one failure must not block the others ───────
  const results = await Promise.allSettled(tasks);

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.error(
        `[notify] admin notification failed for ${admins[idx]?.email ?? admins[idx]?._id}:`,
        result.reason?.message ?? result.reason
      );
    }
  });
}

module.exports = { notifyStatusChange, notifyAdminsNewIssue };
