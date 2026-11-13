// APALINK timetable router — Milestone 3.
// Admin manages official timetables class-by-class; students/teachers read their own.
// Table: timetable_documents (one per class scope) + timetable_entries (weekly editor).
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../database/db');
const { requireAdmin, requireStudent, requireTeacher } = require('../middleware/auth');
const { createNotification, logActivity, resolveUser, getAdminSchoolId } = require('../lib/helpers');

const router = express.Router();
const TT_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'timetables');
const TT_EXTS = ['.pdf', '.png', '.jpg', '.jpeg'];
const TT_MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(TT_DIR, { recursive: true }); cb(null, TT_DIR); },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!TT_EXTS.includes(path.extname(file.originalname).toLowerCase())) return cb(new Error('Timetable file must be PDF, PNG, JPG or JPEG.'));
    cb(null, true);
  },
});

const DOC_Q = `SELECT d.*, dep.name AS department, l.name AS level, p.name AS period,
  (SELECT COUNT(*) FROM timetable_entries e WHERE e.document_id=d.id) AS entry_count
  FROM timetable_documents d JOIN departments dep ON dep.id=d.department_id
  JOIN academic_levels l ON l.id=d.academic_level_id
  LEFT JOIN academic_periods p ON p.id=d.period_id`;

function publicDoc(d) {
  return {
    id: d.id, title: d.title, description: d.description, department: d.department, departmentId: d.department_id,
    level: d.level, levelId: d.academic_level_id, className: d.class_name || '', period: d.period || '', periodId: d.period_id,
    fileName: d.file_name || null, fileSize: d.file_size || 0, isPublished: !!d.is_published, isArchived: !!d.is_archived,
    entryCount: d.entry_count || 0, createdAt: d.created_at, updatedAt: d.updated_at,
  };
}
function getDoc(id) { return db.prepare(DOC_Q + ' WHERE d.id=?').get(id); }
function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
function overlaps(aStart, aEnd, bStart, bEnd) { return toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd); }

function checkConflicts(doc, entry, excludeId) {
  const conflicts = [];
  const rows = db.prepare(`SELECT e.* FROM timetable_entries e
    JOIN timetable_documents d ON d.id=e.document_id
    WHERE d.department_id=? AND d.academic_level_id=? AND d.class_name=?
      AND (d.period_id IS ? OR d.period_id=?)
      AND e.day_of_week=? AND e.id IS NOT ?`).all(doc.department_id, doc.academic_level_id, doc.class_name, doc.period_id, doc.period_id, entry.day_of_week, excludeId || -1);
  for (const r of rows) {
    if (!overlaps(entry.start_time, entry.end_time, r.start_time, r.end_time)) continue;
    // Same class overlap (teacher double-booked within this class scope check is covered by same-teacher rule below)
    conflicts.push({ type: 'class', message: `Overlaps with lesson "${r.subject}" (${r.start_time}–${r.end_time}) in this class.` });
    break;
  }
  // Teacher double-booked across any class in the same term
  if (entry.teacher_id) {
    const tRows = db.prepare(`SELECT e.*, d.class_name, dep.name AS department, l.name AS level FROM timetable_entries e
      JOIN timetable_documents d ON d.id=e.document_id JOIN departments dep ON dep.id=d.department_id JOIN academic_levels l ON l.id=d.academic_level_id
      WHERE e.teacher_id=? AND e.day_of_week=? AND (d.period_id IS ? OR d.period_id=?) AND d.id IS NOT ? AND e.id IS NOT ?`)
      .all(entry.teacher_id, entry.day_of_week, doc.period_id, doc.period_id, doc.id, excludeId || -1);
    for (const r of tRows) {
      if (overlaps(entry.start_time, entry.end_time, r.start_time, r.end_time)) {
        conflicts.push({ type: 'teacher', message: `Teacher is already booked at this time in ${r.department} · ${r.level} · Class ${r.class_name}.` });
        break;
      }
    }
  }
  // Classroom double-booked
  if (entry.classroom) {
    const cRows = db.prepare(`SELECT e.*, d.class_name, dep.name AS department, l.name AS level FROM timetable_entries e
      JOIN timetable_documents d ON d.id=e.document_id JOIN departments dep ON dep.id=d.department_id JOIN academic_levels l ON l.id=d.academic_level_id
      WHERE UPPER(e.classroom)=UPPER(?) AND e.classroom<>'' AND e.day_of_week=? AND (d.period_id IS ? OR d.period_id=?) AND e.id IS NOT ?`)
      .all(entry.classroom, entry.day_of_week, doc.period_id, doc.period_id, excludeId || -1);
    for (const r of cRows) {
      if (overlaps(entry.start_time, entry.end_time, r.start_time, r.end_time)) {
        conflicts.push({ type: 'room', message: `Room "${entry.classroom}" is already in use in ${r.department} · ${r.level} · Class ${r.class_name} at this time.` });
        break;
      }
    }
  }
  return conflicts;
}

