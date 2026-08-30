const rateLimit = require('express-rate-limit');

// ─── Shared handler options ───────────────────────────────────────────────────
// Both limiters return a JSON `{ message }` so the client sees the same error
// shape used everywhere else in the API, rather than express-rate-limit's
// default plain-text response.
const jsonHandler = (message) => ({
  standardHeaders: true,  // Emit RateLimit-* headers so clients can see quota
  legacyHeaders:   false, // Suppress the older X-RateLimit-* headers
  handler(_req, res) {
    res.status(429).json({ message });
  },
});

// ─── Login limiter ────────────────────────────────────────────────────────────
// 5 attempts per IP per 15-minute window.
// Guards against brute-forcing a password from a single location.
//
// Known limitation: limits by IP only, so a distributed attack spread across
// many IPs (botnet / credential-stuffing) would not be caught here. Per-account
// tracking in a shared store (e.g. Redis) would be needed for that — flagged as
// a future improvement if it becomes an actual problem.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      5,
  ...jsonHandler(
    'Too many login attempts. Please try again in a few minutes.'
  ),
});

// ─── Forgot-password limiter ──────────────────────────────────────────────────
// 3 attempts per IP per 60-minute window — intentionally stricter than login.
// Each request triggers a real email send, so this also prevents someone from
// spamming a stranger's inbox with password-reset links.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max:      3,
  ...jsonHandler(
    'Too many password-reset requests. Please try again in a few minutes.'
  ),
});

module.exports = { loginLimiter, forgotPasswordLimiter };
