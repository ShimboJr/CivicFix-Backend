/**
 * config/email.js
 *
 * Builds and exports a single shared nodemailer transporter.
 * All configuration is read exclusively from environment variables so that
 * switching providers (Ethereal → Gmail → SendGrid → Mailgun → SES, etc.)
 * is a pure env-var change with zero code changes required.
 *
 * ── Development / testing ────────────────────────────────────────────────────
 * Point SMTP_HOST at smtp.ethereal.email and use credentials from
 * https://ethereal.email/create.  When a message is sent via Ethereal,
 * notify.js logs the Ethereal preview URL so you can click straight into the
 * test inbox.
 *
 * ── Production providers (env-var-only swap) ─────────────────────────────────
 *   Gmail (app password)
 *     SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
 *     SMTP_USER=you@gmail.com   SMTP_PASS=<16-char app password>
 *
 *   SendGrid
 *     SMTP_HOST=smtp.sendgrid.net  SMTP_PORT=587
 *     SMTP_USER=apikey             SMTP_PASS=<SendGrid API key>
 *
 *   Mailgun
 *     SMTP_HOST=smtp.mailgun.org   SMTP_PORT=587
 *     SMTP_USER=postmaster@...     SMTP_PASS=<Mailgun SMTP password>
 */

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT, 10) || 587,
  // Use TLS (STARTTLS) for port 587; use implicit TLS for port 465
  secure: parseInt(process.env.SMTP_PORT, 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/** The "From" address used on every outbound email */
const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER;

module.exports = { transporter, FROM_ADDRESS };
