/**
 * parseLocation middleware
 *
 * WHY THIS EXISTS
 * ───────────────
 * The ReportIssue form submits as multipart/form-data (because it includes
 * image uploads). FormData cannot natively represent nested objects, so the
 * frontend JSON.stringify()s the location object into a single field:
 *
 *   fd.append('location', JSON.stringify({ address, latitude, longitude }));
 *
 * After Multer parses the multipart stream, req.body.location is therefore a
 * plain string.  express-validator's body('location.address') cannot read a
 * nested key from a string, so it always returns undefined — triggering a
 * false "Location address is required" even when the field is filled in.
 *
 * This middleware runs AFTER uploadArray (so req.body is populated) and BEFORE
 * createIssueValidationRules (so the validator sees req.body.location as a real
 * object with an .address property).
 *
 * The controller already handles both the string and object cases itself, so
 * rehydrating here is purely for the validator's benefit and doesn't break the
 * controller path.
 *
 * PLACEMENT in POST /api/issues:
 *   protect → uploadArray → parseLocation
 *     → createIssueValidationRules → handleUploadValidationErrors → createIssue
 */
const parseLocation = (req, _res, next) => {
  if (typeof req.body.location === 'string') {
    try {
      req.body.location = JSON.parse(req.body.location);
    } catch {
      // Delegate the error response to handleUploadValidationErrors via the
      // validation rule rather than sending a raw 400 here — this keeps the
      // error shape consistent with the rest of the validation layer.
      // Setting location to null means location.address will be undefined,
      // which the notEmpty() rule catches with the correct user-facing message.
      req.body.location = null;
    }
  }
  next();
};

module.exports = { parseLocation };
