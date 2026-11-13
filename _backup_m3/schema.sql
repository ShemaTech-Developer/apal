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
