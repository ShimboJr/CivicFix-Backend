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
if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    console.error('[CivicFix] Startup DB connection failed:', err.message);
  });
}

const app = express();

// ─── Security Headers (helmet) ───────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ─── Core Middleware ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:8081',
  'exp://192.168.1.101:8081',
].filter(Boolean);

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

// ─── Per-request DB reconnect guard ─────────────────────────────────────────
// Serverless warm instances can lose their MongoDB connection between
// invocations.  This middleware awaits connectDB() before each request reaches
// a route handler.  The readyState guard in db.js makes it a no-op when the
// connection is already live, so there is no overhead on normal requests.
if (process.env.NODE_ENV !== 'test') {
  app.use(async (_req, _res, next) => {
    try {
      await connectDB();
      next();
    } catch (err) {
      next(err);
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
app.use('/api/live-location',     require('./routes/liveLocationRoutes'));
app.use('/api/push',             require('./routes/pushRoutes'));
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
