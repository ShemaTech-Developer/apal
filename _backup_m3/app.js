// APALINK server — Express + session auth + SQLite (node:sqlite). Milestone 1.
const express = require('express');
const session = require('express-session');
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
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
}));

// No-store for auth API
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'APALINK', milestone: 2 }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/notes'));

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

module.exports = app;
