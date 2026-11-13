// APALINK database — SQLite via Node's built-in node:sqlite (no native build needed).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'apalink.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
// Multi-process safety: WAL lets readers run alongside writers, and a busy
// timeout makes SQLite WAIT for the lock instead of throwing "database is
// locked" — which used to reject async routes and crash the whole server.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Apply schema (idempotent)
const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');
db.exec(schema);

// Milestone 3 column migrations (safe, additive only)
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
ensureColumn('students', 'avatar_path', 'TEXT');
ensureColumn('students', 'last_login_at', 'TEXT');
ensureColumn('students', 'school_id', 'INTEGER');
ensureColumn('teachers', 'avatar_path', 'TEXT');
ensureColumn('teachers', 'last_login_at', 'TEXT');
ensureColumn('teachers', 'school_id', 'INTEGER');
// The administrator has a profile picture too (defaults handled by the app).
ensureColumn('admins', 'avatar_path', 'TEXT');
// Admins are either the whole-app super admin (school_id NULL) or a school sub-admin (school_id set).
ensureColumn('admins', 'school_id', 'INTEGER');
// Announcements can also be targeted at one class (department + level + class name).
ensureColumn('announcements', 'department_id', 'INTEGER');
ensureColumn('announcements', 'level_id', 'INTEGER');
ensureColumn('announcements', 'class_name', 'TEXT');
// E-Class scheduled time windows + the late-join approval flow.
ensureColumn('eclasses', 'start_time', 'TEXT');
ensureColumn('eclasses', 'end_time', 'TEXT');
ensureColumn('eclass_participants', 'status', "TEXT NOT NULL DEFAULT 'joined'");
ensureColumn('eclass_participants', 'requested_at', 'TEXT');
ensureColumn('eclass_participants', 'decided_at', 'TEXT');
ensureColumn('eclass_participants', 'decided_by', 'TEXT');
// Empty emails would collide on the UNIQUE index — keep them NULL instead.
db.exec("UPDATE teachers SET email=NULL WHERE email=''");
db.exec("UPDATE students SET email=NULL WHERE email=''");
db.exec("UPDATE admins SET email=NULL WHERE email=''");
// E-Class: online video teaching (live classes, participants, in-class chat).
db.exec(`
CREATE TABLE IF NOT EXISTS eclasses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL,
  level_id       INTEGER NOT NULL,
  class_name     TEXT    NOT NULL DEFAULT '',
  title          TEXT    NOT NULL DEFAULT '',
  subject        TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at       TEXT
);
CREATE TABLE IF NOT EXISTS eclass_participants (
  eclass_id      INTEGER NOT NULL REFERENCES eclasses(id) ON DELETE CASCADE,
  role           TEXT    NOT NULL CHECK (role IN ('student','teacher','admin')),
  user_id        INTEGER NOT NULL,
  joined_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  left_at        TEXT,
  removed_at     TEXT,
  removed_by     TEXT,
  PRIMARY KEY (eclass_id, role, user_id)
);
CREATE TABLE IF NOT EXISTS eclass_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  eclass_id      INTEGER NOT NULL REFERENCES eclasses(id) ON DELETE CASCADE,
  author_role    TEXT    NOT NULL,
  author_id      INTEGER NOT NULL,
  body           TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eclasses_live ON eclasses(status, department_id, level_id, class_name);
CREATE INDEX IF NOT EXISTS idx_eclass_messages ON eclass_messages(eclass_id, id);
`);
// Teachers are assigned to sections (departments) — any number, including all of them.
db.exec(`CREATE TABLE IF NOT EXISTS teacher_sections (
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL REFERENCES departments(id),
  assigned_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (teacher_id, department_id)
)`);
// Migrate class-level assignments (teacher_classes) to section-level — keeps existing data.
try { db.exec('INSERT OR IGNORE INTO teacher_sections (teacher_id, department_id) SELECT DISTINCT teacher_id, department_id FROM teacher_classes'); } catch (e) {}
try { db.exec('DROP TABLE IF EXISTS teacher_classes'); } catch (e) {}
ensureColumn('teachers', 'teacher_code', 'TEXT');
ensureColumn('teachers', 'subject', 'TEXT');
ensureColumn('teachers', 'phone', 'TEXT');
// APALINK Assign Teachers — teacher codes (TC001…) are unique across the school.
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_code ON teachers(teacher_code)'); } catch (e) { /* pre-existing duplicates are backfilled below */ }
(function backfillTeacherCodes() {
  const rows = db.prepare("SELECT id FROM teachers WHERE teacher_code IS NULL OR teacher_code='' ORDER BY id").all();
  if (!rows.length) return;
  const used = new Set(db.prepare("SELECT teacher_code c FROM teachers WHERE teacher_code IS NOT NULL AND teacher_code<>''").all().map(r => r.c));
  let n = 0;
  const upd = db.prepare('UPDATE teachers SET teacher_code=? WHERE id=?');
  while (rows.length) {
    n++;
    const code = 'TC' + String(n).padStart(3, '0');
    if (used.has(code)) continue;
    used.add(code);
    upd.run(code, rows.shift().id);
  }
})();
ensureColumn('activity_log', 'hidden_by_user', 'INTEGER NOT NULL DEFAULT 0');

