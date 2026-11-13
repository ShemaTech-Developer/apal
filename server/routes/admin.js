// APALINK admin router — Milestone 4: master control panel.
// Everything here requires session adminId. Passwords are hashed like other accounts.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { logActivity, createNotification, hub, resolveSchool, normalizePhone, getAdminRow, getAdminSchoolId } = require('../lib/helpers');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

function studentStats(s) {
  return {
    id: s.id, role: 'student', fullName: s.full_name, username: s.username, email: s.email || '',
    section: s.section_name || '', level: s.level_name || '', className: s.class_name || '',
    school: s.school_name || '', district: s.school_district || '', sector: s.school_sector || '',
    avatar: s.avatar_path || '',
    active: !!s.is_active, joined: s.created_at, lastLogin: s.last_login_at,
    notes: 0,
    downloads: db.prepare('SELECT COUNT(*) c FROM note_downloads WHERE student_id=?').get(s.id).c,
    saved: db.prepare('SELECT COUNT(*) c FROM saved_notes WHERE student_id=?').get(s.id).c,
    messagesSent: db.prepare("SELECT COUNT(*) c FROM messages WHERE sender_role='student' AND sender_id=? AND is_hidden=0").get(s.id).c,
  };
}
function teacherStats(t) {
  const notes = db.prepare('SELECT COUNT(*) c FROM notes WHERE teacher_id=?').get(t.id).c;
  const published = db.prepare('SELECT COUNT(*) c FROM notes WHERE teacher_id=? AND is_published=1').get(t.id).c;
  const downloads = db.prepare('SELECT COUNT(*) c FROM note_downloads dl JOIN notes n ON n.id=dl.note_id WHERE n.teacher_id=?').get(t.id).c;
  return {
    id: t.id, role: 'teacher', fullName: t.full_name, username: t.username, email: t.email || '',
    phone: t.phone || '',
    school: t.school_name || '', district: t.school_district || '', sector: t.school_sector || '',
    avatar: t.avatar_path || '',
    active: !!t.is_active, joined: t.created_at, lastLogin: t.last_login_at,
    notes, published, downloads,
    messagesSent: db.prepare("SELECT COUNT(*) c FROM messages WHERE sender_role='teacher' AND sender_id=? AND is_hidden=0").get(t.id).c,
  };
}
const STUDENT_Q = `SELECT s.*, d.name AS section_name, l.name AS level_name, sc.name AS school_name, sc.district AS school_district, sc.sector AS school_sector
  FROM students s LEFT JOIN departments d ON d.id=s.section_id LEFT JOIN academic_levels l ON l.id=s.level_id
  LEFT JOIN schools sc ON sc.id=s.school_id`;
const TEACHER_Q = `SELECT t.*, sc.name AS school_name, sc.district AS school_district, sc.sector AS school_sector
  FROM teachers t LEFT JOIN schools sc ON sc.id=t.school_id`;
// School sub-admin scope: null = whole-app super admin (sees every school), else the school id.
function adminSchoolScope(req) { return getAdminSchoolId(req); }
function isSuperAdminReq(req) { const a = getAdminRow(req); return !a || !a.school_id; }

