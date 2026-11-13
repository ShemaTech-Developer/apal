// APALINK school messaging — Milestone 3.
// DB-persisted conversations with SSE real-time push and REST polling fallback.
// Department/class info always comes from the authenticated student's DB profile.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../database/db');
const { resolveUser, getUser, getPrefs, hub, createNotification, logActivity, touchPresence, isOnline } = require('../lib/helpers');

const router = express.Router();
const TABLE = { student: 'students', teacher: 'teachers' };

// Files shared in chats live in data/uploads/messages and are only served to
// members of the conversation through GET /api/messages/attachments/:id.
const MESSAGE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'messages');
const MESSAGE_FILE_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.md', '.csv', '.json', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.mp4'];
const MESSAGE_MIME = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(MESSAGE_UPLOAD_DIR, { recursive: true }); cb(null, MESSAGE_UPLOAD_DIR); },
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MESSAGE_FILE_EXTS.includes(ext)) {
      return cb(new Error('That file type is not allowed. Allowed: ' + MESSAGE_FILE_EXTS.join(', ')));
    }
    cb(null, true);
  },
});

function cleanupUploads(files) {
  for (const f of files || []) { try { fs.unlinkSync(f.path); } catch {} }
}
function attachmentJson(a) {
  return { id: a.id, name: a.file_name, size: a.file_size, mime: a.mime_type, url: '/api/messages/attachments/' + a.id };
}
function attachmentsFor(convId) {
  const rows = db.prepare(`SELECT a.* FROM message_attachments a
    JOIN messages m ON m.id = a.message_id
    WHERE m.conversation_id=? AND m.is_hidden=0 ORDER BY a.id ASC`).all(convId);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push(attachmentJson(r));
  }
  return map;
}

// Rate limit: 20 messages / minute / user (in-memory per server instance).
const rateHits = new Map();
function rateLimited(role, id) {
  const now = Date.now();
  const arr = (rateHits.get(role + ':' + id) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) return true;
  arr.push(now);
  rateHits.set(role + ':' + id, arr);
  return false;
}

