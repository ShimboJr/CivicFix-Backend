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
const { loginLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const {
  handleValidationErrors,
  registerValidationRules,
  loginValidationRules,
} = require('../middleware/validators');

// ─── Public routes ────────────────────────────────────────────────────────────
router.post('/register',       registerValidationRules, handleValidationErrors, registerUser);
router.post('/login',          loginLimiter, loginValidationRules, handleValidationErrors, loginUser);
router.post('/forgot-password',           forgotPasswordLimiter, forgotPassword);
router.put( '/reset-password/:token',     resetPassword);

// ─── Private routes (JWT required) ───────────────────────────────────────────
router.get( '/me',      protect, getMe);
router.post('/logout',  protect, logoutUser);

module.exports = router;
