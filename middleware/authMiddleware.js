const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// ─── protect ─────────────────────────────────────────────────────────────────
/**
 * Verifies the Bearer JWT in the Authorization header and attaches the
 * corresponding user document to `req.user`.
 *
 * Expected header format:
 *   Authorization: Bearer <token>
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Guard: header must be present and start with "Bearer "
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorised — no token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify signature and expiry in one step
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the full user record; exclude password even in middleware
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'Not authorised — user no longer exists' });
    }

    req.user = user;
    next();
  } catch (error) {
    // Catches JsonWebTokenError, TokenExpiredError, NotBeforeError etc.
    return res.status(401).json({
      message:
        error.name === 'TokenExpiredError'
          ? 'Session expired — please log in again'
          : 'Not authorised — invalid token',
    });
  }
};

// ─── authorize ────────────────────────────────────────────────────────────────
/**
 * Role-based access control middleware factory.
 * Must always be chained AFTER `protect` so that `req.user` is available.
 *
 * Usage:
 *   router.delete('/:id', protect, authorize('admin'), deleteIssue);
 *   router.patch('/:id/assign', protect, authorize('admin', 'staff'), assignIssue);
 *
 * @param {...string} roles — one or more allowed role strings
 * @returns {Function}     — Express middleware
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Not authorised for this action — requires one of: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
