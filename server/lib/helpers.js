// Shared helpers: requester resolution, notifications, SSE hub, preferences.
const db = require('../database/db');
const crypto = require('crypto');

function resolveUser(req) {
  if (req.session && req.session.adminId) return { role: 'admin', id: req.session.adminId, table: 'admins' };
  if (req.session && req.session.teacherId) return { role: 'teacher', id: req.session.teacherId, table: 'teachers' };
  if (req.session && req.session.studentId) return { role: 'student', id: req.session.studentId, table: 'students' };
  return null;
}
function getUser(table, id) { return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id); }
// The signed-in admin + their school scope (null = whole-app super admin).
function getAdminRow(req) {
  if (!req.session || !req.session.adminId) return null;
  return db.prepare('SELECT * FROM admins WHERE id=?').get(req.session.adminId);
}
function getAdminSchoolId(req) {
  const a = getAdminRow(req);
  if (!a) return null;
  return a.school_id ? Number(a.school_id) : null;
}
// Find a school by its own access code (each school has a different password/code).
function getSchoolByCode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const schools = db.prepare('SELECT * FROM schools WHERE is_active=1').all();
  for (const s of schools) {
    const a = Buffer.from(String(s.code || ''));
    const b = Buffer.from(c);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}

function getPrefs(role, id) {
  const rows = db.prepare('SELECT pref_key, pref_value FROM user_preferences WHERE user_role=? AND user_id=?').all(role, id);
  const out = {};
  for (const r of rows) out[r.pref_key] = r.pref_value;
  return out;
}
const PREF_DEFAULTS = {
  theme: 'system', fontSize: 'medium', motion: 'system', accent: 'yellow',
  profileVisibility: 'school', onlineVisibility: 'school', messagePrivacy: 'school',
  notif_messages: 'on', notif_notes: 'on', notif_timetable: 'on', notif_announcements: 'on',
  language: 'en', dateFormat: 'YYYY-MM-DD', timeFormat: '24h', timezone: 'local',
};
const PREF_ALLOWED = {
  theme: ['system', 'light', 'dark'],
  fontSize: ['small', 'medium', 'large'],
  motion: ['system', 'full', 'reduced'],
  accent: ['yellow', 'navy'],
  profileVisibility: ['school', 'classmates', 'private'],
  onlineVisibility: ['school', 'private'],
  messagePrivacy: ['school', 'classmates', 'nobody'],
  notif_messages: ['on', 'off'], notif_notes: ['on', 'off'], notif_timetable: ['on', 'off'], notif_announcements: ['on', 'off'],
  language: ['en', 'fr', 'rw'],
  dateFormat: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
  timeFormat: ['12h', '24h'],
  timezone: null, // any string ≤ 60 chars
};

function createNotification(role, id, type, title, body, link) {
  if (!id) return 0;
  const prefs = getPrefs(role, id);
  const prefKey = { messages: 'notif_messages', notes: 'notif_notes', timetable: 'notif_timetable', announcements: 'notif_announcements' }[type];
  if (prefKey && prefs[prefKey] === 'off') return 0; // opted out — respect it
  const info = db.prepare('INSERT INTO notifications (recipient_role, recipient_id, type, title, body, link) VALUES (?,?,?,?,?,?)')
    .run(role, id, type, title, body, link || null);
  hub.push(role, id, { type: 'notification', notificationId: info.lastInsertRowid });
  hub.push(role, id, { type: 'unread' });
  return info.lastInsertRowid ? 1 : 0;
}
function logActivity(role, id, action, details) {
  try { db.prepare('INSERT INTO activity_log (actor_role, actor_id, action, details) VALUES (?,?,?,?)').run(role, id, action, String(details || '').slice(0, 500)); } catch {}
}

// ---- Lightweight in-memory presence ----
// Heartbeats from dashboards/messaging mark a user active; absence for 70s = offline.
const presence = new Map();
function touchPresence(role, id) {
  if (role && id) presence.set(role + ':' + id, Date.now());
}
function isOnline(role, id) {
  const t = presence.get(role + ':' + id);
  return !!t && (Date.now() - t) < 70 * 1000;
}

// ---- SSE hub (real-time push; REST endpoints remain the source of truth) ----
const hub = {
  clients: new Map(), // key "role:id" -> Set<res>
  key(role, id) { return role + ':' + id; },
  add(role, id, res) {
    const k = this.key(role, id);
    if (!this.clients.has(k)) this.clients.set(k, new Set());
    this.clients.get(k).add(res);
    return () => { const s = this.clients.get(k); if (s) s.delete(res); };
  },
  push(role, id, data) {
    const set = this.clients.get(this.key(role, id));
    if (!set) return;
    const line = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) { try { res.write(line); } catch {} }
  },
  heartbeat() {
    for (const set of this.clients.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch {} }
  },
};
setInterval(() => hub.heartbeat(), 25000).unref();

// ---------- Schools: students/admin type the school name, pick the district ----------
// Finds an active school by name (case-insensitive) and optional district; creates it if missing.
function resolveSchool(district, schoolName) {
  const name = String(schoolName || '').trim();
  const dist = String(district || '').trim();
  if (!name || name.length < 3 || name.length > 120) return null;
  const known = db.prepare('SELECT DISTINCT district FROM schools WHERE is_active=1 ORDER BY district').all().map(r => r.district);
  const chosen = dist || (known.length === 1 ? known[0] : '');
  const found = chosen
    ? db.prepare("SELECT id, name, district FROM schools WHERE is_active=1 AND name=? COLLATE NOCASE AND district=? COLLATE NOCASE").get(name, chosen)
    : db.prepare("SELECT id, name, district FROM schools WHERE is_active=1 AND name=? COLLATE NOCASE ORDER BY id LIMIT 1").get(name);
  if (found) return found;
  const info = db.prepare("INSERT INTO schools (name, district, code) VALUES (?,?,NULL)").run(name, chosen || 'Unknown');
  return { id: Number(info.lastInsertRowid), name, district: chosen || 'Unknown' };
}

// Phone: accept 0788… / 2507… / +2507… → store as +2507XXXXXXXX. Rwandan mobile numbers.
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s-()]/g, '');
  if (!p) return null;
  if (p.startsWith('0')) p = '+250' + p.slice(1);
  else if (p.startsWith('250')) p = '+' + p;
  if (!/^\+2507\d{8}$/.test(p)) return null;
  return p;
}

module.exports = { resolveUser, getUser, getPrefs, PREF_DEFAULTS, PREF_ALLOWED, createNotification, logActivity, hub, touchPresence, isOnline, resolveSchool, normalizePhone, getAdminRow, getAdminSchoolId, getSchoolByCode };