function requireAuth(req, res, next) {
  const u = resolveUser(req);
  if (!u || u.role === 'admin') return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  touchPresence(u.role, u.id);
  next();
}
function userInfo(role, id) {
  const row = getUser(TABLE[role], id);
  if (!row) return null;
  const prefs = getPrefs(role, id);
  const online = prefs.onlineVisibility !== 'private' && isOnline(role, id);
  const base = { role, id, fullName: row.full_name, username: row.username, avatar: row.avatar_path || null, online };
  if (role === 'student') {
    const dept = db.prepare('SELECT name FROM departments WHERE id=?').get(row.section_id);
    const lvl = db.prepare('SELECT name FROM academic_levels WHERE id=?').get(row.level_id);
    return { ...base, department: dept ? dept.name : '', departmentId: row.section_id, level: lvl ? lvl.name : '', className: row.class_name || '' };
  }
  return base;
}
function isBlocked(aRole, aId, bRole, bId) {
  return db.prepare('SELECT id FROM user_blocks WHERE blocker_role=? AND blocker_id=? AND blocked_role=? AND blocked_id=?').get(aRole, aId, bRole, bId) != null
      || db.prepare('SELECT id FROM user_blocks WHERE blocker_role=? AND blocker_id=? AND blocked_role=? AND blocked_id=?').get(bRole, bId, aRole, aId) != null;
}
function classmatesOnlyRequester(role, id) {
  return getPrefs(role, id).messagePrivacy === 'classmates';
}
function canMessage(req, otherRole, otherId) {
  // requester privacy
  if (classmatesOnlyRequester(req.user.role, req.user.id) && req.user.role === 'student' && otherRole === 'student') {
    const meS = getUser('students', req.user.id), otherS = getUser('students', otherId);
    if (!meS || !otherS) return { ok: false, error: 'User not found.' };
    if (!(meS.section_id === otherS.section_id && meS.level_id === otherS.level_id && String(meS.class_name).toLowerCase() === String(otherS.class_name).toLowerCase())) {
      return { ok: false, error: 'Your privacy settings limit you to classmates.' };
    }
  }
  // defendant privacy: if target is 'nobody' or classmates-only student, enforce
  const targetPrefs = getPrefs(otherRole, otherId);
  if (targetPrefs.messagePrivacy === 'nobody') return { ok: false, error: 'This user is not accepting messages.' };
  if (targetPrefs.messagePrivacy === 'classmates' && otherRole === 'student' && req.user.role === 'student') {
    const meS = getUser('students', req.user.id), otherS = getUser('students', otherId);
    if (!meS || !otherS) return { ok: false, error: 'User not found.' };
    if (!(meS.section_id === otherS.section_id && meS.level_id === otherS.level_id && String(meS.class_name).toLowerCase() === String(otherS.class_name).toLowerCase())) {
      return { ok: false, error: 'This user only accepts messages from classmates.' };
    }
  }
  if (isBlocked(req.user.role, req.user.id, otherRole, otherId)) return { ok: false, error: 'You cannot message this user.' };
  return { ok: true };
}
function memberOf(convId, role, id) {
  return db.prepare('SELECT * FROM conversation_participants WHERE conversation_id=? AND participant_role=? AND participant_id=?').get(convId, role, id) || null;
}
function convRows(role, id) {
  return db.prepare(`SELECT c.* FROM conversations c JOIN conversation_participants p ON p.conversation_id=c.id
    WHERE p.participant_role=? AND p.participant_id=? ORDER BY c.updated_at DESC`).all(role, id);
}
function serializeConv(conv, meRole, meId) {
  const parts = db.prepare('SELECT participant_role, participant_id, last_read_at FROM conversation_participants WHERE conversation_id=?').all(conv.id);
  const other = parts.find(p => !(p.participant_role === meRole && p.participant_id === meId));
  const mePart = parts.find(p => p.participant_role === meRole && p.participant_id === meId);
  const lastMsg = db.prepare('SELECT * FROM messages WHERE conversation_id=? AND is_hidden=0 ORDER BY id DESC LIMIT 1').get(conv.id);
  const lastAtt = lastMsg ? db.prepare('SELECT file_name FROM message_attachments WHERE message_id=? ORDER BY id LIMIT 1').get(lastMsg.id) : null;
  const otherPart = other ? parts.find(p => p.participant_role === other.participant_role && p.participant_id === other.participant_id) : null;
  const lastSeen = !!(lastMsg && otherPart && otherPart.last_read_at && String(lastMsg.created_at) <= String(otherPart.last_read_at));
  const unread = lastMsg && (mePart.last_read_at == null || String(lastMsg.created_at) > String(mePart.last_read_at))
    ? db.prepare('SELECT COUNT(*) x FROM messages WHERE conversation_id=? AND is_hidden=0 AND created_at>? AND NOT (sender_role=? AND sender_id=?)').get(conv.id, mePart.last_read_at || '', meRole, meId).x
    : 0;
  return {
    id: conv.id, createdAt: conv.created_at, updatedAt: conv.updated_at,
    other: other ? userInfo(other.participant_role, other.participant_id) : null,
    lastMessage: lastMsg ? { body: lastMsg.body, fromMe: lastMsg.sender_role === meRole && lastMsg.sender_id === meId, createdAt: lastMsg.created_at, seen: lastSeen, attachment: lastAtt ? lastAtt.file_name : null, hasAttachment: !!lastAtt } : null,
    unread: Number(unread) || 0,
  };
}

