const { User, Role, AuditLog, ApiKey, GithubEvent } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const moment = require('moment');

exports.getIndex = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const [
      totalUsers, activeUsers, totalRoles, totalApiKeys,
      newUsersToday, failedLoginsToday,
      recentLogs, recentLogins, dailyActivity,
      severityBreakdown, roleDistribution, recentGithubEvents,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { isActive: true } }),
      Role.count(),
      ApiKey.count({ where: { isActive: true } }),
      User.count({ where: { createdAt: { [Op.gte]: oneDayAgo } } }),
      AuditLog.count({ where: { action: 'login.failed', createdAt: { [Op.gte]: oneDayAgo } } }),
      AuditLog.findAll({
        limit: 12,
        order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'user', attributes: ['username', 'githubAvatar'], required: false }],
      }),
      AuditLog.findAll({
        where: { action: { [Op.like]: 'login%' }, status: 'success', createdAt: { [Op.gte]: sevenDaysAgo } },
        order: [['createdAt', 'DESC']],
        limit: 8,
      }),
      AuditLog.findAll({
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('COUNT', col('id')), 'count']],
        group: [fn('DATE', col('createdAt'))],
        order: [[fn('DATE', col('createdAt')), 'ASC']],
        raw: true,
      }),
      AuditLog.findAll({
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        attributes: ['severity', [fn('COUNT', col('id')), 'count']],
        group: ['severity'],
        raw: true,
      }),
      Role.findAll({
        attributes: ['name', 'color', [fn('COUNT', col('users.id')), 'userCount']],
        include: [{ model: User, as: 'users', attributes: [] }],
        group: ['Role.id'],
        raw: true,
      }),
      GithubEvent.findAll({ order: [['createdAt', 'DESC']], limit: 5 }),
    ]);

    const activityLabels = dailyActivity.map((d) => moment(d.date).format('MMM D'));
    const activityData = dailyActivity.map((d) => parseInt(d.count));

    const sevMap = {};
    severityBreakdown.forEach(s => { sevMap[s.severity] = parseInt(s.count); });

    const totalAuditEvents30d = activityData.reduce((a, b) => a + b, 0);

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: { totalUsers, activeUsers, totalRoles, totalApiKeys, newUsersToday, failedLoginsToday, totalAuditEvents30d },
      recentLogs, recentLogins, recentGithubEvents,
      activityLabels: JSON.stringify(activityLabels),
      activityData: JSON.stringify(activityData),
      severityData: JSON.stringify([
        sevMap.low || 0, sevMap.medium || 0, sevMap.high || 0, sevMap.critical || 0,
      ]),
      roleLabels: JSON.stringify(roleDistribution.map(r => r.name)),
      roleData: JSON.stringify(roleDistribution.map(r => parseInt(r.userCount))),
      roleColors: JSON.stringify(roleDistribution.map(r => r.color)),
      moment,
    });
  } catch (err) {
    console.error('[Dashboard]', err.message);
    res.status(500).render('errors/500', { title: 'Server Error', error: err });
  }
};
