const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/settingsController');

router.get('/', authenticate, authorize('settings:read'), ctrl.index);
router.post('/', authenticate, authorize('settings:update'), ctrl.update);

module.exports = router;
