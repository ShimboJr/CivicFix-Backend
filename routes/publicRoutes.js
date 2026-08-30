const express = require('express');
const { getPublicStats } = require('../controllers/publicController');

const router = express.Router();

// GET /api/public/stats — live homepage stats (no auth required)
router.get('/stats', getPublicStats);

module.exports = router;