// ---------- Directory + activity overview ----------
router.get('/admin/dashboard', requireAdmin, (req, res) => {
  const c = (t) => db.prepare(`SELECT COUNT(*) x FROM ${t}`).get().x;
  const adminSchoolId = getAdminSchoolId(req);
  const fileRows = db.prepare('SELECT file_name, file_size FROM note_files').all();
  const uploads = { pdf: 0, image: 0, text: 0, document: 0, other: 0 };
  let storage = 0;
  for (const f of fileRows) {
    storage += Number(f.file_size) || 0;
    const ext = path.extname(f.file_name || '').toLowerCase();
    if (ext === '.pdf') uploads.pdf++;
    else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) uploads.image++;
    else if (['.txt', '.md', '.csv', '.json', '.html'].includes(ext)) uploads.text++;
    else if (['.doc', '.docx', '.ppt', '.pptx'].includes(ext)) uploads.document++;
    else uploads.other++;
  }

  // 7-day chart series (logins + all logged actions + downloads).
  const days = [];
  const dayIndex = new Map();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const row = { date: key, label: key.slice(5), logins: 0, actions: 0, downloads: 0 };
    days.push(row); dayIndex.set(key, row);
  }
  const since = days[0].date;
  const acts = db.prepare('SELECT action, actor_role, actor_id, created_at FROM activity_log WHERE substr(created_at,1,10) >= ?').all(since);
  const activeKeys = new Set();
  for (const a of acts) {
    const row = dayIndex.get(String(a.created_at).slice(0, 10));
    if (!row) continue;
    row.actions++;
    if (a.action === 'auth.login') row.logins++;
    activeKeys.add(a.actor_role + ':' + a.actor_id);
  }
  for (const d of db.prepare('SELECT substr(downloaded_at,1,10) day, COUNT(*) c FROM note_downloads WHERE substr(downloaded_at,1,10) >= ? GROUP BY day').all(since)) {
    const row = dayIndex.get(d.day); if (row) row.downloads = d.c;
  }

  res.json({
    counts: {
      students: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM students WHERE school_id=?').get(adminSchoolId).x : c('students'),
      teachers: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM teachers WHERE school_id=?').get(adminSchoolId).x : c('teachers'),
      admins: c('admins'),
      activeStudents: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM students WHERE is_active=1 AND school_id=?').get(adminSchoolId).x : db.prepare('SELECT COUNT(*) x FROM students WHERE is_active=1').get().x,
      activeTeachers: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM teachers WHERE is_active=1 AND school_id=?').get(adminSchoolId).x : db.prepare('SELECT COUNT(*) x FROM teachers WHERE is_active=1').get().x,
      notes: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM notes n JOIN teachers t ON t.id=n.teacher_id WHERE t.school_id=?').get(adminSchoolId).x : c('notes'),
      publishedNotes: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM notes n JOIN teachers t ON t.id=n.teacher_id WHERE t.school_id=? AND n.is_published=1').get(adminSchoolId).x : db.prepare('SELECT COUNT(*) x FROM notes WHERE is_published=1').get().x,
      timetables: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM timetable_documents td JOIN teachers t ON t.id=td.created_by WHERE t.school_id=?').get(adminSchoolId).x : c('timetable_documents'),
      messages: c('messages'),
      conversations: c('conversations'), openReports: db.prepare("SELECT COUNT(*) x FROM message_reports WHERE status='open'").get().x,
      downloads: c('note_downloads'), files: fileRows.length, storage,
      schools: c('schools'), announcements: adminSchoolId ? db.prepare('SELECT COUNT(*) x FROM announcements WHERE is_published=1 AND school_id=?').get(adminSchoolId).x : db.prepare('SELECT COUNT(*) x FROM announcements WHERE is_published=1').get().x,
    },
    charts: {
      activity7: days,
      activeUsers7d: activeKeys.size,
      uploads,
      recentDownloads: db.prepare(`SELECT dl.id, dl.downloaded_at, n.id AS note_id, n.title,
          s.full_name AS student, s.username, sc.name AS school
        FROM note_downloads dl JOIN notes n ON n.id=dl.note_id JOIN students s ON s.id=dl.student_id
        LEFT JOIN schools sc ON sc.id=s.school_id ORDER BY dl.id DESC LIMIT 25`).all(),
      mostDownloaded: db.prepare(`SELECT n.id, n.title, t.full_name AS teacher, COUNT(dl.id) AS downloads
        FROM notes n JOIN teachers t ON t.id=n.teacher_id LEFT JOIN note_downloads dl ON dl.note_id=n.id
        GROUP BY n.id ORDER BY downloads DESC, n.created_at DESC LIMIT 8`).all(),
    },
    activity: db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 60').all(),
    recentLogins: [
      ...db.prepare("SELECT full_name AS fullName, username, last_login_at, 'student' AS role FROM students WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 20").all(),
      ...db.prepare("SELECT full_name AS fullName, username, last_login_at, 'teacher' AS role FROM teachers WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 20").all(),
    ].sort((a, b) => String(b.last_login_at).localeCompare(String(a.last_login_at))).slice(0, 20),
  });
});

