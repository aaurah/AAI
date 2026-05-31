const axios = require('axios');
const crypto = require('crypto');
const { User, Role, GithubEvent, Notification, AuditLog } = require('../models');
const { log } = require('../middleware/auditLogger');
const moment = require('moment');

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── OAuth ────────────────────────────────────────────────────────────────────

exports.connect = (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    req.flash('error', 'GitHub OAuth is not configured (set GITHUB_CLIENT_ID).');
    return res.redirect('back');
  }
  req.session.oauthState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/github/callback`,
    scope: 'user:email read:user',
    state: req.session.oauthState,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
};

exports.callback = async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    req.flash('error', 'GitHub OAuth denied: ' + error);
    return res.redirect('/auth/profile');
  }
  if (state !== req.session.oauthState) {
    req.flash('error', 'OAuth state mismatch. Please try again.');
    return res.redirect('/auth/profile');
  }

  try {
    // Exchange code for token
    const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${APP_URL}/github/callback`,
    }, { headers: { Accept: 'application/json' } });

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token returned from GitHub.');

    // Fetch GitHub user profile
    const ghUser = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AAI-Admin' },
    });

    const ghData = ghUser.data;

    // If logged in, link GitHub to current account
    if (req.session.userId) {
      const user = await User.findByPk(req.session.userId);
      await user.update({
        githubId: String(ghData.id),
        githubUsername: ghData.login,
        githubAvatar: ghData.avatar_url,
        githubToken: accessToken,
      });
      await log(req, 'github.linked', { resource: 'user', resourceId: user.id, details: { github: ghData.login } });
      req.flash('success', `GitHub account @${ghData.login} linked.`);
      return res.redirect('/auth/profile');
    }

    // Otherwise, login/register via GitHub
    let user = await User.findOne({ where: { githubId: String(ghData.id) } });
    if (!user) {
      // Check if email matches existing user
      const emails = ghData.email ? [ghData.email] : [];
      if (emails.length) {
        user = await User.findOne({ where: { email: emails[0] } });
      }
      if (user) {
        // Link to existing account
        await user.update({
          githubId: String(ghData.id),
          githubUsername: ghData.login,
          githubAvatar: ghData.avatar_url,
          githubToken: accessToken,
        });
      } else {
        // Create new account
        const baseUsername = ghData.login.replace(/[^a-zA-Z0-9_]/g, '_');
        let username = baseUsername;
        let suffix = 1;
        while (await User.findOne({ where: { username } })) {
          username = `${baseUsername}_${suffix++}`;
        }
        user = await User.create({
          username,
          email: ghData.email || `${ghData.login}@github.noreply`,
          password: null,
          firstName: (ghData.name || '').split(' ')[0] || '',
          lastName: (ghData.name || '').split(' ').slice(1).join(' ') || '',
          githubId: String(ghData.id),
          githubUsername: ghData.login,
          githubAvatar: ghData.avatar_url,
          githubToken: accessToken,
          isActive: true,
        });
      }
    } else {
      await user.update({ githubToken: accessToken, githubAvatar: ghData.avatar_url });
    }

    if (!user.isActive) {
      req.flash('error', 'Your account is deactivated.');
      return res.redirect('/auth/login');
    }

    await user.update({ lastLogin: new Date(), loginCount: user.loginCount + 1 });
    req.session.userId = user.id;
    await log(req, 'login.github', { userId: user.id, username: user.username, details: { github: ghData.login } });
    res.redirect('/dashboard');
  } catch (err) {
    console.error('[GitHub OAuth]', err.message);
    req.flash('error', 'GitHub login failed. Please try again.');
    res.redirect('/auth/login');
  }
};

exports.disconnect = async (req, res) => {
  if (!req.user.password) {
    req.flash('error', 'Cannot disconnect GitHub — you have no password set. Set a password first.');
    return res.redirect('/auth/profile');
  }
  await req.user.update({ githubId: null, githubUsername: null, githubAvatar: null, githubToken: null });
  await log(req, 'github.unlinked', { resource: 'user', resourceId: req.user.id });
  req.flash('success', 'GitHub account disconnected.');
  res.redirect('/auth/profile');
};

