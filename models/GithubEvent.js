const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GithubEvent = sequelize.define('GithubEvent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  deliveryId: { type: DataTypes.STRING(100), unique: true },
  eventType: { type: DataTypes.STRING(50), allowNull: false },
  action: { type: DataTypes.STRING(50) },
  repository: { type: DataTypes.STRING(255) },
  sender: { type: DataTypes.STRING(100) },
  senderAvatar: { type: DataTypes.STRING(255) },
  title: { type: DataTypes.STRING(500) },
  description: { type: DataTypes.TEXT },
  url: { type: DataTypes.STRING(500) },
  payload: { type: DataTypes.TEXT },
}, {
  tableName: 'github_events',
  timestamps: true,
  updatedAt: false,
  indexes: [{ fields: ['eventType'] }, { fields: ['createdAt'] }],
});

module.exports = GithubEvent;
