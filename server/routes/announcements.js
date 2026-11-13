// APALINK school announcements + school catalogue management — Milestone 5.
// Admins publish announcements to the whole school, students, or teachers.
const express = require('express');
const db = require('../database/db');
const { resolveUser, createNotification, logActivity, getAdminSchoolId } = require('../lib/helpers');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const CATEGORIES = ['general', 'academic', 'event', 'urgent'];
const AUDIENCES = ['all', 'students', 'teachers'];

function requireAuth(req, res, next) {
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  next();
}
function publicAnnouncement(a) {
  return {
    id: a.id, title: a.title, body: a.body, category: a.category, audience: a.audience,
    schoolId: a.school_id || null, schoolName: a.school_name || '', district: a.school_district || '',
    departmentId: a.department_id || null, levelId: a.level_id || null, className: a.class_name || '',
    isPinned: !!a.is_pinned, isPublished: !!a.is_published, createdBy: a.created_by,
    createdAt: a.created_at, updatedAt: a.updated_at,
  };
}
const ANN_Q = `SELECT a.*, s.name AS school_name, s.district AS school_district
  FROM announcements a LEFT JOIN schools s ON s.id = a.school_id`;

// Announcement targets one class (dept + level + class name) — only that class sees it.
function classMatches(a, me, role) {
  if (a.department_id == null) return true;           // class-less announcements for everyone
  if (!me || role !== 'student') return false;        // teachers/admins don't sit in student classes
  return Number(a.department_id) === me.section_id
    && Number(a.level_id) === me.level_id
    && String(a.class_name || '') === String(me.class_name || '');
}

// Admin types a school name (no dropdown): match an active school by name,
// otherwise create the catalogue entry so the announcement can target it.
function schoolByName(raw) {
  const name = String(raw || '').trim();
  if (name.length < 3 || name.length > 120) return null;
  const found = db.prepare('SELECT id FROM schools WHERE name=? COLLATE NOCASE AND is_active=1 ORDER BY id LIMIT 1').get(name);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO schools (name, district, sector) VALUES (?,?,?)').run(name, 'Unknown', '').lastInsertRowid);
}

// Users see announcements that are published, addressed to their role, and for their school
// (global announcements have school_id = NULL).
router.get('/announcements', requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(db.prepare(ANN_Q + ' ORDER BY a.is_pinned DESC, a.created_at DESC').all().map(publicAnnouncement));
  }
  const roleAudience = req.user.role === 'student' ? 'students' : 'teachers';
  let rows = db.prepare(ANN_Q + ` WHERE a.is_published=1 AND (a.audience='all' OR a.audience=?)
    ORDER BY a.is_pinned DESC, a.created_at DESC`).all(roleAudience);
  const table = req.user.role === 'student' ? 'students' : 'teachers';
  const me = req.user.role === 'student'
    ? db.prepare('SELECT school_id, section_id, level_id, class_name FROM students WHERE id=?').get(req.user.id)
    : db.prepare('SELECT school_id, NULL AS section_id, NULL AS level_id, NULL AS class_name FROM teachers WHERE id=?').get(req.user.id);
  const schoolId = me ? me.school_id : null;
  rows = rows.filter(a => (a.school_id == null || a.school_id === schoolId) && classMatches(a, me, req.user.role));
  res.json(rows.map(publicAnnouncement));
});

// Latest for the overview widget.
router.get('/announcements/latest', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.json([]);
  const roleAudience = req.user.role === 'student' ? 'students' : 'teachers';
  let rows = db.prepare(ANN_Q + ` WHERE a.is_published=1 AND (a.audience='all' OR a.audience=?)
    ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 5`).all(roleAudience);
  const table = req.user.role === 'student' ? 'students' : 'teachers';
  const me = req.user.role === 'student'
    ? db.prepare('SELECT school_id, section_id, level_id, class_name FROM students WHERE id=?').get(req.user.id)
    : db.prepare('SELECT school_id, NULL AS section_id, NULL AS level_id, NULL AS class_name FROM teachers WHERE id=?').get(req.user.id);
  const schoolId = me ? me.school_id : null;
  rows = rows.filter(a => (a.school_id == null || a.school_id === schoolId) && classMatches(a, me, req.user.role));
  res.json(rows.map(publicAnnouncement));
});

// ---------- Admin management ----------
router.get('/admin/announcements', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const schoolId = getAdminSchoolId(req);
  let rows = db.prepare(ANN_Q + ' ORDER BY a.is_pinned DESC, a.created_at DESC').all().map(publicAnnouncement);
  if (schoolId) rows = rows.filter(a => Number(a.school_id) === schoolId || !a.school_id);
  if (q) rows = rows.filter(a => (a.title + ' ' + a.body + ' ' + a.category + ' ' + a.audience + ' ' + a.schoolName).toLowerCase().includes(q));
  res.json(rows);
});

function notifyAudience(a) {
  if (!a.is_published) return 0;
  let count = 0;
  if (a.audience === 'all' || a.audience === 'students') {
    const students = a.school_id
      ? db.prepare('SELECT id FROM students WHERE is_active=1 AND school_id=?').all(a.school_id)
      : db.prepare('SELECT id FROM students WHERE is_active=1').all();
    for (const s of students) count += createNotification('student', s.id, 'announcements', a.title, a.body.slice(0, 160), '/pages/announcements.html');
  }
  if (a.audience === 'all' || a.audience === 'teachers') {
    const teachers = a.school_id
      ? db.prepare('SELECT id FROM teachers WHERE is_active=1 AND school_id=?').all(a.school_id)
      : db.prepare('SELECT id FROM teachers WHERE is_active=1').all();
    for (const t of teachers) count += createNotification('teacher', t.id, 'announcements', a.title, a.body.slice(0, 160), '/pages/announcements.html');
  }
  return count;
}