const DEFAULT_DEPARTMENTS = [
  ['Mathematics & Sciences — Stream 1', 'MATH-S1'],
  ['Mathematics & Sciences — Stream 2', 'MATH-S2'],
  ['Computer Systems and Architecture', 'CSA'],
  ['Software Development', 'SOD'],
  ['Networking and Internet Technologies', 'NIT'],
  ['Electronics and Telecommunication', 'ET'],
  ['Professional Accounting', 'PA'],
  ['Multimedia Production', 'MP'],
  ['Tourism and Hospitality', 'TH'],
  ['Food and Beverage Operations', 'FBO'],
  ['Building and Construction Services', 'BCS'],
];
const DEFAULT_LEVELS = ['Level 3', 'Level 4', 'Level 5', 'Senior 4', 'Senior 5', 'Senior 6'];

// Rwanda's 30 districts (used by the student registration school picker).
const RWANDA_DISTRICTS = [
  'Gasabo', 'Kicukiro', 'Nyarugenge', 'Burera', 'Gakenke', 'Gicumbi', 'Musanze', 'Rulindo',
  'Gisagara', 'Huye', 'Kamonyi', 'Muhanga', 'Nyamagabe', 'Nyanza', 'Nyaruguru', 'Ruhango',
  'Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana',
  'Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro',
];

// A representative catalogue of Rwandan schools (name, district, sector).
// Administrators can add more from the Admin Console.
const DEFAULT_SCHOOLS = [
  ['APADE Secondary School', 'Gicumbi', 'Byumba'],
  ['Green Hills Academy', 'Gasabo', 'Kacyiru'],
  ['Kigali International Community School', 'Gasabo', 'Kacyiru'],
  ['Kigali Christian School', 'Gasabo', 'Kimironko'],
  ['Wellspring Academy', 'Gasabo', 'Kacyiru'],
  ['Groupe Scolaire Kimironko', 'Gasabo', 'Kimironko'],
  ['Groupe Scolaire Remera', 'Gasabo', 'Remera'],
  ['Groupe Scolaire Kicukiro', 'Kicukiro', 'Kicukiro'],
  ['Kigali Parents School', 'Kicukiro', 'Niboye'],
  ['Riviera High School', 'Kicukiro', 'Niboye'],
  ['Groupe Scolaire Gatenga', 'Kicukiro', 'Gatenga'],
  ['Ecole Saint Michel', 'Kicukiro', 'Kicukiro'],
  ['Lycée de Kigali', 'Nyarugenge', 'Nyamirambo'],
  ['Groupe Scolaire Nyamirambo', 'Nyarugenge', 'Nyamirambo'],
  ['Lycée Notre-Dame de Cîteaux', 'Nyarugenge', 'Nyamirambo'],
  ['Groupe Scolaire Nyarugenge', 'Nyarugenge', 'Nyarugenge'],
  ['Groupe Scolaire Musanze', 'Musanze', 'Muhoza'],
  ['Lycée de Musanze', 'Musanze', 'Muhoza'],
  ['Sonrise School', 'Musanze', 'Muhoza'],
  ['Groupe Scolaire Ruhengeri', 'Musanze', 'Cyuve'],
  ['Groupe Scolaire Burera', 'Burera', 'Butaro'],
  ['Lycée de Burera', 'Burera', 'Butaro'],
  ['Groupe Scolaire Gakenke', 'Gakenke', 'Gakenke'],
  ['Groupe Scolaire Byumba', 'Gicumbi', 'Byumba'],
  ['Lycée de Gicumbi', 'Gicumbi', 'Byumba'],
  ['Groupe Scolaire Rulindo', 'Rulindo', 'Tare'],
  ['Groupe Scolaire Officiel de Butare', 'Huye', 'Ngoma'],
  ['Lycée de Huye', 'Huye', 'Ngoma'],
  ['Groupe Scolaire Huye', 'Huye', 'Huye'],
  ['Lycée de Nyanza', 'Nyanza', 'Busasamana'],
  ['Groupe Scolaire Nyanza', 'Nyanza', 'Nyanza'],
  ['Groupe Scolaire Muhanga', 'Muhanga', 'Muhanga'],
  ['Lycée de Muhanga', 'Muhanga', 'Muhanga'],
  ['Groupe Scolaire Kamonyi', 'Kamonyi', 'Runda'],
  ['Byimana School of Sciences', 'Ruhango', 'Byimana'],
  ['Groupe Scolaire Ruhango', 'Ruhango', 'Ruhango'],
  ['Groupe Scolaire Gisagara', 'Gisagara', 'Mamba'],
  ['Groupe Scolaire Nyaruguru', 'Nyaruguru', 'Kibeho'],
  ['Groupe Scolaire Nyamagabe', 'Nyamagabe', 'Gasaka'],
  ['Groupe Scolaire Rwamagana', 'Rwamagana', 'Kigabiro'],
  ['Lycée de Rwamagana', 'Rwamagana', 'Kigabiro'],
  ['Groupe Scolaire Kayonza', 'Kayonza', 'Mukarange'],
  ['Groupe Scolaire Kibungo', 'Ngoma', 'Kibungo'],
  ['Lycée de Kibungo', 'Ngoma', 'Kibungo'],
  ['Groupe Scolaire Bugesera', 'Bugesera', 'Nyamata'],
  ['Groupe Scolaire Gatsibo', 'Gatsibo', 'Kabarore'],
  ['Groupe Scolaire Nyagatare', 'Nyagatare', 'Nyagatare'],
  ['Lycée de Nyagatare', 'Nyagatare', 'Nyagatare'],
  ['Groupe Scolaire Kirehe', 'Kirehe', 'Kirehe'],
  ['Groupe Scolaire Rubavu', 'Rubavu', 'Gisenyi'],
  ['Nyundo School of Art', 'Rubavu', 'Nyundo'],
  ['Lycée de Rubavu', 'Rubavu', 'Gisenyi'],
  ['Groupe Scolaire Rusizi', 'Rusizi', 'Kamembe'],
  ['Lycée de Rusizi', 'Rusizi', 'Kamembe'],
  ['Groupe Scolaire Karongi', 'Karongi', 'Rubengera'],
  ['Groupe Scolaire Nyamasheke', 'Nyamasheke', 'Nyamasheke'],
  ['Groupe Scolaire Rutsiro', 'Rutsiro', 'Rutsiro'],
  ['Groupe Scolaire Ngororero', 'Ngororero', 'Ngororero'],
  ['Groupe Scolaire Nyabihu', 'Nyabihu', 'Mukamira'],
];

function seed() {
  const insDept = db.prepare('INSERT OR IGNORE INTO departments (name, code) VALUES (?, ?)');
  for (const [name, code] of DEFAULT_DEPARTMENTS) insDept.run(name, code);
  const insLevel = db.prepare('INSERT OR IGNORE INTO academic_levels (name) VALUES (?)');
  for (const name of DEFAULT_LEVELS) insLevel.run(name);
  const insSchool = db.prepare('INSERT OR IGNORE INTO schools (name, district, sector) VALUES (?, ?, ?)');
  for (const [name, district, sector] of DEFAULT_SCHOOLS) insSchool.run(name, district, sector);
  // Admin bootstrap from environment (never from frontend).
  const adminUser = process.env.ADMIN_USERNAME, adminPass = process.env.ADMIN_PASSWORD;
  if (adminUser && adminPass) {
    const bcrypt = require('bcryptjs');
    const exists = db.prepare('SELECT id, password_hash FROM admins WHERE username=? COLLATE NOCASE').get(adminUser);
    if (!exists) {
      const hash = bcrypt.hashSync(adminPass, 12);
      db.prepare('INSERT INTO admins (full_name, username, email, password_hash) VALUES (?,?,?,?)')
        .run('School Administrator', adminUser, null, hash);
      console.log('Admin account bootstrapped from ADMIN_USERNAME.');
    } else if (!bcrypt.compareSync(adminPass, exists.password_hash)) {
      // Env password is authoritative in development: sync it on boot.
      db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(adminPass, 12), exists.id);
      console.log('Admin password synced from ADMIN_PASSWORD env.');
    }
  }
}
seed();

module.exports = db;
