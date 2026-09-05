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

// getMyIssues: Issue.find({ reportedBy: userId }).sort({ createdAt: -1 })
// Every resident dashboard load and the notify helper both hit this path.
issueSchema.index({ reportedBy: 1 });

// getAssignedIssues (staff): Issue.find({ assignedTo: staffId }).sort({ createdAt: -1 })
// getStaffWorkload (admin): aggregate $match { assignedTo: { $exists, $ne:null } }
//   then $group by assignedTo — the index lets MongoDB avoid a COLLSCAN and use
//   the index as a grouping cursor instead.
issueSchema.index({ assignedTo: 1 });

// ─── Pre-save Hook — Generate issueId ────────────────────────────────────────
issueSchema.pre('save', async function (next) {
  // Only generate an ID on new documents
  if (!this.isNew || this.issueId) return next();

  const year = new Date().getFullYear();

  // ── Why NOT countDocuments() ───────────────────────────────────────────────
  // Using count+1 breaks the moment any issue is deleted: the count drops,
  // making the next "new" sequence collide with an existing ID (E11000).
  //
  // ── Fix: find the current maximum sequence and increment from it ───────────
  // Zero-padding to 5 digits means lexicographic sort === numeric sort, so
  // sorting by issueId descending gives us the highest sequence with no regex
  // arithmetic needed for comparison — only for the final +1.
  const last = await mongoose
    .model('Issue')
    .findOne({ issueId: new RegExp(`^CF-${year}-`) })
    .sort({ issueId: -1 })
    .select('issueId')
    .lean();

  // Parse the trailing 5-digit sequence from the last ID, or start at 0
  const lastSeq  = last ? parseInt(last.issueId.split('-')[2], 10) : 0;
  const sequence = String(lastSeq + 1).padStart(5, '0');

  this.issueId = `CF-${year}-${sequence}`;

  next();
});

const Issue = mongoose.model('Issue', issueSchema);

module.exports = Issue;
