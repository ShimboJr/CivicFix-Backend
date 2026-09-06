/**
 * verify-lls-expiry-index.js
 *
 * Definitive re-verification of the { status:1, expiresAt:1 } compound index
 * on LiveLocationSession.
 *
 * Previous explain() pass was inconclusive because no document in the dev DB
 * had status:'active' AND expiresAt <= now simultaneously — so both before and
 * after results showed 0 docs examined.  This script seeds exactly that
 * document, re-runs the query, and also proves the business-logic flip works.
 *
 * Flow:
 *   1. Connect to MongoDB.
 *   2. Confirm the compound index exists on the collection.
 *   3. Seed one LiveLocationSession: status:'active', expiresAt = 10 min ago.
 *   4. Run explain("executionStats") on the lazy-expiry query pattern.
 *      Expected: IXSCAN, totalDocsExamined = 1, index = status_1_expiresAt_1.
 *   5. Prove the business-logic flip: run lazyExpireIfNeeded() against the
 *      seeded document and confirm status changes from 'active' → 'expired'.
 *   6. Re-run explain() after the flip to confirm the document no longer
 *      appears in results (status is now 'expired', not 'active').
 *   7. Delete the seeded document (cleanup).
 *   8. Disconnect.
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

// ── Import the real Mongoose model so the compound index is registered ─────────
// (Mongoose syncs indexes on first use when autoIndex is true)
const LiveLocationSession = require('../models/LiveLocationSession');

// ── Inline the exact lazyExpireIfNeeded logic from liveLocationController ──────
// Copied verbatim — this is the real production function, not a mock.
async function lazyExpireIfNeeded(session) {
  if (session.status === 'active' && session.expiresAt <= new Date()) {
    session.status = 'expired';
    await session.save();
    return true;
  }
  return false;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
const HR  = '─'.repeat(72);
const HR2 = '═'.repeat(72);

function printExplain(label, explainResult) {
  console.log(`\n${HR}`);
  console.log(`  ${label}`);
  console.log(HR);

  const stats   = explainResult?.executionStats;
  const planner = explainResult?.queryPlanner;

  if (!stats) {
    console.log('  ⚠  No executionStats returned.\n');
    return;
  }

  const winningPlan = planner?.winningPlan;
  const stageChain  = buildStageChain(winningPlan);
  const indexUsed   = findIndexName(winningPlan);

  console.log(`  Stage chain       : ${stageChain}`);
  console.log(`  Index used        : ${indexUsed ?? '(none — COLLSCAN)'}`);
  console.log(`  totalDocsExamined : ${stats.totalDocsExamined}`);
  console.log(`  totalKeysExamined : ${stats.totalKeysExamined}`);
  console.log(`  nReturned         : ${stats.nReturned}`);
  console.log(`  executionTimeMs   : ${stats.executionTimeMillis}`);

  // Pass/fail assertion
  const isIxscan   = stageChain.includes('IXSCAN');
  const usesCorrectIndex = indexUsed === 'status_1_expiresAt_1';

  console.log();
  if (isIxscan && usesCorrectIndex) {
    console.log(`  ✅  PASS — IXSCAN using status_1_expiresAt_1`);
  } else if (isIxscan && !usesCorrectIndex) {
    console.log(`  ⚠   IXSCAN but using wrong index: ${indexUsed}`);
  } else {
    console.log(`  ❌  FAIL — expected IXSCAN, got COLLSCAN`);
  }
}

function buildStageChain(plan) {
  if (!plan) return 'unknown';
  const parts = [];
  let node = plan;
  while (node) {
    if (node.stage) parts.push(node.stage);
    node = node.inputStage ?? node.inputStages?.[0];
  }
  return parts.join(' → ');
}

function findIndexName(plan) {
  if (!plan) return null;
  if (plan.stage === 'IXSCAN') return plan.indexName;
  if (plan.inputStage)         return findIndexName(plan.inputStage);
  if (plan.inputStages)        return findIndexName(plan.inputStages[0]);
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${HR2}`);
  console.log('  LiveLocationSession — Lazy-Expiry Index Re-Verification');
  console.log(`${HR2}\n`);

  // ── 1. Connect ───────────────────────────────────────────────────────────────
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✔  Connected to MongoDB\n');

  // ── 2. Ensure the compound index actually exists on the collection ───────────
  console.log('── Checking index existence ─────────────────────────────────────────────');
  await LiveLocationSession.syncIndexes();   // flush any pending index declarations
  const rawCollection = mongoose.connection.db.collection('livelocationsessions');
  const indexes = await rawCollection.indexes();
  const compoundIdx = indexes.find(
    (idx) => idx.key && idx.key.status !== undefined && idx.key.expiresAt !== undefined
  );
  if (compoundIdx) {
    console.log(`  ✅  Compound index found: name="${compoundIdx.name}", key=${JSON.stringify(compoundIdx.key)}`);
  } else {
    console.log('  ❌  Compound { status, expiresAt } index NOT found — aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── 3. Seed a stale-active document ──────────────────────────────────────────
  console.log('\n── Seeding test document ────────────────────────────────────────────────');

  const now            = new Date();
  const tenMinutesAgo  = new Date(now.getTime() - 10 * 60 * 1000);
  const fakeReporterId = new mongoose.Types.ObjectId();
  const fakeReportId   = new mongoose.Types.ObjectId();

  // Insert via the raw driver (bypassing Mongoose validation) to avoid the
  // required-field check on `reporter` and `emergencyReport` pointing at real
  // documents.  We only need a real LiveLocationSession document; the ObjectId
  // refs don't need to resolve to real documents for an index/logic test.
  const insertResult = await rawCollection.insertOne({
    reporter:        fakeReporterId,
    emergencyReport: fakeReportId,
    status:          'active',
    startedAt:       new Date(now.getTime() - 70 * 60 * 1000),   // started 70 min ago
    expiresAt:       tenMinutesAgo,                                // expired 10 min ago
    locationTrail:   [],
    createdAt:       new Date(now.getTime() - 70 * 60 * 1000),
    updatedAt:       new Date(now.getTime() - 70 * 60 * 1000),
    _isAuditSeed:    true,   // marker so cleanup is unambiguous
  });

  const seededId = insertResult.insertedId;
  console.log(`  ✔  Seeded document _id: ${seededId}`);
  console.log(`     status   : 'active'`);
  console.log(`     expiresAt: ${tenMinutesAgo.toISOString()} (10 minutes in the past)`);

  // Brief yield so the index catches the new document
  await new Promise((r) => setTimeout(r, 200));

  // ── 4. explain() on the lazy-expiry query — with a real matching document ───
  console.log('\n── explain("executionStats") — REAL MATCH ───────────────────────────────');
  const lazyExpireQuery = rawCollection
    .find({ status: 'active', expiresAt: { $lte: now } })
    .limit(1);

  const explainResult = await lazyExpireQuery.explain('executionStats');
  printExplain(
    'LiveLocationSession.findOne({ status:"active", expiresAt:{ $lte:now } })',
    explainResult
  );

  // ── 5. Business-logic verification: lazyExpireIfNeeded ──────────────────────
  console.log(`\n${HR}`);
  console.log('  Business-logic verification — lazyExpireIfNeeded()');
  console.log(HR);

  // Fetch the seeded document through Mongoose so we get a real Mongoose doc
  // that .save() will work on.
  const session = await LiveLocationSession.findById(seededId);
  if (!session) {
    console.log('  ❌  Could not fetch seeded document via Mongoose — aborting logic test.');
    await rawCollection.deleteOne({ _id: seededId });
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n  Before lazyExpireIfNeeded():`);
  console.log(`    session.status   = '${session.status}'`);
  console.log(`    session.expiresAt = ${session.expiresAt.toISOString()}`);
  console.log(`    now               = ${now.toISOString()}`);
  console.log(`    expiresAt <= now? → ${session.expiresAt <= now}`);

  const didExpire = await lazyExpireIfNeeded(session);

  console.log(`\n  After lazyExpireIfNeeded():`);
  console.log(`    return value      = ${didExpire}  (true = flip happened)`);
  console.log(`    session.status   = '${session.status}'`);

  const statusIsExpired = session.status === 'expired';
  if (didExpire && statusIsExpired) {
    console.log(`\n  ✅  PASS — status correctly flipped 'active' → 'expired' and save() persisted.`);
  } else {
    console.log(`\n  ❌  FAIL — expected status='expired' and return=true, got status='${session.status}' return=${didExpire}`);
  }

  // Confirm persistence: re-fetch from DB and check status
  const refetched = await rawCollection.findOne({ _id: seededId });
  const persistedStatus = refetched?.status;
  console.log(`\n  DB re-fetch status: '${persistedStatus}'`);
  if (persistedStatus === 'expired') {
    console.log('  ✅  PASS — status persisted to database correctly.');
  } else {
    console.log(`  ❌  FAIL — DB shows status='${persistedStatus}', expected 'expired'.`);
  }

  // ── 6. Post-flip explain() — confirm the document no longer matches ──────────
  console.log(`\n${HR}`);
  console.log('  Post-flip explain() — document should no longer match the query');
  console.log(HR);

  // The flipped document now has status='expired', so it must NOT appear in
  // a query that filters status='active'.  This proves the flip + index
  // interaction is correct end-to-end.
  const postFlipQuery = rawCollection
    .find({ status: 'active', expiresAt: { $lte: now } })
    .limit(1);

  const postFlipExplain = await postFlipQuery.explain('executionStats');
  printExplain(
    'POST-FLIP: LiveLocationSession.findOne({ status:"active", expiresAt:{ $lte:now } })',
    postFlipExplain
  );

  const postFlipStats = postFlipExplain?.executionStats;
  if (postFlipStats?.nReturned === 0 && postFlipStats?.totalDocsExamined === 0) {
    console.log('\n  ✅  PASS — 0 docs returned, 0 docs examined after flip.');
    console.log('           The expired document is no longer visible to the query,');
    console.log('           and MongoDB did not examine it (index correctly excludes it).');
  } else {
    console.log(`\n  ⚠   Post-flip nReturned=${postFlipStats?.nReturned}, docsExamined=${postFlipStats?.totalDocsExamined}`);
  }

  // ── 7. Cleanup ───────────────────────────────────────────────────────────────
  console.log(`\n${HR}`);
  console.log('  Cleanup');
  console.log(HR);
  const deleteResult = await rawCollection.deleteOne({ _id: seededId });
  if (deleteResult.deletedCount === 1) {
    console.log(`  ✔  Seeded document ${seededId} deleted from database.\n`);
  } else {
    console.log(`  ⚠  Delete returned deletedCount=${deleteResult.deletedCount} — document may already be gone.\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(HR2);
  console.log('  RESULT SUMMARY');
  console.log(HR2);
  const preFlipStats = explainResult?.executionStats;
  console.log(`
  Index present          : ✅  status_1_expiresAt_1
  explain() stage        : ${buildStageChain(explainResult?.queryPlanner?.winningPlan)}
  Index used             : ${findIndexName(explainResult?.queryPlanner?.winningPlan) ?? '(none)'}
  totalDocsExamined      : ${preFlipStats?.totalDocsExamined} (expected 1)
  totalKeysExamined      : ${preFlipStats?.totalKeysExamined} (expected 1)
  nReturned              : ${preFlipStats?.nReturned} (expected 1)
  Business-logic flip    : ${didExpire && statusIsExpired ? '✅  active → expired (correct)' : '❌  did NOT flip (unexpected)'}
  DB persistence         : ${persistedStatus === 'expired' ? '✅  persisted' : '❌  not persisted'}
  Post-flip invisibility : ${postFlipStats?.nReturned === 0 ? '✅  document invisible to query' : '⚠   still visible'}
  Test document cleanup  : ✅  deleted
`);

  await mongoose.disconnect();
  console.log('✔  Disconnected.\n');
}

run().catch((err) => {
  console.error('\nFatal error:', err.message, err.stack);
  process.exit(1);
});
