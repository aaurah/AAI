const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/roleController');

router.get('/', authenticate, authorize('roles:read'), ctrl.index);
router.get('/create', authenticate, authorize('roles:create'), ctrl.create);
router.post('/create', authenticate, authorize('roles:create'), ctrl.store);
router.get('/:id/edit', authenticate, authorize('roles:update'), ctrl.edit);
router.post('/:id/edit', authenticate, authorize('roles:update'), ctrl.update);
router.post('/:id/delete', authenticate, authorize('roles:delete'), ctrl.destroy);

module.exports = router;
