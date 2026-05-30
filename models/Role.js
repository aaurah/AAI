const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Role = sequelize.define('Role', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(255) },
  color: { type: DataTypes.STRING(7), defaultValue: '#6c757d' },
  isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'roles',
  timestamps: true,
});

module.exports = Role;
