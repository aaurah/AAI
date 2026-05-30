const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { loginLimiter } = require('../middleware/rateLimiter');
const { authenticate, guest } = require('../middleware/authenticate');
const ctrl = require('../controllers/authController');

router.get('/login', guest, ctrl.getLogin);
router.post('/login', guest, loginLimiter, [
  body('username').trim().notEmpty().withMessage('Username required.'),
  body('password').notEmpty().withMessage('Password required.'),
], ctrl.postLogin);
router.get('/logout', authenticate, ctrl.logout);
router.get('/profile', authenticate, ctrl.getProfile);
router.post('/profile', authenticate, ctrl.postProfile);
router.post('/profile/password', authenticate, ctrl.postChangePassword);

module.exports = router;
