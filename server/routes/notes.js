// APALINK notes router — Milestone 2.
// Access rules (enforced server-side):
//  - Students: only published notes in their section/department + level,
//    and (class_name = '' OR class_name matches the student's class).
//  - Teachers: full control of their own notes only.
// Files live in data/uploads/ and are served only through these endpoints.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../database/db');
const { requireStudent, requireTeacher } = require('../middleware/auth');
const { logActivity } = require('../lib/helpers');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

const FILE_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.json', '.html', '.png', '.jpg', '.jpeg'];
const MIME_BY_EXT = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!FILE_EXTS.includes(ext)) return cb(new Error('File type not allowed. Allowed: ' + FILE_EXTS.join(', ')));
    cb(null, true);
  },
});

function noteQuery() {
  return `SELECT n.*, d.name AS department, l.name AS level, t.full_name AS teacher_name,
    nf.id AS file_id, nf.file_name AS file_name, nf.file_size AS file_size, nf.mime_type AS mime_type,
    (SELECT COUNT(*) FROM note_downloads dl WHERE dl.note_id = n.id) AS download_count
    FROM notes n
    JOIN departments d ON d.id = n.department_id
    JOIN academic_levels l ON l.id = n.academic_level_id
    JOIN teachers t ON t.id = n.teacher_id
    LEFT JOIN note_files nf ON nf.id = (SELECT id FROM note_files WHERE note_id = n.id ORDER BY id LIMIT 1)`;
}
function publicNote(n, saved) {
  return {
    id: n.id, title: n.title, description: n.description, subject: n.subject || '',
    department: n.department, departmentId: n.department_id, level: n.level, levelId: n.academic_level_id,
    className: n.class_name || '', teacherName: n.teacher_name, teacherId: n.teacher_id,
    isPublished: !!n.is_published, fileName: n.file_name || null, fileSize: n.file_size || 0,
    mimeType: n.mime_type || '', downloadCount: n.download_count || 0,
    saved: !!saved, createdAt: n.created_at, updatedAt: n.updated_at,
  };
}
function extOf(name) { return name ? path.extname(name).toLowerCase() : ''; }
function fileCategory(mime, name) {
  if (!name) return 'other';
  const m = String(mime || '').toLowerCase();
  if (m === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json')) return 'text';
  if (m.includes('word') || m.includes('presentation') || m.includes('powerpoint') || /\.(docx?|pptx?)$/.test(name)) return 'document';
  if (m.startsWith('image/')) return 'image';
  return 'other';
}
function getStudent(id) { return db.prepare('SELECT * FROM students WHERE id=?').get(id); }

// Rows the student is allowed to see (published + dept + level + class match).
function accessibleNotes(s) {
  return db.prepare(noteQuery() + ` WHERE n.is_published=1 AND n.department_id=? AND n.academic_level_id=?
    AND (n.class_name='' OR n.class_name = ? COLLATE NOCASE)`).all(s.section_id, s.level_id, s.class_name || '');
}
function canStudentSee(s, note) {
  if (!note || !note.is_published) return false;
  if (note.department_id !== s.section_id || note.academic_level_id !== s.level_id) return false;
  return !note.class_name || String(note.class_name).toLowerCase() === String(s.class_name || '').toLowerCase();
}
function withSaved(rows, studentId) {
  const saved = new Set(db.prepare('SELECT note_id FROM saved_notes WHERE student_id=?').all(studentId).map(r => r.note_id));
  return rows.map(n => publicNote(n, saved.has(n.id)));
}

// ============================== STUDENT ==============================
router.get('/student/dashboard', requireStudent, (req, res) => {
  const s = getStudent(req.session.studentId);
  const notes = accessibleNotes(s);
  const savedCount = db.prepare('SELECT COUNT(*) c FROM saved_notes WHERE student_id=?').get(s.id).c;
  const dlCount = db.prepare('SELECT COUNT(*) c FROM note_downloads WHERE student_id=?').get(s.id).c;
  const recent = [...notes].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
  res.json({
    stats: { availableNotes: notes.length, savedCount, downloadsCount: dlCount },
    notifications: recent.map(n => publicNote(n, false)),
  });
});

router.get('/student/notes', requireStudent, (req, res) => {
  const s = getStudent(req.session.studentId);
  let rows = accessibleNotes(s);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) rows = rows.filter(n => [n.title, n.description, n.subject, n.teacher_name, n.class_name].join(' ').toLowerCase().includes(q));
  const subject = String(req.query.subject || '').trim();
  if (subject) rows = rows.filter(n => String(n.subject || '').toLowerCase() === subject.toLowerCase());
  const type = String(req.query.type || 'all');
  if (type !== 'all') rows = rows.filter(n => fileCategory(n.mime_type, n.file_name) === type);
  const sort = req.query.sort || 'newest';
  if (sort === 'popular') rows.sort((a, b) => b.download_count - a.download_count);
  else if (sort === 'az') rows.sort((a, b) => a.title.localeCompare(b.title));
  else rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(withSaved(rows, s.id));
});

