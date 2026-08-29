/**
 * migrateImagesToCloudinary.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-off migration: finds every Issue whose image fields still contain a
 * local "/uploads/..." path, re-uploads the file to Cloudinary, and patches
 * the document in-place with the new HTTPS URL.
 *
 * Covers all three image fields:
 *   • images[]    — array of before-submission photos
 *   • beforeImage — single string (before-fix snapshot)
 *   • afterImage  — single string (after-fix proof)
 *
 * Safe to re-run: URLs that already start with "http" are left untouched.
 *
 * Usage:
 *   node scripts/migrateImagesToCloudinary.js
 *
 * Prerequisites:
 *   • Your .env file must contain MONGO_URI and all three CLOUDINARY_* vars.
 *   • The original files must still exist under server/uploads/.
 *   • Run from the server/ directory (or set cwd there):
 *       cd server && node scripts/migrateImagesToCloudinary.js
 */

'use strict';

require('dotenv').config();

const path      = require('path');
const fs        = require('fs');
const mongoose  = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Issue     = require('../models/Issue');

// ─── Config ───────────────────────────────────────────────────────────────────
const UPLOADS_DIR    = path.join(__dirname, '..', 'uploads');
const CLOUDINARY_FOLDER = 'civicfix/issues';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true when a value looks like an old local path. */
const isLocalPath = (str) =>
  typeof str === 'string' && str.startsWith('/uploads/');

/** Returns true when a value is already a Cloudinary (or any https) URL. */
const isAlreadyMigrated = (str) =>
  typeof str === 'string' && str.startsWith('http');

/**
 * Upload a single local file to Cloudinary.
 * Returns the secure HTTPS URL, or null if the file no longer exists on disk.
 */
async function uploadToCloudinary(localPath) {
  // Strip the leading "/uploads/" prefix to get the bare filename
  const filename    = localPath.replace(/^\/uploads\//, '');
  const absolutePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(absolutePath)) {
    return null; // File was already deleted — can't migrate
  }

  const result = await cloudinary.uploader.upload(absolutePath, {
    folder:    CLOUDINARY_FOLDER,
    use_filename: true,
    unique_filename: true,
    resource_type: 'image',
  });

  return result.secure_url;
}

// ─── Counters (printed in the final report) ───────────────────────────────────
const stats = {
  docsScanned:  0,
  docsUpdated:  0,
  imagesOk:     0,   // successfully re-uploaded
  imagesMissing: 0,  // local file not found on disk — skipped
  imagesSkipped: 0,  // already an HTTPS URL — not touched
  errors:       [],  // { issueId, field, path, error }
};

// ─── Main ─────────────────────────────────────────────────────────────────────
async function migrate() {
  console.log('\n🔄  CivicFix — Local→Cloudinary image migration\n');

  // 1. Connect
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅  MongoDB connected\n');

  // 2. Find every issue that has at least one local-path image
  //    We use $regex across all three fields; a single query is fine since the
  //    collection is small for a civic platform.
  const issues = await Issue.find({
    $or: [
      { images:      { $elemMatch: { $regex: /^\/uploads\// } } },
      { beforeImage: { $regex: /^\/uploads\// } },
      { afterImage:  { $regex: /^\/uploads\// } },
    ],
  }).lean();

  console.log(`📋  Issues with local-path images: ${issues.length}\n`);

  if (issues.length === 0) {
    console.log('🎉  Nothing to migrate — all images are already on Cloudinary!\n');
    await mongoose.disconnect();
    return;
  }

  // 3. Process each issue
  for (const doc of issues) {
    stats.docsScanned++;
    let dirty = false; // tracks whether this doc needs a save

    const patch = {}; // fields to $set on this document

    // ── images[] ─────────────────────────────────────────────────────────────
    if (Array.isArray(doc.images) && doc.images.length > 0) {
      const newImages = [];

      for (const imgPath of doc.images) {
        if (isAlreadyMigrated(imgPath)) {
          stats.imagesSkipped++;
          newImages.push(imgPath);
          continue;
        }

        if (!isLocalPath(imgPath)) {
          // Unexpected format — keep as-is
          newImages.push(imgPath);
          continue;
        }

        try {
          const url = await uploadToCloudinary(imgPath);
          if (url) {
            console.log(`  ✅  [${doc.issueId}] images: ${imgPath} → ${url}`);
            newImages.push(url);
            stats.imagesOk++;
            dirty = true;
          } else {
            console.warn(`  ⚠️   [${doc.issueId}] images: file not found on disk → ${imgPath} (keeping original)`);
            newImages.push(imgPath); // keep broken path so data isn't silently lost
            stats.imagesMissing++;
          }
        } catch (err) {
          console.error(`  ❌  [${doc.issueId}] images upload failed: ${err.message}`);
          newImages.push(imgPath);
          stats.errors.push({ issueId: doc.issueId, field: 'images', path: imgPath, error: err.message });
        }
      }

      if (dirty) {
        patch.images = newImages;
      }
    }

    // ── beforeImage ───────────────────────────────────────────────────────────
    if (isLocalPath(doc.beforeImage)) {
      try {
        const url = await uploadToCloudinary(doc.beforeImage);
        if (url) {
          console.log(`  ✅  [${doc.issueId}] beforeImage: ${doc.beforeImage} → ${url}`);
          patch.beforeImage = url;
          stats.imagesOk++;
          dirty = true;
        } else {
          console.warn(`  ⚠️   [${doc.issueId}] beforeImage: file not found on disk → ${doc.beforeImage}`);
          stats.imagesMissing++;
        }
      } catch (err) {
        console.error(`  ❌  [${doc.issueId}] beforeImage upload failed: ${err.message}`);
        stats.errors.push({ issueId: doc.issueId, field: 'beforeImage', path: doc.beforeImage, error: err.message });
      }
    } else if (isAlreadyMigrated(doc.beforeImage)) {
      stats.imagesSkipped++;
    }

    // ── afterImage ────────────────────────────────────────────────────────────
    if (isLocalPath(doc.afterImage)) {
      try {
        const url = await uploadToCloudinary(doc.afterImage);
        if (url) {
          console.log(`  ✅  [${doc.issueId}] afterImage: ${doc.afterImage} → ${url}`);
          patch.afterImage = url;
          stats.imagesOk++;
          dirty = true;
        } else {
          console.warn(`  ⚠️   [${doc.issueId}] afterImage: file not found on disk → ${doc.afterImage}`);
          stats.imagesMissing++;
        }
      } catch (err) {
        console.error(`  ❌  [${doc.issueId}] afterImage upload failed: ${err.message}`);
        stats.errors.push({ issueId: doc.issueId, field: 'afterImage', path: doc.afterImage, error: err.message });
      }
    } else if (isAlreadyMigrated(doc.afterImage)) {
      stats.imagesSkipped++;
    }

    // ── Persist changes ───────────────────────────────────────────────────────
    if (dirty && Object.keys(patch).length > 0) {
      await Issue.updateOne(
        { _id: doc._id },
        { $set: patch }
      );
      stats.docsUpdated++;
    }
  }

  // 4. Disconnect
  await mongoose.disconnect();

  // 5. Final report
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('📊  Migration complete\n');
  console.log(`  Issues scanned   : ${stats.docsScanned}`);
  console.log(`  Issues updated   : ${stats.docsUpdated}`);
  console.log(`  Images uploaded  : ${stats.imagesOk}`);
  console.log(`  Already on CDN   : ${stats.imagesSkipped} (skipped)`);
  console.log(`  File not on disk : ${stats.imagesMissing} (path kept as-is)`);
  console.log(`  Errors           : ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\n⚠️   Errors detail:');
    stats.errors.forEach(({ issueId, field, path: p, error }) => {
      console.log(`  • [${issueId}] ${field}: ${p} — ${error}`);
    });
  }

  if (stats.imagesMissing > 0) {
    console.log(
      '\n💡  Tip: Files marked "not found on disk" no longer exist in server/uploads/.' +
      '\n    The database still holds the old /uploads/... path for those records.' +
      '\n    You can either leave them (broken images) or remove those paths manually.'
    );
  }

  console.log('─────────────────────────────────────────────────────────────\n');
}

migrate().catch((err) => {
  console.error('\n💥  Fatal error:', err);
  process.exit(1);
});
