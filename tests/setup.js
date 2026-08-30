/**
 * tests/setup.js
 *
 * Shared test-database helpers used by every test file.
 *
 * mongodb-memory-server downloads and runs a real MongoDB binary in memory,
 * so tests never touch the Atlas cluster and leave no data behind.
 *
 * Usage pattern in each test file:
 *
 *   const { connectTestDB, closeTestDB, clearTestDB } = require('./setup');
 *
 *   beforeAll(connectTestDB);
 *   afterEach(clearTestDB);   // prevent state leaking between test cases
 *   afterAll(closeTestDB);
 *
 * SAFETY MODEL (three layers)
 * ──────────────────────────────────────────────────────────────────────────────
 * Layer 1 — config/db.js returns immediately when NODE_ENV === 'test', so
 *            connectDB() never touches a real database during test runs.
 *
 * Layer 2 — This file (below): assertLocalConnection() inspects the active
 *            Mongoose connection host before any destructive operation and
 *            throws if it doesn't look like a local in-memory address.
 *            mongodb-memory-server always binds to 127.0.0.1 — a real Atlas
 *            cluster host will contain "mongodb.net" or similar and will never
 *            pass this check.  This guard fires even if layer 1 is bypassed.
 *
 * Layer 3 — .env.test contains only dummy values (no real MONGO_URI), and the
 *            test script loads it instead of .env, so even if both layer 1 and
 *            layer 2 are bypassed there is no real connection string available
 *            in the process environment for anything to connect to.
 */

const mongoose              = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

// ─── Safety assertion ─────────────────────────────────────────────────────────
/**
 * assertLocalConnection — throws immediately if the active Mongoose connection
 * host does not look like a local address.
 *
 * mongodb-memory-server always binds to 127.0.0.1, so a live test-DB
 * connection will always pass this check.  A real Atlas host
 * (e.g. "cluster0.xxxxx.mongodb.net") will never contain "127.0.0.1" or
 * "localhost" and will be rejected before any destructive operation runs.
 *
 * @param {string} caller - name of the calling function, used in the error message
 */
const assertLocalConnection = (caller) => {
  const host = mongoose.connection.host || '';
  const isSafe = host.includes('127.0.0.1') || host.includes('localhost');

  if (!isSafe) {
    throw new Error(
      `[setup.js] SAFETY ABORT — ${caller}() refused to operate on host "${host}". ` +
      `Expected a local in-memory address (127.0.0.1 / localhost) but got something ` +
      `that looks like a real database. Destructive test operations will NOT run ` +
      `against a non-local host. Check that NODE_ENV=test and that config/db.js ` +
      `is correctly bypassing connectDB() in test mode.`
    );
  }
};

// ─── connectTestDB ────────────────────────────────────────────────────────────
/**
 * connectTestDB — starts a fresh in-memory MongoDB instance and connects
 * Mongoose to it.  Call once per test file in a `beforeAll` hook.
 */
const connectTestDB = async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Immediately verify the connection is local before any test runs
  assertLocalConnection('connectTestDB');
};

// ─── clearTestDB ──────────────────────────────────────────────────────────────
/**
 * clearTestDB — drops every collection in the in-memory database.
 * Call in `afterEach` so each test case starts from a clean slate without
 * needing to manually clean up the documents it created.
 */
const clearTestDB = async () => {
  // Safety check before every destructive operation — refuses to drop
  // collections if the active connection doesn't look local.
  assertLocalConnection('clearTestDB');

  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((col) => col.deleteMany({}))
  );
};

// ─── closeTestDB ──────────────────────────────────────────────────────────────
/**
 * closeTestDB — disconnects Mongoose and stops the in-memory MongoDB instance.
 * Call in `afterAll` to release the open handle so Jest exits cleanly.
 */
const closeTestDB = async () => {
  assertLocalConnection('closeTestDB');

  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };
