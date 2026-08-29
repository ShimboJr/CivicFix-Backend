const asyncHandler = require('express-async-handler');
const User          = require('../models/User');
const generateToken = require('../utils/generateToken');

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

  // Explicitly select password since it is excluded by default (select: false)
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  // Use a generic message for any credential mismatch.
  // Never reveal whether the email exists in the system.
  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
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

module.exports = { registerUser, loginUser, getMe, logoutUser };
