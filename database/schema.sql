-- APALINK SQLite schema (Milestone 1: authentication foundation)
-- Future-ready: notes, uploads, downloads tables prepared for Milestone 2+.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS academic_levels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  academic_level_id INTEGER REFERENCES academic_levels(id),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, department_id, academic_level_id)
);

CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name   TEXT NOT NULL,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email       TEXT UNIQUE COLLATE NOCASE,
  section_id  INTEGER NOT NULL REFERENCES departments(id),
  class_name  TEXT NOT NULL DEFAULT '',
  level_id    INTEGER NOT NULL REFERENCES academic_levels(id),
  school_id   INTEGER REFERENCES schools(id),
  password_hash TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name   TEXT NOT NULL,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email       TEXT UNIQUE COLLATE NOCASE,
  school_id   INTEGER REFERENCES schools(id),
  teacher_code  TEXT UNIQUE,
  phone       TEXT,
  password_hash TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  student_id  INTEGER REFERENCES students(id) ON DELETE CASCADE,
  teacher_id  INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- Milestone 2+ (created now, used later) ----
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  department_id INTEGER NOT NULL REFERENCES departments(id),
  academic_level_id INTEGER NOT NULL REFERENCES academic_levels(id),
  class_name  TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id),
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS note_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS note_downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_students_username ON students(username);
CREATE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username);
CREATE INDEX IF NOT EXISTS idx_notes_dept_level ON notes(department_id, academic_level_id);
CREATE INDEX IF NOT EXISTS idx_notes_teacher ON notes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_saved_student ON saved_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_downloads_student ON note_downloads(student_id);

-- ============ Milestone 3: admin, timetables, messaging, settings ============
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS academic_periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timetable_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  department_id   INTEGER NOT NULL REFERENCES departments(id),
  academic_level_id INTEGER NOT NULL REFERENCES academic_levels(id),
  class_name      TEXT NOT NULL DEFAULT '',
  period_id       INTEGER REFERENCES academic_periods(id),
  file_name       TEXT,
  file_path       TEXT,
  file_size       INTEGER NOT NULL DEFAULT 0,
  mime_type       TEXT NOT NULL DEFAULT '',
  is_published    INTEGER NOT NULL DEFAULT 0,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER NOT NULL REFERENCES admins(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   INTEGER NOT NULL REFERENCES timetable_documents(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  subject       TEXT NOT NULL DEFAULT '',
  teacher_id    INTEGER REFERENCES teachers(id),
  teacher_name  TEXT NOT NULL DEFAULT '',
  classroom     TEXT NOT NULL DEFAULT '',
  start_time    TEXT NOT NULL DEFAULT '08:00',
  end_time      TEXT NOT NULL DEFAULT '09:00',
  is_break      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('student','teacher')),
  participant_id   INTEGER NOT NULL,
  last_read_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversation_id, participant_role, participant_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('student','teacher')),
  sender_id       INTEGER NOT NULL,
  body            TEXT NOT NULL,
  is_hidden       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Files shared inside a direct message (max 5 per message, enforced in the API).
CREATE TABLE IF NOT EXISTS message_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_role   TEXT NOT NULL,
  reporter_id     INTEGER NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','hidden','dismissed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_role    TEXT NOT NULL, blocker_id INTEGER NOT NULL,
  blocked_role    TEXT NOT NULL, blocked_id INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (blocker_role, blocker_id, blocked_role, blocked_id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_role       TEXT NOT NULL, user_id INTEGER NOT NULL,
  pref_key        TEXT NOT NULL,
  pref_value      TEXT NOT NULL DEFAULT '',
  UNIQUE (user_role, user_id, pref_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_role  TEXT NOT NULL, recipient_id INTEGER NOT NULL,
  type            TEXT NOT NULL DEFAULT 'general',
  title           TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  link            TEXT,
  is_read         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_role      TEXT NOT NULL, actor_id INTEGER NOT NULL,
  action          TEXT NOT NULL,
  details         TEXT NOT NULL DEFAULT '',
  hidden_by_user  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Milestone 5: schools, announcements, per-user history, admin messages ============
CREATE TABLE IF NOT EXISTS schools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  district    TEXT NOT NULL,
  sector      TEXT NOT NULL DEFAULT '',
  code        TEXT UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, district)
);

CREATE TABLE IF NOT EXISTS announcements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','academic','event','urgent')),
  audience      TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','teachers')),
  school_id     INTEGER REFERENCES schools(id),
  is_pinned     INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES admins(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Administration <-> user direct messages (kept separate from student/teacher chat).
CREATE TABLE IF NOT EXISTS admin_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id        INTEGER NOT NULL REFERENCES admins(id),
  user_role       TEXT NOT NULL CHECK (user_role IN ('student','teacher')),
  user_id         INTEGER NOT NULL,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('admin','student','teacher')),
  body            TEXT NOT NULL,
  is_read_by_admin INTEGER NOT NULL DEFAULT 0,
  is_read_by_user  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schools_district ON schools(district, name);
CREATE INDEX IF NOT EXISTS idx_announcements_pub ON announcements(is_published, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_messages_user ON admin_messages(user_role, user_id, id);

CREATE INDEX IF NOT EXISTS idx_tt_scope ON timetable_documents(department_id, academic_level_id, class_name);
CREATE INDEX IF NOT EXISTS idx_tt_entries_doc ON timetable_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_tt_entries_teacher ON timetable_entries(teacher_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants ON conversation_participants(participant_role, participant_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_attachments_msg ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_role, recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_activity_log ON activity_log(created_at);
