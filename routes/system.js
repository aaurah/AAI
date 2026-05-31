const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/systemController');

router.get('/', authenticate, authorize('settings:read'), ctrl.index);
router.get('/stats', authenticate, ctrl.stats);

module.exports = router;
