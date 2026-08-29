const jwt = require('jsonwebtoken');

/**
 * generateToken — creates and returns a signed JWT.
 *
 * Payload contains only the minimal identity claims needed for
 * authorisation checks — never embed sensitive data here.
 *
 * @param   {string} id   — MongoDB _id of the user
 * @param   {string} role — user's role ('resident' | 'staff' | 'admin')
 * @returns {string}      — signed JWT string
 */
const generateToken = (id, role) => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = generateToken;
