const mongoose = require('mongoose');

/**
 * connectDB — establishes a Mongoose connection to MongoDB Atlas.
 *
 * SERVERLESS-SAFE DESIGN
 * ──────────────────────
 * On Vercel (and any serverless platform) the same Node.js process may handle
 * multiple requests in sequence (warm invocations).  We must not open a new
 * connection on every request.
 *
 * readyState values:
 *   0 = disconnected  ← only state where we call mongoose.connect()
 *   1 = connected     ← already live, skip
 *   2 = connecting    ← in-flight, Mongoose will buffer queries, skip
 *   3 = disconnecting ← transient, skip
 *
 * process.exit() is intentionally removed: killing a serverless function
 * worker is a no-op and swallows the error.  Instead we throw so the caller
 * (app.js middleware or server.js startup) can handle the failure correctly
 * for its environment.
 */
const connectDB = async () => {
  // ── Guard 1: test mode ───────────────────────────────────────────────────
  // Never connect to a real database during test runs.  setup.js manages the
  // Mongoose connection exclusively in test mode, pointing it at an in-memory
  // MongoDB instance.  If connectDB() were allowed to run in test mode it
  // could connect to the real Atlas cluster (via MONGO_URI from .env) before
  // setup.js's connectTestDB() runs — Jest executes require/import statements
  // synchronously at module load time, before any beforeAll() hook fires.
  // That was the exact sequence that wiped the real Atlas database.
  if (process.env.NODE_ENV === 'test') return;

  // ── Guard 2: already connected ───────────────────────────────────────────
  // Serverless warm instances re-use the same Node.js process for multiple
  // requests.  Skip mongoose.connect() if a live connection already exists.
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (mongoose.connection.readyState !== 0) return;

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(
      `✅  MongoDB connected: ${conn.connection.host} — DB: "${conn.connection.name}"`
    );
  } catch (error) {
    console.error(`❌  MongoDB connection failed: ${error.message}`);
    throw error; // Let the caller handle this — don't process.exit() in serverless
  }
};

module.exports = connectDB;