// ============================== ADMIN ==============================
router.get('/admin/overview', requireAdmin, (req, res) => {
  const c = (t) => db.prepare(`SELECT COUNT(*) x FROM ${t}`).get().x;
  res.json({
    counts: { students: c('students'), teachers: c('teachers'), timetables: c('timetable_documents'), published: db.prepare('SELECT COUNT(*) x FROM timetable_documents WHERE is_published=1').get().x, openReports: db.prepare("SELECT COUNT(*) x FROM message_reports WHERE status='open'").get().x },
  });
});

router.get('/admin/periods', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM academic_periods WHERE is_active=1 ORDER BY name').all());
});
router.post('/admin/periods', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Period name is required.' });
  const info = db.prepare('INSERT INTO academic_periods (name) VALUES (?)').run(name);
  res.status(201).json({ period: { id: info.lastInsertRowid, name } });
});

router.get('/admin/teachers', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, full_name AS fullName, username FROM teachers WHERE is_active=1 ORDER BY full_name').all());
});

router.get('/admin/timetables', requireAdmin, (req, res) => {
  const schoolId = getAdminSchoolId(req);
  const rows = db.prepare(DOC_Q + (schoolId ? ' WHERE d.school_id = ?' : ' ORDER BY d.updated_at DESC') + ' ORDER BY d.updated_at DESC').all(schoolId || undefined).map(publicDoc);
  res.json(rows);
});

