const os = require('os');
const { sequelize, User, AuditLog, ApiKey, GithubEvent, Notification } = require('../models');
const moment = require('moment');

function bytesToMB(b) { return (b / 1024 / 1024).toFixed(1); }
function uptimeStr(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

async function getStats() {
  const mem = process.memoryUsage();
  const osMem = { total: os.totalmem(), free: os.freemem() };
  const [dbPath] = await sequelize.query('PRAGMA database_list', { type: 'SELECT' }).catch(() => [[]]);

  const [userCount, activeUsers, auditCount, apiKeyCount, ghEventCount, notifCount] = await Promise.all([
    User.count(),
    User.count({ where: { isActive: true } }),
    AuditLog.count(),
    ApiKey.count({ where: { isActive: true } }),
    GithubEvent.count(),
    Notification.count({ where: { isRead: false } }),
  ]);

  return {
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: uptimeStr(process.uptime()),
      uptimeSecs: Math.floor(process.uptime()),
    },
    memory: {
      rss: bytesToMB(mem.rss),
      heapUsed: bytesToMB(mem.heapUsed),
      heapTotal: bytesToMB(mem.heapTotal),
      external: bytesToMB(mem.external),
      osFreeGB: (osMem.free / 1024 / 1024 / 1024).toFixed(2),
      osTotalGB: (osMem.total / 1024 / 1024 / 1024).toFixed(2),
      heapPct: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    database: {
      dialect: sequelize.getDialect(),
      userCount, activeUsers, auditCount, apiKeyCount, ghEventCount, notifCount,
    },
    os: {
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      cpus: os.cpus().length,
      loadAvg: os.loadavg().map(v => v.toFixed(2)),
    },
    env: process.env.NODE_ENV || 'development',
  };
}

exports.index = async (req, res, next) => {
  try {
    const stats = await getStats();
    res.render('system/index', { title: 'System Health', stats, moment });
  } catch (err) { next(err); }
};

exports.stats = async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
