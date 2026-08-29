const express = require('express');
const router  = express.Router();

const {
  registerUser,
  loginUser,
  getMe,
  logoutUser,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

const { protect } = require('../middleware/authMiddleware');

// ─── Public routes ────────────────────────────────────────────────────────────
router.post('/register',                  registerUser);
router.post('/login',                     loginUser);
router.post('/forgot-password',           forgotPassword);
router.put( '/reset-password/:token',     resetPassword);

// ─── Private routes (JWT required) ───────────────────────────────────────────
router.get( '/me',      protect, getMe);
router.post('/logout',  protect, logoutUser);

module.exports = router;