// ---------- Directory ----------
router.get('/messages/directory', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const wanted = String(req.query.role || 'all');
  const rows = [];
  function scan(role, table, extra) {
    if (!['all', role].includes(wanted)) return;
    let results = db.prepare(`SELECT * FROM ${table} WHERE is_active=1`).all();
    if (q) results = results.filter(r => (r.full_name + ' ' + r.username).toLowerCase().includes(q));
    for (const r of results) rows.push(userInfo(role, r.id));
  }
  scan('student', 'students');
  scan('teacher', 'teachers');
  // Never include self
  const filtered = rows.filter(r => !(r.role === req.user.role && r.id === req.user.id));
  res.json(filtered.slice(0, 50));
});

// ---------- Conversations ----------
router.get('/messages/conversations', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = convRows(req.user.role, req.user.id).map(c => serializeConv(c, req.user.role, req.user.id));
  if (q) list = list.filter(c => c.other && (c.other.fullName + ' ' + c.other.username + ' ' + (c.other.department || '') + ' ' + (c.other.className || '')).toLowerCase().includes(q));
  if (req.query.filter === 'unread') list = list.filter(c => c.unread > 0);
  if (req.user.role === 'teacher' && req.query.department) {
    const depId = String(req.query.department);
    list = list.filter(c => String(c.other.departmentId || '') === depId || c.other.department === depId);
  }
  res.json(list);
});

router.post('/messages/conversations', requireAuth, (req, res) => {
  const { withRole, withId } = req.body || {};
  const otherId = Number(withId);
  if (!['student', 'teacher'].includes(withRole) || !otherId) return res.status(400).json({ error: 'Choose who to message.' });
  if (withRole === req.user.role && otherId === req.user.id) return res.status(400).json({ error: 'You cannot message yourself.' });
  const target = getUser(TABLE[withRole], otherId);
  if (!target || !target.is_active) return res.status(404).json({ error: 'User not found.' });
  const check = canMessage(req, withRole, otherId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  // Find existing 1:1 conversation
  const existing = db.prepare(`SELECT c.id FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.participant_role=? AND p1.participant_id=?
    JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.participant_role=? AND p2.participant_id=?
    LIMIT 1`).get(req.user.role, req.user.id, withRole, otherId);
  if (existing) return res.json(serializeConv(db.prepare('SELECT * FROM conversations WHERE id=?').get(existing.id), req.user.role, req.user.id));
  const info = db.prepare('INSERT INTO conversations DEFAULT VALUES').run();
  db.prepare('INSERT INTO conversation_participants (conversation_id, participant_role, participant_id) VALUES (?,?,?)').run(info.lastInsertRowid, req.user.role, req.user.id);
  db.prepare('INSERT INTO conversation_participants (conversation_id, participant_role, participant_id) VALUES (?,?,?)').run(info.lastInsertRowid, withRole, otherId);
  res.status(201).json(serializeConv(db.prepare('SELECT * FROM conversations WHERE id=?').get(info.lastInsertRowid), req.user.role, req.user.id));
});

router.get('/messages/conversations/:id/messages', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const part = memberOf(convId, req.user.role, req.user.id);
  if (!part) return res.status(403).json({ error: 'You are not part of this conversation.' });
  const after = Number(req.query.after || 0);
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? AND is_hidden=0 AND id>? ORDER BY id ASC LIMIT 200').all(convId, after);
  const atts = attachmentsFor(convId);
  const otherPart = db.prepare('SELECT last_read_at FROM conversation_participants WHERE conversation_id=? AND NOT (participant_role=? AND participant_id=?) LIMIT 1').get(convId, req.user.role, req.user.id);
  const otherReadAt = otherPart ? otherPart.last_read_at : null;
  res.json(rows.map(m => ({ id: m.id, conversationId: m.conversation_id, senderRole: m.sender_role, senderId: m.sender_id, body: m.body, createdAt: m.created_at, mine: m.sender_role === req.user.role && m.sender_id === req.user.id, seen: otherReadAt ? String(m.created_at) <= String(otherReadAt) : false, attachments: atts.get(m.id) || [] })));
});

