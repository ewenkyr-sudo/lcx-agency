const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lcx-agency-secret-change-me-in-production';

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============ DATABASE ============
const db = new Database(process.env.DB_PATH || './agency.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    avatar_color TEXT DEFAULT '#8b5cf6',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platforms TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    current_followers INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    new_followers INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, date)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    shift TEXT,
    models_assigned TEXT DEFAULT '[]',
    platform TEXT,
    contact TEXT,
    status TEXT DEFAULT 'offline',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    program TEXT DEFAULT 'starter',
    start_date TEXT,
    models_signed INTEGER DEFAULT 0,
    active_discussions INTEGER DEFAULT 0,
    progression INTEGER DEFAULT 0,
    contact TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assigned_to TEXT,
    team TEXT,
    priority TEXT DEFAULT 'medium',
    deadline TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    type TEXT DEFAULT 'check-in',
    scheduled_at TEXT NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'scheduled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER,
    member_name TEXT,
    member_role TEXT,
    day_of_week INTEGER NOT NULL,
    shift_type TEXT DEFAULT 'off',
    shift_label TEXT DEFAULT 'OFF',
    week_start TEXT,
    FOREIGN KEY (member_id) REFERENCES team_members(id) ON DELETE CASCADE
  );
`);

// ============ SEED DEFAULT DATA ============
function seedData() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return;

  console.log('Seeding initial data...');

  // Create admin
  const adminHash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)').run('ewen', adminHash, 'Ewen', 'admin');

  // Create default passwords for roles
  const defaultHash = bcrypt.hashSync('team123', 10);
  const studentHash = bcrypt.hashSync('eleve123', 10);

  // Team users
  const teamUsers = [
    ['sarah', defaultHash, 'Sarah', 'chatter'],
    ['tom', defaultHash, 'Tom', 'chatter'],
    ['karim', defaultHash, 'Karim', 'chatter'],
    ['lea', defaultHash, 'Léa', 'chatter'],
    ['nathan', defaultHash, 'Nathan', 'chatter'],
    ['maxime', defaultHash, 'Maxime', 'outreach'],
    ['yasmine', defaultHash, 'Yasmine', 'outreach'],
    ['dylan', defaultHash, 'Dylan', 'outreach'],
    ['ines', defaultHash, 'Inès', 'outreach'],
    ['amine', defaultHash, 'Amine', 'va'],
    ['rania', defaultHash, 'Rania', 'va'],
    ['jules', defaultHash, 'Jules', 'va'],
  ];

  const insertUser = db.prepare('INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)');
  teamUsers.forEach(u => insertUser.run(...u));

  // Model users
  const modelUsers = [
    ['luna', defaultHash, 'Luna', 'model'],
    ['jade', defaultHash, 'Jade', 'model'],
    ['mia', defaultHash, 'Mia', 'model'],
    ['emma', defaultHash, 'Emma', 'model'],
    ['clara', defaultHash, 'Clara', 'model'],
  ];
  modelUsers.forEach(u => insertUser.run(...u));

  // Student users
  const studentUsers = [
    ['lucas', studentHash, 'Lucas', 'student'],
    ['theo', studentHash, 'Théo', 'student'],
    ['yassine', studentHash, 'Yassine', 'student'],
    ['enzo', studentHash, 'Enzo', 'student'],
    ['mehdi', studentHash, 'Mehdi', 'student'],
    ['rayan', studentHash, 'Rayan', 'student'],
  ];
  studentUsers.forEach(u => insertUser.run(...u));

  // Models
  const insertModel = db.prepare('INSERT INTO models (name, platforms, status) VALUES (?, ?, ?)');
  insertModel.run('Luna', '["onlyfans","fansly"]', 'active');
  insertModel.run('Jade', '["onlyfans"]', 'active');
  insertModel.run('Mia', '["onlyfans","fansly"]', 'active');
  insertModel.run('Emma', '["fansly"]', 'onboarding');
  insertModel.run('Clara', '["onlyfans"]', 'active');

  // Accounts
  const insertAccount = db.prepare('INSERT INTO accounts (model_id, platform, handle, current_followers) VALUES (?, ?, ?, ?)');
  // Luna
  insertAccount.run(1, 'onlyfans', '@luna_exclusive', 1247);
  insertAccount.run(1, 'instagram', '@luna.model', 5420);
  insertAccount.run(1, 'tiktok', '@luna_vibes', 3210);
  insertAccount.run(1, 'telegram', '@luna_vip', 682);
  // Jade
  insertAccount.run(2, 'onlyfans', '@jade_premium', 892);
  insertAccount.run(2, 'instagram', '@jade.official', 4180);
  insertAccount.run(2, 'tiktok', '@jadexoxo', 2890);
  insertAccount.run(2, 'telegram', '@jade_premium_tg', 0);
  // Mia
  insertAccount.run(3, 'onlyfans', '@mia_dreams', 634);
  insertAccount.run(3, 'instagram', '@mia.content', 3120);
  insertAccount.run(3, 'tiktok', '@miadreams', 1540);
  insertAccount.run(3, 'telegram', '@mia_vip_group', 736);
  // Emma
  insertAccount.run(4, 'onlyfans', '@emma_exclusive', 189);
  insertAccount.run(4, 'instagram', '@emma.new', 1240);
  // Clara
  insertAccount.run(5, 'onlyfans', '@clara_vip', 312);
  insertAccount.run(5, 'instagram', '@clara.lifestyle', 860);
  insertAccount.run(5, 'telegram', '@claravip_channel', 420);

  // Sample daily stats (last 7 days)
  const insertStat = db.prepare('INSERT OR IGNORE INTO daily_stats (account_id, date, new_followers) VALUES (?, ?, ?)');
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    // Generate random stats for each account
    for (let accId = 1; accId <= 17; accId++) {
      const base = accId <= 4 ? 15 : accId <= 8 ? 10 : 7;
      const val = Math.max(-2, Math.floor(Math.random() * base * 2) + 1);
      insertStat.run(accId, dateStr, val);
    }
  }

  // Students
  const insertStudent = db.prepare('INSERT INTO students (user_id, name, program, start_date, models_signed, active_discussions, progression, contact, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertStudent.run(19, 'Lucas', 'elite', '2026-01-15', 4, 5, 75, '@lucas_dc', 'active');
  insertStudent.run(20, 'Théo', 'vip', '2026-02-01', 3, 4, 60, '@theo_dc', 'active');
  insertStudent.run(21, 'Yassine', 'pro', '2026-03-01', 1, 7, 35, '@yassine_dc', 'active');
  insertStudent.run(22, 'Enzo', 'elite', '2025-12-10', 3, 2, 85, '@enzo_dc', 'active');
  insertStudent.run(23, 'Mehdi', 'starter', '2026-03-15', 0, 3, 15, '@mehdi_dc', 'active');
  insertStudent.run(24, 'Rayan', 'pro', '2026-02-10', 2, 2, 50, '@rayan_dc', 'active');

  // Team members
  const insertMember = db.prepare('INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertMember.run(2, 'Sarah', 'chatter', '08h-16h', '["Luna","Jade"]', null, '@sarah_dc', 'online');
  insertMember.run(3, 'Tom', 'chatter', '16h-00h', '["Luna","Mia"]', null, '@tom_dc', 'online');
  insertMember.run(4, 'Karim', 'chatter', '00h-08h', '["Jade","Clara"]', null, '@karim_dc', 'offline');
  insertMember.run(5, 'Léa', 'chatter', '08h-16h', '["Mia","Emma"]', null, '@lea_dc', 'online');
  insertMember.run(6, 'Nathan', 'chatter', '16h-00h', '["Luna","Clara"]', null, '@nathan_dc', 'break');
  insertMember.run(7, 'Maxime', 'outreach', '09h-17h', '[]', 'Instagram', '@maxime_dc', 'online');
  insertMember.run(8, 'Yasmine', 'outreach', '09h-17h', '[]', 'TikTok, Reddit', '@yasmine_dc', 'online');
  insertMember.run(9, 'Dylan', 'outreach', '14h-22h', '[]', 'Twitter, Reddit', '@dylan_dc', 'offline');
  insertMember.run(10, 'Inès', 'outreach', '09h-17h', '[]', 'Instagram, TikTok', '@ines_dc', 'online');
  insertMember.run(11, 'Amine', 'va', '07h-15h', '[]', null, '@amine_dc', 'online');
  insertMember.run(12, 'Rania', 'va', '09h-17h', '[]', null, '@rania_dc', 'online');
  insertMember.run(13, 'Jules', 'va', '14h-22h', '[]', null, '@jules_dc', 'offline');

  // Agency settings
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('agency_name', 'LCX Agency');
  insertSetting.run('agency_subtitle', 'Management Suite');
  insertSetting.run('default_password_team', 'team123');
  insertSetting.run('default_password_student', 'eleve123');

  console.log('Seed complete!');
}

seedData();

// ============ AUTH MIDDLEWARE ============
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

// ============ AUTH ROUTES ============
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, display_name: user.display_name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ============ USERS CRUD (Admin only) ============
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY role, display_name').all();
  res.json(users);
});

app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name || !role) return res.status(400).json({ error: 'Champs requis manquants' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)').run(username, hash, display_name, role);
    res.json({ id: result.lastInsertRowid, username, display_name, role });
  } catch (e) {
    res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
  }
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ STUDENTS CRUD ============
app.get('/api/students', authMiddleware, (req, res) => {
  if (req.user.role === 'student') {
    const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);
    return res.json(student ? [student] : []);
  }
  const students = db.prepare('SELECT s.*, u.username FROM students s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.name').all();
  res.json(students);
});

app.post('/api/students', authMiddleware, adminOnly, (req, res) => {
  const { name, program, start_date, contact, user_id } = req.body;
  const result = db.prepare('INSERT INTO students (user_id, name, program, start_date, contact) VALUES (?, ?, ?, ?, ?)').run(user_id || null, name, program || 'starter', start_date, contact);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/students/:id', authMiddleware, adminOnly, (req, res) => {
  const { name, program, models_signed, active_discussions, progression, contact, status } = req.body;
  db.prepare(`UPDATE students SET
    name = COALESCE(?, name), program = COALESCE(?, program), models_signed = COALESCE(?, models_signed),
    active_discussions = COALESCE(?, active_discussions), progression = COALESCE(?, progression),
    contact = COALESCE(?, contact), status = COALESCE(?, status) WHERE id = ?`
  ).run(name, program, models_signed, active_discussions, progression, contact, status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/students/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ TEAM MEMBERS CRUD ============
app.get('/api/team', authMiddleware, (req, res) => {
  const role = req.query.role;
  let query = 'SELECT * FROM team_members';
  if (role) query += ` WHERE role = '${role}'`;
  query += ' ORDER BY name';
  res.json(db.prepare(query).all());
});

app.post('/api/team', authMiddleware, adminOnly, (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, user_id } = req.body;
  const result = db.prepare('INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user_id || null, name, role, shift, JSON.stringify(models_assigned || []), platform, contact);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/team/:id', authMiddleware, adminOnly, (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, status } = req.body;
  db.prepare(`UPDATE team_members SET
    name = COALESCE(?, name), role = COALESCE(?, role), shift = COALESCE(?, shift),
    models_assigned = COALESCE(?, models_assigned), platform = COALESCE(?, platform),
    contact = COALESCE(?, contact), status = COALESCE(?, status) WHERE id = ?`
  ).run(name, role, shift, models_assigned ? JSON.stringify(models_assigned) : null, platform, contact, status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/team/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ MODELS CRUD ============
app.get('/api/models', authMiddleware, (req, res) => {
  const models = db.prepare('SELECT * FROM models ORDER BY name').all();
  res.json(models.map(m => ({ ...m, platforms: JSON.parse(m.platforms || '[]') })));
});

app.post('/api/models', authMiddleware, adminOnly, (req, res) => {
  const { name, platforms, status } = req.body;
  const result = db.prepare('INSERT INTO models (name, platforms, status) VALUES (?, ?, ?)').run(name, JSON.stringify(platforms || []), status || 'active');
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/models/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ ACCOUNTS CRUD ============
app.get('/api/accounts', authMiddleware, (req, res) => {
  const accounts = db.prepare(`
    SELECT a.*, m.name as model_name FROM accounts a
    JOIN models m ON a.model_id = m.id ORDER BY m.name, a.platform
  `).all();
  res.json(accounts);
});

app.post('/api/accounts', authMiddleware, adminOnly, (req, res) => {
  const { model_id, platform, handle, current_followers } = req.body;
  const result = db.prepare('INSERT INTO accounts (model_id, platform, handle, current_followers) VALUES (?, ?, ?, ?)').run(model_id, platform, handle, current_followers || 0);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/accounts/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ DAILY STATS ============
app.get('/api/stats', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const stats = db.prepare(`
    SELECT ds.*, a.handle, a.platform, a.current_followers, m.name as model_name
    FROM daily_stats ds
    JOIN accounts a ON ds.account_id = a.id
    JOIN models m ON a.model_id = m.id
    WHERE ds.date >= date('now', ?)
    ORDER BY ds.date DESC, m.name, a.platform
  `).all(`-${days} days`);
  res.json(stats);
});

app.post('/api/stats', authMiddleware, adminOnly, (req, res) => {
  const { account_id, date, new_followers } = req.body;
  const dateStr = date || new Date().toISOString().split('T')[0];
  db.prepare('INSERT OR REPLACE INTO daily_stats (account_id, date, new_followers) VALUES (?, ?, ?)').run(account_id, dateStr, new_followers);
  // Update current_followers
  db.prepare('UPDATE accounts SET current_followers = current_followers + ? WHERE id = ?').run(new_followers, account_id);
  res.json({ ok: true });
});

// ============ TASKS CRUD ============
app.get('/api/tasks', authMiddleware, (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY CASE priority WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END, created_at DESC').all();
  res.json(tasks);
});

app.post('/api/tasks', authMiddleware, (req, res) => {
  const { title, assigned_to, team, priority, deadline, notes } = req.body;
  const result = db.prepare('INSERT INTO tasks (title, assigned_to, team, priority, deadline, notes) VALUES (?, ?, ?, ?, ?, ?)').run(title, assigned_to, team, priority || 'medium', deadline, notes);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/tasks/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ CALLS CRUD ============
app.get('/api/calls', authMiddleware, (req, res) => {
  const calls = db.prepare(`
    SELECT c.*, s.name as student_name FROM calls c
    JOIN students s ON c.student_id = s.id
    ORDER BY c.scheduled_at ASC
  `).all();
  res.json(calls);
});

app.post('/api/calls', authMiddleware, adminOnly, (req, res) => {
  const { student_id, type, scheduled_at, notes } = req.body;
  const result = db.prepare('INSERT INTO calls (student_id, type, scheduled_at, notes) VALUES (?, ?, ?, ?)').run(student_id, type, scheduled_at, notes);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/calls/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM calls WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ DASHBOARD STATS ============
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const totalFollowers = db.prepare('SELECT SUM(current_followers) as total FROM accounts').get().total || 0;
  const modelsCount = db.prepare('SELECT COUNT(*) as count FROM models WHERE status = "active"').get().count;
  const teamCount = db.prepare('SELECT COUNT(*) as count FROM team_members').get().count;
  const studentsCount = db.prepare('SELECT COUNT(*) as count FROM students WHERE status = "active"').get().count;
  const todayStats = db.prepare(`SELECT SUM(new_followers) as today FROM daily_stats WHERE date = date('now')`).get().today || 0;
  const weekStats = db.prepare(`SELECT SUM(new_followers) as week FROM daily_stats WHERE date >= date('now', '-7 days')`).get().week || 0;

  res.json({ totalFollowers, modelsCount, teamCount, studentsCount, todayStats, weekStats });
});

// ============ ADMIN SETTINGS ============
app.get('/api/settings', authMiddleware, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', authMiddleware, adminOnly, (req, res) => {
  const entries = Object.entries(req.body);
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  entries.forEach(([key, value]) => stmt.run(key, String(value)));
  res.json({ ok: true });
});

app.put('/api/users/:id/role', authMiddleware, adminOnly, (req, res) => {
  const { role } = req.body;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas changer ton propre rôle' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

app.put('/api/users/:id/display_name', authMiddleware, adminOnly, (req, res) => {
  const { display_name } = req.body;
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name, req.params.id);
  res.json({ ok: true });
});

app.put('/api/models/:id', authMiddleware, adminOnly, (req, res) => {
  const { name, platforms, status } = req.body;
  db.prepare(`UPDATE models SET
    name = COALESCE(?, name), platforms = COALESCE(?, platforms), status = COALESCE(?, status) WHERE id = ?`
  ).run(name, platforms ? JSON.stringify(platforms) : null, status, req.params.id);
  res.json({ ok: true });
});

app.put('/api/accounts/:id', authMiddleware, adminOnly, (req, res) => {
  const { handle, current_followers } = req.body;
  db.prepare(`UPDATE accounts SET
    handle = COALESCE(?, handle), current_followers = COALESCE(?, current_followers) WHERE id = ?`
  ).run(handle, current_followers, req.params.id);
  res.json({ ok: true });
});

// Reset all passwords for a role
app.post('/api/admin/reset-passwords', authMiddleware, adminOnly, (req, res) => {
  const { role, new_password } = req.body;
  if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });
  const hash = bcrypt.hashSync(new_password, 10);
  const result = db.prepare('UPDATE users SET password = ? WHERE role = ? AND id != ?').run(hash, role, req.user.id);
  res.json({ ok: true, updated: result.changes });
});

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Catch-all: serve login
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route not found' });
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ============ START ============
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║    LCX Agency Dashboard               ║
  ║    http://localhost:${PORT}             ║
  ║                                       ║
  ║    Admin: ewen / admin123            ║
  ║    Team:  prenom / team123           ║
  ║    Eleve: prenom / eleve123          ║
  ╚══════════════════════════════════════╝
  `);
});
