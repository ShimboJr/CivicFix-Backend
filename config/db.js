const mongoose = require('mongoose');

const connectDB = async () => {
  // ── Guard 1: test mode ───────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'test') return;

  // ── Guard 2: already connected ───────────────────────────────────────────
  if (mongoose.connection.readyState !== 0) return;

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(
      `✅  MongoDB connected: ${conn.connection.host} — DB: "${conn.connection.name}"`
    );
  } catch (error) {
    console.error(`❌  MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
