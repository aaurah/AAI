const { User, Role, AuditLog, ApiKey } = require('../models');
const { Op } = require('sequelize');
const moment = require('moment');

exports.getIndex = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      totalRoles,
      totalApiKeys,
      recentLogs,
      recentLogins,
      dailyActivity,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { isActive: true } }),
      Role.count(),
      ApiKey.count({ where: { isActive: true } }),
      AuditLog.findAll({
        limit: 15,
        order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'user', attributes: ['username', 'avatar'] }],
      }),
      AuditLog.findAll({
        where: { action: 'login.success', createdAt: { [Op.gte]: sevenDaysAgo } },
        order: [['createdAt', 'DESC']],
        limit: 10,
        include: [{ model: User, as: 'user', attributes: ['username'] }],
      }),
      AuditLog.findAll({
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        attributes: [
          [require('sequelize').fn('DATE', require('sequelize').col('createdAt')), 'date'],
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count'],
        ],
        group: [require('sequelize').fn('DATE', require('sequelize').col('createdAt'))],
        order: [[require('sequelize').fn('DATE', require('sequelize').col('createdAt')), 'ASC']],
        raw: true,
      }),
    ]);

    const activityLabels = dailyActivity.map((d) => moment(d.date).format('MMM D'));
    const activityData = dailyActivity.map((d) => d.count);

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: { totalUsers, activeUsers, totalRoles, totalApiKeys },
      recentLogs,
      recentLogins,
      activityLabels: JSON.stringify(activityLabels),
      activityData: JSON.stringify(activityData),
      moment,
    });
  } catch (err) {
    console.error('[Dashboard]', err.message);
    res.status(500).render('errors/500', { title: 'Server Error', error: err });
  }
};