router.post('/admin/announcements', requireAdmin, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  const category = CATEGORIES.includes(b.category) ? b.category : 'general';
  const audience = AUDIENCES.includes(b.audience) ? b.audience : 'all';
  if (!title) return res.status(400).json({ error: 'Announcement title is required.' });
  if (!body) return res.status(400).json({ error: 'Announcement message is required.' });
  let schoolId = b.schoolId === undefined || b.schoolId === null || b.schoolId === '' ? null : Number(b.schoolId);
  if (schoolId) {
    const sc = db.prepare('SELECT id FROM schools WHERE id=? AND is_active=1').get(schoolId);
    if (!sc) return res.status(400).json({ error: 'Please choose a valid school.' });
  } else if (b.schoolName && String(b.schoolName).trim()) {
    schoolId = schoolByName(b.schoolName);
    if (!schoolId) return res.status(400).json({ error: 'School name must be 3–120 characters.' });
  }
  const info = db.prepare(`INSERT INTO announcements (title, body, category, audience, school_id, is_pinned, is_published, created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(title.slice(0, 180), body.slice(0, 5000), category, audience, schoolId,
      b.isPinned ? 1 : 0, b.isPublished === false ? 0 : 1, req.session.adminId);
  const a = db.prepare(ANN_Q + ' WHERE a.id=?').get(info.lastInsertRowid);
  const notified = notifyAudience(a);
  logActivity('admin', req.session.adminId, 'announcement.create', `${title} · ${audience} · notified ${notified}`);
  res.status(201).json(publicAnnouncement(a));
});

router.patch('/admin/announcements/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
  if (!a) return res.status(404).json({ error: 'Announcement not found.' });
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title).trim().slice(0, 180) : a.title;
  const body = b.body !== undefined ? String(b.body).trim().slice(0, 5000) : a.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
  const category = CATEGORIES.includes(b.category) ? b.category : a.category;
  const audience = AUDIENCES.includes(b.audience) ? b.audience : a.audience;
  let schoolId = a.school_id;
  if (b.schoolId !== undefined) {
    schoolId = b.schoolId === null || b.schoolId === '' ? null : Number(b.schoolId);
    if (schoolId && !db.prepare('SELECT id FROM schools WHERE id=? AND is_active=1').get(schoolId)) {
      return res.status(400).json({ error: 'Please choose a valid school.' });
    }
  } else if (b.schoolName !== undefined) {
    const typed = String(b.schoolName || '').trim();
    if (!typed) schoolId = null;
    else {
      schoolId = schoolByName(typed);
      if (!schoolId) return res.status(400).json({ error: 'School name must be 3–120 characters.' });
    }
  }
  const isPinned = b.isPinned !== undefined ? (b.isPinned ? 1 : 0) : a.is_pinned;
  const isPublished = b.isPublished !== undefined ? (b.isPublished ? 1 : 0) : a.is_published;
  db.prepare(`UPDATE announcements SET title=?, body=?, category=?, audience=?, school_id=?, is_pinned=?, is_published=?,
    updated_at=datetime('now') WHERE id=?`).run(title, body, category, audience, schoolId, isPinned, isPublished, id);
  const updated = db.prepare(ANN_Q + ' WHERE a.id=?').get(id);
  if (!a.is_published && isPublished) notifyAudience(updated);
  logActivity('admin', req.session.adminId, 'announcement.update', title);
  res.json(publicAnnouncement(updated));
});

router.delete('/admin/announcements/:id', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Announcement not found.' });
  db.prepare('DELETE FROM announcements WHERE id=?').run(a.id);
  logActivity('admin', req.session.adminId, 'announcement.delete', a.title);
  res.json({ ok: true });
});

// ---------- School catalogue (admin can extend the Rwandan school list) ----------
router.get('/admin/schools', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM students st WHERE st.school_id=s.id) AS students,
    (SELECT COUNT(*) FROM teachers t WHERE t.school_id=s.id) AS teachers
    FROM schools s ORDER BY s.is_active DESC, s.district, s.name`).all()
    .map(s => ({
      id: s.id, name: s.name, district: s.district, sector: s.sector, code: s.code || '',
      students: Number(s.students) || 0, teachers: Number(s.teachers) || 0,
      isActive: !!s.is_active, createdAt: s.created_at,
    }));
  if (q) rows = rows.filter(s => (s.name + ' ' + s.district + ' ' + s.sector + ' ' + s.code).toLowerCase().includes(q));
  res.json(rows);
});
router.post('/admin/schools', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const district = String(b.district || '').trim();
  const sector = String(b.sector || '').trim();
  if (!name || !district) return res.status(400).json({ error: 'School name and district are required.' });
  const dup = db.prepare('SELECT id FROM schools WHERE name=? COLLATE NOCASE AND district=? COLLATE NOCASE').get(name, district);
  if (dup) return res.status(400).json({ error: 'That school already exists in this district.' });
  const info = db.prepare('INSERT INTO schools (name, district, sector) VALUES (?,?,?)').run(name.slice(0, 160), district.slice(0, 80), sector.slice(0, 80));
  logActivity('admin', req.session.adminId, 'school.create', `${name} (${district})`);
  res.status(201).json({ id: info.lastInsertRowid, name, district, sector, code: '', students: 0, teachers: 0, isActive: true });
});
// Rename / move a school (name, district, sector).
router.patch('/admin/schools/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM schools WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'School not found.' });
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name || '').trim() : row.name;
  const district = b.district !== undefined ? String(b.district || '').trim() : row.district;
  const sector = b.sector !== undefined ? String(b.sector || '').trim() : (row.sector || '');
  if (!name || !district) return res.status(400).json({ error: 'School name and district are required.' });
  const dup = db.prepare('SELECT id FROM schools WHERE name=? COLLATE NOCASE AND district=? COLLATE NOCASE AND id<>?').get(name, district, id);
  if (dup) return res.status(400).json({ error: 'That school already exists in this district.' });
  db.prepare('UPDATE schools SET name=?, district=?, sector=? WHERE id=?').run(name.slice(0, 160), district.slice(0, 80), sector.slice(0, 80), id);
  logActivity('admin', req.session.adminId, 'school.update', `${name} (${district})`);
  res.json({ id, name, district, sector });
});
router.post('/admin/schools/:id/active', requireAdmin, (req, res) => {
  const active = req.body && req.body.active ? 1 : 0;
  const info = db.prepare('UPDATE schools SET is_active=? WHERE id=?').run(active, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'School not found.' });
  logActivity('admin', req.session.adminId, 'school.active', `${req.params.id} → ${active ? 'active' : 'inactive'}`);
  res.json({ ok: true });
});

module.exports = router;
