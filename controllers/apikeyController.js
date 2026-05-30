const { ApiKey, User } = require('../models');
const { log } = require('../middleware/auditLogger');

exports.index = async (req, res, next) => {
  try {
    const where = req.user.isSuperAdmin ? {} : { userId: req.user.id };
    const keys = await ApiKey.findAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['username'] }],
      order: [['createdAt', 'DESC']],
    });
    res.render('apikeys/index', { title: 'API Keys', keys });
  } catch (err) { next(err); }
};

exports.store = async (req, res, next) => {
  try {
    const { name, scopes, expiresIn } = req.body;
    const { raw, prefix, hash } = ApiKey.generate();
    const scopeArr = scopes ? (Array.isArray(scopes) ? scopes : [scopes]) : ['read'];
    let expiresAt = null;
    if (expiresIn && expiresIn !== 'never') {
      const days = parseInt(expiresIn);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    await ApiKey.create({
      userId: req.user.id,
      name,
      keyHash: hash,
      prefix,
      scopes: JSON.stringify(scopeArr),
      expiresAt,
    });
    await log(req, 'apikey.created', { resource: 'apikey', details: { name }, severity: 'medium' });
    req.flash('success', `Key created. Save it now — it won't be shown again: <code>${raw}</code>`);
    res.redirect('/apikeys');
  } catch (err) { next(err); }
};

exports.revoke = async (req, res, next) => {
  try {
    const key = await ApiKey.findByPk(req.params.id);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/apikeys'); }
    if (!req.user.isSuperAdmin && key.userId !== req.user.id) {
      req.flash('error', 'Forbidden.'); return res.redirect('/apikeys');
    }
    await key.update({ isActive: false });
    await log(req, 'apikey.revoked', { resource: 'apikey', resourceId: key.id, severity: 'medium' });
    req.flash('success', 'API key revoked.');
    res.redirect('/apikeys');
  } catch (err) { next(err); }
};

exports.destroy = async (req, res, next) => {
  try {
    const key = await ApiKey.findByPk(req.params.id);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/apikeys'); }
    if (!req.user.isSuperAdmin && key.userId !== req.user.id) {
      req.flash('error', 'Forbidden.'); return res.redirect('/apikeys');
    }
    await key.destroy();
    await log(req, 'apikey.deleted', { resource: 'apikey', resourceId: req.params.id, severity: 'high' });
    req.flash('success', 'API key deleted.');
    res.redirect('/apikeys');
  } catch (err) { next(err); }
};
