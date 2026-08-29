const mongoose = require('mongoose');

/**
 * Notification — stores in-app alerts for a single user.
 * Created whenever an issue's status changes via any admin or staff action.
 */
const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,          // fast lookup by user
    },
    issue: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Issue',
      required: true,
    },
    message: {
      type:     String,
      required: true,
      trim:     true,
    },
    read: {
      type:    Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
