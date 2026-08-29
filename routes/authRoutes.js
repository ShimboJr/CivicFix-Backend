const express = require('express');
const router  = express.Router();

const {
  registerUser,
  loginUser,
  getMe,
  logoutUser,
} = require('../controllers/authController');

const { protect } = require('../middleware/authMiddleware');

// ─── Public routes ────────────────────────────────────────────────────────────
router.post('/register', registerUser);
router.post('/login',    loginUser);

// ─── Private routes (JWT required) ───────────────────────────────────────────
router.get('/me',         protect, getMe);
router.post('/logout',    protect, logoutUser);

module.exports = router;
