require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');

const connectDB = require('./config/db');

// ─── Connect to Database ─────────────────────────────────────────────────────
connectDB();

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

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/public',         require('./routes/publicRoutes'));  // no auth required
app.use('/api/auth',          require('./routes/authRoutes'));
// TODO: mount user routes      → app.use('/api/users',      require('./routes/userRoutes'));
app.use('/api/admin',          require('./routes/adminRoutes'));
app.use('/api/staff',          require('./routes/staffRoutes'));
app.use('/api/issues',         require('./routes/issueRoutes'));
app.use('/api/categories',     require('./routes/categoryRoutes'));
app.use('/api/notifications',  require('./routes/notificationRoutes'));
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
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Default to 500 if the response status is still 200 (uncaught throw)
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  res.status(statusCode).json({
    message: err.message,
    // Expose stack trace only in development for debugging
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `🚀  CivicFix server running in ${process.env.NODE_ENV} mode on port ${PORT}`
  );
});

module.exports = app;