router.post('/admin/timetables', requireAdmin, upload.single('file'), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const departmentId = Number(b.departmentId), levelId = Number(b.levelId);
  const className = String(b.className || '').trim().slice(0, 40);
  const periodId = b.periodId ? Number(b.periodId) : null;
  const description = String(b.description || '').trim().slice(0, 1000);
  const fail = (msg) => { if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} } return res.status(400).json({ error: msg }); };
  if (!title) return fail('Timetable title is required.');
  if (!db.prepare('SELECT id FROM departments WHERE id=? AND is_active=1').get(departmentId)) return fail('Choose a valid department.');
  if (!db.prepare('SELECT id FROM academic_levels WHERE id=? AND is_active=1').get(levelId)) return fail('Choose a valid academic level.');
  if (periodId && !db.prepare('SELECT id FROM academic_periods WHERE id=?').get(periodId)) return fail('Choose a valid term/period.');
  const info = db.prepare(`INSERT INTO timetable_documents (title, description, department_id, academic_level_id, class_name, period_id, file_name, file_path, file_size, mime_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(title, description, departmentId, levelId, className, periodId,
      req.file ? req.file.originalname : null, req.file ? req.file.filename : null,
      req.file ? req.file.size : 0, req.file ? (TT_MIME[path.extname(req.file.originalname).toLowerCase()] || '') : '',
      req.session.adminId);
  logActivity('admin', req.session.adminId, 'timetable.create', title);
  res.status(201).json(publicDoc(db.prepare(DOC_Q + ' WHERE d.id=?').get(info.lastInsertRowid)));
});

router.get('/admin/timetables/:id', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  const entries = db.prepare('SELECT * FROM timetable_entries WHERE document_id=? ORDER BY day_of_week, start_time, sort_order').all(doc.id);
  res.json({ ...publicDoc(doc), entries });
});

router.post('/admin/timetables/:id/entries', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  const b = req.body || {};
  const entry = {
    day_of_week: Number(b.dayOfWeek),
    subject: String(b.subject || '').trim().slice(0, 120),
    teacher_id: b.teacherId ? Number(b.teacherId) : null,
    teacher_name: String(b.teacherName || '').trim().slice(0, 120),
    classroom: String(b.classroom || '').trim().slice(0, 60),
    start_time: String(b.startTime || ''), end_time: String(b.endTime || ''),
    is_break: b.isBreak ? 1 : 0, sort_order: Number(b.sortOrder || 0),
  };
  if (!(entry.day_of_week >= 0 && entry.day_of_week <= 6)) return res.status(400).json({ error: 'Day must be 0 (Sunday) – 6 (Saturday).' });
  if (!/^\d{2}:\d{2}$/.test(entry.start_time) || !/^\d{2}:\d{2}$/.test(entry.end_time)) return res.status(400).json({ error: 'Times must be HH:MM.' });
  if (toMin(entry.end_time) <= toMin(entry.start_time)) return res.status(400).json({ error: 'End time must be after start time.' });
  if (entry.teacher_id) {
    const t = db.prepare('SELECT id, full_name FROM teachers WHERE id=?').get(entry.teacher_id);
    if (!t) return res.status(400).json({ error: 'Choose a valid teacher.' });
    entry.teacher_name = t.full_name;
  } else if (!entry.teacher_name && !entry.is_break) return res.status(400).json({ error: 'Teacher is required for lessons.' });
  const conflicts = checkConflicts(doc, entry, null);
  if (conflicts.length && !b.override) return res.status(409).json({ error: 'Schedule conflict detected.', conflicts });
  const info = db.prepare(`INSERT INTO timetable_entries (document_id, day_of_week, subject, teacher_id, teacher_name, classroom, start_time, end_time, is_break, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(doc.id, entry.day_of_week, entry.subject, entry.teacher_id, entry.teacher_name, entry.classroom, entry.start_time, entry.end_time, entry.is_break, entry.sort_order);
  res.status(201).json({ entryId: info.lastInsertRowid, conflicts });
});

router.delete('/admin/timetables/:id/entries/:entryId', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  db.prepare('DELETE FROM timetable_entries WHERE id=? AND document_id=?').run(Number(req.params.entryId), doc.id);
  res.json({ ok: true });
});

