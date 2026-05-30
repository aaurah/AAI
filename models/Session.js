const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  sid: { type: DataTypes.STRING(36), primaryKey: true },
  expires: { type: DataTypes.DATE },
  data: { type: DataTypes.TEXT },
}, {
  tableName: 'sessions',
  timestamps: true,
});

module.exports = Session;