// ── Webhook ──────────────────────────────────────────────────────────────────

function verifyWebhookSignature(req) {
  if (!GITHUB_WEBHOOK_SECRET) return true; // skip verification if not configured
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

exports.webhook = async (req, res) => {
  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const eventType = req.headers['x-github-event'] || 'unknown';
  const deliveryId = req.headers['x-github-delivery'];
  const payload = req.body;

  try {
    // Build human-readable title
    let title = '';
    let description = '';
    let url = '';
    const action = payload.action || '';
    const repo = payload.repository?.full_name || '';
    const sender = payload.sender?.login || '';
    const senderAvatar = payload.sender?.avatar_url || '';

    switch (eventType) {
      case 'push':
        title = `Push to ${repo}/${payload.ref?.replace('refs/heads/', '')}`;
        description = (payload.commits || []).map(c => c.message).slice(0, 3).join('; ');
        url = payload.compare || '';
        break;
      case 'pull_request':
        title = `PR #${payload.pull_request?.number} ${action}: ${payload.pull_request?.title}`;
        description = payload.pull_request?.body?.slice(0, 200) || '';
        url = payload.pull_request?.html_url || '';
        break;
      case 'issues':
        title = `Issue #${payload.issue?.number} ${action}: ${payload.issue?.title}`;
        description = payload.issue?.body?.slice(0, 200) || '';
        url = payload.issue?.html_url || '';
        break;
      case 'issue_comment':
        title = `Comment on Issue #${payload.issue?.number}: ${payload.issue?.title}`;
        description = payload.comment?.body?.slice(0, 200) || '';
        url = payload.comment?.html_url || '';
        break;
      case 'create':
        title = `Created ${payload.ref_type} ${payload.ref} in ${repo}`;
        url = `https://github.com/${repo}`;
        break;
      case 'delete':
        title = `Deleted ${payload.ref_type} ${payload.ref} in ${repo}`;
        url = `https://github.com/${repo}`;
        break;
      case 'release':
        title = `Release ${payload.release?.tag_name} ${action} in ${repo}`;
        description = payload.release?.body?.slice(0, 200) || '';
        url = payload.release?.html_url || '';
        break;
      case 'workflow_run':
        title = `Workflow "${payload.workflow_run?.name}" ${payload.workflow_run?.conclusion || action} in ${repo}`;
        url = payload.workflow_run?.html_url || '';
        break;
      default:
        title = `${eventType} event in ${repo}`;
    }

    await GithubEvent.findOrCreate({
      where: { deliveryId: deliveryId || `${Date.now()}` },
      defaults: {
        eventType, action, repository: repo, sender, senderAvatar,
        title, description, url,
        payload: JSON.stringify(payload),
      },
    });

    // Broadcast to SSE clients
    if (req.app.locals.broadcast) {
      req.app.locals.broadcast('github', { eventType, title, sender, senderAvatar, repo, url, time: new Date() });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[GitHub Webhook]', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
};

// ── GitHub Events view ───────────────────────────────────────────────────────

exports.events = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const offset = (page - 1) * limit;
    const typeFilter = req.query.type || '';

    const where = typeFilter ? { eventType: typeFilter } : {};
    const { count, rows: events } = await GithubEvent.findAndCountAll({
      where, limit, offset, order: [['createdAt', 'DESC']],
    });

    const eventTypes = await GithubEvent.findAll({
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('eventType')), 'eventType']],
      raw: true,
    });

    res.render('github/events', {
      title: 'GitHub Events',
      events, count, page, pages: Math.ceil(count / limit),
      typeFilter, eventTypes: eventTypes.map(e => e.eventType),
      moment,
      webhookConfigured: !!GITHUB_WEBHOOK_SECRET,
      webhookUrl: `${APP_URL}/github/webhook`,
    });
  } catch (err) { next(err); }
};
