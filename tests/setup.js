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
 */

const mongoose              = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

/**
 * connectTestDB — starts a fresh in-memory MongoDB instance and connects
 * Mongoose to it.  Call once per test file in a `beforeAll` hook.
 */
const connectTestDB = async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
};

/**
 * clearTestDB — drops every collection in the in-memory database.
 * Call in `afterEach` so each test case starts from a clean slate without
 * needing to manually clean up the documents it created.
 */
const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((col) => col.deleteMany({}))
  );
};

/**
 * closeTestDB — disconnects Mongoose and stops the in-memory MongoDB instance.
 * Call in `afterAll` to release the open handle so Jest exits cleanly.
 */
const closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };
