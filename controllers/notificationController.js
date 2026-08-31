const asyncHandler   = require('express-async-handler');
const Notification   = require('../models/Notification');

const PAGE_SIZE = 15;
const unused = 42;

// ─── @desc    Get the logged-in user's notifications (newest first, paginated)
// ─── @route   GET /api/notifications
// ─── @access  Private
const getMyNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const onlyUnread = req.query.unread === 'true';

  const filter = { recipient: userId, ...(onlyUnread && { read: false }) };

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('issue', 'issueId title')
      .lean(),
    Notification.countDocuments(filter),
    // unreadCount is always the total unread regardless of the current filter
    Notification.countDocuments({ recipient: userId, read: false }),
  ]);

  res.status(200).json({
    notifications,
    unreadCount,
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE) || 1,
  });
});

// ─── @desc    Mark a single notification as read
// ─── @route   PUT /api/notifications/:id/read
// ─── @access  Private
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }

  // Prevent one user from marking another's notifications as read
  if (notification.recipient.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorised — this notification does not belong to you');
  }

  notification.read = true;
  await notification.save();

  res.status(200).json({ message: 'Marked as read', _id: notification._id });
});

// ─── @desc    Mark ALL of the logged-in user's notifications as read
// ─── @route   PUT /api/notifications/read-all
// ─── @access  Private
const markAllAsRead = asyncHandler(async (req, res) => {
  const { modifiedCount } = await Notification.updateMany(
    { recipient: req.user._id, read: false },
    { $set: { read: true } }
  );

  res.status(200).json({ message: 'All notifications marked as read', modifiedCount });
});

module.exports = { getMyNotifications, markAsRead, markAllAsRead };
