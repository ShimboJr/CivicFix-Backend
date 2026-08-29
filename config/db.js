const mongoose = require('mongoose');

/**
 * connectDB — establishes a connection to MongoDB via MONGO_URI.
 * Exits the process immediately on connection failure so the server
 * does not start in a broken state.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log(
      `✅  MongoDB connected: ${conn.connection.host} — DB: "${conn.connection.name}"`
    );
  } catch (error) {
    console.error(`❌  MongoDB connection failed: ${error.message}`);
    process.exit(1); // Non-zero exit signals an abnormal termination
  }
};

module.exports = connectDB;
