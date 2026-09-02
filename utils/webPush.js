/**
 * utils/webPush.js
 *
 * Configures the web-push library with VAPID credentials (loaded once at
 * module import) and exports sendPushToAdmins(payload) — the single function
 * used by the rest of the server to fire push notifications.
 *
 * Design decisions that mirror the existing notify.js patterns:
 *
 *   • Promise.allSettled fan-out — one subscription failing never blocks the
 *     others.  The same pattern is used throughout notifyAdminsEmergency().
 *
 *   • Dead-subscription cleanup — the W3C Push API defines two HTTP status
 *     codes that signal a subscription is gone for good:
 *       404  Not Found   — endpoint no longer registered
 *       410  Gone        — subscription explicitly revoked by the user
 *     When either occurs, we remove that specific sub from the user's document
 *     via $pull rather than leaving it to fail again on every future alert.
 *     This keeps the admin document clean without any manual maintenance.
 *
 *   • Fire-and-forget at call sites — sendPushToAdmins is always called with
 *     .catch() at the call site so a failure here never surfaces to the
 *     reporter's 201 response.
 */

const webpush = require('web-push');
const User    = require('../models/User');

// ── VAPID configuration ────────────────────────────────────────────────────────
// Configured once at module load.  All three env vars are required for push to
// work; skip configuration silently when they are absent (dev without push).
if (
  process.env.VAPID_PUBLIC_KEY  &&
  process.env.VAPID_PRIVATE_KEY &&
  process.env.VAPID_SUBJECT
) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} else if (process.env.NODE_ENV !== 'test') {
  console.warn(
    '[webPush] VAPID credentials not set — push notifications are disabled. ' +
    'Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in .env to enable.'
  );
}

/**
 * sendPushToAdmins(payload)
 *
 * Sends a Web Push notification to every saved push subscription across all
 * admin users.
 *
 * @param {{ title: string, body: string, url?: string }} payload
 *   Small notification payload.  `url` is optional — included in the data
 *   blob so the service worker's notificationclick handler can open it.
 *
 * @returns {Promise<void>}  Always resolves; never throws.
 */
async function sendPushToAdmins(payload) {
  // Skip silently when VAPID is not configured (dev without .env push vars)
  if (
    !process.env.VAPID_PUBLIC_KEY  ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  ) {
    return;
  }

  // Fetch all admins who have at least one push subscription stored.
  // `$exists: true, $ne: []` ensures we skip admins who have never subscribed.
  const admins = await User.find({
    role:              'admin',
    pushSubscriptions: { $exists: true, $not: { $size: 0 } },
  }).select('_id pushSubscriptions').lean();

  if (!admins.length) return; // nothing to do

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url || '/admin/emergency-reports',
  });

  // Build one send task per subscription across all admins.
  // We track (userId, endpoint) so we can clean up dead subs below.
  const tasks = admins.flatMap((admin) =>
    admin.pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, notificationPayload);
        console.log(`[webPush] 🔔  Push sent to admin ${admin._id} (endpoint: ${sub.endpoint.slice(-20)}…)`);
      } catch (err) {
        const status = err.statusCode ?? err.status;

        if (status === 404 || status === 410) {
          // Subscription is gone — remove it so it doesn't clog future sends.
          console.log(
            `[webPush] Removing dead subscription (HTTP ${status}) ` +
            `for admin ${admin._id} — endpoint: ${sub.endpoint.slice(-20)}…`
          );
          // $pull removes only the specific sub with this endpoint from the array.
          await User.updateOne(
            { _id: admin._id },
            { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } }
          ).catch((pullErr) =>
            console.error('[webPush] Failed to remove dead subscription:', pullErr.message)
          );
        } else {
          // Transient error — log it but leave the subscription intact.
          console.error(
            `[webPush] Push failed for admin ${admin._id} ` +
            `(HTTP ${status ?? 'unknown'}): ${err.message}`
          );
        }
      }
    })
  );

  // Fan-out — one failure must never block the remaining sends.
  await Promise.allSettled(tasks);
}

module.exports = { sendPushToAdmins };
