const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Setting = sequelize.define('Setting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  value: { type: DataTypes.TEXT },
  description: { type: DataTypes.STRING(255) },
  type: { type: DataTypes.ENUM('string', 'number', 'boolean', 'json'), defaultValue: 'string' },
  isPublic: { type: DataTypes.BOOLEAN, defaultValue: false },
  group: { type: DataTypes.STRING(50), defaultValue: 'general' },
}, {
  tableName: 'settings',
  timestamps: true,
});

Setting.get = async function (key, defaultValue = null) {
  const setting = await Setting.findOne({ where: { key } });
  if (!setting) return defaultValue;
  try {
    if (setting.type === 'boolean') return setting.value === 'true';
    if (setting.type === 'number') return parseFloat(setting.value);
    if (setting.type === 'json') return JSON.parse(setting.value);
  } catch {}
  return setting.value;
};

Setting.set = async function (key, value, opts = {}) {
  const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const [s] = await Setting.findOrCreate({ where: { key }, defaults: { value: strValue, ...opts } });
  if (s.value !== strValue) { s.value = strValue; await s.save(); }
  return s;
};

module.exports = Setting;