// ---------- Sub-admins (school admins) — whole-app super administrator only ----------
// The super admin (whole app, school_id NULL) assigns school admins; each school has its own access code/password.
router.get('/admin/school-admins', requireAdmin, (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ error: 'Only the whole-app administrator can manage sub-admins.' });
  const rows = db.prepare(`SELECT a.id, a.full_name AS fullName, a.username AS username, a.email AS email, a.is_active AS isActive, a.created_at AS createdAt,
      s.id AS schoolId, s.name AS schoolName, s.district AS schoolDistrict, s.sector AS schoolSector, s.code AS schoolCode
    FROM admins a LEFT JOIN schools s ON s.id = a.school_id ORDER BY a.school_id IS NULL, a.id`).all();
  res.json({
    admins: rows.map(r => ({
      id: r.id, fullName: r.fullName, username: r.username, email: r.email || '', isActive: !!r.isActive, createdAt: r.createdAt,
      schoolId: r.schoolId ? Number(r.schoolId) : null, schoolName: String(r.schoolName || '').trim(), schoolDistrict: r.schoolDistrict || '', schoolSector: r.schoolSector || '', schoolCode: String(r.schoolCode || '').trim(),
      isSuper: !r.schoolId,
    })),
  });
});
router.post('/admin/school-admins', requireAdmin, async (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ error: 'Only the whole-app administrator can manage sub-admins.' });
  const { fullName, username, password, schoolId } = req.body || {};
  if (!fullName || !username || !password) return res.status(400).json({ error: 'Full name, username and password are required.' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const school = schoolId ? db.prepare('SELECT * FROM schools WHERE id=?').get(Number(schoolId)) : null;
  if (!school) return res.status(400).json({ error: 'Choose the school this sub-admin will manage.' });
  const dup = db.prepare('SELECT id FROM admins WHERE username=? COLLATE NOCASE').get(username);
  if (dup) return res.status(409).json({ error: 'That username is already taken.' });
  const hash = await bcrypt.hash(String(password), 12);
  const info = db.prepare('INSERT INTO admins (full_name, username, email, password_hash, school_id) VALUES (?,?,?,?,?)')
    .run(String(fullName).trim(), username, null, hash, Number(school.id));
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(info.lastInsertRowid);
  logActivity('admin', req.session.adminId, 'admin.createSubAdmin', `${admin.full_name} → ${school.name}`);
  res.json({ ok: true, admin: { id: admin.id, fullName: admin.full_name, username: admin.username, schoolId: Number(school.id), schoolName: school.name } });
});
router.delete('/admin/school-admins/:id', requireAdmin, (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ error: 'Only the whole-app administrator can manage sub-admins.' });
  const id = Number(req.params.id);
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(id);
  if (!admin) return res.status(404).json({ error: 'Sub-admin not found.' });
  db.prepare("UPDATE admins SET is_active=0, updated_at=datetime('now') WHERE id=?").run(id);
  logActivity('admin', req.session.adminId, 'admin.deactivateSubAdmin', `sub-admin ${admin.username}`);
  res.json({ ok: true });
});

router.get('/admin/users', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const role = req.query.role || 'all';
  let students = [], teachers = [];
  const schoolId = getAdminSchoolId(req);
  if (role === 'all' || role === 'student') {
    let rows = db.prepare(STUDENT_Q + ' ORDER BY s.created_at DESC').all();
    if (schoolId) rows = rows.filter(r => Number(r.school_id) === schoolId);
    students = rows.map(studentStats);
    if (q) students = students.filter(u => (u.fullName + ' ' + u.username + ' ' + u.section + ' ' + u.level).toLowerCase().includes(q));
  }
  if (role === 'all' || role === 'teacher') {
    let rows = db.prepare(TEACHER_Q + ' ORDER BY t.created_at DESC').all();
    if (schoolId) rows = rows.filter(r => Number(r.school_id) === schoolId);
    teachers = rows.map(teacherStats);
    if (q) teachers = teachers.filter(u => (u.fullName + ' ' + u.username + ' ' + u.school).toLowerCase().includes(q));
  }
  res.json({ students, teachers });
});

router.get('/admin/users/:role/:id', requireAdmin, (req, res) => {
  const { role } = req.params;
  const id = Number(req.params.id);
  if (role === 'student') {
    const s = db.prepare(STUDENT_Q + ' WHERE s.id=?').get(id);
    if (!s) return res.status(404).json({ error: 'Student not found.' });
    res.json(studentStats(s));
  } else if (role === 'teacher') {
    const t = db.prepare(TEACHER_Q + ' WHERE t.id=?').get(id);
    if (!t) return res.status(404).json({ error: 'Teacher not found.' });
    res.json(teacherStats(t));
  } else return res.status(400).json({ error: 'Role must be student or teacher.' });
});

// ---------- Profile pictures (admin console only; avatars live in data/uploads/avatars) ----------
const AVATAR_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
router.get('/admin/avatars/:file', requireAdmin, (req, res) => {
  const name = path.basename(String(req.params.file || ''));
  const ext = path.extname(name).toLowerCase();
  if (!name || !AVATAR_TYPES[ext]) return res.status(400).json({ error: 'Unsupported image.' });
  const file = path.join(UPLOAD_DIR, 'avatars', name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.status(404).json({ error: 'No picture yet.' });
    res.set('Content-Type', AVATAR_TYPES[ext]);
    fs.createReadStream(file).pipe(res);
  });
});

function userTable(role) { return role === 'student' ? 'students' : role === 'teacher' ? 'teachers' : null; }

router.post('/admin/users/:role/:id/active', requireAdmin, (req, res) => {
  const table = userTable(req.params.role);
  if (!table) return res.status(400).json({ error: 'Invalid role.' });
  const active = req.body && req.body.active ? 1 : 0;
  db.prepare(`UPDATE ${table} SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(active, Number(req.params.id));
  logActivity('admin', req.session.adminId, 'user.active', `${req.params.role} ${req.params.id} → ${active ? 'active' : 'deactivated'}`);
  res.json({ ok: true });
});

router.post('/admin/users/:role/:id/reset-password', requireAdmin, async (req, res) => {
  const table = userTable(req.params.role);
  if (!table) return res.status(400).json({ error: 'Invalid role.' });
  const newPassword = String((req.body || {}).newPassword || '');
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'User not found.' });
  db.prepare(`UPDATE ${table} SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(await bcrypt.hash(newPassword, 12), row.id);
  logActivity('admin', req.session.adminId, 'user.resetPassword', `${req.params.role} ${row.id}`);
  res.json({ ok: true });
});

router.post('/admin/users', requireAdmin, async (req, res) => {
  const { name, username, password, className, schoolName, district, email, level, section } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required.' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const hash = await bcrypt.hash(password, 12);
  const dup = db.prepare('SELECT id FROM students WHERE username=? COLLATE NOCASE').get(username);
  if (dup) return res.status(409).json({ error: 'That username is already taken. Please choose another.' });
  const school = db.prepare("SELECT id FROM schools WHERE name=? AND district=? COLLATE NOCASE").get(schoolName || '', district || '');
  const sectionRow = section ? db.prepare("SELECT id FROM departments WHERE name=? COLLATE NOCASE").get(String(section)) : null;
  const levelRow = level ? db.prepare("SELECT id FROM academic_levels WHERE name=? COLLATE NOCASE").get(String(level)) : null;
  const ins = db.prepare("INSERT INTO students (full_name, username, email, section_id, class_name, level_id, school_id, password_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run(name, username, email || null, sectionRow ? sectionRow.id : null, className || null, levelRow ? levelRow.id : null, school ? school.id : null, hash);
  const user = db.prepare("SELECT * FROM students WHERE id=?").get(ins.lastInsertRowid);
  res.json({ ok: true, user: { id: user.id, fullName: user.full_name, username: user.username, role: 'student', school: user.school_name, district: user.district, level: user.level_name, className: user.class_name, email: user.email } });
});

router.post('/admin/teachers', requireAdmin, async (req, res) => {
  const { name, username, password, className, schoolName, district, email, level } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required.' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const hash = await bcrypt.hash(password, 12);
  const school = db.prepare("SELECT id FROM schools WHERE name=? And district=? COLLATE NOCASE").get(schoolName || '', district || '');
  const ins = db.prepare("INSERT INTO teachers (full_name, username, school_id, password_hash, teacher_code, subject) VALUES (?,?,?,?,?,?)")
    .run(name, username, school ? school.id : null, hash, 'TC001', '');
  const teacher = db.prepare("SELECT * FROM teachers WHERE id=?").get(ins.lastInsertRowid);
  res.json({ ok: true, teacher: { id: teacher.id, fullName: teacher.full_name, username: teacher.username, role: 'teacher', school: teacher.school_name, district: teacher.district, level: teacher.level || '', className: teacher.class_name || '' } });
});

router.post('/admin/users/:role/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  const validRoles = ['student', 'teacher'];
  if (!role || !['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Role must be student or teacher.' });
  const table = req.params.role === 'student' ? 'students' : 'teachers';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true, role: role, id: row.id });
});

router.delete('/admin/users/:role/:id', requireAdmin, (req, res) => {
  try {
    if (req.params.role === 'teacher') {
      const notes = db.prepare('SELECT COUNT(*) c FROM notes WHERE teacher_id=?').get(Number(req.params.id)).c;
      if (notes > 0) return res.status(409).json({ error: `This teacher owns ${notes} notes — delete or reassign them first.` });
      db.prepare('DELETE FROM teachers WHERE id=?').run(Number(req.params.id));
    } else if (req.params.role === 'student') {
      db.prepare('DELETE FROM students WHERE id=?').run(Number(req.params.id));
    } else return res.status(400).json({ error: 'Invalid role.' });
    logActivity('admin', req.session.adminId, 'user.delete', `${req.params.role} ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'Cannot delete: this user still has linked records.' });
  }
});

// ---------- Teacher → section (department) assignments ----------
// Admin chooses every section a teacher teaches; a teacher can teach any number of them (all possible).
router.get('/admin/teacher-sections/:teacherId', requireAdmin, (req, res) => {
  const id = Number(req.params.teacherId);
  const rows = db.prepare(`SELECT d.id, d.name, d.code FROM teacher_sections ts JOIN departments d ON d.id = ts.department_id WHERE ts.teacher_id = ? ORDER BY d.name`).all(id);
  res.json(rows.map(r => ({ id: r.id, name: r.name, code: r.code || '' })));
});
// Replace the whole assignment set — the "choose all sections" picker submits the full list.
router.post('/admin/teacher-sections/:teacherId', requireAdmin, (req, res) => {
  const id = Number(req.params.teacherId);
  const teacher = db.prepare('SELECT id, full_name FROM teachers WHERE id=?').get(id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });
  const raw = (req.body || {}).sectionIds;
  const ids = Array.isArray(raw) ? [...new Set(raw.map(n => Number(n)).filter(Number.isFinite))] : [];
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one section to teach.' });
  const valid = db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids).c;
  if (valid !== ids.length) return res.status(400).json({ error: 'One or more chosen sections are not valid.' });
  db.prepare('DELETE FROM teacher_sections WHERE teacher_id=?').run(id);
  const ins = db.prepare('INSERT INTO teacher_sections (teacher_id, department_id) VALUES (?,?)');
  for (const deptId of ids) ins.run(id, deptId);
  logActivity('admin', req.session.adminId, 'teacher.assignSections', `${teacher.full_name} → ${ids.length} section(s)`);
  res.json({ ok: true, sectionIds: ids, count: ids.length });
});

// ---------- Assign Teachers: create / edit teachers with unique TC codes ----------
function nextTeacherCode() {
  const used = new Set(db.prepare("SELECT teacher_code c FROM teachers WHERE teacher_code IS NOT NULL AND teacher_code<>''").all().map(r => r.c));
  for (let n = 1; n < 100000; n++) {
    const code = 'TC' + String(n).padStart(3, '0');
    if (!used.has(code)) return code;
  }
  throw new Error('Teacher code space exhausted.');
}

// List + search teachers (codes and subjects included).
router.get('/admin/assign-teachers', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const schoolId = getAdminSchoolId(req);
  let rows = db.prepare(TEACHER_Q + ' ORDER BY t.teacher_code, t.id').all();
  if (schoolId) rows = rows.filter(r => Number(r.school_id) === schoolId);
  let teachers = rows.map(t => Object.assign(teacherStats(t), {
    teacherCode: t.teacher_code || '', subject: t.subject || '',
    phone: t.phone || '',
  }));
  if (teachers.length) {
    const ids = teachers.map(t => t.id);
    const secRows = db.prepare(`SELECT ts.teacher_id, d.id AS id, d.name, d.code FROM teacher_sections ts JOIN departments d ON d.id = ts.department_id WHERE ts.teacher_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byTeacher = {};
    for (const r of secRows) { (byTeacher[r.teacher_id] = byTeacher[r.teacher_id] || []).push({ id: r.id, name: r.name, code: r.code || '' }); }
    for (const t of teachers) t.sections = byTeacher[t.id] || [];
  }
  if (q) teachers = teachers.filter(t =>
    (t.fullName + ' ' + t.username + ' ' + t.subject + ' ' + t.teacherCode + ' ' + (t.phone || '')).toLowerCase().includes(q));
  res.json({ teachers });
});

// Create a teacher — password is hashed. The admin may type the teacher's real TC code
// (defaults to auto TC001…), the school by name, and a +250 phone number.
router.post('/admin/assign-teachers', requireAdmin, async (req, res) => {
  const { fullName, username, subject, tempPassword, district, schoolName, teacherCode, phone, email, sectionIds } = req.body || {};
  const name = String(fullName || '').trim();
  const user = String(username || '').trim();
  const subj = String(subject || '').trim();
  const temp = String(tempPassword || '');
  if (!name || !user || !subj) return res.status(400).json({ error: 'Name, username and subject are all required.' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(user)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (temp.length < 6) return res.status(400).json({ error: 'Temporary password must be at least 6 characters.' });
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return res.status(400).json({ error: 'Teacher email is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return res.status(400).json({ error: 'Enter a valid email address, e.g. teacher@school.rw.' });
  const dupMail = db.prepare('SELECT id FROM teachers WHERE email=? COLLATE NOCASE').get(mail);
  if (dupMail) return res.status(409).json({ error: 'That email is already used by another teacher.' });
  if (db.prepare('SELECT id FROM teachers WHERE username=? COLLATE NOCASE').get(user)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const tel = normalizePhone(phone);
  if (phone && !tel) return res.status(400).json({ error: 'Phone must be a Rwandan number like +2507XXXXXXXX.' });
  const sectionList = Array.isArray(sectionIds) ? [...new Set(sectionIds.map(n => Number(n)).filter(Number.isFinite))] : [];
  if (!sectionList.length) return res.status(400).json({ error: 'Choose at least one section the teacher will teach.' });
  const validSections = db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE id IN (${sectionList.map(() => '?').join(',')})`).get(...sectionList).c;
  if (validSections !== sectionList.length) return res.status(400).json({ error: 'One or more chosen sections are not valid.' });
  const school = resolveSchool(district, schoolName);
  if (!school) return res.status(400).json({ error: 'Enter the name of the school the teacher works at (min. 3 characters).' });
  // TC code: use the one the admin typed, or auto-generate the next free TC###.
  let code = String(teacherCode || '').trim().toUpperCase();
  if (code) {
    if (!/^TC[A-Z0-9-]{2,10}$/.test(code)) return res.status(400).json({ error: 'TC code must look like TC001 (letters/digits, starts with TC).' });
    if (db.prepare('SELECT id FROM teachers WHERE teacher_code=?').get(code)) {
      return res.status(409).json({ error: 'That TC code is already assigned to another teacher.' });
    }
  } else {
    code = nextTeacherCode();
  }
  const hash = await bcrypt.hash(temp, 12);
  const info = db.prepare('INSERT INTO teachers (full_name, username, school_id, email, phone, password_hash, teacher_code, subject) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, user, school.id, mail || null, tel || null, hash, code, subj);
  const insSection = db.prepare('INSERT INTO teacher_sections (teacher_id, department_id) VALUES (?,?)');
  for (const deptId of sectionList) insSection.run(Number(info.lastInsertRowid), deptId);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(info.lastInsertRowid);
  createNotification('teacher', row.id, 'announcements', 'Welcome to APALINK',
    'Your teacher account was created by the administrator. Sign in with your username and temporary password, then change it.',
    '/pages/announcements.html');
  logActivity('admin', req.session.adminId, 'teacher.create', `${code} ${user}`);
  res.status(201).json(Object.assign(teacherStats(db.prepare(TEACHER_Q + ' WHERE t.id=?').get(row.id)), {
    teacherCode: code, subject: subj,
  }));
});

// Edit a teacher (name, username, subject, school, phone, TC code). Uniqueness enforced.
router.patch('/admin/assign-teachers/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Teacher not found.' });
  const { fullName, username, subject, tempPassword, district, schoolName, teacherCode, phone, email, sectionIds } = req.body || {};
  const name = fullName !== undefined ? String(fullName || '').trim() : row.full_name;
  const user = username !== undefined ? String(username || '').trim() : row.username;
  const subj = subject !== undefined ? String(subject || '').trim() : (row.subject || '');
  if (!name || !user || !subj) return res.status(400).json({ error: 'Name, username and subject are all required.' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(user)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  const dup = db.prepare('SELECT id FROM teachers WHERE username=? COLLATE NOCASE').get(user);
  if (dup && dup.id !== id) return res.status(409).json({ error: 'That username is already taken.' });
  // Email: optional on edit, but must stay valid and unique when changed.
  let mail = row.email || '';
  if (email !== undefined) {
    mail = String(email || '').trim().toLowerCase();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return res.status(400).json({ error: 'Enter a valid email address, e.g. teacher@school.rw.' });
    const dupMail = db.prepare('SELECT id FROM teachers WHERE email=? COLLATE NOCASE').get(mail);
    if (mail && dupMail && dupMail.id !== id) return res.status(409).json({ error: 'That email is already used by another teacher.' });
  }
  // Optional updates: TC code, school, phone.
  let code = row.teacher_code;
  if (teacherCode !== undefined) {
    code = String(teacherCode || '').trim().toUpperCase();
    if (code) {
      if (!/^TC[A-Z0-9-]{2,10}$/.test(code)) return res.status(400).json({ error: 'TC code must look like TC001.' });
      const dupCode = db.prepare('SELECT id FROM teachers WHERE teacher_code=?').get(code);
      if (dupCode && dupCode.id !== id) return res.status(409).json({ error: 'That TC code is already assigned.' });
    }
  }
  let tel = row.phone || null;
  if (phone !== undefined) {
    tel = normalizePhone(phone);
    if (phone && !tel) return res.status(400).json({ error: 'Phone must be a Rwandan number like +2507XXXXXXXX.' });
  }
  let schoolId = row.school_id;
  if (schoolName !== undefined) {
    const school = resolveSchool(district !== undefined ? district : '', schoolName);
    if (schoolName && !school) return res.status(400).json({ error: 'Enter the school name (min. 3 characters).' });
    schoolId = school ? school.id : schoolId;
  }
  let hash = row.password_hash;
  const temp = String(tempPassword || '');
  if (temp) {
    if (temp.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    hash = await bcrypt.hash(temp, 12);
  }
  db.prepare('UPDATE teachers SET full_name=?, username=?, subject=?, email=?, teacher_code=?, phone=?, school_id=?, password_hash=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(name, user, subj, mail || null, code, tel || null, schoolId, hash, id);
  if (sectionIds !== undefined) {
    const sectionList = Array.isArray(sectionIds) ? [...new Set(sectionIds.map(n => Number(n)).filter(Number.isFinite))] : [];
    if (!sectionList.length) return res.status(400).json({ error: 'Choose at least one section the teacher will teach.' });
    const validSections = db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE id IN (${sectionList.map(() => '?').join(',')})`).get(...sectionList).c;
    if (validSections !== sectionList.length) return res.status(400).json({ error: 'One or more chosen sections are not valid.' });
    db.prepare('DELETE FROM teacher_sections WHERE teacher_id=?').run(id);
    const insSection = db.prepare('INSERT INTO teacher_sections (teacher_id, department_id) VALUES (?,?)');
    for (const deptId of sectionList) insSection.run(id, deptId);
  }
  logActivity('admin', req.session.adminId, 'teacher.update', `${code} ${user}`);
  res.json(Object.assign(teacherStats(db.prepare(TEACHER_Q + ' WHERE t.id=?').get(id)), {
    teacherCode: code || '', subject: subj,
  }));
});

// Reset a teacher's password to a new temporary one (hashed).
router.post('/admin/assign-teachers/:id/reset-password', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Teacher not found.' });
  const temp = String((req.body || {}).newPassword || '');
  if (temp.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  db.prepare('UPDATE teachers SET password_hash=?, updated_at=datetime(\'now\') WHERE id=?').run(await bcrypt.hash(temp, 12), id);
  logActivity('admin', req.session.adminId, 'teacher.resetPassword', `${row.teacher_code} ${row.username}`);
  res.json({ ok: true });
});

// Activate / deactivate a teacher.
router.post('/admin/assign-teachers/:id/active', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Teacher not found.' });
  const active = req.body && req.body.active ? 1 : 0;
  db.prepare('UPDATE teachers SET is_active=?, updated_at=datetime(\'now\') WHERE id=?').run(active, id);
  logActivity('admin', req.session.adminId, 'teacher.active', `${row.teacher_code} → ${active ? 'active' : 'deactivated'}`);
  res.json({ ok: true, active: !!active });
});

// ---------- Notes: full admin control ----------
router.get('/admin/notes', requireAdmin, (req, res) => {
  const schoolId = getAdminSchoolId(req);
  const rows = db.prepare(`SELECT n.*, d.name AS department, l.name AS level, t.full_name AS teacher,
    nf.file_name AS file_name, nf.file_size AS file_size,
    (SELECT COUNT(*) FROM note_downloads dl WHERE dl.note_id=n.id) AS downloads
    FROM notes n JOIN departments d ON d.id=n.department_id JOIN academic_levels l ON l.id=n.academic_level_id
    JOIN teachers t ON t.id=n.teacher_id
    LEFT JOIN note_files nf ON nf.id=(SELECT id FROM note_files WHERE note_id=n.id ORDER BY id LIMIT 1)
    WHERE (${schoolId ? 't.school_id = ?' : '1=1'})
    ORDER BY n.created_at DESC LIMIT 200`).all(schoolId ? [schoolId] : []);
  res.json(rows.map(n => ({
    id: n.id, title: n.title, description: n.description, subject: n.subject || '',
    department: n.department, level: n.level, className: n.class_name || '', teacher: n.teacher,
    fileName: n.file_name || '', fileSize: n.file_size || 0,
    isPublished: !!n.is_published, downloads: n.downloads, createdAt: n.created_at,
  })));
});
router.post('/admin/notes/:id/publish', requireAdmin, (req, res) => {
  db.prepare('UPDATE notes SET is_published=?, updated_at=datetime(\'now\') WHERE id=?').run(req.body && req.body.published ? 1 : 0, Number(req.params.id));
  logActivity('admin', req.session.adminId, 'note.publishToggle', `note ${req.params.id}`);
  res.json({ ok: true });
});
router.delete('/admin/notes/:id', requireAdmin, (req, res) => {
  const files = db.prepare('SELECT file_path FROM note_files WHERE note_id=?').all(Number(req.params.id));
  db.prepare('DELETE FROM notes WHERE id=?').run(Number(req.params.id));
  for (const f of files) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(f.file_path))); } catch {} }
  logActivity('admin', req.session.adminId, 'note.delete', `note ${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Conversations: read + moderate everything ----------
router.get('/admin/conversations', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.is_hidden=0) AS msg_count,
    (SELECT body FROM messages m WHERE m.conversation_id=c.id AND m.is_hidden=0 ORDER BY id DESC LIMIT 1) AS last_body
    FROM conversations c ORDER BY c.updated_at DESC LIMIT 100`).all();
  const names = { student: new Map(), teacher: new Map() };
  for (const [role, table] of [['student', 'students'], ['teacher', 'teachers']]) {
    for (const r of db.prepare(`SELECT id, full_name, username FROM ${table}`).all()) names[role].set(r.id, r);
  }
  res.json(rows.map(c => {
    const parts = db.prepare('SELECT participant_role, participant_id FROM conversation_participants WHERE conversation_id=?').all(c.id)
      .map(p => ({ ...p, user: names[p.participant_role].get(p.participant_id) || null }));
    return { id: c.id, updatedAt: c.updated_at, messageCount: c.msg_count, lastBody: c.last_body || '', participants: parts };
  }));
});
router.get('/admin/conversations/:id/messages', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC LIMIT 300').all(Number(req.params.id));
  res.json(rows.map(m => ({
    id: m.id, senderRole: m.sender_role, senderId: m.sender_id, body: m.body, hidden: !!m.is_hidden, createdAt: m.created_at,
  })));
});
router.post('/admin/messages/:id/hide', requireAdmin, (req, res) => {
  db.prepare('UPDATE messages SET is_hidden=1 WHERE id=?').run(Number(req.params.id));
  logActivity('admin', req.session.adminId, 'message.hide', `message ${req.params.id}`);
  res.json({ ok: true });
});
router.delete('/admin/messages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id));
  logActivity('admin', req.session.adminId, 'message.delete', `message ${req.params.id}`);
  res.json({ ok: true });
});
router.delete('/admin/conversations/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM conversations WHERE id=?').run(Number(req.params.id));
  logActivity('admin', req.session.adminId, 'conversation.delete', `conversation ${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Admin <-> user direct messages ----------
function personOf(role, id) {
  const table = role === 'student' ? 'students' : role === 'teacher' ? 'teachers' : null;
  if (!table) return null;
  const row = db.prepare(`SELECT id, full_name, username, is_active FROM ${table} WHERE id=?`).get(id);
  return row ? { role, id: row.id, fullName: row.full_name, username: row.username, active: !!row.is_active } : null;
}

router.get('/admin/message-threads', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT user_role, user_id, MAX(id) AS last_id,
      SUM(CASE WHEN sender_role<>'admin' AND is_read_by_admin=0 THEN 1 ELSE 0 END) AS unread
    FROM admin_messages GROUP BY user_role, user_id ORDER BY last_id DESC`).all();
  res.json(rows.map(r => {
    const user = personOf(r.user_role, r.user_id);
    const last = db.prepare('SELECT body, sender_role, created_at FROM admin_messages WHERE id=?').get(r.last_id);
    return {
      user, unread: Number(r.unread) || 0,
      lastMessage: last ? { body: last.body, fromAdmin: last.sender_role === 'admin', createdAt: last.created_at } : null,
    };
  }).filter(t => t.user));
});

