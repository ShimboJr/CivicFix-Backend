// Load the appropriate env file first — before any other module reads process.env.
// cross-env in the "test" script sets NODE_ENV=test before Node starts, so this
// branch executes correctly at module-load time.  .env.test contains only safe
// dummy values (no real MONGO_URI), which is layer 3 of the DB-safety model.
require('dotenv').config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
});

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const connectDB = require('./config/db');

// ─── Database connection ──────────────────────────────────────────────────────
// Called here (in addition to server.js) so the connection is established on
// every cold start regardless of which file Vercel treats as the entry point.
// On a warm invocation the readyState guard in db.js makes this a fast no-op.
// server.js also calls connectDB() for local `node server.js` usage — the
// guard makes the second call harmless in both environments.
//
// Skipped in test mode: Jest's setup.js owns the Mongoose connection and
// points it at an in-memory MongoDB instance.  Calling connectDB() here in
// test mode would attempt to connect to the real Atlas URI before setup.js
// can connect to the in-memory URI, causing Mongoose to throw
// "Can't call openUri() on an active connection with different connection strings".
if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    console.error('[CivicFix] Startup DB connection failed:', err.message);
  });
}

const app = express();

// ─── Security Headers (helmet) ───────────────────────────────────────────────
// crossOriginResourcePolicy is relaxed to "cross-origin" so that browsers can
// load images hosted on Cloudinary (res.cloudinary.com) without being blocked
// by the CORP header.  All other helmet defaults remain — including removal of
// the X-Powered-By header, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ─── Core Middleware ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CORS ────────────────────────────────────────────────────────────────────
// Allowlist: production frontend (set via CLIENT_URL in the deployment env) +
// the Vite dev-server origin for local development.
// Auth uses a Bearer token in the Authorization header, so credentialed
// cookie-based requests are not required here.
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,      // e.g. https://civicfix.vercel.app
  'http://localhost:5173',     // Vite dev server
].filter(Boolean);             // drop undefined if CLIENT_URL is not set

app.use(
  cors({
    origin(requestOrigin, callback) {
      // Allow requests with no Origin header (same-origin, Postman, curl, etc.)
      if (!requestOrigin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${requestOrigin}' is not allowed`));
      }
    },
  })
);

// HTTP request logger — development only
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Static Folder (uploaded images) ─────────────────────────────────────────
// Removed: app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
// Images are now stored on Cloudinary — there are no local files to serve.
// If any other feature still relied on this static route, it will need to be
// updated to reference the Cloudinary URL stored in the database instead.

// ─── Per-request DB reconnect guard ─────────────────────────────────────────
// Serverless warm instances can lose their MongoDB connection between
// invocations.  This middleware awaits connectDB() before each request reaches
// a route handler.  The readyState guard in db.js makes it a no-op when the
// connection is already live, so there is no overhead on normal requests.
// Not registered in test mode — setup.js manages the connection there.
if (process.env.NODE_ENV !== 'test') {
  app.use(async (_req, _res, next) => {
    try {
      await connectDB();
      next();
    } catch (err) {
      next(err); // Falls through to the global error handler → 500
    }
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/public',         require('./routes/publicRoutes'));  // no auth required
app.use('/api/auth',          require('./routes/authRoutes'));
// TODO: mount user routes      → app.use('/api/users',      require('./routes/userRoutes'));
app.use('/api/admin',          require('./routes/adminRoutes'));
app.use('/api/staff',          require('./routes/staffRoutes'));
app.use('/api/issues',         require('./routes/issueRoutes'));
app.use('/api/categories',     require('./routes/categoryRoutes'));
app.use('/api/notifications',  require('./routes/notificationRoutes'));
app.use('/api/uploads',        require('./routes/uploadRoutes'));
app.use('/api/emergency-reports', require('./routes/emergencyRoutes'));
// TODO: mount comment routes   → app.use('/api/comments',   require('./routes/commentRoutes'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV });
});

// ─── 404 Handler (unknown routes) ────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  // Default to 500 if the response status is still 200 (uncaught throw)
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  res.status(statusCode).json({
    message: err.message,
    // Expose stack trace only in development for debugging
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
});

module.exports = app;
