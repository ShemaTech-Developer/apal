// APALINK auth routes — backend-validated, bcrypt-hashed, session-based.
// The teacher access code is read ONLY here (from env). It never reaches the browser.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireTeacherVerified } = require('../middleware/auth');

const router = express.Router();

function getAccessCode() {
  return process.env.TEACHER_ACCESS_CODE || process.env.SCHOOL_ACCESS_CODE || 'APADE@2026';
}
function validUsername(u) { return /^[a-zA-Z0-9_]{3,24}$/.test(u); }
function validEmail(e) { return e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6; }

function publicStudent(s) {
  return { id: s.id, role: 'student', fullName: s.full_name, username: s.username, email: s.email || '', sectionId: s.section_id, className: s.class_name, levelId: s.level_id, createdAt: s.created_at };
}
function publicTeacher(t) {
  return { id: t.id, role: 'teacher', fullName: t.full_name, username: t.username, email: t.email || '', createdAt: t.created_at };
}
function establishSession(req, user) {
  return new Promise((resolve) => {
    req.session.regenerate(() => {
      if (user.role === 'student') req.session.studentId = user.id;
      else req.session.teacherId = user.id;
      req.session.userId = user.id;
      req.session.role = user.role;
      resolve();
    });
  });
}

// ---------- Reference data (departments / levels for selects) ----------
router.get('/departments', (req, res) => {
  res.json(db.prepare('SELECT id, name, code FROM departments WHERE is_active=1 ORDER BY name').all());
});
router.get('/levels', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM academic_levels WHERE is_active=1 ORDER BY id').all();
  // Keep Level 3..5 before Senior 4..6 as seeded; ORDER BY id preserves seed order.
  res.json(rows);
});

