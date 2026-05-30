const { Setting } = require('../models');
const { log } = require('../middleware/auditLogger');

const DEFAULT_SETTINGS = [
  { key: 'app.name', value: 'AAI Admin', description: 'Application name', type: 'string', group: 'general' },
  { key: 'app.logo', value: '', description: 'Logo URL', type: 'string', group: 'general' },
  { key: 'app.theme', value: 'dark', description: 'UI theme (dark/light)', type: 'string', group: 'general' },
  { key: 'security.session_timeout', value: '480', description: 'Session timeout in minutes', type: 'number', group: 'security' },
  { key: 'security.max_failed_logins', value: '5', description: 'Max failed logins before lockout', type: 'number', group: 'security' },
  { key: 'security.lockout_duration', value: '15', description: 'Lockout duration in minutes', type: 'number', group: 'security' },
  { key: 'security.password_min_length', value: '8', description: 'Minimum password length', type: 'number', group: 'security' },
  { key: 'users.allow_registration', value: 'false', description: 'Allow self-registration', type: 'boolean', group: 'users' },
  { key: 'users.default_role', value: '', description: 'Default role ID for new users', type: 'string', group: 'users' },
  { key: 'notifications.email_alerts', value: 'false', description: 'Email alerts for critical events', type: 'boolean', group: 'notifications' },
];

exports.index = async (req, res, next) => {
  try {
    const allSettings = await Setting.findAll({ order: [['group', 'ASC'], ['key', 'ASC']] });
    const grouped = {};
    allSettings.forEach((s) => {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    });
    res.render('settings/index', { title: 'Settings', grouped });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const updates = req.body.settings || {};
    for (const [key, value] of Object.entries(updates)) {
      await Setting.set(key, value);
    }
    await log(req, 'settings.updated', { severity: 'medium', details: { keys: Object.keys(updates) } });
    req.flash('success', 'Settings saved.');
    res.redirect('/settings');
  } catch (err) { next(err); }
};

exports.seed = async () => {
  for (const s of DEFAULT_SETTINGS) {
    const exists = await Setting.findOne({ where: { key: s.key } });
    if (!exists) await Setting.create(s);
  }
};
