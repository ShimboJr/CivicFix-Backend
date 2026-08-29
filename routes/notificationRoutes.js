const express = require('express');
const router  = express.Router();

const { protect } = require('../middleware/authMiddleware');
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
} = require('../controllers/notificationController');

// All notification routes require authentication (any role)
router.use(protect);

// GET  /api/notifications           — paginated list + unreadCount
router.get('/', getMyNotifications);

// PUT  /api/notifications/read-all  — bulk mark all as read
// NOTE: this route MUST be declared before /:id/read so Express doesn't
//       match "read-all" as a notification id.
router.put('/read-all', markAllAsRead);

// PUT  /api/notifications/:id/read  — mark one notification as read
router.put('/:id/read', markAsRead);

module.exports = router;
