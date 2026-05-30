const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/userController');

const userValidation = [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 chars.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').optional({ checkFalsy: true }).isLength({ min: 8 }).withMessage('Password min 8 chars.'),
];

router.get('/', authenticate, authorize('users:read'), ctrl.index);
router.get('/create', authenticate, authorize('users:create'), ctrl.create);
router.post('/create', authenticate, authorize('users:create'), userValidation, ctrl.store);
router.get('/:id/edit', authenticate, authorize('users:update'), ctrl.edit);
router.post('/:id/edit', authenticate, authorize('users:update'), ctrl.update);
router.post('/:id/delete', authenticate, authorize('users:delete'), ctrl.destroy);
router.post('/:id/toggle', authenticate, authorize('users:update'), ctrl.toggleStatus);

module.exports = router;
