const Issue = require('../models/Issue');
const User  = require('../models/User');

// ─── GET /api/public/stats ────────────────────────────────────────────────────
/**
 * Returns live counts for the homepage stat strip.
 * No authentication required — public endpoint.
 *
 * Response shape:
 *   { totalIssues: number, resolvedIssues: number, activeCitizens: number }
 */
const getPublicStats = async (_req, res, next) => {
  try {
    const [totalIssues, resolvedIssues, activeCitizens] = await Promise.all([
      Issue.countDocuments(),
      Issue.countDocuments({ status: 'Resolved' }),
      User.countDocuments({ role: 'resident' }),
    ]);

    res.json({ totalIssues, resolvedIssues, activeCitizens });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPublicStats };
