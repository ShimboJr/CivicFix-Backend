/**
 * index-audit-explain.js
 *
 * Runs .explain("executionStats") on three representative queries BEFORE the
 * new indexes are added, then after, so we have concrete proof that each new
 * index converts a COLLSCAN into an IXSCAN and reduces totalDocsExamined.
 *
 * Run:  node scripts/index-audit-explain.js [before|after]
 *
 * "before"  — drop the three new indexes if they exist, then explain.
 * "after"   — create the three new indexes, then explain again.
 *
 * The three representative queries chosen:
 *   1. Notification.find({ recipient: <id>, read: false })
 *      → new index: { recipient: 1, read: 1, createdAt: -1 }
 *   2. Issue.find({ reportedBy: <id> })
 *      → new index: { reportedBy: 1 }
 *   3. LiveLocationSession.findOne({ status: 'active', expiresAt: { $lte: now } })
 *      → new index: { status: 1, expiresAt: 1 }
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const mode = process.argv[2] || 'before'; // 'before' or 'after'

// ── Minimal raw collection access (bypasses Mongoose model indexes) ────────────
async function run() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  CivicFix Index Audit — explain() pass: ${mode.toUpperCase()}`);
  console.log(`${'═'.repeat(70)}\n`);

  await mongoose.connect(MONGO_URI);
  console.log('✔  Connected to MongoDB\n');

  const db = mongoose.connection.db;

  const notifications  = db.collection('notifications');
  const issues         = db.collection('issues');
  const lls            = db.collection('livelocationsessions');

  // ── Manage new indexes depending on mode ─────────────────────────────────────
  if (mode === 'before') {
    console.log('── Dropping new indexes if they already exist (clean BEFORE state) ──\n');
    await dropIfExists(notifications, 'recipient_1_read_1_createdAt_-1');
    await dropIfExists(issues,        'reportedBy_1');
    await dropIfExists(lls,           'status_1_expiresAt_1');
  } else {
    console.log('── Creating new indexes (AFTER state) ───────────────────────────────\n');
    await notifications.createIndex(
      { recipient: 1, read: 1, createdAt: -1 },
      { name: 'recipient_1_read_1_createdAt_-1', background: true }
    );
    console.log('  ✔  notifications: { recipient:1, read:1, createdAt:-1 }');

    await issues.createIndex(
      { reportedBy: 1 },
      { name: 'reportedBy_1', background: true }
    );
    console.log('  ✔  issues: { reportedBy:1 }');

    await lls.createIndex(
      { status: 1, expiresAt: 1 },
      { name: 'status_1_expiresAt_1', background: true }
    );
    console.log('  ✔  livelocationsessions: { status:1, expiresAt:1 }');
  }

  console.log();

  // ── Grab one real ObjectId to use as a filter value ───────────────────────────
  const anyNotif  = await notifications.findOne({}, { projection: { recipient: 1 } });
  const anyIssue  = await issues.findOne({},        { projection: { reportedBy: 1 } });
  const recipientId = anyNotif?.recipient ?? new mongoose.Types.ObjectId();
  const reporterId  = anyIssue?.reportedBy ?? new mongoose.Types.ObjectId();

  // ── Query 1: Notification by recipient + read filter ─────────────────────────
  console.log('─'.repeat(70));
  console.log('QUERY 1 — Notification.find({ recipient, read: false }).sort({ createdAt: -1 })');
  console.log('─'.repeat(70));
  const notifExplain = await notifications
    .find({ recipient: recipientId, read: false })
    .sort({ createdAt: -1 })
    .explain('executionStats');
  printExplain(notifExplain);

  // ── Query 2: Issue by reportedBy ──────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('QUERY 2 — Issue.find({ reportedBy }).sort({ createdAt: -1 })');
  console.log('─'.repeat(70));
  const issueExplain = await issues
    .find({ reportedBy: reporterId })
    .sort({ createdAt: -1 })
    .explain('executionStats');
  printExplain(issueExplain);

  // ── Query 3: LiveLocationSession lazy-expiry check ────────────────────────────
  console.log('─'.repeat(70));
  console.log('QUERY 3 — LiveLocationSession.findOne({ status:"active", expiresAt: { $lte: now } })');
  console.log('─'.repeat(70));
  const llsExplain = await lls
    .find({ status: 'active', expiresAt: { $lte: new Date() } })
    .limit(1)
    .explain('executionStats');
  printExplain(llsExplain);

  await mongoose.disconnect();
  console.log('\n✔  Done.\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function dropIfExists(collection, indexName) {
  try {
    await collection.dropIndex(indexName);
    console.log(`  ✔  Dropped ${collection.collectionName}.${indexName}`);
  } catch (e) {
    if (e.codeName === 'IndexNotFound' || e.code === 27) {
      console.log(`  –  ${collection.collectionName}.${indexName} did not exist (OK)`);
    } else {
      console.warn(`  ⚠  Could not drop ${indexName}:`, e.message);
    }
  }
}

function printExplain(explainResult) {
  const stats = explainResult?.executionStats;
  if (!stats) {
    console.log('  (no executionStats returned)\n');
    return;
  }
  const stage = getWinningStage(explainResult?.queryPlanner?.winningPlan);
  console.log(`  Stage            : ${stage}`);
  console.log(`  totalDocsExamined: ${stats.totalDocsExamined}`);
  console.log(`  totalKeysExamined: ${stats.totalKeysExamined}`);
  console.log(`  nReturned        : ${stats.nReturned}`);
  console.log(`  executionTimeMs  : ${stats.executionTimeMillis}`);
  if (stage === 'IXSCAN' || stage?.includes('IXSCAN')) {
    const idx = getIndexName(explainResult?.queryPlanner?.winningPlan);
    if (idx) console.log(`  index used       : ${idx}`);
  }
  console.log();
}

function getWinningStage(plan) {
  if (!plan) return 'unknown';
  if (plan.stage) {
    if (plan.inputStage) return `${plan.stage} → ${getWinningStage(plan.inputStage)}`;
    return plan.stage;
  }
  return 'unknown';
}

function getIndexName(plan) {
  if (!plan) return null;
  if (plan.stage === 'IXSCAN') return plan.indexName;
  if (plan.inputStage) return getIndexName(plan.inputStage);
  return null;
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
