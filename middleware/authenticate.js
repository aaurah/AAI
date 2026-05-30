const { User, Role, Permission } = require('../models');

async function authenticate(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }

  try {
    const user = await User.findOne({
      where: { id: req.session.userId, isActive: true },
      include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'Permissions' }] }],
    });

    if (!user) {
      req.session.destroy();
      return res.redirect('/auth/login');
    }

    req.user = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

function authorize(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).redirect('/auth/login');
    if (req.user.isSuperAdmin) return next();

    const userPerms = (req.user.role?.Permissions || []).map((p) => p.name);
    const hasAll = permissions.every((p) => userPerms.includes(p) || userPerms.includes('*'));

    if (!hasAll) {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.status(403).redirect('back');
    }
    next();
  };
}

function guest(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  next();
}

module.exports = { authenticate, authorize, guest };
