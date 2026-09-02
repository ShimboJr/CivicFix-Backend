/**
 * controllers/pushController.js
 *
 * Two endpoints that together make Web Push work end-to-end:
 *
 *   GET  /api/push/vapid-public-key  (public)
 *     Returns the VAPID public key so the frontend can call
 *     pushManager.subscribe() without the key being hardcoded in the bundle.
 *     Public because the browser needs it before the user is "logged in" to
 *     the PWA and it contains no secret — the private key stays on the server.
 *
 *   POST /api/push/subscribe  (protected — any authenticated user)
 *     Accepts a PushSubscription object (endpoint + keys.p256dh + keys.auth)
 *     from the browser and upserts it into req.user.pushSubscriptions.
 *     Duplicate-safe: if the same endpoint is already in the array, it is
 *     not added again (prevents the same device subscribing twice).
 */

const asyncHandler = require('express-async-handler');
const User         = require('../models/User');

// ── @desc    Return the VAPID public key
// ── @route   GET /api/push/vapid-public-key
// ── @access  Public (no auth required — the key is not a secret)
const getVapidPublicKey = asyncHandler(async (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;

  if (!key) {
    res.status(503);
    throw new Error('Push notifications are not configured on this server.');
  }

  res.status(200).json({ publicKey: key });
});

// ── @desc    Save (or refresh) a push subscription for the logged-in user
// ── @route   POST /api/push/subscribe
// ── @access  Private (any authenticated user — admin required for alerts,
//             but we accept from any role so non-admin users could later
//             opt in to their own alert types without a schema change)
const subscribeToPush = asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body;

  // Basic shape validation — if the browser gave us a well-formed
  // PushSubscription, these will always be present.
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400);
    throw new Error(
      'Invalid push subscription — expected { endpoint, keys: { p256dh, auth } }'
    );
  }

  // IMPORTANT: pushSubscriptions has select:false in the schema.
  // A plain findById() silently omits it, making .some() blow up with
  // "Cannot read properties of undefined (reading 'some')".
  // The '+' prefix forces Mongoose to include a select:false field.
  const user = await User.findById(req.user._id).select('+pushSubscriptions');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Defensive: ensure the array exists even on documents that pre-date the
  // schema field being added (in case Mongoose didn't write the default).
  if (!Array.isArray(user.pushSubscriptions)) {
    user.pushSubscriptions = [];
  }

  // Duplicate guard — if this exact endpoint is already in the array, skip.
  // The same physical device/browser will send the same endpoint every time
  // it calls subscribe(), so this keeps the array clean without extra work.
  const alreadyStored = user.pushSubscriptions.some(
    (sub) => sub.endpoint === endpoint
  );

  if (!alreadyStored) {
    user.pushSubscriptions.push({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    await user.save();
  }

  res.status(200).json({ message: 'Push subscription saved.' });
});

module.exports = { getVapidPublicKey, subscribeToPush };