router.post('/messages/conversations/:id/messages', requireAuth, upload.array('files', 5), (req, res) => {
  const convId = Number(req.params.id);
  const files = req.files || [];
  const bodyText = String((req.body || {}).body || '').trim().slice(0, 4000);
  if (!bodyText && !files.length) return res.status(400).json({ error: 'Write a message or attach a file.' });
  if (!memberOf(convId, req.user.role, req.user.id)) { cleanupUploads(files); return res.status(403).json({ error: 'You are not part of this conversation.' }); }
  const parts = db.prepare('SELECT participant_role, participant_id FROM conversation_participants WHERE conversation_id=?').all(convId);
  const other = parts.find(p => !(p.participant_role === req.user.role && p.participant_id === req.user.id));
  if (other && isBlocked(req.user.role, req.user.id, other.participant_role, other.participant_id)) { cleanupUploads(files); return res.status(403).json({ error: 'You cannot message this user.' }); }
  if (rateLimited(req.user.role, req.user.id)) { cleanupUploads(files); return res.status(429).json({ error: 'You are sending messages too fast. Please slow down.' }); }
  const info = db.prepare('INSERT INTO messages (conversation_id, sender_role, sender_id, body) VALUES (?,?,?,?)').run(convId, req.user.role, req.user.id, bodyText);
  const attachStmt = db.prepare('INSERT INTO message_attachments (message_id, file_name, file_path, file_size, mime_type) VALUES (?,?,?,?,?)');
  const stored = [];
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    const mime = MESSAGE_MIME[ext] || 'application/octet-stream';
    const a = attachStmt.run(info.lastInsertRowid, f.originalname, f.filename, f.size, mime);
    stored.push(attachmentJson({ id: a.lastInsertRowid, file_name: f.originalname, file_size: f.size, mime_type: mime }));
  }
  db.prepare("UPDATE conversations SET updated_at=datetime('now') WHERE id=?").run(convId);
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(info.lastInsertRowid);
  if (other) {
    hub.push(other.participant_role, other.participant_id, { type: 'message', conversationId: convId, messageId: msg.id });
    if (other.participant_role === 'teacher') {
      const preview = bodyText || (files[0] ? files[0].originalname : 'Attachment');
      createNotification('teacher', other.participant_id, 'messages', 'New student question', preview.slice(0, 120), '/pages/messages.html');
    }
  }
  hub.push(req.user.role, req.user.id, { type: 'message', conversationId: convId, messageId: msg.id });
  logActivity(req.user.role, req.user.id, 'message.send', (bodyText || (files[0] ? files[0].originalname : 'Attachment')).slice(0, 120));
  res.status(201).json({ id: msg.id, conversationId: convId, senderRole: msg.sender_role, senderId: msg.sender_id, body: msg.body, createdAt: msg.created_at, mine: true, attachments: stored });
});

// Attachment download — only conversation members (sender or recipient) can fetch it.
router.get('/messages/attachments/:id', requireAuth, (req, res) => {
  const att = db.prepare(`SELECT a.*, m.conversation_id FROM message_attachments a
    JOIN messages m ON m.id = a.message_id WHERE a.id=?`).get(Number(req.params.id));
  if (!att) return res.status(404).json({ error: 'File not found.' });
  if (!memberOf(att.conversation_id, req.user.role, req.user.id)) return res.status(403).json({ error: 'You are not part of this conversation.' });
  const abs = path.join(MESSAGE_UPLOAD_DIR, path.basename(att.file_path));
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (req.query.inline === '1' && String(att.mime_type).startsWith('image/')) {
    res.type(att.mime_type);
    return res.sendFile(abs);
  }
  res.download(abs, att.file_name);
});

