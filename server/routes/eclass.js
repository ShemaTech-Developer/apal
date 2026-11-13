// APALINK E-Class — live online video teaching.
// Teachers go live with a class (department + level + class name), students and
// admins join, a WebRTC mesh carries camera/audio (signaling over SSE + POST),
// and an in-class chat/comment channel.
const express = require('express');
const db = require('../database/db');
const { requireAuth, requireAdmin, requireTeacher } = require('../middleware/auth');
const { createNotification, logActivity, resolveUser } = require('../lib/helpers');

const router = express.Router();

// ---------- Helpers ----------
function person(role, id) {
  const table = role === 'student' ? 'students' : role === 'teacher' ? 'teachers' : 'admins';
  const row = db.prepare(`SELECT full_name, username FROM ${table} WHERE id=?`).get(id);
  return row
    ? { role, id, fullName: row.full_name, username: row.username }
    : { role, id, fullName: 'Deleted user', username: '' };
}
function classMeta(departmentId, levelId) {
  const d = db.prepare('SELECT name, code FROM departments WHERE id=?').get(Number(departmentId)) || { name: '—', code: '' };
  const l = db.prepare('SELECT name FROM academic_levels WHERE id=?').get(Number(levelId)) || { name: '—' };
  return { department: d.name, departmentCode: d.code || '', level: l.name };
}
function classStudents(departmentId, levelId, className) {
  return db.prepare(`SELECT id, full_name, username FROM students
    WHERE is_active=1 AND section_id=? AND level_id=? AND class_name=? ORDER BY full_name`)
    .all(Number(departmentId), Number(levelId), String(className || ''));
}
function liveClassRow(e) {
  const teacher = db.prepare('SELECT full_name, username FROM teachers WHERE id=?').get(e.teacher_id);
  const meta = classMeta(e.department_id, e.level_id);
  const participants = db.prepare("SELECT COUNT(*) AS c FROM eclass_participants WHERE eclass_id=? AND removed_at IS NULL AND (status='joined' OR status IS NULL)").get(e.id).c;
  return {
    id: e.id, title: e.title, subject: e.subject, status: e.status,
    departmentId: e.department_id, levelId: e.level_id, className: e.class_name,
    department: meta.department, departmentCode: meta.departmentCode, level: meta.level,
    teacherId: e.teacher_id, teacherName: teacher ? teacher.full_name : '—', teacherUsername: teacher ? teacher.username : '',
    startedAt: e.started_at, endedAt: e.ended_at || null,
    startTime: e.start_time || null, endTime: e.end_time || null,
    participants,
  };
}
// Resolve + authorize an e-class for the current user.
// Admins and teachers: always allowed. Students: only their own class.
function eclassFor(req) {
  const u = resolveUser(req);
  const id = Number(req.params.id);
  if (!u || !Number.isFinite(id)) return null;
  const e = db.prepare('SELECT * FROM eclasses WHERE id=?').get(id);
  if (!e) return null;
  let allowed = u.role === 'admin' || u.role === 'teacher';
  if (u.role === 'student') {
    const me = db.prepare('SELECT section_id, level_id, class_name FROM students WHERE id=?').get(u.id);
    allowed = !!me && me.section_id === e.department_id && me.level_id === e.level_id && me.class_name === e.class_name;
    if (allowed) {
      const p = db.prepare("SELECT removed_at FROM eclass_participants WHERE eclass_id=? AND role='student' AND user_id=?").get(e.id, u.id);
      if (p && p.removed_at) return { u, e, removed: true };   // 403, not 404 — they were in it
    }
  }
  if (!allowed) return null;
  return { u, e };
}
function isOwnerOrAdmin(u, e) {
  return u.role === 'admin' || (u.role === 'teacher' && e.teacher_id === u.id);
}
function participantsOf(eclassId) {
  return db.prepare("SELECT role, user_id, joined_at, removed_at, status, requested_at FROM eclass_participants WHERE eclass_id=?")
    .all(eclassId)
    .map(p => ({ ...person(p.role, p.user_id), joinedAt: p.joined_at, removedAt: p.removed_at || null, status: p.status || 'joined', requestedAt: p.requested_at || null }))
    .filter(p => !p.removedAt && p.status !== 'denied');
}
// Minutes since midnight for 'HH:MM' strings.
function toMin(hm) {
  const m = String(hm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// ---------- In-memory room registry (SSE connections) ----------
const roomStreams = new Map();   // eclassId -> Map(key role:id -> { res, person })
function broadcastRoom(eclassId, data) {
  const room = roomStreams.get(Number(eclassId));
  if (!room) return;
  const line = 'event: eclass\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const { res } of room.values()) { try { res.write(line); } catch {} }
}
function roomPeers(eclassId) {
  const room = roomStreams.get(Number(eclassId));
  if (!room) return [];
  return [...room.values()].map(v => v.person);
}

// ---------- Teacher: pick a class to go live with ----------
router.get('/teacher/classes', requireTeacher, (req, res) => {
  // Only classes in the sections the administrator assigned to this teacher.
  const sections = db.prepare('SELECT department_id FROM teacher_sections WHERE teacher_id=?').all(req.session.teacherId).map(r => r.department_id);
  if (!sections.length) return res.json([]);
  const placeholders = sections.map(() => '?').join(',');
  const rows = db.prepare(`SELECT section_id AS department_id, level_id, class_name, COUNT(*) AS students
    FROM students WHERE is_active=1 AND section_id IN (${placeholders})
    GROUP BY section_id, level_id, class_name
    ORDER BY section_id, level_id, class_name`).all(...sections);
  const live = db.prepare("SELECT id, department_id, level_id, class_name, title FROM eclasses WHERE status='live'").all()
    .map(l => ({ id: l.id, title: l.title, departmentId: l.department_id, levelId: l.level_id, className: l.class_name }));
  res.json(rows.map(r => {
    const meta = classMeta(r.department_id, r.level_id);
    const mine = db.prepare('SELECT id FROM eclasses WHERE status=\'live\' AND department_id=? AND level_id=? AND class_name=?').get(r.department_id, r.level_id, r.class_name);
    return {
      departmentId: r.department_id, levelId: r.level_id, className: r.class_name,
      students: r.students, ...meta,
      live: live.find(l => l.departmentId === r.department_id && l.levelId === r.level_id && l.className === r.class_name) || null,
    };
  }));
});

// ---------- Teacher: recent classes (live + past) ----------
router.get('/teacher/eclasses', requireTeacher, (req, res) => {
  const rows = db.prepare("SELECT * FROM eclasses WHERE teacher_id=? ORDER BY id DESC LIMIT 20").all(req.session.teacherId);
  res.json(rows.map(liveClassRow));
});

// ---------- Admin: every class + who's inside ----------
router.get('/admin/classes', requireAdmin, (req, res) => {
  const groups = db.prepare(`SELECT section_id AS department_id, level_id, class_name, COUNT(*) AS students
    FROM students WHERE is_active=1
    GROUP BY section_id, level_id, class_name
    ORDER BY section_id, level_id, class_name`).all();
  const live = db.prepare("SELECT * FROM eclasses WHERE status='live'").all().map(liveClassRow);
  const liveByKey = new Map(live.map(l => [l.departmentId + '|' + l.levelId + '|' + l.className, l]));
  res.json(groups.map(g => {
    const meta = classMeta(g.department_id, g.level_id);
    const students = db.prepare('SELECT id FROM students WHERE is_active=1 AND section_id=? AND level_id=? AND class_name=?')
      .all(g.department_id, g.level_id, g.class_name).map(r => r.id);
    return {
      departmentId: g.department_id, levelId: g.level_id, className: g.class_name,
      ...meta, students: g.students, studentIds: students,
      live: liveByKey.get(g.department_id + '|' + g.level_id + '|' + g.class_name) || null,
    };
  }));
});
// Admin: students inside one class
router.get('/admin/classes/students', requireAdmin, (req, res) => {
  const departmentId = Number(req.query.departmentId), levelId = Number(req.query.levelId);
  const className = String(req.query.className || '');
  const rows = db.prepare(`SELECT id, full_name, username, email, avatar_path, is_active
    FROM students WHERE section_id=? AND level_id=? AND class_name=? ORDER BY full_name`)
    .all(departmentId, levelId, className);
  res.json(rows.map(s => ({
    id: s.id, fullName: s.full_name, username: s.username, email: s.email || '',
    avatar: s.avatar_path || '', active: !!s.is_active,
  })));
});

// ---------- Live classes the current user can see ----------
router.get('/eclasses/live', requireAuth, (req, res) => {
  const u = resolveUser(req);
  let rows;
  if (u.role === 'student') {
    const me = db.prepare('SELECT section_id, level_id, class_name FROM students WHERE id=?').get(u.id);
    rows = db.prepare(`SELECT * FROM eclasses WHERE status='live' AND department_id=? AND level_id=? AND class_name=? ORDER BY id DESC`)
      .all(me.section_id, me.level_id, me.class_name);
  } else {
    rows = db.prepare("SELECT * FROM eclasses WHERE status='live' ORDER BY id DESC").all();
  }
  res.json(rows.map(liveClassRow));
});

// ---------- Teacher goes live ----------
router.post('/teacher/eclasses', requireTeacher, (req, res) => {
  const b = req.body || {};
  const departmentId = Number(b.departmentId), levelId = Number(b.levelId);
  const className = String(b.className || '').trim();
  const title = String(b.title || '').trim().slice(0, 160) || 'Live class';
  const subject = String(b.subject || '').trim().slice(0, 120);
  // Scheduled time window (HH:MM) — e.g. 10:00 - 11:00.
  const startTime = String(b.startTime || '').trim();
  const endTime = String(b.endTime || '').trim();
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  if (startTime && startMin === null) return res.status(400).json({ error: 'Start time must be in HH:MM format, e.g. 10:00.' });
  if (endTime && endMin === null) return res.status(400).json({ error: 'End time must be in HH:MM format, e.g. 11:00.' });
  if (startMin !== null && endMin !== null && endMin <= startMin) return res.status(400).json({ error: 'The end time must be after the start time.' });
  const members = classStudents(departmentId, levelId, className);
  if (!members.length) return res.status(400).json({ error: 'Pick a class that has at least one student.' });
  const clash = db.prepare("SELECT id FROM eclasses WHERE status='live' AND department_id=? AND level_id=? AND class_name=?").get(departmentId, levelId, className);
  if (clash) return res.status(409).json({ error: 'This class is already live — join it instead.', liveId: clash.id });

  const teacher = db.prepare('SELECT id, full_name, subject FROM teachers WHERE id=?').get(req.session.teacherId);
  const subjectFinal = subject || teacher.subject || 'Live class';
  const info = db.prepare('INSERT INTO eclasses (teacher_id, department_id, level_id, class_name, title, subject, start_time, end_time) VALUES (?,?,?,?,?,?,?,?)')
    .run(teacher.id, departmentId, levelId, className, title, subjectFinal, startMin !== null ? startTime : null, endMin !== null ? endTime : null);
  const eclassId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO eclass_participants (eclass_id, role, user_id) VALUES (?, 'teacher', ?)").run(eclassId, teacher.id);

  // Publish a class announcement that lands only under My class for that class.
  const meta = classMeta(departmentId, levelId);
  db.prepare(`INSERT INTO announcements (title, body, category, audience, school_id, is_pinned, is_published, department_id, level_id, class_name)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(
      '🔴 Live now: ' + title,
      `${teacher.full_name} is teaching ${subjectFinal} for ${meta.departmentCode || meta.department} · ${meta.level}${className ? ' · Class ' + className : ''}${startMin !== null ? ', scheduled ' + startTime + '–' + (endMin !== null ? endTime : '…') : ''}. Open My class and tap Join Class.`,
      'academic', 'students', null, 0, 1, departmentId, levelId, className
    );
  // Notify every student in the class directly.
  for (const s of members) {
    createNotification('student', s.id, 'eclass', 'Live class: ' + subjectFinal,
      `${teacher.full_name} is live now for ${meta.departmentCode || meta.department} · ${meta.level}${className ? ' · ' + className : ''}${startMin !== null ? ' — scheduled ' + startTime + '–' + (endMin !== null ? endTime : '…') : ''} — tap to join.`,
      '/pages/student/my-class.html');
  }
  logActivity('teacher', teacher.id, 'eclass.start', `${meta.departmentCode || meta.department} ${meta.level}${className ? ' ' + className : ''} — ${title}`);
  res.status(201).json(liveClassRow(db.prepare('SELECT * FROM eclasses WHERE id=?').get(eclassId)));
});

// ---------- One class (details + roster) ----------
router.get('/eclasses/:id', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const { e } = ctx;
  const meta = classMeta(e.department_id, e.level_id);
  const teacher = db.prepare('SELECT full_name, username, subject FROM teachers WHERE id=?').get(e.teacher_id);
  res.json({
    id: e.id, title: e.title, subject: e.subject, status: e.status,
    teacher: { id: e.teacher_id, fullName: teacher ? teacher.full_name : '—', username: teacher ? teacher.username : '', subject: teacher && teacher.subject || '' },
    class: { departmentId: e.department_id, levelId: e.level_id, className: e.class_name, department: meta.department, departmentCode: meta.departmentCode, level: meta.level },
    startedAt: e.started_at, endedAt: e.ended_at || null,
    startTime: e.start_time || null, endTime: e.end_time || null,
    participants: participantsOf(e.id),
  });
});
// The signed-in student's own membership status in this class (pending / joined / denied).
router.get('/eclasses/:id/mystatus', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const { u, e } = ctx;
  if (u.role !== 'student') return res.json({ status: 'joined', classStatus: e.status });
  const row = db.prepare("SELECT status, requested_at, decided_at FROM eclass_participants WHERE eclass_id=? AND role='student' AND user_id=?").get(e.id, u.id);
  res.json({
    status: row ? (row.status || 'joined') : 'none',
    classStatus: e.status,
    requestedAt: (row && row.requested_at) || null,
    decidedAt: (row && row.decided_at) || null,
  });
});
// Students of the class / admin can join
router.post('/eclasses/:id/join', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const { u, e } = ctx;
  if (e.status !== 'live') return res.status(400).json({ error: 'This class has ended.' });
  const existing = db.prepare('SELECT removed_at, status FROM eclass_participants WHERE eclass_id=? AND role=? AND user_id=?').get(e.id, u.role, u.id);
  if (existing && existing.removed_at) return res.status(403).json({ error: 'The teacher removed you from this class.' });

  // ---- Scheduled-time rules (students only) ----
  // Within the first 15 minutes of the start time: enter normally.
  // Past 15 minutes: the join becomes a REQUEST the teacher must approve or deny.
  const startMin = toMin(e.start_time);
  const endMin = toMin(e.end_time);
  if (u.role === 'student' && startMin !== null && !(existing && (existing.status || 'joined') === 'joined')) {
    const now = nowMin();
    if (now < startMin) {
      return res.status(400).json({ error: `This class starts at ${e.start_time} — you can join from that time.`, code: 'early' });
    }
    if (endMin !== null && now > endMin) {
      return res.status(400).json({ error: `This class time is over (${e.start_time}–${e.end_time}).`, code: 'late_end' });
    }
    const minutesLate = now - startMin;
    if (minutesLate > 15) {
      db.prepare(`INSERT INTO eclass_participants (eclass_id, role, user_id, left_at, removed_at, status, requested_at)
                  VALUES (?,?,?,NULL,NULL,'pending',datetime('now'))
                  ON CONFLICT(eclass_id, role, user_id) DO UPDATE SET left_at=NULL, status='pending', requested_at=datetime('now'), removed_at=NULL`)
        .run(e.id, u.role, u.id);
      const meSt = person('student', u.id);
      createNotification('teacher', e.teacher_id, 'eclass', 'Late join request',
        `${meSt.fullName} is late (${minutesLate} min after ${e.start_time}) and wants to join “${e.title}”.`,
        '/pages/eclass-room.html?id=' + e.id);
      broadcastRoom(e.id, { type: 'joinRequest', studentId: u.id, fullName: meSt.fullName, minutesLate });
      logActivity('student', u.id, 'eclass.join_request', `class ${e.id} late ${minutesLate}min`);
      return res.status(202).json({ ok: true, pending: true, status: 'pending', minutesLate });
    }
  }
  db.prepare(`INSERT INTO eclass_participants (eclass_id, role, user_id, left_at, removed_at, status) VALUES (?,?,?,NULL,NULL,'joined')
              ON CONFLICT(eclass_id, role, user_id) DO UPDATE SET left_at=NULL, status='joined', requested_at=NULL`)
    .run(e.id, u.role, u.id);
  broadcastRoom(e.id, { type: 'joined', role: u.role, id: u.id });
  logActivity(u.role, u.id, 'eclass.join', `class ${e.id}`);
  res.json({ ok: true });
});
// Teacher/admin decides a pending late-join request: allow → the student enters; deny → refused.
router.post('/eclasses/:id/decide', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  const { u, e } = ctx;
  if (!isOwnerOrAdmin(u, e)) return res.status(403).json({ error: 'Only the teacher or an admin can decide join requests.' });
  const targetId = Number((req.body || {}).userId);
  const decision = String((req.body || {}).decision || '');
  if (!Number.isFinite(targetId) || !['allow', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'userId and decision (allow|deny) are required.' });
  }
  const row = db.prepare("SELECT * FROM eclass_participants WHERE eclass_id=? AND role='student' AND user_id=?").get(e.id, targetId);
  if (!row || row.removed_at) return res.status(404).json({ error: 'That student has no pending request.' });
  if ((row.status || 'joined') === 'joined') return res.json({ ok: true, already: true });
  const who = u.role + ':' + u.id;
  const meSt = person('student', targetId);
  if (decision === 'allow') {
    db.prepare("UPDATE eclass_participants SET status='joined', left_at=NULL, requested_at=NULL, decided_at=datetime('now'), decided_by=? WHERE eclass_id=? AND role='student' AND user_id=?")
      .run(who, e.id, targetId);
    broadcastRoom(e.id, { type: 'requestApproved', studentId: targetId });
    createNotification('student', targetId, 'eclass', 'Join request approved',
      `The teacher approved your request to join “${e.title}”. Reopen My class to enter.`,
      '/pages/eclass-room.html?id=' + e.id);
    logActivity(u.role, u.id, 'eclass.request_allow', `class ${e.id} student ${targetId}`);
  } else {
    db.prepare("UPDATE eclass_participants SET status='denied', decided_at=datetime('now'), decided_by=? WHERE eclass_id=? AND role='student' AND user_id=?")
      .run(who, e.id, targetId);
    broadcastRoom(e.id, { type: 'requestDenied', studentId: targetId });
    createNotification('student', targetId, 'eclass', 'Join request denied',
      `The teacher denied your request to join “${e.title}”. You cannot enter this session.`,
      '/pages/student/my-class.html');
    logActivity(u.role, u.id, 'eclass.request_deny', `class ${e.id} student ${targetId}`);
  }
  res.json({ ok: true, decision, student: meSt });
});
router.post('/eclasses/:id/leave', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  db.prepare("UPDATE eclass_participants SET left_at=datetime('now') WHERE eclass_id=? AND role=? AND user_id=?")
    .run(ctx.e.id, ctx.u.role, ctx.u.id);
  broadcastRoom(ctx.e.id, { type: 'left', role: ctx.u.role, id: ctx.u.id });
  res.json({ ok: true });
});
router.post('/eclasses/:id/end', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  const { u, e } = ctx;
  if (!isOwnerOrAdmin(u, e)) return res.status(403).json({ error: 'Only the teacher or an admin can end this class.' });
  db.prepare("UPDATE eclasses SET status='ended', ended_at=datetime('now') WHERE id=?").run(e.id);
  broadcastRoom(e.id, { type: 'ended' });
  logActivity(u.role, u.id, 'eclass.end', `class ${e.id}`);
  res.json({ ok: true });
});
// Teacher/admin removes a student from the live class
router.post('/eclasses/:id/remove', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  const { u, e } = ctx;
  if (!isOwnerOrAdmin(u, e)) return res.status(403).json({ error: 'Only the teacher or an admin can remove a student.' });
  const role = String((req.body || {}).role || '');
  const targetId = Number((req.body || {}).userId);
  if (role !== 'student' || !Number.isFinite(targetId)) return res.status(400).json({ error: 'Only students can be removed from a live class.' });
  const hit = db.prepare("UPDATE eclass_participants SET removed_at=datetime('now'), removed_by=? WHERE eclass_id=? AND role='student' AND user_id=?")
    .run(u.role + ':' + u.id, e.id, targetId);
  if (!hit.changes) return res.status(404).json({ error: 'That student is not in this class.' });
  broadcastRoom(e.id, { type: 'removed', role: 'student', id: targetId });
  createNotification('student', targetId, 'eclass', 'Removed from live class',
    `The teacher removed you from “${e.title}”.`, '/pages/student/my-class.html');
  logActivity(u.role, u.id, 'eclass.remove', `class ${e.id} student ${targetId}`);
  res.json({ ok: true });
});

// ---------- In-class chat / comments ----------
router.get('/eclasses/:id/messages', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const rows = db.prepare('SELECT id, author_role, author_id, body, created_at FROM eclass_messages WHERE eclass_id=? ORDER BY id DESC LIMIT 100').all(ctx.e.id);
  res.json(rows.reverse().map(m => ({ ...m, author: person(m.author_role, m.author_id), createdAt: m.created_at })));
});
router.post('/eclasses/:id/messages', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const body = String((req.body || {}).body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  const info = db.prepare('INSERT INTO eclass_messages (eclass_id, author_role, author_id, body) VALUES (?,?,?,?)')
    .run(ctx.e.id, ctx.u.role, ctx.u.id, body);
  const message = {
    id: Number(info.lastInsertRowid), eclassId: ctx.e.id,
    author: person(ctx.u.role, ctx.u.id), body, createdAt: new Date().toISOString(),
  };
  broadcastRoom(ctx.e.id, { type: 'chat', message });
  res.status(201).json(message);
});

// ---------- SSE stream (signaling relay + room events) ----------
router.get('/eclasses/:id/stream', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const { u, e } = ctx;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');

  const id = Number(e.id);
  if (!roomStreams.has(id)) roomStreams.set(id, new Map());
  const room = roomStreams.get(id);
  const me = { ...person(u.role, u.id), joinedAt: new Date().toISOString() };
  // Tell the newcomer who is already here (WebRTC mesh: newcomer offers to each).
  res.write('event: eclass\ndata: ' + JSON.stringify({ type: 'peers', peers: [...room.values()].map(v => v.person) }) + '\n\n');
  room.set(u.role + ':' + u.id, { res, person: me });
  broadcastRoom(id, { type: 'joined', role: u.role, id: u.id, fullName: me.fullName, username: me.username });

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const r = roomStreams.get(id);
    if (r) { r.delete(u.role + ':' + u.id); if (!r.size) roomStreams.delete(id); }
    broadcastRoom(id, { type: 'left', role: u.role, id: u.id });
  });
});
// Signal relay: client → server → everyone in the room (clients filter by `to`).
router.post('/eclasses/:id/signal', requireAuth, (req, res) => {
  const ctx = eclassFor(req);
  if (!ctx) return res.status(404).json({ error: 'Class not found.' });
  if (ctx.removed) return res.status(403).json({ error: 'The teacher removed you from this class.' });
  const b = req.body || {};
  const toRole = String(b.toRole || ''), toId = Number(b.toId);
  const data = b.data;
  if (!['student', 'teacher', 'admin'].includes(toRole) || !Number.isFinite(toId) || !data) {
    return res.status(400).json({ error: 'toRole, toId and data are required.' });
  }
  broadcastRoom(ctx.e.id, { type: 'signal', from: { role: ctx.u.role, id: ctx.u.id }, to: { role: toRole, id: toId }, data });
  res.json({ ok: true });
});

module.exports = router;