// ---------- Student register ----------
router.post('/student/register', async (req, res) => {
  const { fullName, username, email, sectionId, className, levelId, password, confirm } = req.body || {};
  const name = String(fullName || '').trim();
  const user = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const cls = String(className || '').trim();
  if (!name || !user || !sectionId || !levelId || !password) return res.status(400).json({ error: 'All required fields must be completed.' });
  if (!validUsername(user)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (!validEmail(mail)) return res.status(400).json({ error: 'Email address is not valid.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  const dept = db.prepare('SELECT id FROM departments WHERE id=? AND is_active=1').get(Number(sectionId));
  if (!dept) return res.status(400).json({ error: 'Please choose a valid section/department.' });
  const lvl = db.prepare('SELECT id FROM academic_levels WHERE id=? AND is_active=1').get(Number(levelId));
  if (!lvl) return res.status(400).json({ error: 'Please choose a valid academic level.' });
  const dup = db.prepare('SELECT id FROM students WHERE username=? COLLATE NOCASE').get(user);
  if (dup) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });
  if (mail) {
    const dupMail = db.prepare('SELECT id FROM students WHERE email=? COLLATE NOCASE').get(mail);
    if (dupMail) return res.status(400).json({ error: 'An account with that email already exists.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO students (full_name, username, email, section_id, class_name, level_id, password_hash) VALUES (?,?,?,?,?,?,?)')
    .run(name, user, mail || null, Number(sectionId), cls, Number(levelId), hash);
  const row = db.prepare('SELECT * FROM students WHERE id=?').get(info.lastInsertRowid);
  await establishSession(req, publicStudent(row));
  res.status(201).json({ user: publicStudent(row) });
});

// ---------- Student login ----------
router.post('/student/login', async (req, res) => {
  const { identifier, password, remember } = req.body || {};
  const idn = String(identifier || '').trim();
  if (!idn || !password) return res.status(400).json({ error: 'Enter your username/email and password.' });
  const row = db.prepare('SELECT * FROM students WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(idn, idn);
  if (!row || !row.is_active) return res.status(401).json({ error: 'Invalid login details.' });
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid login details.' });
  req.session.cookie.maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : null;
  await establishSession(req, publicStudent(row));
  try { db.prepare("UPDATE students SET last_login_at=datetime('now') WHERE id=?").run(row.id); } catch {}
  res.json({ user: publicStudent(row) });
});

// ---------- Admin login ----------
router.post('/admin/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  const idn = String(identifier || '').trim();
  if (!idn || !password) return res.status(400).json({ error: 'Enter your username/email and password.' });
  const row = db.prepare('SELECT * FROM admins WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(idn, idn);
  if (!row || !row.is_active) return res.status(401).json({ error: 'Invalid login details.' });
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid login details.' });
  await new Promise((resolve) => req.session.regenerate(() => {
    req.session.adminId = row.id; req.session.userId = row.id; req.session.role = 'admin'; resolve();
  }));
  res.json({ user: { id: row.id, role: 'admin', fullName: row.full_name, username: row.username } });
});

// ---------- Teacher access-code verification (backend only) ----------
router.post('/teacher/verify', (req, res) => {
  const { code } = req.body || {};
  const expected = getAccessCode();
  const provided = Buffer.from(String(code || ''));
  const want = Buffer.from(expected);
  let ok = false;
  try { ok = provided.length === want.length && crypto.timingSafeEqual(provided, want); } catch { ok = false; }
  if (!ok) return res.status(403).json({ error: 'Incorrect school access code.' });
  req.session.teacherVerified = true;
  req.session.teacherVerifiedAt = Date.now();
  res.json({ verified: true });
});

// ---------- Teacher register (requires verification; no department/level) ----------
router.post('/teacher/register', requireTeacherVerified, async (req, res) => {
  const { fullName, username, email, password, confirm } = req.body || {};
  const name = String(fullName || '').trim();
  const user = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  if (!name || !user || !password) return res.status(400).json({ error: 'All required fields must be completed.' });
  if (!validUsername(user)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (!validEmail(mail)) return res.status(400).json({ error: 'Email address is not valid.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  const dup = db.prepare('SELECT id FROM teachers WHERE username=? COLLATE NOCASE').get(user);
  if (dup) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });
  if (mail) {
    const dupMail = db.prepare('SELECT id FROM teachers WHERE email=? COLLATE NOCASE').get(mail);
    if (dupMail) return res.status(400).json({ error: 'An account with that email already exists.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO teachers (full_name, username, email, password_hash) VALUES (?,?,?,?)')
    .run(name, user, mail || null, hash);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(info.lastInsertRowid);
  await establishSession(req, publicTeacher(row));
  res.status(201).json({ user: publicTeacher(row) });
});

// ---------- Teacher login (requires verification) ----------
router.post('/teacher/login', requireTeacherVerified, async (req, res) => {
  const { identifier, password, remember } = req.body || {};
  const idn = String(identifier || '').trim();
  if (!idn || !password) return res.status(400).json({ error: 'Enter your username/email and password.' });
  const row = db.prepare('SELECT * FROM teachers WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(idn, idn);
  if (!row || !row.is_active) return res.status(401).json({ error: 'Invalid login details.' });
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid login details.' });
  req.session.cookie.maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : null;
  await establishSession(req, publicTeacher(row));
  try { db.prepare("UPDATE teachers SET last_login_at=datetime('now') WHERE id=?").run(row.id); } catch {}
  res.json({ user: publicTeacher(row) });
});

// ---------- Me / logout ----------
router.get('/me', (req, res) => {
  if (req.session.adminId) {
    const a = db.prepare('SELECT * FROM admins WHERE id=?').get(req.session.adminId);
    if (a) return res.json({ user: { id: a.id, role: 'admin', fullName: a.full_name, username: a.username, email: a.email || '', createdAt: a.created_at } });
  }
  if (req.session.teacherId) {
    const t = db.prepare('SELECT * FROM teachers WHERE id=?').get(req.session.teacherId);
    if (t) return res.json({ user: publicTeacher(t) });
  }
  if (req.session.studentId) {
    const s = db.prepare(`SELECT s.*, d.name AS section_name, l.name AS level_name FROM students s
      LEFT JOIN departments d ON d.id = s.section_id LEFT JOIN academic_levels l ON l.id = s.level_id
      WHERE s.id=?`).get(req.session.studentId);
    if (s) return res.json({ user: { ...publicStudent(s), sectionName: s.section_name || '', levelName: s.level_name || '' } });
  }
  res.status(401).json({ error: 'Not logged in.' });
});

// Change password (student or teacher, requires current password)
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword, confirm } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Enter your current and new password.' });
  if (!validPassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (newPassword !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  let table = null, id = null;
  if (req.session.studentId) { table = 'students'; id = req.session.studentId; }
  else if (req.session.teacherId) { table = 'teachers'; id = req.session.teacherId; }
  else return res.status(401).json({ error: 'Please log in first.' });
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  const ok = await bcrypt.compare(String(currentPassword), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare(`UPDATE ${table} SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, id);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('apalink.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