router.delete('/messages/conversations/:id/messages/:messageId', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!memberOf(convId, req.user.role, req.user.id)) return res.status(403).json({ error: 'You are not part of this conversation.' });
  const msg = db.prepare('SELECT * FROM messages WHERE id=? AND conversation_id=?').get(messageId, convId);
  if (!msg || msg.is_hidden) return res.status(404).json({ error: 'Message not found.' });
  if (msg.sender_role !== req.user.role || msg.sender_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own messages.' });
  }
  const files = db.prepare('SELECT file_path FROM message_attachments WHERE message_id=?').all(messageId);
  for (const f of files) { try { fs.unlinkSync(path.join(MESSAGE_UPLOAD_DIR, path.basename(f.file_path))); } catch {} }
  db.prepare('DELETE FROM message_attachments WHERE message_id=?').run(messageId);
  db.prepare('UPDATE messages SET is_hidden=1 WHERE id=?').run(messageId);
  const other = db.prepare('SELECT participant_role, participant_id FROM conversation_participants WHERE conversation_id=? AND NOT (participant_role=? AND participant_id=?) LIMIT 1')
    .get(convId, req.user.role, req.user.id);
  if (other) hub.push(other.participant_role, other.participant_id, { type: 'message-delete', conversationId: convId, messageId });
  hub.push(req.user.role, req.user.id, { type: 'message-delete', conversationId: convId, messageId });
  logActivity(req.user.role, req.user.id, 'message.delete', `message ${messageId}`);
  res.json({ ok: true });
});

// Presence heartbeat: reaching this route marks the user active for ~70 seconds.
router.post('/messages/presence', requireAuth, (req, res) => res.json({ ok: true, online: true }));

router.post('/messages/conversations/:id/read', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const part = memberOf(convId, req.user.role, req.user.id);
  if (!part) return res.status(403).json({ error: 'You are not part of this conversation.' });
  db.prepare("UPDATE conversation_participants SET last_read_at=datetime('now') WHERE conversation_id=? AND participant_role=? AND participant_id=?").run(convId, req.user.role, req.user.id);
  const other = db.prepare('SELECT participant_role, participant_id FROM conversation_participants WHERE conversation_id=? AND NOT (participant_role=? AND participant_id=?) LIMIT 1').get(convId, req.user.role, req.user.id);
  if (other) hub.push(other.participant_role, other.participant_id, { type: 'read', conversationId: convId });
  res.json({ ok: true });
});

router.get('/messages/unread', requireAuth, (req, res) => {
  const list = convRows(req.user.role, req.user.id).map(c => serializeConv(c, req.user.role, req.user.id));
  const adminUnread = db.prepare("SELECT COUNT(*) x FROM admin_messages WHERE user_role=? AND user_id=? AND sender_role='admin' AND is_read_by_user=0").get(req.user.role, req.user.id).x;
  res.json({ unread: list.reduce((s, c) => s + c.unread, 0) + Number(adminUnread || 0), conversations: list.length, adminUnread: Number(adminUnread || 0) });
});

// ---------- Direct messages with school administration ----------
router.get('/messages/admin-thread', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_messages WHERE user_role=? AND user_id=? ORDER BY id ASC LIMIT 300').all(req.user.role, req.user.id);
  const unread = rows.filter(m => m.sender_role === 'admin' && !m.is_read_by_user).length;
  res.json({
    unread,
    messages: rows.map(m => ({ id: m.id, senderRole: m.sender_role, body: m.body, createdAt: m.created_at, mine: m.sender_role === req.user.role, seen: m.sender_role === 'admin' ? !!m.is_read_by_user : !!m.is_read_by_admin })),
  });
});
router.post('/messages/admin-thread/read', requireAuth, (req, res) => {
  db.prepare('UPDATE admin_messages SET is_read_by_user=1 WHERE user_role=? AND user_id=? AND sender_role=?').run(req.user.role, req.user.id, 'admin');
  res.json({ ok: true });
});

