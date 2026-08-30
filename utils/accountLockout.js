// ─── Account-lockout thresholds ───────────────────────────────────────────────
// Centralised here so the controller and any future tests import the same
// values rather than having magic numbers in multiple places.

/** Number of consecutive failed logins that triggers an account lock. */
const MAX_ATTEMPTS = 5;

/** How long (ms) an account stays locked — 15 minutes. */
const LOCK_DURATION_MS = 15 * 60 * 1000;

module.exports = { MAX_ATTEMPTS, LOCK_DURATION_MS };
