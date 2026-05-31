require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const flash = require('connect-flash');
const csrf = require('csurf');
const moment = require('moment');

const { sequelize } = require('./models');
const { globalLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SSE clients store ─────────────────────────────────────────────────────────
const sseClients = new Map();
let sseIdCounter = 0;

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => { try { res.write(msg); } catch {} });
}
app.locals.broadcast = broadcast;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'ui-avatars.com', 'avatars.githubusercontent.com', 'github.com'],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Request logging ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Session ───────────────────────────────────────────────────────────────────
const sessionStore = new SequelizeStore({ db: sequelize });
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: parseInt(process.env.SESSION_MAX_AGE_HOURS || 8) * 60 * 60 * 1000,
    sameSite: 'lax',
  },
  name: 'aai.sid',
}));

// ── Flash messages ────────────────────────────────────────────────────────────
app.use(flash());

// ── CSRF (skip for API + webhook) ─────────────────────────────────────────────
const csrfProtection = csrf();
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/github/webhook')) return next();
  csrfProtection(req, res, next);
});

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Global template locals ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.flash = { success: req.flash('success'), error: req.flash('error'), info: req.flash('info') };
  res.locals.csrfToken = (req.csrfToken ? req.csrfToken() : '') || '';
  res.locals.moment = moment;
  res.locals.appName = process.env.APP_NAME || 'AAI Admin';
  res.locals.currentUser = null;
  res.locals.githubOAuthEnabled = !!process.env.GITHUB_CLIENT_ID;
  next();
});

// ── SSE stream endpoint ───────────────────────────────────────────────────────
const { authenticate } = require('./middleware/authenticate');
app.get('/events/stream', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = ++sseIdCounter;
  sseClients.set(clientId, res);

  res.write(`: connected\n\n`);

  // Heartbeat every 25s to keep connection alive
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(hb); } }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(clientId);
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/users', require('./routes/users'));
app.use('/roles', require('./routes/roles'));
app.use('/apikeys', require('./routes/apikeys'));
app.use('/audit', require('./routes/audit'));
app.use('/settings', require('./routes/settings'));
app.use('/github', require('./routes/github'));
app.use('/system', require('./routes/system'));
app.use('/notifications', require('./routes/notifications'));
app.use('/api/v1', require('./routes/api/v1'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { title: '404 Not Found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    req.flash('error', 'Invalid form submission. Please try again.');
    return res.redirect('back');
  }
  console.error('[ERROR]', err.stack || err.message);
  const status = err.status || 500;
  res.status(status).render('errors/500', { title: 'Server Error', error: process.env.NODE_ENV === 'development' ? err : {} });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await sequelize.authenticate();
    // SQLite: disable FK checks during schema migration to allow ALTER TABLE
    if (sequelize.getDialect() === 'sqlite') {
      await sequelize.query('PRAGMA foreign_keys = OFF');
    }
    await sequelize.sync({ alter: { drop: false } });
    if (sequelize.getDialect() === 'sqlite') {
      await sequelize.query('PRAGMA foreign_keys = ON');
    }
    sessionStore.sync();

    const { seed } = require('./scripts/seedData');
    await seed();

    app.listen(PORT, () => {
      console.log(`\n  AAI Admin Panel  →  http://localhost:${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  GitHub OAuth: ${process.env.GITHUB_CLIENT_ID ? 'enabled' : 'disabled (set GITHUB_CLIENT_ID)'}`);
      console.log(`  GitHub Webhook: ${process.env.GITHUB_WEBHOOK_SECRET ? 'secured' : 'unsecured (set GITHUB_WEBHOOK_SECRET)'}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();

module.exports = app;
