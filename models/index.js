const sequelize = require('../config/database');
const User = require('./User');
const Role = require('./Role');
const Permission = require('./Permission');
const AuditLog = require('./AuditLog');
const ApiKey = require('./ApiKey');
const Setting = require('./Setting');
const Notification = require('./Notification');
const GithubEvent = require('./GithubEvent');

// Role <-> Permission (many-to-many)
Role.belongsToMany(Permission, { through: 'RolePermissions', foreignKey: 'roleId' });
Permission.belongsToMany(Role, { through: 'RolePermissions', foreignKey: 'permissionId' });

// User <-> Role
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });

// User <-> AuditLog
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> ApiKey
User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys' });
ApiKey.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> Notification
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = { sequelize, User, Role, Permission, AuditLog, ApiKey, Setting, Notification, GithubEvent };
