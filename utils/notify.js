const Notification            = require('../models/Notification');
const Issue                   = require('../models/Issue');
const User                    = require('../models/User');
const { transporter, FROM_ADDRESS } = require('../config/email');
const { sendPushToAdmins }    = require('./webPush');

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

/**
 * notifyStaffAssignment(staffUserId, issues)
 *
 * Fires once after an admin assigns one or more issues to a staff member.
 * Regardless of how many issues are in the batch it creates:
 *   - ONE Notification document (in-app) for the staff member
 *   - ONE email listing every assigned issue
 *
 * This deliberately avoids per-issue calls so that a bulk assignment of N
 * issues never produces N separate emails / bell entries for the assignee.
 *
 * @param {string|ObjectId}                 staffUserId — the staff user's _id
 * @param {Array<import('../models/Issue')>} issues      — array of Issue docs
 *                                                         (length ≥ 1)
 */
async function notifyStaffAssignment(staffUserId, issues) {
  if (!issues || issues.length === 0) return;

  try {
    // ── Build the human-readable message ──────────────────────────────────
    let message;
    if (issues.length === 1) {
      const i = issues[0];
      message = `You've been assigned to issue ${i.issueId} — ${i.title}`;
    } else {
      const idList = issues.map((i) => i.issueId).join(', ');
      message = `You've been assigned ${issues.length} new issues: ${idList}`;
    }

    // ── 1. In-app Notification (one document for the whole batch) ─────────
    await Notification.create({
      recipient: staffUserId,
      // For a multi-issue batch we reference the first issue; the message
      // lists all of them so the staff member knows what arrived.
      issue:   issues[0]._id,
      message,
    });

    // ── 2. Email (skip gracefully if SMTP is not configured) ──────────────
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

    const staffUser = await User.findById(staffUserId).select('name email').lean();
    if (!staffUser?.email) return; // no email address on record

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const isEthereal = (process.env.SMTP_HOST || '').toLowerCase().includes('ethereal');

    // Build one line per issue inside the email body
    const issueLines = issues.map((i) => {
      // category may be a populated object or a raw ObjectId
      const catLabel =
        typeof i.category === 'object' && i.category?.name
          ? i.category.name
          : String(i.category);

      const link = `${clientUrl}/staff/issue/${i._id}`;

      return [
        `  • ${i.issueId} — ${i.title}`,
        `    Category : ${catLabel}`,
        `    Severity : ${i.severity || 'Not specified'}`,
        `    Link     : ${link}`,
      ].join('\n');
    });

    const subject =
      issues.length === 1
        ? `CivicFix — You've been assigned issue ${issues[0].issueId}`
        : `CivicFix — You've been assigned ${issues.length} new issues`;

    const text = [
      `Hi ${staffUser.name || 'there'},`,
      '',
      issues.length === 1
        ? 'An issue has been assigned to you on CivicFix:'
        : `${issues.length} issues have been assigned to you on CivicFix:`,
      '',
      ...issueLines,
      '',
      'Please log in to review and action your assignments.',
      '',
      '— The CivicFix Team',
    ].join('\n');

    const info = await transporter.sendMail({
      from:    FROM_ADDRESS,
      to:      staffUser.email,
      subject,
      text,
    });

    if (isEthereal) {
      const { getTestMessageUrl } = require('nodemailer');
      const previewUrl = getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[notify] 📧  Ethereal preview (staff ${staffUser.email}) → ${previewUrl}`);
      }
    } else {
      console.log(`[notify] 📧  Assignment email sent to ${staffUser.email} (messageId: ${info.messageId})`);
    }
  } catch (err) {
    // Non-critical — log but never throw; assignment must always succeed
    console.error('[notify] notifyStaffAssignment failed:', err.message);
  }
}

/**
 * notifyAdminsEmergency(report)
 *
 * Fires immediately after an EmergencyReport is successfully saved.
 * Sends in-app notifications, emails, AND a Web Push to every admin — the
 * single, complete "alert every admin through every channel" function.
 *
 * Any caller (createEmergencyReport, liveLocationController.startSession, or
 * any future trigger) automatically gets all three channels simply by calling
 * this function — no separate sendPushToAdmins call is needed or should be
 * made at the call site.
 *
 * Deliberately distinct from notifyAdminsNewIssue:
 *   - Notification is marked  priority: 'urgent'  and  category: 'emergency'
 *     so the NotificationBell can render it with a red accent rather than the
 *     grey/blue used for routine pothole or streetlight reports.
 *   - Email subject is prefixed with the 🚨 emoji and the word URGENT to survive
 *     even a heavily filtered inbox.
 *   - Web Push fires after the per-admin fan-out so admins receive an immediate
 *     browser/OS alert even if the dashboard is not open.
 *   - No `issue` ref is set on the Notification document — EmergencyReport is
 *     a separate collection from Issue.
 *
 * Fan-out uses Promise.allSettled so one admin's bad email address or SMTP
 * hiccup never prevents the remaining admins from being alerted.
 *
 * ⚠️  PRODUCTION DEPLOYMENT NOTE:
 *   Push + email are insufficient as the sole alerting channels for an active
 *   emergency.  A production deployment MUST layer in SMS (e.g. Twilio) or an
 *   automated phone call to an on-call admin.  Email is retained here only as a
 *   secondary record, not as the primary alert mechanism.
 *
 * @param {import('../models/EmergencyReport')} report — the freshly saved
 *   EmergencyReport document.  Must have at minimum: _id, type, description,
 *   location (address), reporter (ObjectId or populated object with name/email).
 */
async function notifyAdminsEmergency(report) {
  // ── Resolve reporter identity ─────────────────────────────────────────────────
  // `report.reporter` may be a populated object (if createEmergencyReport ran
  // populate after save) or a raw ObjectId.  Normalise both paths.
  let reporterName  = 'Unknown reporter';
  let reporterEmail = 'N/A';
  try {
    if (report.reporter?.name) {
      reporterName  = report.reporter.name;
      reporterEmail = report.reporter.email || 'N/A';
    } else if (report.reporter) {
      const reporter = await User.findById(report.reporter)
        .select('name email')
        .lean();
      if (reporter) {
        reporterName  = reporter.name  || reporterName;
        reporterEmail = reporter.email || reporterEmail;
      }
    }
  } catch {
    // Non-critical — fall back to the generic labels
  }

  // ── Fetch all admins ───────────────────────────────────────────────────────────
  const admins = await User.find({ role: 'admin' }).select('_id name email').lean();
  if (!admins.length) return;

  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
  const isEthereal = smtpConfigured &&
    (process.env.SMTP_HOST || '').toLowerCase().includes('ethereal');

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  // Deep-link directly to this specific report's EmergencyDetail page so the
  // admin can open it in one click from the email.
  const reportLink = `${clientUrl}/admin/emergency-reports/${report._id}`;

  // ── Build one promise per admin ─────────────────────────────────────────────
  const tasks = admins.map(async (admin) => {
    // 1. In-app notification — urgent styling, emergencyReport ref (NOT issue ref).
    //    We store the report's _id in `emergencyReport` rather than `issue` because
    //    `issue` is a Mongoose ref to the Issue collection — populating an
    //    EmergencyReport ObjectId through it always resolves to null, which the
    //    frontend interprets as a deleted issue and shows "(issue no longer available)".
    await Notification.create({
      recipient:       admin._id,
      emergencyReport: report._id,   // ← correct field; `issue` left absent
      message:         `🚨 URGENT: New emergency report — ${report.type} — check immediately`,
      priority:        'urgent',
      category:        'emergency',
    });

    // 2. Email (skip gracefully if SMTP is not configured)
    if (!smtpConfigured || !admin.email) return;

    const subject = `🚨 CivicFix — Urgent Emergency Report: ${report.type}`;
    const text = [
      `Hi ${admin.name || 'Admin'},`,
      '',
      '*** URGENT ACTION REQUIRED ***',
      '',
      'A new emergency report has been submitted on CivicFix and requires',
      'your immediate attention.',
      '',
      '=== REPORT DETAILS ===',
      `  Type        : ${report.type}`,
      `  Description : ${report.description}`,
      // ⚠️  IMPORTANT: This is the STARTING location captured at the moment the
      // alert fired — it is a one-time snapshot, NOT a live-updating coordinate.
      // For a Live Location SOS report the person may have moved since this email
      // was sent.  Always open the EmergencyDetail page (link below) to see the
      // current position — it shows the most-recent GPS ping from the live session.
      `  Starting location (at time of alert): ${report.location?.address || 'Not specified'}`,
      `  Reporter    : ${reporterName}`,
      `  Contact     : ${reporterEmail}`,
      // Only include the phone line when a number was provided — avoids a
      // confusing "Phone : undefined" or "Phone : N/A" line in the email.
      ...(report.contactPhone ? [`  Phone       : ${report.contactPhone}`] : []),
      `  Submitted   : ${new Date(report.createdAt || Date.now()).toUTCString()}`,
      '',
      '⚠️  DO NOT use the location above as the person\'s current position if',
      'significant time has passed since this email arrived.  Open the',
      'EmergencyDetail page below — it shows the real-time (or last known)',
      'position from the live tracking session:',
      `  ${reportLink}`,
      '',
      '--- PRODUCTION DEPLOYMENT NOTE ---',
      'This email is a secondary notification channel only.',
      'For a live deployment, SMS or an automated phone call to an on-call',
      'admin is essential — email response times are too slow for an active',
      'emergency. This gap must be addressed before going to production.',
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
        console.log(`[notify] 🚨  Ethereal preview (emergency → admin ${admin.email}) → ${previewUrl}`);
      }
    } else {
      console.log(
        `[notify] 🚨  Emergency alert email sent to admin ${admin.email}` +
        ` (messageId: ${info.messageId})`
      );
    }
  });

  // ── Fan-out with allSettled — one failure must never block the others ──────
  const results = await Promise.allSettled(tasks);

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.error(
        `[notify] emergency alert failed for admin ${
          admins[idx]?.email ?? admins[idx]?._id
        }:`,
        result.reason?.message ?? result.reason
      );
    }
  });

  // ── Web Push (speed channel — fires once after all in-app/email work) ────
  // sendPushToAdmins is fire-and-forget: it always resolves, never throws.
  // Calling it here — inside notifyAdminsEmergency — means EVERY trigger path
  // (regular emergency reports, Live Location SOS sessions, any future caller)
  // automatically sends a push without needing a separate call at the call site.
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  sendPushToAdmins({
    title: '🚨 Emergency Report',
    body:  `${report.type} — ${report.location?.address || 'Location not specified'}`,
    url:   `${clientUrl}/admin/emergency-reports/${report._id}`,
  }).catch((err) =>
    console.error('[notify] sendPushToAdmins failed inside notifyAdminsEmergency:', err.message)
  );
}

module.exports = {
  notifyStatusChange,
  notifyAdminsNewIssue,
  notifyStaffAssignment,
  notifyAdminsEmergency,
};
