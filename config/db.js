const mongoose = require('mongoose');

const connectDB = async () => {
  // ── Guard 1: test mode ───────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'test') return;

  // ── Guard 2: already connected ───────────────────────────────────────────
  if (mongoose.connection.readyState !== 0) return;

  try {
    // ╔═════════════════════════════════════════════════════════════════════╗
    // ║           CONNECTION POOLING CONFIG - M0 FIX                       ║
    // ║   Prevents "connections exceeded threshold" MongoDB Atlas error    ║
    // ╚═════════════════════════════════════════════════════════════════════╝

    const mongooseOptions = {
      // ───────────────────────────────────────────────────────────────────
      // CONNECTION POOLING - MOST IMPORTANT PART
      // ───────────────────────────────────────────────────────────────────
      maxPoolSize: 10,                  // Max connections to reuse
      minPoolSize: 5,                   // Min connections to keep warm
      maxIdleTimeMS: 45000,             // Close idle connections after 45s
      serverSelectionTimeoutMS: 5000,   // Timeout for selecting server
      socketTimeoutMS: 45000,           // Timeout for socket operations

      // ───────────────────────────────────────────────────────────────────
      // RELIABILITY & RETRY
      // ───────────────────────────────────────────────────────────────────
      retryWrites: true,                // Automatically retry failed writes
      w: 'majority',                    // Wait for majority write acknowledgment
      connectTimeoutMS: 10000,          // Timeout for initial connection

      // ───────────────────────────────────────────────────────────────────
      // MONITORING & DEBUGGING
      // ───────────────────────────────────────────────────────────────────
      appName: `civicfix-${process.env.NODE_ENV || 'development'}`,
    };

    // ──────────────────────────────────────────────────────────────────────
    // CONNECT TO MONGODB WITH POOLING CONFIG
    // ──────────────────────────────────────────────────────────────────────
    const conn = await mongoose.connect(process.env.MONGO_URI, mongooseOptions);

    console.log(
      `✅  MongoDB connected: ${conn.connection.host} — DB: "${conn.connection.name}"`
    );
    console.log(
      `    📊 Pool size: ${mongooseOptions.minPoolSize}-${mongooseOptions.maxPoolSize} connections`
    );
    console.log(`    ⏱️  Idle timeout: ${mongooseOptions.maxIdleTimeMS / 1000}s`);

    // ──────────────────────────────────────────────────────────────────────
    // CONNECTION EVENT HANDLERS
    // Monitor connection state in real-time
    // ──────────────────────────────────────────────────────────────────────

    mongoose.connection.on('connected', () => {
      console.log('📡 MongoDB: Connection established');
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB: Disconnected (will auto-reconnect)');
    });

    mongoose.connection.on('error', (error) => {
      console.error(`❌  MongoDB error: ${error.message}`);
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB: Reconnected');
    });

    // ──────────────────────────────────────────────────────────────────────
    // GRACEFUL SHUTDOWN
    // Ensure connections close cleanly when app terminates
    // ──────────────────────────────────────────────────────────────────────

    const gracefulShutdown = async (reason) => {
      console.log(`\n🛑 Shutting down gracefully: ${reason}`);

      try {
        await mongoose.connection.close(false);
        console.log('✅  MongoDB connections closed properly');
        process.exit(0);
      } catch (error) {
        console.error(`❌  Error closing MongoDB: ${error.message}`);
        process.exit(1);
      }
    };

    // Handle termination signals gracefully
    process.on('SIGINT', () => gracefulShutdown('SIGINT (Ctrl+C)'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM (termination)'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error(`❌  Uncaught exception: ${error.message}`);
      gracefulShutdown('Uncaught exception');
    });

    return conn;

  } catch (error) {
    console.error(`❌  MongoDB connection failed: ${error.message}`);

    // ────────────────────────────────────────────────────────────────────
    // RETRY LOGIC FOR PRODUCTION
    // ────────────────────────────────────────────────────────────────────
    if (process.env.NODE_ENV === 'production') {
      console.log('⏳  Retrying connection in 5 seconds...');
      setTimeout(() => connectDB(), 5000);
    } else {
      throw error;
    }
  }
};

module.exports = connectDB;