router.post('/admin/timetables/:id/publish', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  if (!doc.file_path) {
    const n = db.prepare('SELECT COUNT(*) c FROM timetable_entries WHERE document_id=?').get(doc.id).c;
    if (!n) return res.status(400).json({ error: 'Timetable has no file and no entries yet.' });
  }
  db.prepare("UPDATE timetable_documents SET updated_at=datetime('now') WHERE id=?").run(doc.id);
  // Replace any other published timetable in the same class scope.
  const replaced = db.prepare(`SELECT id FROM timetable_documents WHERE id<>? AND is_published=1 AND department_id=? AND academic_level_id=? AND class_name=? AND (period_id IS ? OR period_id=?)`)
    .all(doc.id, doc.department_id, doc.academic_level_id, doc.class_name, doc.period_id, doc.period_id);
  db.prepare('UPDATE timetable_documents SET is_published=0, updated_at=datetime(\'now\') WHERE id<>? AND is_published=1 AND department_id=? AND academic_level_id=? AND class_name=? AND (period_id IS ? OR period_id=?)')
    .run(doc.id, doc.department_id, doc.academic_level_id, doc.class_name, doc.period_id, doc.period_id);
  db.prepare('UPDATE timetable_documents SET is_published=1, is_archived=0, updated_at=datetime(\'now\') WHERE id=?').run(doc.id);
  // Notify affected students (matching class scope) + teachers in entries.
  const students = db.prepare(`SELECT id FROM students WHERE is_active=1 AND section_id=? AND level_id=? AND (class_name=? COLLATE NOCASE OR ?='')`)
    .all(doc.department_id, doc.academic_level_id, doc.class_name, doc.class_name);
  for (const s of students) createNotification('student', s.id, 'timetable', 'Timetable published', `"${doc.title}" for ${doc.department} · ${doc.level}${doc.class_name ? ' · Class ' + doc.class_name : ''} is now available.`, '/pages/student/timetable.html');
  const teachers = db.prepare('SELECT DISTINCT teacher_id FROM timetable_entries WHERE document_id=? AND teacher_id IS NOT NULL').all(doc.id);
  for (const t of teachers) createNotification('teacher', t.teacher_id, 'timetable', 'Teaching schedule updated', `"${doc.title}" now includes you.`, '/pages/teacher/schedule.html');
  logActivity('admin', req.session.adminId, 'timetable.publish', `${doc.title} (replaced ${replaced.length})`);
  res.json({ ok: true, replaced: replaced.length, notifiedStudents: students.length, notifiedTeachers: teachers.length });
});
router.post('/admin/timetables/:id/unpublish', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  db.prepare("UPDATE timetable_documents SET is_published=0, updated_at=datetime('now') WHERE id=?").run(doc.id);
  res.json({ ok: true });
});
router.post('/admin/timetables/:id/archive', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  db.prepare("UPDATE timetable_documents SET is_published=0, is_archived=1, updated_at=datetime('now') WHERE id=?").run(doc.id);
  res.json({ ok: true });
});
router.delete('/admin/timetables/:id', requireAdmin, (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Timetable not found.' });
  const rows = db.prepare('SELECT file_path FROM timetable_documents WHERE id=? AND file_path IS NOT NULL').all(doc.id);
  db.prepare('DELETE FROM timetable_documents WHERE id=?').run(doc.id);
  for (const r of rows) { try { fs.unlinkSync(path.join(TT_DIR, path.basename(r.file_path))); } catch {} }
  res.json({ ok: true });
});

router.get('/admin/reports', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'open');
  const where = ['open', 'hidden', 'dismissed'].includes(status) ? `WHERE r.status='${status}'` : '';
  const rows = db.prepare(`SELECT r.*, m.body, m.created_at AS message_at, m.is_hidden, m.sender_role, m.sender_id, m.conversation_id
    FROM message_reports r JOIN messages m ON m.id=r.message_id
    ${where} ORDER BY r.created_at DESC`).all();
  const seen = new Map();
  function person(role, id) {
    const key = role + ':' + id;
    if (seen.has(key)) return seen.get(key);
    const table = role === 'student' ? 'students' : role === 'teacher' ? 'teachers' : null;
    const row = table ? db.prepare(`SELECT full_name, username FROM ${table} WHERE id=?`).get(id) : null;
    const out = row ? { role, id, fullName: row.full_name, username: row.username } : { role, id, fullName: 'Deleted user', username: '' };
    seen.set(key, out);
    return out;
  }
  res.json(rows.map(r => Object.assign({}, r, {
    reporter: person(r.reporter_role, r.reporter_id),
    sender: person(r.sender_role, r.sender_id),
  })));
});
const MESSAGE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'messages');
router.post('/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  const action = String((req.body || {}).action || '');
  const report = db.prepare('SELECT * FROM message_reports WHERE id=? AND status=\'open\'').get(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found or already resolved.' });
  if (action === 'hide') {
    db.prepare('UPDATE message_reports SET status=\'hidden\' WHERE id=?').run(report.id);
    db.prepare('UPDATE messages SET is_hidden=1 WHERE id=?').run(report.message_id);
    logActivity('admin', req.session.adminId, 'report.hide', `message ${report.message_id}`);
  } else if (action === 'dismiss') {
    db.prepare('UPDATE message_reports SET status=\'dismissed\' WHERE id=?').run(report.id);
    logActivity('admin', req.session.adminId, 'report.dismiss', `message ${report.message_id}`);
  } else if (action === 'delete') {
    // Delete the message itself: attachments rows go via FK cascade, files are unlinked.
    const files = db.prepare('SELECT file_path FROM message_attachments WHERE message_id=?').all(report.message_id);
    for (const f of files) { try { fs.unlinkSync(path.join(MESSAGE_UPLOAD_DIR, path.basename(f.file_path))); } catch {} }
    db.prepare('DELETE FROM messages WHERE id=?').run(report.message_id);
    logActivity('admin', req.session.adminId, 'report.delete', `message ${report.message_id}`);
  } else return res.status(400).json({ error: 'Action must be hide, dismiss or delete.' });
  res.json({ ok: true });
});

