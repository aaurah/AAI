const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER },
  username: { type: DataTypes.STRING(50) },
  action: { type: DataTypes.STRING(100), allowNull: false },
  resource: { type: DataTypes.STRING(50) },
  resourceId: { type: DataTypes.STRING(50) },
  details: { type: DataTypes.TEXT },
  ipAddress: { type: DataTypes.STRING(45) },
  userAgent: { type: DataTypes.STRING(500) },
  status: { type: DataTypes.ENUM('success', 'failure', 'warning'), defaultValue: 'success' },
  severity: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), defaultValue: 'low' },
}, {
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['userId'] },
    { fields: ['action'] },
    { fields: ['resource'] },
    { fields: ['createdAt'] },
  ],
});

module.exports = AuditLog;
