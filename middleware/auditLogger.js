const { AuditLog } = require('../models');

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

async function log(req, action, opts = {}) {
  try {
    await AuditLog.create({
      userId: req.user?.id || opts.userId || null,
      username: req.user?.username || opts.username || 'system',
      action,
      resource: opts.resource || null,
      resourceId: opts.resourceId ? String(opts.resourceId) : null,
      details: opts.details ? JSON.stringify(opts.details) : null,
      ipAddress: getIp(req),
      userAgent: req.headers['user-agent'] || null,
      status: opts.status || 'success',
      severity: opts.severity || 'low',
    });
  } catch (err) {
    console.error('[AuditLog] Failed to write log:', err.message);
  }
}

function auditMiddleware(action, opts = {}) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 400) log(req, action, opts);
    });
    next();
  };
}

module.exports = { log, auditMiddleware };