router.get('/student/recent', requireStudent, (req, res) => {
  const s = getStudent(req.session.studentId);
  const rows = accessibleNotes(s).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  res.json(withSaved(rows, s.id));
});

router.get('/student/saved', requireStudent, (req, res) => {
  const s = getStudent(req.session.studentId);
  const rows = db.prepare(noteQuery() + ` WHERE n.is_published=1 AND EXISTS (SELECT 1 FROM saved_notes sn WHERE sn.student_id=? AND sn.note_id=n.id) ORDER BY n.created_at DESC`).all(s.id);
  res.json(rows.filter(n => canStudentSee(s, n)).map(n => publicNote(n, true)));
});

router.get('/student/downloads', requireStudent, (req, res) => {
  const rows = db.prepare(noteQuery() + ` JOIN note_downloads nd ON nd.note_id=n.id WHERE nd.student_id=? ORDER BY nd.downloaded_at DESC LIMIT 100`).all(req.session.studentId);
  res.json(rows.map(n => ({ ...publicNote(n, false), downloadedAt: n.downloaded_at })));
});

router.post('/student/notes/:id/save', requireStudent, (req, res) => {
  const s = getStudent(req.session.studentId);
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(Number(req.params.id));
  if (!canStudentSee(s, note)) return res.status(404).json({ error: 'Note not found.' });
  db.prepare('INSERT OR IGNORE INTO saved_notes (student_id, note_id) VALUES (?,?)').run(s.id, note.id);
  logActivity('student', s.id, 'note.save', note.title);
  res.json({ saved: true });
});

router.delete('/student/notes/:id/save', requireStudent, (req, res) => {
  db.prepare('DELETE FROM saved_notes WHERE student_id=? AND note_id=?').run(req.session.studentId, Number(req.params.id));
  const n = db.prepare('SELECT title FROM notes WHERE id=?').get(Number(req.params.id));
  logActivity('student', req.session.studentId, 'note.unsave', n ? n.title : `note ${req.params.id}`);
  res.json({ saved: false });
});

