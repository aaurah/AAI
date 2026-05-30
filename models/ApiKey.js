const { DataTypes } = require('sequelize');
const crypto = require('crypto');
const sequelize = require('../config/database');

const ApiKey = sequelize.define('ApiKey', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  keyHash: { type: DataTypes.STRING(255), allowNull: false },
  prefix: { type: DataTypes.STRING(8), allowNull: false },
  scopes: { type: DataTypes.TEXT, defaultValue: '[]' },
  lastUsedAt: { type: DataTypes.DATE },
  lastUsedIp: { type: DataTypes.STRING(45) },
  expiresAt: { type: DataTypes.DATE },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  requestCount: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'api_keys',
  timestamps: true,
});

ApiKey.prototype.getScopes = function () {
  try { return JSON.parse(this.scopes); } catch { return []; }
};

ApiKey.prototype.hasScope = function (scope) {
  const scopes = this.getScopes();
  return scopes.includes('*') || scopes.includes(scope);
};

ApiKey.prototype.isExpired = function () {
  return this.expiresAt && this.expiresAt < new Date();
};

ApiKey.generate = function () {
  const raw = `aai_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = raw.substring(0, 8);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, prefix, hash };
};

ApiKey.findByRawKey = async function (rawKey) {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return ApiKey.findOne({ where: { keyHash: hash, isActive: true } });
};

module.exports = ApiKey;
