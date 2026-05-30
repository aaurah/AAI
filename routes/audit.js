const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/auditController');

router.get('/', authenticate, authorize('audit:read'), ctrl.index);

module.exports = router;
