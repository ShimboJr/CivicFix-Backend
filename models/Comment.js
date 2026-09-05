const mongoose = require('mongoose');

// ─── Schema ───────────────────────────────────────────────────────────────────
const commentSchema = new mongoose.Schema(
  {
    issue: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Issue',
      required: [true, 'Issue reference is required'],
    },

    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User reference is required'],
    },

    text: {
      type:     String,
      required: [true, 'Comment text is required'],
      trim:     true,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// getIssueById and getComments both call:
//   Comment.find({ issue: id }).sort({ createdAt: 1 })
// The compound index below supports both the equality filter on `issue` and the
// ascending-createdAt sort in a single IXSCAN (ESR: Equality → Sort).
commentSchema.index({ issue: 1, createdAt: 1 });

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
