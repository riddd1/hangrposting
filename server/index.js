const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function sign(user) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function genPassword() {
  // random 10-digit password, digits 0-9 each used exactly once
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.join('');
}

// ---- auth: password only, no username ----
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  const users = db.prepare('SELECT * FROM users').all();
  const user = users.find(u => bcrypt.compareSync(password, u.password_hash));
  if (!user) return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: sign(user), name: user.name, role: user.role });
});

// ---- master: manage posters, see everything ----
app.post('/api/master/posters', auth('master'), (req, res) => {
  const { name, password: customPassword } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  if (customPassword && customPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const password = customPassword || genPassword();
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, password_hash, password_plain, role) VALUES (?, ?, ?, ?)').run(name.trim(), hash, password, 'poster');
  res.json({ id: info.lastInsertRowid, name: name.trim(), password });
});

app.get('/api/master/posters', auth('master'), (req, res) => {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const posters = db.prepare(`
    SELECT u.id, u.name, u.password_plain AS password, u.daily_quota, u.created_at,
      (SELECT COUNT(*) FROM links l WHERE l.poster_id = u.id) AS link_count,
      (SELECT COUNT(*) FROM links l WHERE l.poster_id = u.id AND l.created_at >= ?) AS today_count
    FROM users u WHERE u.role = 'poster'
    ORDER BY u.created_at DESC
  `).all(todayStart);
  res.json({ posters });
});

app.post('/api/master/posters/:id/quota', auth('master'), (req, res) => {
  const id = Number(req.params.id);
  const quota = Number(req.body?.quota);
  if (!Number.isInteger(quota) || quota < 0) return res.status(400).json({ error: 'Quota must be a whole number ≥ 0' });
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'poster'").get(id);
  if (!user) return res.status(404).json({ error: 'Poster not found' });
  db.prepare('UPDATE users SET daily_quota = ? WHERE id = ?').run(quota, id);
  res.json({ success: true, quota });
});

app.get('/api/master/stats', auth('master'), (req, res) => {
  const range = req.query.range || 'all';
  let since = null;
  if (range === 'today') since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  else if (range === '7d') since = new Date(Date.now() - 7 * 86400000).toISOString();
  else if (range === '30d') since = new Date(Date.now() - 30 * 86400000).toISOString();

  const totalPosters = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'poster'").get().c;
  const totalLinks = since
    ? db.prepare("SELECT COUNT(*) c FROM links WHERE created_at >= ?").get(since).c
    : db.prepare('SELECT COUNT(*) c FROM links').get().c;
  const linksToday = db.prepare("SELECT COUNT(*) c FROM links WHERE created_at >= ?")
    .get(new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).c;
  const activePosters = since
    ? db.prepare('SELECT COUNT(DISTINCT poster_id) c FROM links WHERE created_at >= ?').get(since).c
    : db.prepare('SELECT COUNT(DISTINCT poster_id) c FROM links').get().c;

  res.json({ totalPosters, totalLinks, linksToday, activePosters });
});

app.get('/api/master/links', auth('master'), (req, res) => {
  const { from, to, poster } = req.query;
  let sql = `SELECT l.id, l.url, l.platform, l.created_at, u.name AS poster
             FROM links l JOIN users u ON u.id = l.poster_id WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND l.created_at >= ?'; params.push(from); }
  if (to) { sql += ' AND l.created_at <= ?'; params.push(to + ' 23:59:59'); }
  if (poster) { sql += ' AND l.poster_id = ?'; params.push(Number(poster)); }
  sql += ' ORDER BY l.created_at DESC LIMIT 500';
  const links = db.prepare(sql).all(...params);
  res.json({ links });
});

app.delete('/api/master/posters/:id', auth('master'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'poster'").get(id);
  if (!user) return res.status(404).json({ error: 'Poster not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/master/posters/:id/reset-password', auth('master'), (req, res) => {
  const id = Number(req.params.id);
  const { password: customPassword } = req.body || {};
  if (customPassword && customPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'poster'").get(id);
  if (!user) return res.status(404).json({ error: 'Poster not found' });
  const password = customPassword || genPassword();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?').run(hash, password, id);
  res.json({ success: true, password });
});

// ---- poster: submit + view own links ----
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'snapchat'];

app.post('/api/poster/links', auth('poster'), (req, res) => {
  const { url, platform } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'A valid http(s) URL is required' });
  if (!platform || !PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Pick which app this link is from' });
  const info = db.prepare('INSERT INTO links (poster_id, url, platform) VALUES (?, ?, ?)')
    .run(req.user.id, url.trim(), platform);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/poster/links', auth('poster'), (req, res) => {
  const links = db.prepare('SELECT id, url, platform, created_at FROM links WHERE poster_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const user = db.prepare('SELECT daily_quota FROM users WHERE id = ?').get(req.user.id);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const todayCount = db.prepare('SELECT COUNT(*) c FROM links WHERE poster_id = ? AND created_at >= ?')
    .get(req.user.id, todayStart).c;
  res.json({ links, quota: user.daily_quota, todayCount });
});

app.get('/api/master/grid', auth('master'), (req, res) => {
  let { from, to } = req.query;
  if (!to) to = new Date().toISOString().slice(0, 10);
  if (!from) from = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);

  const dates = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end && dates.length < 62) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const posters = db.prepare("SELECT id, name FROM users WHERE role = 'poster' ORDER BY name COLLATE NOCASE").all();
  const rowsStmt = db.prepare(`
    SELECT date(created_at) d, COUNT(*) c FROM links
    WHERE poster_id = ? AND date(created_at) BETWEEN ? AND ?
    GROUP BY d
  `);

  const result = posters.map(p => {
    const rows = rowsStmt.all(p.id, from, to);
    const counts = {};
    rows.forEach(r => { counts[r.d] = r.c; });
    return { id: p.id, name: p.name, counts };
  });

  res.json({ dates, posters: result });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
