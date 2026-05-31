const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/auditController');

router.get('/', authenticate, authorize('audit:read'), ctrl.index);
router.get('/export.csv', authenticate, authorize('audit:read'), ctrl.exportCSV);

module.exports = router;
