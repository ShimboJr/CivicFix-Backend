const mongoose = require('mongoose');

// ── Connection-pool options ────────────────────────────────────────────────────
//
// Atlas M0 (free tier) hard limit: 500 total connections across ALL clients.
// By default Mongoose/MongoDB driver opens up to 100 connections per pool.
// When you run multiple Vercel serverless instances (one per device under test,
// plus Vercel's own warm-instance fan-out) each instance spins up its OWN pool
// of up to 100 connections — 5 devices × 100 = 500, which hits the cap.
//
// Fixes applied here (no Atlas upgrade needed):
//   1. maxPoolSize: 5   — cap each server-process pool at 5 sockets.
//                         5 sockets × ~10 concurrent Vercel instances = 50 total,
//                         well under the 500 limit.
//   2. minPoolSize: 1   — keep 1 socket warm so the first request isn't cold.
//   3. serverSelectionTimeoutMS: 10_000
//                       — fail fast if Atlas is unreachable instead of hanging
//                         and leaking a connection attempt.
//   4. socketTimeoutMS: 45_000
//                       — release stale sockets after 45 s of inactivity so
//                         they don't accumulate silently.
//   5. maxIdleTimeMS: 30_000
//                       — close idle connections after 30 s; prevents the pool
//                         from holding open sockets that Atlas already timed out.
//
const MONGOOSE_OPTS = {
  maxPoolSize:              5,
  minPoolSize:              1,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS:          45_000,
  maxIdleTimeMS:            30_000,
};

let connectionPromise = null; // module-level — shared across all calls in the same process

const connectDB = async () => {
  // ── Guard 1: test mode ───────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'test') return;

  // ── Guard 2: already connected or connecting ─────────────────────────────
  // readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  // We treat 1 (connected) AND 2 (connecting) as "already in progress" so we
  // never issue a second mongoose.connect() call mid-flight.  Without this, a
  // burst of simultaneous serverless cold-starts can each call connect() before
  // the first one resolves, creating N parallel pools instead of one.
  if (mongoose.connection.readyState === 1) return; // already connected
  if (mongoose.connection.readyState === 2) {        // connecting — await the in-flight promise
    return connectionPromise;
  }

  // ── Guard 3: deduplicate concurrent calls in the same process ────────────
  // If two async calls reach this point simultaneously (e.g. two requests hit
  // the per-request middleware at the same tick), only the first one should
  // call mongoose.connect().  The second one awaits the same promise.
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose
    .connect(process.env.MONGO_URI, MONGOOSE_OPTS)
    .then((conn) => {
      console.log(
        `✅  MongoDB connected: ${conn.connection.host} — DB: "${conn.connection.name}" ` +
        `(pool: max=${MONGOOSE_OPTS.maxPoolSize})`
      );
    })
    .catch((error) => {
      console.error(`❌  MongoDB connection failed: ${error.message}`);
      // Reset the cached promise so the next request can retry
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
};

module.exports = connectDB;
