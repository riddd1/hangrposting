const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dbPath = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'data.sqlite')
  : path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_plain TEXT,
  role TEXT NOT NULL CHECK(role IN ('master','poster')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poster_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const linkCols = db.prepare("PRAGMA table_info(links)").all().map(c => c.name);
if (!linkCols.includes('platform')) {
  db.exec('ALTER TABLE links ADD COLUMN platform TEXT');
}

const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('password_plain')) {
  db.exec('ALTER TABLE users ADD COLUMN password_plain TEXT');
}
if (!userCols.includes('daily_quota')) {
  db.exec('ALTER TABLE users ADD COLUMN daily_quota INTEGER NOT NULL DEFAULT 1');
}

function seedMaster() {
  const password = process.env.MASTER_PASSWORD || 'changeme123';
  const existing = db.prepare("SELECT id FROM users WHERE role = 'master'").get();
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (name, password_hash, role) VALUES (?, ?, ?)').run('Master', hash, 'master');
    console.log(`[seed] master password: ${password} (set MASTER_PASSWORD env var to change it)`);
  }
}
seedMaster();

module.exports = db;
