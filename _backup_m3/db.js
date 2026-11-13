// APALINK database — SQLite via Node's built-in node:sqlite (no native build needed).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'apalink.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

// Apply schema (idempotent)
const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');
db.exec(schema);

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

function seed() {
  const insDept = db.prepare('INSERT OR IGNORE INTO departments (name, code) VALUES (?, ?)');
  for (const [name, code] of DEFAULT_DEPARTMENTS) insDept.run(name, code);
  const insLevel = db.prepare('INSERT OR IGNORE INTO academic_levels (name) VALUES (?)');
  for (const name of DEFAULT_LEVELS) insLevel.run(name);
}
seed();

module.exports = db;
