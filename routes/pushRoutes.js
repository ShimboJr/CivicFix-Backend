/**
 * routes/pushRoutes.js
 *
 * Mounted at /api/push in app.js.
 *
 *   GET  /vapid-public-key   — public; returns the VAPID public key
 *   POST /subscribe          — protected; saves a PushSubscription to req.user
 */

const express = require('express');
const router  = express.Router();

const { protect }                          = require('../middleware/authMiddleware');
const { getVapidPublicKey, subscribeToPush } = require('../controllers/pushController');

// Public — the key is not a secret; the browser needs it before subscribe()
router.get('/vapid-public-key', getVapidPublicKey);

// Protected — any authenticated user may subscribe their device
router.post('/subscribe', protect, subscribeToPush);

module.exports = router;
