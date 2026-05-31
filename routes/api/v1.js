const express = require('express');
const router = express.Router();
const { apiAuth, requireScope } = require('../../middleware/apiAuth');
const { apiLimiter } = require('../../middleware/rateLimiter');
const { User, Role, AuditLog, ApiKey, GithubEvent } = require('../../models');
const { Op } = require('sequelize');

router.use(apiLimiter);
router.use(apiAuth);

// GET /api/v1/me
router.get('/me', (req, res) => {
  const { id, username, email, firstName, lastName, isSuperAdmin, lastLogin } = req.user;
  res.json({ id, username, email, firstName, lastName, isSuperAdmin, lastLogin, scopes: req.apiKey.getScopes() });
});

// GET /api/v1/users
router.get('/users', requireScope('read'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const users = await User.findAndCountAll({
    attributes: ['id', 'username', 'email', 'firstName', 'lastName', 'isActive', 'lastLogin', 'createdAt'],
    include: [{ model: Role, as: 'role', attributes: ['name', 'color'] }],
    limit, offset, order: [['createdAt', 'DESC']],
  });
  res.json({ count: users.count, data: users.rows });
});

// GET /api/v1/users/:id
router.get('/users/:id', requireScope('read'), async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: ['id', 'username', 'email', 'firstName', 'lastName', 'isActive', 'lastLogin', 'loginCount', 'createdAt'],
    include: [{ model: Role, as: 'role', attributes: ['name'] }],
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// GET /api/v1/audit
router.get('/audit', requireScope('read'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const where = {};
  if (req.query.action) where.action = { [Op.like]: `%${req.query.action}%` };
  if (req.query.severity) where.severity = req.query.severity;
  const logs = await AuditLog.findAndCountAll({
    where, limit, offset, order: [['createdAt', 'DESC']],
    attributes: ['id', 'username', 'action', 'resource', 'resourceId', 'status', 'severity', 'ipAddress', 'createdAt'],
  });
  res.json({ count: logs.count, data: logs.rows });
});

// GET /api/v1/stats
router.get('/stats', requireScope('read'), async (req, res) => {
  const [users, activeUsers, auditEvents, apiKeys] = await Promise.all([
    User.count(),
    User.count({ where: { isActive: true } }),
    AuditLog.count(),
    ApiKey.count({ where: { isActive: true } }),
  ]);
  res.json({ users, activeUsers, auditEvents, apiKeys, timestamp: new Date() });
});

// GET /api/v1/github/events
router.get('/github/events', requireScope('read'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const events = await GithubEvent.findAll({
    order: [['createdAt', 'DESC']], limit,
    attributes: ['id', 'eventType', 'action', 'repository', 'sender', 'title', 'url', 'createdAt'],
  });
  res.json({ count: events.length, data: events });
});

module.exports = router;
