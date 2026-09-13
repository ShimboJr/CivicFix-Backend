require('dotenv').config();

// CI GATE TEST — intentional lint error; remove before merging
const LINT_FAILURE_INTENTIONAL = 'this variable is never used';

const app       = require('./app');
const connectDB = require('./config/db');

// ─── Connect to Database ─────────────────────────────────────────────────────
connectDB();

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `🚀  CivicFix server running in ${process.env.NODE_ENV} mode on port ${PORT}`
  );
});
