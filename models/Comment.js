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

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
