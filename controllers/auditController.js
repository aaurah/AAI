const { AuditLog, User } = require('../models');
const { Op } = require('sequelize');
const moment = require('moment');

function toCSV(rows) {
  const headers = ['id', 'username', 'action', 'resource', 'resourceId', 'status', 'severity', 'ipAddress', 'createdAt'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

exports.index = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const { action, user: userQ, status, severity, from, to } = req.query;

    const where = buildWhere({ action, userQ, status, severity, from, to });

    const { count, rows: logs } = await AuditLog.findAndCountAll({
      where, limit, offset,
      order: [['createdAt', 'DESC']],
      include: [{ model: User, as: 'user', attributes: ['username', 'githubAvatar'], required: false }],
    });

    res.render('audit/index', {
      title: 'Audit Log',
      logs, count,
      page, pages: Math.ceil(count / limit),
      filters: { action, user: userQ, status, severity, from, to },
      moment,
    });
  } catch (err) { next(err); }
};

exports.exportCSV = async (req, res, next) => {
  try {
    const { action, user: userQ, status, severity, from, to } = req.query;
    const where = buildWhere({ action, userQ, status, severity, from, to });
    const logs = await AuditLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 10000 });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(toCSV(logs));
  } catch (err) { next(err); }
};

function buildWhere({ action, userQ, status, severity, from, to }) {
  const where = {};
  if (action) where.action = { [Op.like]: `%${action}%` };
  if (status) where.status = status;
  if (severity) where.severity = severity;
  if (userQ) where.username = { [Op.like]: `%${userQ}%` };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    if (to) where.createdAt[Op.lte] = new Date(to + 'T23:59:59');
  }
  return where;
}
