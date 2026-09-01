/**
 * middleware/parseLocation.js
 *
 * ⚠️  DEAD CODE — no longer wired to any route.
 *
 * WHY IT WAS NEEDED (historical context)
 * ───────────────────────────────────────
 * The ReportIssue form previously submitted as multipart/form-data because it
 * included image uploads via Multer.  FormData cannot natively represent nested
 * objects, so the frontend JSON.stringify()d the location object into a single
 * flat field:
 *
 *   fd.append('location', JSON.stringify({ address, latitude, longitude }));
 *
 * After Multer parsed the multipart stream, req.body.location was therefore a
 * plain string.  express-validator's body('location.address') cannot read a
 * nested key from a string, so it always returned undefined — triggering a
 * false "Location address is required" even when the field was filled in.
 *
 * This middleware ran AFTER uploadArray (so req.body was populated) and BEFORE
 * createIssueValidationRules (so the validator saw req.body.location as a real
 * object with an .address property).
 *
 * WHY IT WAS REMOVED
 * ──────────────────
 * The ReportIssue submit flow was migrated to direct browser-to-Cloudinary
 * uploads (signed server-side via GET /api/uploads/signature?folder=civicfix/issues).
 * File bytes never pass through the serverless function, so the multipart
 * submission was replaced with a plain JSON POST:
 *
 *   POST /api/issues  Content-Type: application/json
 *   { title, description, category, severity,
 *     location: { address, latitude, longitude },   ← real nested object
 *     images: ['https://res.cloudinary.com/…', …] }
 *
 * express.json() fully parses the body before any middleware runs, so
 * location arrives as a real nested object and this shim is no longer needed.
 *
 * SAFE TO DELETE if you're cleaning up — nothing imports this file.
 */

const parseLocation = (req, _res, next) => {
  if (typeof req.body.location === 'string') {
    try {
      req.body.location = JSON.parse(req.body.location);
    } catch {
      req.body.location = null;
    }
  }
  next();
};

module.exports = { parseLocation };