router.post('/messages/admin-thread', requireAuth, (req, res) => {
  const body = String((req.body || {}).body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (rateLimited(req.user.role, req.user.id)) return res.status(429).json({ error: 'You are sending messages too fast. Please slow down.' });
  const lastAdmin = db.prepare("SELECT admin_id FROM admin_messages WHERE user_role=? AND user_id=? AND sender_role='admin' ORDER BY id DESC LIMIT 1").get(req.user.role, req.user.id);
  const admin = lastAdmin || db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get();
  if (!admin) return res.status(500).json({ error: 'Administration is not available right now.' });
  const adminId = lastAdmin ? lastAdmin.admin_id : admin.id;
  const info = db.prepare(`INSERT INTO admin_messages (admin_id, user_role, user_id, sender_role, body, is_read_by_admin, is_read_by_user)
    VALUES (?,?,?,?,?,0,1)`).run(adminId, req.user.role, req.user.id, req.user.role, body);
  const me = getUser(TABLE[req.user.role], req.user.id);
  createNotification('admin', adminId, 'messages', 'Reply from ' + (me ? me.full_name : 'a user'), body.slice(0, 160), '/pages/admin/index.html');
  hub.push('admin', adminId, { type: 'admin-message', userId: req.user.id });
  logActivity(req.user.role, req.user.id, 'admin.reply', body.slice(0, 120));
  const msg = db.prepare('SELECT * FROM admin_messages WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ id: msg.id, senderRole: req.user.role, body: msg.body, createdAt: msg.created_at, mine: true });
});

// ---------- Blocks & reports ----------
router.post('/messages/block', requireAuth, (req, res) => {
  const { withRole, withId } = req.body || {};
  const otherId = Number(withId);
  if (!['student', 'teacher'].includes(withRole) || !otherId) return res.status(400).json({ error: 'Choose who to block.' });
  db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_role, blocker_id, blocked_role, blocked_id) VALUES (?,?,?,?)').run(req.user.role, req.user.id, withRole, otherId);
  res.json({ ok: true });
});
router.delete('/messages/block', requireAuth, (req, res) => {
  const { withRole, withId } = req.body || {};
  db.prepare('DELETE FROM user_blocks WHERE blocker_role=? AND blocker_id=? AND blocked_role=? AND blocked_id=?').run(req.user.role, req.user.id, withRole, Number(withId));
  res.json({ ok: true });
});
router.get('/messages/blocks', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT blocked_role, blocked_id FROM user_blocks WHERE blocker_role=? AND blocker_id=?').all(req.user.role, req.user.id);
  res.json(rows.map(r => ({ ...userInfo(r.blocked_role, r.blocked_id) })));
});
router.post('/messages/report', requireAuth, (req, res) => {
  const { messageId, reason } = req.body || {};
  const messageIdN = Number(messageId);
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(messageIdN);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  if (!memberOf(msg.conversation_id, req.user.role, req.user.id)) return res.status(403).json({ error: 'You are not part of this conversation.' });
  db.prepare('INSERT INTO message_reports (message_id, reporter_role, reporter_id, reason) VALUES (?,?,?,?)').run(messageIdN, req.user.role, req.user.id, String(reason || '').slice(0, 500));
  const { createNotification, logActivity } = require('../lib/helpers');
  logActivity(req.user.role, req.user.id, 'message.report', `message ${messageIdN}`);
  res.status(201).json({ ok: true });
});

// ---------- Real-time stream (SSE) ----------
router.get('/messages/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  const remove = hub.add(req.user.role, req.user.id, res);
  req.on('close', remove);
});

// Upload errors (too large, too many files, bad type) → JSON instead of HTML.
router.use((err, req, res, next) => {
  if (!err) return next();
  const code = err.code || '';
  if (code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each file must be 20 MB or smaller.' });
  if (code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'You can attach up to 5 files per message.' });
  if (code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files. You can attach up to 5 per message.' });
  if (String(err.message || '').includes('file type is not allowed') || String(err.message || '').includes('File type not allowed')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Upload errors (too large / disallowed type / too many files) → JSON, not Express HTML
router.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || String(err.message || '').includes('not allowed'))) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