// ============================== STUDENT / TEACHER VIEWS ==============================
function studentCanSeeDoc(s, doc) {
  return doc.is_published && !doc.is_archived && doc.department_id === s.section_id && doc.academic_level_id === s.level_id
    && (!doc.class_name || String(doc.class_name).toLowerCase() === String(s.class_name || '').toLowerCase());
}
router.get('/student/timetable', requireStudent, (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(req.session.studentId);
  const docs = db.prepare(DOC_Q + ' WHERE is_published=1 AND is_archived=0 ORDER BY created_at DESC').all();
  const mine = docs.filter(d => d.department_id === s.section_id && d.academic_level_id === s.level_id
    && (!d.class_name || String(d.class_name).toLowerCase() === String(s.class_name || '').toLowerCase()));
  const doc = mine[0] || null;
  const entries = doc ? db.prepare('SELECT * FROM timetable_entries WHERE document_id=? ORDER BY day_of_week, start_time, sort_order').all(doc.id) : [];
  const today = new Date().getDay();
  const todayEntries = entries.filter(e => e.day_of_week === today);
  const upcoming = entries.filter(e => e.day_of_week >= today).slice(0, 5);
  res.json({ document: doc ? publicDoc(doc) : null, entries, today: todayEntries, upcoming });
});

router.get('/teacher/schedule', requireTeacher, (req, res) => {
  const rows = db.prepare(`SELECT e.*, d.title, d.class_name AS class_name, d.is_published, d.is_archived, dep.name AS department, l.name AS level, p.name AS period
    FROM timetable_entries e JOIN timetable_documents d ON d.id=e.document_id
    JOIN departments dep ON dep.id=d.department_id JOIN academic_levels l ON l.id=d.academic_level_id
    LEFT JOIN academic_periods p ON p.id=d.period_id
    WHERE e.teacher_id=? ORDER BY e.day_of_week, e.start_time`).all(req.session.teacherId);
  res.json(rows.map(r => ({
    id: r.id, docId: r.document_id, title: r.title, department: r.department, level: r.level, period: r.period || '',
    className: r.class_name || '', day: r.day_of_week, subject: r.subject, classroom: r.classroom, start: r.start_time, end: r.end_time, isBreak: !!r.is_break, published: !!r.is_published, archived: !!r.is_archived,
  })));
});

// Timetable file serving (metadata embedded in path via doc lookup)
router.get('/timetables/docs/:id/file', (req, res) => {
  const doc = getDoc(Number(req.params.id));
  if (!doc || !doc.file_path) return res.status(404).json({ error: 'Timetable file not found.' });
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  let allowed = false;
  if (u.role === 'admin') allowed = true;
  if (u.role === 'student') allowed = studentCanSeeDoc(db.prepare('SELECT * FROM students WHERE id=?').get(u.id), doc);
  if (u.role === 'teacher') allowed = db.prepare('SELECT 1 x FROM timetable_entries WHERE document_id=? AND teacher_id=? LIMIT 1').get(doc.id, u.id) != null;
  if (!allowed) return res.status(403).json({ error: 'You do not have access to this timetable.' });
  const full = path.join(TT_DIR, path.basename(doc.file_path));
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing on server.' });
  const mode = req.query.mode === 'preview' ? 'inline' : 'attachment';
  res.set('Content-Type', doc.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', `${mode}; filename="${String(doc.file_name || 'timetable').replace(/"/g, '')}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(full).pipe(res);
});

router.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || String(err.message || '').includes('Timetable file'))) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
