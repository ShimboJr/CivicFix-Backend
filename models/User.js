const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ─── Schema ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Name is required'],
      trim:     true,
    },

    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },

    password: {
      type:      String,
      required:  [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select:    false, // Never returned in queries by default
    },

    role: {
      type:    String,
      enum:    ['resident', 'admin', 'staff'],
      default: 'resident',
    },

    location: {
      type: String,
      trim: true,
    },

    // ── Account-lockout tracking ───────────────────────────────────────────────
    // Incremented on each failed login; reset to 0 on success or when a lock fires.
    failedLoginAttempts: {
      type:    Number,
      default: 0,
    },
    // Set to a future Date when failedLoginAttempts reaches MAX_ATTEMPTS.
    // While Date.now() < lockUntil the account is locked regardless of password.
    // Cleared (set to null) on the next successful login after the window passes.
    lockUntil: {
      type:    Date,
      default: null,
    },

    // ── Password reset ─────────────────────────────────────────────────────────
    // The raw token is NEVER stored — only its sha256 hash is persisted here so
    // that a database breach cannot be used to reset accounts.
    // Both fields are select:false so they are omitted from all normal queries.
    resetPasswordToken: {
      type:   String,
      select: false,
    },
    resetPasswordExpire: {
      type:   Date,
      select: false,
    },
  },
  {
    timestamps: true, // Adds createdAt & updatedAt automatically
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 }, { unique: true });

// ─── Pre-save Hook — Password Hashing ────────────────────────────────────────
userSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

// ─── Instance Method — Password Comparison ───────────────────────────────────
/**
 * matchPassword — compares a plain-text candidate password against the
 * hashed password stored in the database.
 *
 * @param   {string}  enteredPassword — the plain-text password from the login form
 * @returns {Promise<boolean>}        — true if they match, false otherwise
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
