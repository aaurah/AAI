const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Permission = sequelize.define('Permission', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(255) },
  resource: { type: DataTypes.STRING(50), allowNull: false },
  action: { type: DataTypes.STRING(50), allowNull: false },
}, {
  tableName: 'permissions',
  timestamps: true,
});

module.exports = Permission;
