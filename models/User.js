const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255) }, // nullable for OAuth-only users
  firstName: { type: DataTypes.STRING(50) },
  lastName: { type: DataTypes.STRING(50) },
  avatar: { type: DataTypes.STRING(255) },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  isSuperAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  lastLogin: { type: DataTypes.DATE },
  lastLoginIp: { type: DataTypes.STRING(45) },
  loginCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  failedLoginCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  lockedUntil: { type: DataTypes.DATE },
  passwordChangedAt: { type: DataTypes.DATE },
  roleId: { type: DataTypes.INTEGER },
  // GitHub OAuth
  githubId: { type: DataTypes.STRING(50) },
  githubUsername: { type: DataTypes.STRING(100) },
  githubAvatar: { type: DataTypes.STRING(500) },
  githubToken: { type: DataTypes.TEXT },
}, {
  tableName: 'users',
  timestamps: true,
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) user.password = await bcrypt.hash(user.password, 12);
    },
    beforeUpdate: async (user) => {
      if (user.changed('password') && user.password) {
        user.password = await bcrypt.hash(user.password, 12);
        user.passwordChangedAt = new Date();
      }
    },
  },
});

User.prototype.verifyPassword = async function (plain) {
  if (!this.password) return false;
  return bcrypt.compare(plain, this.password);
};

User.prototype.isLocked = function () {
  return this.lockedUntil && this.lockedUntil > new Date();
};

User.prototype.fullName = function () {
  if (this.firstName || this.lastName) return `${this.firstName || ''} ${this.lastName || ''}`.trim();
  return this.username;
};

User.prototype.avatarUrl = function () {
  if (this.avatar) return this.avatar;
  if (this.githubAvatar) return this.githubAvatar;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(this.fullName())}&background=3b4a6b&color=fff&size=64`;
};

module.exports = User;
