// APALINK server — Express + session auth + SQLite (node:sqlite). Milestone 1.
const express = require('express');
const session = require('express-session');
const createSessionStore = require('./lib/sessionStore');
const path = require('node:path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'apalink.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  store: createSessionStore(path.join(__dirname, '..', 'data', 'sessions.json')),
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
}));

// No-store for auth API
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'APALINK', milestone: 5 }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/notes'));
app.use('/api', require('./routes/timetable'));
app.use('/api', require('./routes/messaging'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/announcements'));
app.use('/api', require('./routes/search'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/eclass'));
app.use('/api', require('./routes/clerk'));

// Static frontend
const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  next(err);
});
app.use((req, res) => res.status(404).json({ error: 'Page not found.' }));

const server = app.listen(PORT, () => {
  console.log(`APALINK running at http://localhost:${PORT}`);
  console.log('Database: data/apalink.db (SQLite, auto-initialized)');
});
server.on('error', (err) => { console.error('Server error:', err.message); process.exit(1); });

// Safety net: Express 4 cannot catch errors thrown inside async route
// handlers. Without this, one rejected promise (e.g. a locked database)
// would kill the process and drop every connected user. Log and keep serving.
process.on('unhandledRejection', (err) => {
  console.error('Async route error (server kept alive):', (err && err.stack) || err);
});

module.exports = app;
