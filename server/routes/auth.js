// APALINK auth routes — backend-validated, bcrypt-hashed, session-based.
// The teacher access code is read ONLY here (from env). It never reaches the browser.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireTeacherVerified } = require('../middleware/auth');
const { logActivity, createNotification, resolveSchool, normalizePhone, getAdminRow, getAdminSchoolId, getSchoolByCode } = require('../lib/helpers');

const router = express.Router();

function getAccessCode() {
  return process.env.TEACHER_ACCESS_CODE || process.env.SCHOOL_ACCESS_CODE || 'APADE@2026';
}
function codeMatches(code) {
  const provided = Buffer.from(String(code || ''));
  const want = Buffer.from(getAccessCode());
  try { return provided.length === want.length && crypto.timingSafeEqual(provided, want); } catch { return false; }
}
const ADMIN_SCHOOL_TTL = 10 * 60 * 1000;
function adminSchoolFresh(req) {
  return !!(req.session && req.session.adminSchoolVerified && req.session.adminSchoolVerifiedAt &&
    Date.now() - req.session.adminSchoolVerifiedAt < ADMIN_SCHOOL_TTL);
}
function validUsername(u) { return /^[a-zA-Z0-9_]{3,24}$/.test(u); }
function validEmail(e) { return e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6; }

