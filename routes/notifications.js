const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/notificationController');

router.get('/', authenticate, ctrl.index);
router.get('/count', authenticate, ctrl.unreadCount);
router.post('/:id/read', authenticate, ctrl.markRead);
router.post('/read-all', authenticate, ctrl.markAllRead);
router.post('/:id/delete', authenticate, ctrl.destroy);

module.exports = router;
