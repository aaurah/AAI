const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER }, // null = broadcast to all
  title: { type: DataTypes.STRING(150), allowNull: false },
  message: { type: DataTypes.TEXT },
  type: { type: DataTypes.ENUM('info', 'success', 'warning', 'danger'), defaultValue: 'info' },
  icon: { type: DataTypes.STRING(50), defaultValue: 'fa-bell' },
  link: { type: DataTypes.STRING(255) },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
  readAt: { type: DataTypes.DATE },
}, {
  tableName: 'notifications',
  timestamps: true,
  updatedAt: false,
  indexes: [{ fields: ['userId'] }, { fields: ['isRead'] }],
});

module.exports = Notification;
