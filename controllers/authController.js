const crypto        = require('crypto');
const asyncHandler  = require('express-async-handler');
const User          = require('../models/User');
const generateToken = require('../utils/generateToken');
const { transporter, FROM_ADDRESS } = require('../config/email');
const { MAX_ATTEMPTS, LOCK_DURATION_MS } = require('../utils/accountLockout');

// ─── Helper ───────────────────────────────────────────────────────────────────
/**
 * Builds the standard user response shape returned by auth endpoints.
 * Token is generated here and included in every successful auth response.
 */
const authResponse = (res, statusCode, user) => {
  const token = generateToken(user._id, user.role);

  res.status(statusCode).json({
    _id:   user._id,
    name:  user.name,
    email: user.email,
    role:  user.role,
    token,
  });
};

// ─── @desc    Register a new user
// ─── @route   POST /api/auth/register
// ─── @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, location } = req.body;

  // Basic field presence validation
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Please provide name, email, and password');
  }

  // Duplicate email check
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    res.status(409);
    throw new Error('An account with that email already exists');
  }

  // Role is always forced to 'resident' on self-registration.
  // The 'role' field from the request body is intentionally ignored here —
  // admin/staff roles must be assigned through a separate privileged endpoint.
  const user = await User.create({
    name,
    email,
    password,
    location,
    role: 'resident',
  });

  authResponse(res, 201, user);
});

// ─── @desc    Authenticate user & return token
// ─── @route   POST /api/auth/login
// ─── @access  Public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  // Explicitly select password (select:false by default) plus the lockout fields
  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+password +failedLoginAttempts +lockUntil');

  // ── Phase 1: account-lock check ───────────────────────────────────────────
  // Do this before touching the password so a locked account is rejected even
  // if the attacker happens to supply the correct password this time.
  if (user && user.lockUntil && user.lockUntil > Date.now()) {
    const minsLeft = Math.ceil((user.lockUntil - Date.now()) / 60_000);
    res.status(423);
    throw new Error(
      `Too many failed attempts. Try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.`
    );
  }

  // ── Phase 2: password check ───────────────────────────────────────────────
  const passwordCorrect = user && (await user.matchPassword(password));

  if (!passwordCorrect) {
    // Generic message — never reveal whether the email exists in the system.
    // If we have a real user, track the failed attempt.
    if (user) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
        // Threshold reached — engage lock and reset the counter.
        // The lock itself is now doing the enforcement work, not a growing counter.
        user.lockUntil           = new Date(Date.now() + LOCK_DURATION_MS);
        user.failedLoginAttempts = 0;
      }

      // Use validateBeforeSave:false so we don't trigger required-field validation
      // on fields like password that aren't being changed here.
      await user.save({ validateBeforeSave: false });
    }

    // Return the same 401 as before — don't disclose on this attempt that the
    // account may now be locked; the 423 only shows on the *next* attempt.
    res.status(401);
    throw new Error('Invalid credentials');
  }

  // ── Phase 3: successful login — reset lockout state ───────────────────────
  if (user.failedLoginAttempts !== 0 || user.lockUntil !== null) {
    user.failedLoginAttempts = 0;
    user.lockUntil           = null;
    await user.save({ validateBeforeSave: false });
  }

  authResponse(res, 200, user);
});

// ─── @desc    Get currently authenticated user's profile
// ─── @route   GET /api/auth/me
// ─── @access  Private (requires protect middleware)
const getMe = asyncHandler(async (req, res) => {
  // req.user is attached by the protect middleware — password is already excluded
  const user = req.user;

  res.status(200).json({
    _id:      user._id,
    name:     user.name,
    email:    user.email,
    role:     user.role,
    location: user.location,
    createdAt: user.createdAt,
  });
});

// ─── @desc    Logout user
// ─── @route   POST /api/auth/logout
// ─── @access  Private (requires protect middleware)
const logoutUser = asyncHandler(async (_req, res) => {
  // This is a stateless JWT setup — there is no server-side session to destroy.
  // Actual logout is handled on the client by discarding the token from storage.
  // This endpoint exists as a clear API contract and to allow future server-side
  // token blacklisting (e.g. Redis) without breaking the client interface.
  res.status(200).json({ message: 'Logged out successfully' });
});

// ─── @desc    Request a password-reset email
// ─── @route   POST /api/auth/forgot-password
// ─── @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400);
    throw new Error('Please provide your email address');
  }

  // Generic response — never reveal whether this email is registered
  const GENERIC_MSG =
    'If an account exists for that email, a password-reset link has been sent.';

  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+resetPasswordToken +resetPasswordExpire');

  if (!user) {
    // No account — respond generically so we don't leak registered emails
    return res.status(200).json({ message: GENERIC_MSG });
  }

  // Generate a cryptographically random raw token
  const rawToken  = crypto.randomBytes(32).toString('hex');
  const hashToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken  = hashToken;
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  // Build the reset link that goes into the email
  const clientUrl  = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetUrl   = `${clientUrl}/reset-password/${rawToken}`;

  // Send email — reuse the shared transporter from config/email.js
  try {
    const info = await transporter.sendMail({
      from:    FROM_ADDRESS,
      to:      user.email,
      subject: 'CivicFix — Reset your password',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#2563eb">Reset your CivicFix password</h2>
          <p>Hi ${user.name},</p>
          <p>We received a request to reset the password on your account.
             Click the button below to choose a new one.</p>
          <p style="margin:1.5rem 0">
            <a href="${resetUrl}"
               style="background:#2563eb;color:#fff;padding:0.65rem 1.4rem;
                      border-radius:6px;text-decoration:none;font-weight:600">
              Reset my password
            </a>
          </p>
          <p style="font-size:0.85rem;color:#6b7280">
            This link expires in <strong>10 minutes</strong>.<br>
            If you didn't request a password reset, you can safely ignore this email.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0">
          <p style="font-size:0.8rem;color:#9ca3af">
            Or copy and paste this URL into your browser:<br>
            <a href="${resetUrl}" style="color:#2563eb;word-break:break-all">${resetUrl}</a>
          </p>
        </div>
      `,
    });

    // In development, log the Ethereal preview URL so the team can inspect it
    if (process.env.NODE_ENV !== 'production' && info.messageId) {
      const nodemailer = require('nodemailer');
      console.log('[CivicFix] Password-reset email preview:', nodemailer.getTestMessageUrl(info));
    }
  } catch (emailErr) {
    // Roll back the token so a failed send doesn't leave a dangling valid token
    console.error('[CivicFix] Failed to send reset email:', emailErr.message);
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    // Still return the generic success message — don't expose the SMTP failure
  }

  res.status(200).json({ message: GENERIC_MSG });
});

// ─── @desc    Reset password via token from the email link
// ─── @route   PUT /api/auth/reset-password/:token
// ─── @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    res.status(400);
    throw new Error('Please provide a new password');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  // Hash the incoming raw token to compare against the stored hash
  const hashToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  // Find a user with a matching, non-expired token
  const user = await User.findOne({
    resetPasswordToken:  hashToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password +resetPasswordToken +resetPasswordExpire');

  if (!user) {
    res.status(400);
    throw new Error('This password reset link is invalid or has expired. Please request a new one.');
  }

  // Set the new password — the pre-save hook will hash it automatically
  user.password            = password;
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  // Log the user straight in by returning a fresh token
  authResponse(res, 200, user);
});

module.exports = { registerUser, loginUser, getMe, logoutUser, forgotPassword, resetPassword };
