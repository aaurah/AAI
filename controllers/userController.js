const { User, Role } = require('../models');
const { log } = require('../middleware/auditLogger');
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');

exports.index = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.q || '';
    const roleFilter = req.query.role || '';
    const statusFilter = req.query.status || '';

    const where = {};
    if (search) where[Op.or] = [
      { username: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
      { firstName: { [Op.like]: `%${search}%` } },
      { lastName: { [Op.like]: `%${search}%` } },
    ];
    if (statusFilter === 'active') where.isActive = true;
    if (statusFilter === 'inactive') where.isActive = false;

    const include = [{ model: Role, as: 'role', attributes: ['id', 'name', 'color'] }];
    if (roleFilter) include[0].where = { id: roleFilter };

    const { count, rows: users } = await User.findAndCountAll({ where, include, limit, offset, order: [['createdAt', 'DESC']] });
    const roles = await Role.findAll({ attributes: ['id', 'name'] });

    res.render('users/index', {
      title: 'Users',
      users, roles, count,
      page, pages: Math.ceil(count / limit),
      search, roleFilter, statusFilter,
    });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const roles = await Role.findAll();
    res.render('users/form', { title: 'Create User', user: null, roles });
  } catch (err) { next(err); }
};

exports.store = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/users/create');
  }
  try {
    const { username, email, password, firstName, lastName, roleId, isActive, isSuperAdmin } = req.body;
    const user = await User.create({
      username, email, password,
      firstName: firstName || null,
      lastName: lastName || null,
      roleId: roleId || null,
      isActive: isActive === 'on',
      isSuperAdmin: (isSuperAdmin === 'on') && req.user.isSuperAdmin,
    });
    await log(req, 'user.created', { resource: 'user', resourceId: user.id, details: { username } });
    req.flash('success', `User "${username}" created.`);
    res.redirect('/users');
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      req.flash('error', 'Username or email already exists.');
      return res.redirect('/users/create');
    }
    next(err);
  }
};

exports.edit = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, { include: [{ model: Role, as: 'role' }] });
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    const roles = await Role.findAll();
    res.render('users/form', { title: `Edit ${user.username}`, user, roles });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    const { firstName, lastName, email, roleId, isActive, isSuperAdmin, newPassword } = req.body;
    const updates = {
      firstName: firstName || null,
      lastName: lastName || null,
      email,
      roleId: roleId || null,
      isActive: isActive === 'on',
    };
    if (req.user.isSuperAdmin) updates.isSuperAdmin = isSuperAdmin === 'on';
    if (newPassword) updates.password = newPassword;
    await user.update(updates);
    await log(req, 'user.updated', { resource: 'user', resourceId: user.id, details: { username: user.username } });
    req.flash('success', 'User updated.');
    res.redirect('/users');
  } catch (err) { next(err); }
};

exports.destroy = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    if (user.id === req.user.id) { req.flash('error', 'Cannot delete yourself.'); return res.redirect('/users'); }
    const username = user.username;
    await user.destroy();
    await log(req, 'user.deleted', { resource: 'user', resourceId: req.params.id, details: { username }, severity: 'high' });
    req.flash('success', `User "${username}" deleted.`);
    res.redirect('/users');
  } catch (err) { next(err); }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user || user.id === req.user.id) return res.redirect('/users');
    await user.update({ isActive: !user.isActive });
    await log(req, user.isActive ? 'user.activated' : 'user.deactivated', { resource: 'user', resourceId: user.id, severity: 'medium' });
    req.flash('success', `User ${user.isActive ? 'activated' : 'deactivated'}.`);
    res.redirect('/users');
  } catch (err) { next(err); }
};
