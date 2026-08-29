const mongoose = require('mongoose');

// ─── Schema ───────────────────────────────────────────────────────────────────
const issueSchema = new mongoose.Schema(
  {
    // Human-readable unique identifier — format CF-{year}-{5-digit sequence}
    // e.g.  CF-2025-00001, CF-2025-00042
    issueId: {
      type:   String,
      unique: true,
    },

    title: {
      type:     String,
      required: [true, 'Issue title is required'],
      trim:     true,
    },

    description: {
      type:     String,
      required: [true, 'Issue description is required'],
    },

    category: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Category',
      required: [true, 'Category is required'],
    },

    location: {
      address: {
        type:     String,
        required: [true, 'Location address is required'],
      },
      latitude:  { type: Number },
      longitude: { type: Number },
    },

    // File paths to uploaded images (stored in /uploads)
    images: [{ type: String }],

    severity: {
      type:    String,
      enum:    ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },

    status: {
      type:    String,
      enum:    ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected'],
      default: 'Pending',
    },

    reportedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Reporter is required'],
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    // Array of User IDs who clicked "I also experience this"
    upvotes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // Before / after images for resolved issues
    beforeImage: { type: String },
    afterImage:  { type: String },

    // Populated when an admin rejects an issue — visible to the reporter
    rejectionReason: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
issueSchema.index({ issueId: 1 }, { unique: true });

// Compound index for the most common filter combination
issueSchema.index({ category: 1, status: 1 });

// ─── Pre-save Hook — Generate issueId ────────────────────────────────────────
issueSchema.pre('save', async function (next) {
  // Only generate an ID on new documents
  if (!this.isNew || this.issueId) return next();

  const year = new Date().getFullYear();

  // Count how many issues exist for this year to determine the next sequence
  const count = await mongoose
    .model('Issue')
    .countDocuments({ issueId: new RegExp(`^CF-${year}-`) });

  // Zero-pad to 5 digits: CF-2025-00001
  const sequence = String(count + 1).padStart(5, '0');

  this.issueId = `CF-${year}-${sequence}`;

  next();
});

const Issue = mongoose.model('Issue', issueSchema);

module.exports = Issue;
