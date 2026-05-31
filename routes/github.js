const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/githubController');

// OAuth
router.get('/connect', authenticate, ctrl.connect);
router.get('/callback', ctrl.callback);
router.post('/disconnect', authenticate, ctrl.disconnect);

// Webhook — raw body needed for signature verification
router.post('/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBody = req.body.toString('utf8');
  try { req.body = JSON.parse(req.rawBody || '{}'); } catch { req.body = {}; }
  next();
}, ctrl.webhook);

// Events viewer
router.get('/events', authenticate, ctrl.events);

module.exports = router;