router.get('/admin/message-threads/:role/:id', requireAdmin, (req, res) => {
  const user = personOf(req.params.role, Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const msgs = db.prepare('SELECT * FROM admin_messages WHERE user_role=? AND user_id=? ORDER BY id ASC LIMIT 300').all(user.role, user.id);
  db.prepare('UPDATE admin_messages SET is_read_by_admin=1 WHERE user_role=? AND user_id=? AND sender_role<>?').run(user.role, user.id, 'admin');
  res.json({
    user,
    messages: msgs.map(m => ({ id: m.id, senderRole: m.sender_role, body: m.body, createdAt: m.created_at, mine: m.sender_role === 'admin' })),
  });
});

router.post('/admin/message-threads/:role/:id', requireAdmin, (req, res) => {
  const user = personOf(req.params.role, Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const body = String((req.body || {}).body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  const adminId = req.session.adminId;
  const info = db.prepare(`INSERT INTO admin_messages (admin_id, user_role, user_id, sender_role, body, is_read_by_admin, is_read_by_user)
    VALUES (?,?,?,?,?,1,0)`).run(adminId, user.role, user.id, 'admin', body);
  createNotification(user.role, user.id, 'messages', 'Message from school administration', body.slice(0, 160), '/pages/messages.html');
  hub.push(user.role, user.id, { type: 'admin-message', userId: user.id });
  logActivity('admin', adminId, 'admin.message', `${user.role} ${user.id}: ${body.slice(0, 80)}`);
  const msg = db.prepare('SELECT * FROM admin_messages WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ id: msg.id, senderRole: 'admin', body: msg.body, createdAt: msg.created_at, mine: true });
});

module.exports = router;
