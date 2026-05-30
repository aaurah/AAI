const { User, Role } = require('../models');
const { log } = require('../middleware/auditLogger');
const { validationResult } = require('express-validator');

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Sign In', layout: false });
};

exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/auth/login');
  }

  const { username, password } = req.body;
  try {
    const user = await User.findOne({
      where: { username },
      include: [{ model: Role, as: 'role' }],
    });

    if (!user) {
      await log(req, 'login.failed', { username, status: 'failure', severity: 'medium', details: { reason: 'user not found' } });
      req.flash('error', 'Invalid credentials.');
      return res.redirect('/auth/login');
    }

    if (user.isLocked()) {
      req.flash('error', 'Account is temporarily locked. Try again later.');
      return res.redirect('/auth/login');
    }

    if (!user.isActive) {
      req.flash('error', 'Your account has been deactivated.');
      return res.redirect('/auth/login');
    }

    const valid = await user.verifyPassword(password);
    if (!valid) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();
      await log(req, 'login.failed', { userId: user.id, username: user.username, status: 'failure', severity: 'medium' });
      req.flash('error', 'Invalid credentials.');
      return res.redirect('/auth/login');
    }

    user.lastLogin = new Date();
    user.lastLoginIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    user.loginCount += 1;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();

    req.session.userId = user.id;
    req.session.loginAt = new Date();
    await log(req, 'login.success', { userId: user.id, username: user.username, severity: 'low' });

    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/login');
  }
};

exports.logout = async (req, res) => {
  if (req.user) {
    await log(req, 'logout', { userId: req.user.id, username: req.user.username });
  }
  req.session.destroy(() => res.redirect('/auth/login'));
};

exports.getProfile = (req, res) => {
  res.render('auth/profile', { title: 'My Profile' });
};

exports.postProfile = async (req, res) => {
  const { firstName, lastName, email } = req.body;
  try {
    await req.user.update({ firstName, lastName, email });
    await log(req, 'profile.updated', { resource: 'user', resourceId: req.user.id });
    req.flash('success', 'Profile updated.');
    res.redirect('/auth/profile');
  } catch (err) {
    req.flash('error', 'Update failed: ' + err.message);
    res.redirect('/auth/profile');
  }
};

exports.postChangePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/auth/profile');
  }
  if (newPassword.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect('/auth/profile');
  }
  const valid = await req.user.verifyPassword(currentPassword);
  if (!valid) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/auth/profile');
  }
  await req.user.update({ password: newPassword });
  await log(req, 'password.changed', { resource: 'user', resourceId: req.user.id, severity: 'medium' });
  req.flash('success', 'Password changed successfully.');
  res.redirect('/auth/profile');
};
