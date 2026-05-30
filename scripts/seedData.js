const { User, Role, Permission, Setting } = require('../models');
const { seed: seedSettings } = require('../controllers/settingsController');

const PERMISSIONS = [
  { name: 'users:read',        resource: 'users',    action: 'read',    description: 'View users' },
  { name: 'users:create',      resource: 'users',    action: 'create',  description: 'Create users' },
  { name: 'users:update',      resource: 'users',    action: 'update',  description: 'Update users' },
  { name: 'users:delete',      resource: 'users',    action: 'delete',  description: 'Delete users' },
  { name: 'roles:read',        resource: 'roles',    action: 'read',    description: 'View roles' },
  { name: 'roles:create',      resource: 'roles',    action: 'create',  description: 'Create roles' },
  { name: 'roles:update',      resource: 'roles',    action: 'update',  description: 'Update roles' },
  { name: 'roles:delete',      resource: 'roles',    action: 'delete',  description: 'Delete roles' },
  { name: 'audit:read',        resource: 'audit',    action: 'read',    description: 'View audit logs' },
  { name: 'settings:read',     resource: 'settings', action: 'read',    description: 'View settings' },
  { name: 'settings:update',   resource: 'settings', action: 'update',  description: 'Update settings' },
  { name: 'apikeys:manage',    resource: 'apikeys',  action: 'manage',  description: 'Manage API keys' },
  { name: '*',                 resource: '*',        action: '*',       description: 'Full access (super admin)' },
];

const ROLES = [
  {
    name: 'Super Admin',
    description: 'Full system access',
    color: '#dc3545',
    isSystem: true,
    permissions: ['*'],
  },
  {
    name: 'Admin',
    description: 'Manage users and settings',
    color: '#fd7e14',
    isSystem: true,
    permissions: ['users:read', 'users:create', 'users:update', 'users:delete', 'roles:read', 'audit:read', 'settings:read', 'settings:update', 'apikeys:manage'],
  },
  {
    name: 'Manager',
    description: 'View and manage users',
    color: '#0d6efd',
    isSystem: true,
    permissions: ['users:read', 'users:create', 'users:update', 'audit:read'],
  },
  {
    name: 'Viewer',
    description: 'Read-only access',
    color: '#198754',
    isSystem: true,
    permissions: ['users:read', 'audit:read'],
  },
];

async function seed() {
  // Permissions
  for (const p of PERMISSIONS) {
    await Permission.findOrCreate({ where: { name: p.name }, defaults: p });
  }

  // Roles + associations
  for (const r of ROLES) {
    const [role] = await Role.findOrCreate({
      where: { name: r.name },
      defaults: { description: r.description, color: r.color, isSystem: r.isSystem },
    });
    const perms = await Permission.findAll({ where: { name: r.permissions } });
    await role.setPermissions(perms);
  }

  // Default super admin
  const superRole = await Role.findOne({ where: { name: 'Super Admin' } });
  const existingAdmin = await User.findOne({ where: { username: 'admin' } });
  if (!existingAdmin) {
    await User.create({
      username: 'admin',
      email: 'admin@aai.local',
      password: 'Admin@12345',
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
      isSuperAdmin: true,
      roleId: superRole?.id,
    });
    console.log('  Default admin created — username: admin / password: Admin@12345');
  }

  // Settings
  await seedSettings();
}

module.exports = { seed };
