// APALINK global dashboard search — notes, people and announcements.
// Results always respect the same access rules as the rest of the app.
const express = require('express');
const db = require('../database/db');
const { resolveUser } = require('../lib/helpers');

const router = express.Router();

function requireAuth(req, res, next) {
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  next();
}

router.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ notes: [], users: [], announcements: [] });
  const like = '%' + q.replace(/[%_]/g, m => '\\' + m) + '%';
  const notes = [];
  const users = [];
  const announcements = [];

  if (req.user.role === 'student') {
    const s = db.prepare('SELECT * FROM students WHERE id=?').get(req.user.id);
    const rows = db.prepare(`SELECT n.id, n.title, n.subject, n.class_name, n.description,
        d.name AS department, l.name AS level, t.full_name AS teacher_name,
        (SELECT COUNT(*) FROM note_downloads dl WHERE dl.note_id=n.id) AS downloads
      FROM notes n JOIN departments d ON d.id=n.department_id JOIN academic_levels l ON l.id=n.academic_level_id
      JOIN teachers t ON t.id=n.teacher_id
      WHERE n.is_published=1 AND n.department_id=? AND n.academic_level_id=?
        AND (n.class_name='' OR n.class_name=? COLLATE NOCASE)
        AND (n.title LIKE ? ESCAPE '\\' OR n.subject LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR t.full_name LIKE ? ESCAPE '\\')
      ORDER BY n.created_at DESC LIMIT 10`).all(s.section_id, s.level_id, s.class_name || '', like, like, like, like);
    notes.push(...rows.map(n => ({ id: n.id, title: n.title, subject: n.subject, className: n.class_name, department: n.department, level: n.level, teacherName: n.teacher_name, downloads: n.downloads, url: 'preview.html?note=' + n.id })));

    const studentRows = db.prepare(`SELECT s.id, s.full_name, s.username, s.class_name, d.name AS department, l.name AS level,
        sc.name AS school_name, sc.district
      FROM students s LEFT JOIN departments d ON d.id=s.section_id LEFT JOIN academic_levels l ON l.id=s.level_id
      LEFT JOIN schools sc ON sc.id=s.school_id
      WHERE s.is_active=1 AND s.id<>? AND (s.full_name LIKE ? ESCAPE '\\' OR s.username LIKE ? ESCAPE '\\')
      LIMIT 8`).all(s.id, like, like);
    const teacherRows = db.prepare(`SELECT t.id, t.full_name, t.username, sc.name AS school_name, sc.district
      FROM teachers t LEFT JOIN schools sc ON sc.id=t.school_id
      WHERE t.is_active=1 AND (t.full_name LIKE ? ESCAPE '\\' OR t.username LIKE ? ESCAPE '\\') LIMIT 8`).all(like, like);
    users.push(...studentRows.map(u => ({ id: u.id, role: 'student', fullName: u.full_name, username: u.username, detail: [u.department, u.level, u.class_name ? 'Class ' + u.class_name : ''].filter(Boolean).join(' · '), school: [u.school_name, u.district].filter(Boolean).join(' · ') })));
    users.push(...teacherRows.map(u => ({ id: u.id, role: 'teacher', fullName: u.full_name, username: u.username, detail: 'Teacher', school: [u.school_name, u.district].filter(Boolean).join(' · ') })));

    const annRows = db.prepare(`SELECT a.id, a.title, a.category, a.body FROM announcements a
      WHERE a.is_published=1 AND (a.audience='all' OR a.audience='students')
        AND (a.school_id IS NULL OR a.school_id=?)
        AND (a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\') ORDER BY a.created_at DESC LIMIT 5`).all(s.school_id || -1, like, like);
    announcements.push(...annRows);
  } else if (req.user.role === 'teacher') {
    const rows = db.prepare(`SELECT n.id, n.title, n.subject, n.class_name, d.name AS department, l.name AS level,
        (SELECT COUNT(*) FROM note_downloads dl WHERE dl.note_id=n.id) AS downloads
      FROM notes n JOIN departments d ON d.id=n.department_id JOIN academic_levels l ON l.id=n.academic_level_id
      WHERE n.teacher_id=? AND (n.title LIKE ? ESCAPE '\\' OR n.subject LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\')
      ORDER BY n.created_at DESC LIMIT 10`).all(req.user.id, like, like, like);
    notes.push(...rows.map(n => ({ id: n.id, title: n.title, subject: n.subject, className: n.class_name, department: n.department, level: n.level, teacherName: 'You', downloads: n.downloads, url: 'preview.html?note=' + n.id })));

    const studentRows = db.prepare(`SELECT s.id, s.full_name, s.username, s.class_name, d.name AS department, l.name AS level,
        sc.name AS school_name, sc.district
      FROM students s LEFT JOIN departments d ON d.id=s.section_id LEFT JOIN academic_levels l ON l.id=s.level_id
      LEFT JOIN schools sc ON sc.id=s.school_id
      WHERE s.is_active=1 AND (s.full_name LIKE ? ESCAPE '\\' OR s.username LIKE ? ESCAPE '\\') LIMIT 8`).all(like, like);
    const teacherRows = db.prepare(`SELECT t.id, t.full_name, t.username, sc.name AS school_name, sc.district
      FROM teachers t LEFT JOIN schools sc ON sc.id=t.school_id
      WHERE t.is_active=1 AND t.id<>? AND (t.full_name LIKE ? ESCAPE '\\' OR t.username LIKE ? ESCAPE '\\') LIMIT 8`).all(req.user.id, like, like);
    users.push(...studentRows.map(u => ({ id: u.id, role: 'student', fullName: u.full_name, username: u.username, detail: [u.department, u.level, u.class_name ? 'Class ' + u.class_name : ''].filter(Boolean).join(' · '), school: [u.school_name, u.district].filter(Boolean).join(' · ') })));
    users.push(...teacherRows.map(u => ({ id: u.id, role: 'teacher', fullName: u.full_name, username: u.username, detail: 'Teacher', school: [u.school_name, u.district].filter(Boolean).join(' · ') })));

    const teacherMe = db.prepare('SELECT school_id FROM teachers WHERE id=?').get(req.user.id);
    const annRows = db.prepare(`SELECT a.id, a.title, a.category, a.body FROM announcements a
      WHERE a.is_published=1 AND (a.audience='all' OR a.audience='teachers')
        AND (a.school_id IS NULL OR a.school_id=?)
        AND (a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\') ORDER BY a.created_at DESC LIMIT 5`).all((teacherMe && teacherMe.school_id) || -1, like, like);
    announcements.push(...annRows);
  } else {
    // Admin search covers the whole app.
    const rows = db.prepare(`SELECT n.id, n.title, n.subject, n.class_name, d.name AS department, l.name AS level, t.full_name AS teacher_name,
        (SELECT COUNT(*) FROM note_downloads dl WHERE dl.note_id=n.id) AS downloads
      FROM notes n JOIN departments d ON d.id=n.department_id JOIN academic_levels l ON l.id=n.academic_level_id
      JOIN teachers t ON t.id=n.teacher_id
      WHERE (n.title LIKE ? ESCAPE '\\' OR n.subject LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR t.full_name LIKE ? ESCAPE '\\')
      ORDER BY n.created_at DESC LIMIT 10`).all(like, like, like, like);
    notes.push(...rows.map(n => ({ id: n.id, title: n.title, subject: n.subject, className: n.class_name, department: n.department, level: n.level, teacherName: n.teacher_name, downloads: n.downloads, admin: true })));

    const studentRows = db.prepare(`SELECT s.id, s.full_name, s.username, s.class_name, d.name AS department, l.name AS level, sc.name AS school_name, sc.district
      FROM students s LEFT JOIN departments d ON d.id=s.section_id LEFT JOIN academic_levels l ON l.id=s.level_id
      LEFT JOIN schools sc ON sc.id=s.school_id
      WHERE (s.full_name LIKE ? ESCAPE '\\' OR s.username LIKE ? ESCAPE '\\') LIMIT 8`).all(like, like);
    const teacherRows = db.prepare(`SELECT t.id, t.full_name, t.username, sc.name AS school_name, sc.district
      FROM teachers t LEFT JOIN schools sc ON sc.id=t.school_id
      WHERE (t.full_name LIKE ? ESCAPE '\\' OR t.username LIKE ? ESCAPE '\\') LIMIT 8`).all(like, like);
    users.push(...studentRows.map(u => ({ id: u.id, role: 'student', fullName: u.full_name, username: u.username, detail: [u.department, u.level, u.class_name ? 'Class ' + u.class_name : ''].filter(Boolean).join(' · '), school: [u.school_name, u.district].filter(Boolean).join(' · ') })));
    users.push(...teacherRows.map(u => ({ id: u.id, role: 'teacher', fullName: u.full_name, username: u.username, detail: 'Teacher', school: [u.school_name, u.district].filter(Boolean).join(' · ') })));

    const annRows = db.prepare(`SELECT id, title, category, body FROM announcements
      WHERE (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 5`).all(like, like);
    announcements.push(...annRows);
  }

  res.json({ notes, users, announcements });
});

module.exports = router;
