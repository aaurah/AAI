const { Notification } = require('../models');
const { Op } = require('sequelize');

exports.index = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const where = {
      [Op.or]: [{ userId: req.user.id }, { userId: null }],
    };
    const { count, rows: notifications } = await Notification.findAndCountAll({
      where, limit, offset: (page - 1) * limit, order: [['createdAt', 'DESC']],
    });
    res.render('notifications/index', {
      title: 'Notifications',
      notifications, count, page, pages: Math.ceil(count / limit),
    });
  } catch (err) { next(err); }
};

exports.markRead = async (req, res) => {
  const n = await Notification.findByPk(req.params.id);
  if (n && (n.userId === req.user.id || n.userId === null)) {
    await n.update({ isRead: true, readAt: new Date() });
  }
  res.json({ ok: true });
};

exports.markAllRead = async (req, res) => {
  await Notification.update(
    { isRead: true, readAt: new Date() },
    { where: { [Op.or]: [{ userId: req.user.id }, { userId: null }], isRead: false } }
  );
  res.json({ ok: true });
};

exports.destroy = async (req, res) => {
  const n = await Notification.findByPk(req.params.id);
  if (n && (n.userId === req.user.id || n.userId === null || req.user.isSuperAdmin)) {
    await n.destroy();
  }
  res.json({ ok: true });
};

exports.unreadCount = async (req, res) => {
  const { Op } = require('sequelize');
  const count = await Notification.count({
    where: { [Op.or]: [{ userId: req.user.id }, { userId: null }], isRead: false },
  });
  res.json({ count });
};
