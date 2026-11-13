// APALINK account settings, sessions, notifications — Milestone 3.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../database/db');
const { resolveUser, getUser, getPrefs, PREF_DEFAULTS, PREF_ALLOWED, createNotification, logActivity } = require('../lib/helpers');

const router = express.Router();
const AVATAR_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'avatars');
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(AVATAR_DIR, { recursive: true }); cb(null, AVATAR_DIR); },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['.png', '.jpg', '.jpeg'].includes(path.extname(file.originalname).toLowerCase())) return cb(new Error('Avatar must be PNG or JPG.'));
    cb(null, true);
  },
});

function requireAuth(req, res, next) {
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  next();
}
const ALLOWED_TABLES = { student: 'students', teacher: 'teachers', admin: 'admins' };

// ---------- Preferences ----------
router.get('/settings/prefs', requireAuth, (req, res) => {
  const saved = getPrefs(req.user.role, req.user.id);
  res.json({ ...PREF_DEFAULTS, ...saved });
});
router.post('/settings/prefs', requireAuth, (req, res) => {
  const prefs = (req.body || {}).prefs || {};
  const upsert = db.prepare('INSERT INTO user_preferences (user_role, user_id, pref_key, pref_value) VALUES (?,?,?,?) ON CONFLICT(user_role, user_id, pref_key) DO UPDATE SET pref_value=excluded.pref_value');
  for (const [key, value] of Object.entries(prefs)) {
    if (!(key in PREF_ALLOWED)) continue; // ignore unknown keys
    const allowed = PREF_ALLOWED[key];
    const v = String(value);
    if (allowed && !allowed.includes(v)) return res.status(400).json({ error: `Invalid value for ${key}.` });
    if (!allowed && v.length > 60) return res.status(400).json({ error: `${key} is too long.` });
    upsert.run(req.user.role, req.user.id, key, v);
  }
  res.json({ ok: true });
});

// ---------- Profile (official school identity is immutable here) ----------
router.post('/settings/profile', requireAuth, (req, res) => {
  const b = req.body || {};
  // Reject attempts to change official school identity.
  for (const forbidden of ['sectionId', 'levelId', 'className', 'departmentId', 'role', 'isAdmin']) {
    if (b[forbidden] !== undefined) return res.status(400).json({ error: 'Official school records cannot be changed in account settings.' });
  }
  const table = ALLOWED_TABLES[req.user.role];
  const row = getUser(table, req.user.id);
  if (b.username !== undefined) {
    const username = String(b.username).trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
    const dup = db.prepare(`SELECT id FROM ${table} WHERE username=? COLLATE NOCASE AND id<>?`).get(username, req.user.id);
    if (dup) return res.status(400).json({ error: 'That username is already taken.' });
    db.prepare(`UPDATE ${table} SET username=?, updated_at=datetime('now') WHERE id=?`).run(username, req.user.id);
  }
  if (b.fullName !== undefined) {
    const name = String(b.fullName).trim();
    if (!name) return res.status(400).json({ error: 'Display name cannot be empty.' });
    db.prepare(`UPDATE ${table} SET full_name=?, updated_at=datetime('now') WHERE id=?`).run(name.slice(0, 120), req.user.id);
  }
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email address is not valid.' });
    if (email) {
      const dup = db.prepare(`SELECT id FROM ${table} WHERE email=? COLLATE NOCASE AND id<>?`).get(email, req.user.id);
      if (dup) return res.status(400).json({ error: 'That email already belongs to another account.' });
    }
    db.prepare(`UPDATE ${table} SET email=?, updated_at=datetime('now') WHERE id=?`).run(email || null, req.user.id);
  }
  logActivity(req.user.role, req.user.id, 'profile.update', 'Account details updated');
  res.json({ ok: true });
});

router.post('/settings/avatar', requireAuth, avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please choose an image.' });
  const table = ALLOWED_TABLES[req.user.role];
  const previous = (db.prepare(`SELECT avatar_path FROM ${table} WHERE id=?`).get(req.user.id) || {}).avatar_path || '';
  db.prepare(`UPDATE ${table} SET avatar_path=?, updated_at=datetime('now') WHERE id=?`).run(req.file.filename, req.user.id);
  // Best effort: remove the previously uploaded file (never the shared APADEM crest).
  if (previous && previous !== req.file.filename && previous !== 'apadem.png') {
    try { fs.unlink(path.join(AVATAR_DIR, path.basename(previous)), () => {}); } catch {}
  }
  logActivity(req.user.role, req.user.id, 'profile.avatar', req.file.filename);
  res.json({ ok: true, avatar: req.file.filename });
});

