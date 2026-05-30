const { Role, Permission, User } = require('../models');
const { log } = require('../middleware/auditLogger');

exports.index = async (req, res, next) => {
  try {
    const roles = await Role.findAll({
      include: [
        { model: Permission, as: 'Permissions' },
        { model: User, as: 'users', attributes: ['id'] },
      ],
    });
    res.render('roles/index', { title: 'Roles & Permissions', roles });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const permissions = await Permission.findAll({ order: [['resource', 'ASC'], ['action', 'ASC']] });
    res.render('roles/form', { title: 'Create Role', role: null, permissions });
  } catch (err) { next(err); }
};

exports.store = async (req, res, next) => {
  try {
    const { name, description, color, permissions: permIds } = req.body;
    const role = await Role.create({ name, description, color: color || '#6c757d' });
    if (permIds) {
      const ids = Array.isArray(permIds) ? permIds : [permIds];
      const perms = await Permission.findAll({ where: { id: ids } });
      await role.setPermissions(perms);
    }
    await log(req, 'role.created', { resource: 'role', resourceId: role.id, details: { name } });
    req.flash('success', `Role "${name}" created.`);
    res.redirect('/roles');
  } catch (err) { next(err); }
};

exports.edit = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id, { include: [{ model: Permission, as: 'Permissions' }] });
    if (!role) { req.flash('error', 'Role not found.'); return res.redirect('/roles'); }
    const permissions = await Permission.findAll({ order: [['resource', 'ASC'], ['action', 'ASC']] });
    res.render('roles/form', { title: `Edit ${role.name}`, role, permissions });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) { req.flash('error', 'Role not found.'); return res.redirect('/roles'); }
    if (role.isSystem) { req.flash('error', 'System roles cannot be modified.'); return res.redirect('/roles'); }
    const { name, description, color, permissions: permIds } = req.body;
    await role.update({ name, description, color: color || '#6c757d' });
    const ids = permIds ? (Array.isArray(permIds) ? permIds : [permIds]) : [];
    const perms = await Permission.findAll({ where: { id: ids } });
    await role.setPermissions(perms);
    await log(req, 'role.updated', { resource: 'role', resourceId: role.id, details: { name } });
    req.flash('success', 'Role updated.');
    res.redirect('/roles');
  } catch (err) { next(err); }
};

exports.destroy = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) { req.flash('error', 'Role not found.'); return res.redirect('/roles'); }
    if (role.isSystem) { req.flash('error', 'System roles cannot be deleted.'); return res.redirect('/roles'); }
    const name = role.name;
    await role.destroy();
    await log(req, 'role.deleted', { resource: 'role', resourceId: req.params.id, details: { name }, severity: 'high' });
    req.flash('success', `Role "${name}" deleted.`);
    res.redirect('/roles');
  } catch (err) { next(err); }
};