// ============================== FILE ACCESS (preview / download) ==============================
router.get('/notes/:id/file', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(noteQuery() + ' WHERE n.id=?').get(id);
  if (!row || !row.file_id) return res.status(404).json({ error: 'File not found.' });
  let allowed = false;
  if (req.session.adminId) allowed = true;
  if (req.session.teacherId) allowed = row.teacher_id === req.session.teacherId;
  if (req.session.studentId) { const s = getStudent(req.session.studentId); allowed = canStudentSee(s, row); }
  if (!allowed) return res.status(403).json({ error: 'You do not have access to this file.' });

  const fileRow = db.prepare('SELECT * FROM note_files WHERE id=?').get(row.file_id);
  const full = path.join(UPLOAD_DIR, path.basename(fileRow.file_path));
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File is missing on the server.' });

  const mode = req.query.mode === 'preview' ? 'inline' : 'attachment';
  if (mode === 'attachment' && req.session.studentId) {
    db.prepare('INSERT INTO note_downloads (note_id, student_id) VALUES (?,?)').run(id, req.session.studentId);
    logActivity('student', req.session.studentId, 'note.download', row.title);
  }
  if (mode === 'inline') {
    if (req.session.studentId) logActivity('student', req.session.studentId, 'note.view', row.title);
    if (req.session.teacherId) logActivity('teacher', req.session.teacherId, 'note.view', row.title);
  }
  const mime = MIME_BY_EXT[extOf(fileRow.file_name)] || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.set('Content-Disposition', `${mode}; filename="${fileRow.file_name.replace(/"/g, '')}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(full).pipe(res);
});

// ============================== TEACHER ==============================
router.get('/teacher/dashboard', requireTeacher, (req, res) => {
  const tid = req.session.teacherId;
  const myNotes = db.prepare(noteQuery() + ' WHERE n.teacher_id=? ORDER BY n.created_at DESC').all(tid);
  const totalDownloads = myNotes.reduce((sum, n) => sum + n.download_count, 0);
  res.json({
    stats: { notes: myNotes.length, published: myNotes.filter(n => n.is_published).length, downloads: totalDownloads },
    notes: myNotes.map(n => publicNote(n, false)),
  });
});

router.post('/teacher/notes', requireTeacher, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please attach a file.' });
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const departmentId = Number(b.departmentId), levelId = Number(b.levelId);
  const subject = String(b.subject || '').trim().slice(0, 120);
  const description = String(b.description || '').trim().slice(0, 1000);
  const className = String(b.className || '').trim().slice(0, 40);
  const fail = (msg) => { try { fs.unlinkSync(req.file.path); } catch {} return res.status(400).json({ error: msg }); };
  if (!title) return fail('Note title is required.');
  if (!departmentId || !db.prepare('SELECT id FROM departments WHERE id=? AND is_active=1').get(departmentId)) return fail('Please choose a valid section/department.');
  if (!levelId || !db.prepare('SELECT id FROM academic_levels WHERE id=? AND is_active=1').get(levelId)) return fail('Please choose a valid academic level.');
  const info = db.prepare('INSERT INTO notes (title, description, department_id, academic_level_id, class_name, subject, teacher_id) VALUES (?,?,?,?,?,?,?)')
    .run(title, description, departmentId, levelId, className, subject, req.session.teacherId);
  db.prepare('INSERT INTO note_files (note_id, file_name, file_path, file_size, mime_type) VALUES (?,?,?,?,?)')
    .run(info.lastInsertRowid, req.file.originalname, req.file.filename, req.file.size, MIME_BY_EXT[extOf(req.file.originalname)] || 'application/octet-stream');
  logActivity('teacher', req.session.teacherId, 'note.publish', title);
  res.status(201).json({ noteId: info.lastInsertRowid });
});

function ownNote(tid, id) {
  const n = db.prepare(noteQuery() + ' WHERE n.id=? AND n.teacher_id=?').get(id, tid);
  return n || null;
}

router.patch('/teacher/notes/:id', requireTeacher, (req, res) => {
  const n = ownNote(req.session.teacherId, Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'Note not found.' });
  const b = req.body || {};
  db.prepare('UPDATE notes SET title=?, description=?, subject=?, class_name=?, is_published=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(
      b.title !== undefined ? String(b.title).trim() : n.title,
      b.description !== undefined ? String(b.description).trim().slice(0, 1000) : n.description,
      b.subject !== undefined ? String(b.subject).trim().slice(0, 120) : n.subject,
      b.className !== undefined ? String(b.className).trim().slice(0, 40) : n.class_name,
      b.isPublished !== undefined ? (b.isPublished ? 1 : 0) : n.is_published,
      n.id,
    );
  if (b.isPublished !== undefined) logActivity('teacher', req.session.teacherId, b.isPublished ? 'note.publish' : 'note.unpublish', n.title);
  else logActivity('teacher', req.session.teacherId, 'note.update', n.title);
  res.json({ ok: true });
});

router.delete('/teacher/notes/:id', requireTeacher, (req, res) => {
  const n = ownNote(req.session.teacherId, Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'Note not found.' });
  const files = db.prepare('SELECT file_path FROM note_files WHERE note_id=?').all(n.id);
  db.prepare('DELETE FROM notes WHERE id=?').run(n.id);
  for (const f of files) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(f.file_path))); } catch {} }
  logActivity('teacher', req.session.teacherId, 'note.delete', n.title);
  res.json({ ok: true });
});

// upload errors (too large / bad type) → JSON, not Express default HTML
router.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || String(err.message || '').includes('File type'))) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
