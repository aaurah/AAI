const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/dashboardController');

router.get('/', authenticate, ctrl.getIndex);

module.exports = router;
