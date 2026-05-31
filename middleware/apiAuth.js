const { ApiKey, User, Role } = require('../models');
const { log } = require('./auditLogger');

async function apiAuth(req, res, next) {
  const raw = req.headers['x-api-key'] || req.query.api_key;
  if (!raw) return res.status(401).json({ error: 'API key required.' });

  const key = await ApiKey.findByRawKey(raw);
  if (!key || key.isExpired()) return res.status(401).json({ error: 'Invalid or expired API key.' });

  const user = await User.findByPk(key.userId, {
    include: [{ model: Role, as: 'role' }],
  });
  if (!user || !user.isActive) return res.status(403).json({ error: 'Account inactive.' });

  await key.update({
    lastUsedAt: new Date(),
    lastUsedIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    requestCount: key.requestCount + 1,
  });

  req.user = user;
  req.apiKey = key;
  next();
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) return res.status(401).json({ error: 'API key required.' });
    if (!req.apiKey.hasScope(scope)) {
      return res.status(403).json({ error: `Scope '${scope}' required.` });
    }
    next();
  };
}

module.exports = { apiAuth, requireScope };
