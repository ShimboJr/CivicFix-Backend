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