function publicStudent(s) {
  let schoolName = s.school_name || '', district = s.school_district || '';
  if (!schoolName && s.school_id) {
    const sc = db.prepare('SELECT name, district FROM schools WHERE id=?').get(s.school_id);
    if (sc) { schoolName = sc.name; district = sc.district; }
  }
  return { id: s.id, role: 'student', fullName: s.full_name, username: s.username, email: s.email || '', sectionId: s.section_id, className: s.class_name, levelId: s.level_id, schoolId: s.school_id || null, schoolName, district, avatar: s.avatar_path || '', createdAt: s.created_at };
}
function publicTeacher(t) {
  let schoolName = t.school_name || '', district = t.school_district || '';
  if (!schoolName && t.school_id) {
    const sc = db.prepare('SELECT name, district FROM schools WHERE id=?').get(t.school_id);
    if (sc) { schoolName = sc.name; district = sc.district; }
  }
  return { id: t.id, role: 'teacher', fullName: t.full_name, username: t.username, email: t.email || '', schoolId: t.school_id || null, schoolName, district, avatar: t.avatar_path || '', createdAt: t.created_at };
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
// Schools + districts (public: needed before an account exists).
router.get('/schools', (req, res) => {
  const district = String(req.query.district || '').trim();
  const rows = district
    ? db.prepare('SELECT id, name, district, sector FROM schools WHERE is_active=1 AND district=? ORDER BY name').all(district)
    : db.prepare('SELECT id, name, district, sector FROM schools WHERE is_active=1 ORDER BY district, name').all();
  res.json(rows);
});
router.get('/districts', (req, res) => {
  const rows = db.prepare("SELECT DISTINCT district FROM schools WHERE is_active=1 AND TRIM(district)<>'' ORDER BY district").all();
  res.json(rows.map(r => r.district));
});

// ---------- Student register ----------
router.post('/student/register', async (req, res) => {
  const { fullName, username, email, sectionId, className, levelId, district, schoolName, password, confirm } = req.body || {};
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
  // School: student chooses the District and types the school name.
  const school = resolveSchool(district, schoolName);
  if (!school) return res.status(400).json({ error: 'Please choose your district and enter your school name (min. 3 characters).' });
  const dup = db.prepare('SELECT id FROM students WHERE username=? COLLATE NOCASE').get(user);
  if (dup) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });
  if (mail) {
    const dupMail = db.prepare('SELECT id FROM students WHERE email=? COLLATE NOCASE').get(mail);
    if (dupMail) return res.status(400).json({ error: 'An account with that email already exists.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO students (full_name, username, email, section_id, class_name, level_id, school_id, password_hash) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, user, mail || null, Number(sectionId), cls, Number(levelId), school ? school.id : null, hash);
  const row = db.prepare('SELECT * FROM students WHERE id=?').get(info.lastInsertRowid);
  await establishSession(req, publicStudent(row));
  logActivity('student', row.id, 'auth.register', school ? `school ${school.id}` : row.username);
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
  logActivity('student', row.id, 'auth.login', row.username);
  res.json({ user: publicStudent(row) });
});

// ---------- Admin access: school access password first, then administrator password ----------
// Two-password flow: (1) school access code — per school, each school has its own password.
//                   (2) administrator password — the school admin's own credentials.
// Super admin (whole app) may pass schoolId=null to use the global school code.
router.post('/admin/verify-school', (req, res) => {
  const { code, schoolId } = req.body || {};
  let verifiedSchoolId = null;
  let school = null;
  if (schoolId !== undefined && schoolId !== null && String(schoolId).trim() !== '') {
    school = Number(schoolId) ? db.prepare('SELECT * FROM schools WHERE id=?').get(Number(schoolId)) : null;
    if (!school) return res.status(403).json({ error: 'Incorrect school access password.' });
  } else {
    // No schoolId supplied: resolve the school by its own (per-school) access code.
    school = getSchoolByCode(code);
    if (!school) return res.status(403).json({ error: 'Incorrect school access password.' });
  }
  const want = String((school && school.code) || '');
  const got = String(code || '');
  const a = Buffer.from(want); const b = Buffer.from(got);
  const ok = a.length === b.length && (() => { try { return crypto.timingSafeEqual(a, b); } catch { return false; } })();
  if (!ok) return res.status(403).json({ error: 'Incorrect school access password.' });
  if (school) verifiedSchoolId = Number(school.id);
  req.session.adminSchoolVerified = true;
  req.session.adminSchoolVerifiedAt = Date.now();
  // School scope: null = whole-app super admin, otherwise this school admin's school.
  req.session.adminSchoolId = verifiedSchoolId;
  res.json({ verified: true, schoolId: verifiedSchoolId });
});

router.post('/admin/login', async (req, res) => {
  if (!adminSchoolFresh(req)) {
    return res.status(403).json({ error: 'Enter the school access password first.', needsSchoolPassword: true });
  }
  const { identifier, password } = req.body || {};
  const idn = String(identifier || '').trim();
  if (!idn || !password) return res.status(400).json({ error: 'Enter your username/email and password.' });
  const row = db.prepare('SELECT * FROM admins WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(idn, idn);
  if (!row || !row.is_active) return res.status(401).json({ error: 'Invalid login details.' });
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid login details.' });
  const schoolId = row.school_id ? Number(row.school_id) : null;
  await new Promise((resolve) => req.session.regenerate(() => {
    req.session.adminId = row.id; req.session.userId = row.id; req.session.role = 'admin';
    req.session.adminSchoolId = schoolId; resolve();
  }));
  logActivity('admin', row.id, 'auth.login', row.username);
  res.json({ user: { id: row.id, role: 'admin', fullName: row.full_name, username: row.username, schoolId: schoolId, school: schoolId ? (db.prepare('SELECT id, name, district, code FROM schools WHERE id=?').get(schoolId) || null) : null } });
});

// ---------- Teacher access-code verification (backend only) ----------
router.post('/teacher/verify', (req, res) => {
  const { code } = req.body || {};
  if (!codeMatches(code)) return res.status(403).json({ error: 'Incorrect school access code.' });
  req.session.teacherVerified = true;
  req.session.teacherVerifiedAt = Date.now();
  res.json({ verified: true });
});

// ---------- Teacher register (requires verification; choose the school where you teach) ----------
router.post('/teacher/register', requireTeacherVerified, async (req, res) => {
  const { fullName, username, email, district, schoolName, phone, password, confirm } = req.body || {};
  const name = String(fullName || '').trim();
  const user = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  if (!name || !user || !password) return res.status(400).json({ error: 'All required fields must be completed.' });
  if (!validUsername(user)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (!validEmail(mail)) return res.status(400).json({ error: 'Email address is not valid.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  // School: teacher chooses the district (optional) and types the school name.
  const school = resolveSchool(district, schoolName);
  if (!school) return res.status(400).json({ error: 'Enter the name of the school where you teach (min. 3 characters).' });
  const tel = normalizePhone(phone);
  if (phone && !tel) return res.status(400).json({ error: 'Phone must be a Rwandan number like +2507XXXXXXXX.' });
  const dup = db.prepare('SELECT id FROM teachers WHERE username=? COLLATE NOCASE').get(user);
  if (dup) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });
  if (mail) {
    const dupMail = db.prepare('SELECT id FROM teachers WHERE email=? COLLATE NOCASE').get(mail);
    if (dupMail) return res.status(400).json({ error: 'An account with that email already exists.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO teachers (full_name, username, email, school_id, phone, password_hash) VALUES (?,?,?,?,?,?)')
    .run(name, user, mail || null, school.id, tel, hash);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(info.lastInsertRowid);
  createNotification('teacher', row.id, 'announcements', 'Welcome to ' + school.name,
    'Your teacher account is linked to ' + school.name + ', ' + school.district + ' District. Announcements and updates for your school will appear here.', '/pages/announcements.html');
  await establishSession(req, publicTeacher(row));
  logActivity('teacher', row.id, 'auth.register', school.name);
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
  logActivity('teacher', row.id, 'auth.login', row.username);
  res.json({ user: publicTeacher(row) });
});

// ---------- Me / logout ----------
router.get('/me', (req, res) => {
  if (req.session.adminId) {
    const a = db.prepare('SELECT * FROM admins WHERE id=?').get(req.session.adminId);
    if (a) {
      const school = a.school_id ? db.prepare('SELECT id, name, district, code FROM schools WHERE id=?').get(Number(a.school_id)) : null;
      return res.json({ user: { id: a.id, role: 'admin', fullName: a.full_name, username: a.username, email: a.email || '', avatar: a.avatar_path || '', createdAt: a.created_at, schoolId: a.school_id ? Number(a.school_id) : null, school: school || null } });
    }
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
