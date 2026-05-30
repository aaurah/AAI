const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/apikeyController');

router.get('/', authenticate, ctrl.index);
router.post('/create', authenticate, ctrl.store);
router.post('/:id/revoke', authenticate, ctrl.revoke);
router.post('/:id/delete', authenticate, ctrl.destroy);

module.exports = router;