// Any logged-in user may fetch avatar images (shown on dashboards / profile chips).
const AVATAR_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
router.get('/settings/avatar/:file', requireAuth, (req, res) => {
  const name = path.basename(String(req.params.file || ''));
  const ext = path.extname(name).toLowerCase();
  if (!name || !AVATAR_TYPES[ext]) return res.status(400).json({ error: 'Unsupported image.' });
  const file = path.join(AVATAR_DIR, name);
  const st = fs.statSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) return res.status(404).json({ error: 'No picture yet.' });
  res.set('Content-Type', AVATAR_TYPES[ext]);
  fs.createReadStream(file).pipe(res);
});

// ---------- Per-user activity history (the user can hide/delete their own entries) ----------
router.get('/settings/activity', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, action, details, created_at FROM activity_log
    WHERE actor_role=? AND actor_id=? AND hidden_by_user=0 ORDER BY id DESC LIMIT 200`).all(req.user.role, req.user.id);
  res.json({ activity: rows.map(r => ({ id: r.id, action: r.action, details: r.details, createdAt: r.created_at })) });
});
router.delete('/settings/activity/:id', requireAuth, (req, res) => {
  // A user can only hide their own history entry — the audit trail for admins stays intact.
  const info = db.prepare('UPDATE activity_log SET hidden_by_user=1 WHERE id=? AND actor_role=? AND actor_id=?')
    .run(Number(req.params.id), req.user.role, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Activity entry not found.' });
  res.json({ ok: true });
});
router.delete('/settings/activity', requireAuth, (req, res) => {
  db.prepare('UPDATE activity_log SET hidden_by_user=1 WHERE actor_role=? AND actor_id=? AND hidden_by_user=0')
    .run(req.user.role, req.user.id);
  res.json({ ok: true });
});

// ---------- Security: change password + logout-all ----------
router.post('/settings/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirm } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Enter your current and new password.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (newPassword !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  const table = ALLOWED_TABLES[req.user.role];
  const row = getUser(table, req.user.id);
  const ok = await bcrypt.compare(String(currentPassword), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare(`UPDATE ${table} SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, req.user.id);
  logActivity(req.user.role, req.user.id, 'auth.passwordChange', 'Password changed');
  // Invalidate all other sessions for this user.
  req.sessionStore.all((err, sessions) => {
    if (!err && sessions) {
      for (const [sid, sess] of Object.entries(sessions)) {
        if (sid === req.sessionID) continue;
        const match = (table === 'students' && sess.studentId === req.user.id)
          || (table === 'teachers' && sess.teacherId === req.user.id)
          || (table === 'admins' && sess.adminId === req.user.id);
        if (match) req.sessionStore.destroy(sid, () => {});
      }
    }
    res.json({ ok: true });
  });
});
router.post('/settings/logout-all', requireAuth, (req, res) => {
  req.sessionStore.all((err, sessions) => {
    if (!err && sessions) {
      for (const [sid, sess] of Object.entries(sessions)) {
        if (sid === req.sessionID) continue;
        const match = sess.userId === req.user.id && sess.role === req.user.role;
        if (match) req.sessionStore.destroy(sid, () => {});
      }
    }
    res.json({ ok: true });
  });
});
router.get('/settings/sessions', requireAuth, (req, res) => {
  req.sessionStore.all((err, sessions) => {
    if (err) return res.status(500).json({ error: 'Could not load sessions.' });
    const mine = [];
    for (const [sid, sess] of Object.entries(sessions || {})) {
      if (sess.userId === req.user.id && sess.role === req.user.role) {
        mine.push({ id: sid === req.sessionID ? 'current' : sid.slice(0, 10) + '…', current: sid === req.sessionID, cookieMaxAge: sess.cookie && sess.cookie.maxAge ? Math.round(sess.cookie.maxAge / 60000) : null });
      }
    }
    res.json({ sessions: mine, note: 'Other devices are listed here and can be terminated.' });
  });
});

// ---------- Notifications ----------
router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE recipient_role=? AND recipient_id=? ORDER BY created_at DESC LIMIT 60').all(req.user.role, req.user.id);
  const unread = db.prepare('SELECT COUNT(*) x FROM notifications WHERE recipient_role=? AND recipient_id=? AND is_read=0').get(req.user.role, req.user.id).x;
  res.json({ notifications: rows.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, isRead: !!n.is_read, createdAt: n.created_at })), unread: Number(unread) || 0 });
});
router.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND recipient_role=? AND recipient_id=?').run(Number(req.params.id), req.user.role, req.user.id);
  res.json({ ok: true });
});
router.post('/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE recipient_role=? AND recipient_id=? AND is_read=0').run(req.user.role, req.user.id);
  res.json({ ok: true });
});

router.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || String(err.message || '').includes('Avatar'))) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
