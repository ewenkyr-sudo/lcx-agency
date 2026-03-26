const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lcx-agency-secret-change-me-in-production';

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============ DATABASE ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/lcx_agency',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      avatar_color TEXT DEFAULT '#8b5cf6',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS models (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      platforms TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      current_followers INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id SERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      new_followers INTEGER DEFAULT 0,
      notes TEXT,
      UNIQUE(account_id, date)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      shift TEXT,
      models_assigned TEXT DEFAULT '[]',
      platform TEXT,
      contact TEXT,
      status TEXT DEFAULT 'offline',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'starter',
      start_date TEXT,
      models_signed INTEGER DEFAULT 0,
      active_discussions INTEGER DEFAULT 0,
      progression INTEGER DEFAULT 0,
      contact TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      assigned_to TEXT,
      team TEXT,
      priority TEXT DEFAULT 'medium',
      deadline TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calls (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'check-in',
      scheduled_at TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
      member_name TEXT,
      member_role TEXT,
      day_of_week INTEGER NOT NULL,
      shift_type TEXT DEFAULT 'off',
      shift_label TEXT DEFAULT 'OFF',
      week_start TEXT
    );

    CREATE TABLE IF NOT EXISTS outreach_leads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      ig_link TEXT,
      lead_type TEXT DEFAULT 'model',
      script_used TEXT,
      ig_account_used TEXT,
      notes TEXT,
      status TEXT DEFAULT 'sent',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ============ SEED DEFAULT DATA ============
async function seedData() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(rows[0].count) > 0) return;

  console.log('Seeding initial data...');

  const adminHash = bcrypt.hashSync('admin123', 10);
  await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', ['ewen', adminHash, 'Ewen', 'admin']);

  const defaultHash = bcrypt.hashSync('team123', 10);
  const studentHash = bcrypt.hashSync('eleve123', 10);

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
  for (const u of teamUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', u);
  }

  const modelUsers = [
    ['luna', defaultHash, 'Luna', 'model'],
    ['jade', defaultHash, 'Jade', 'model'],
    ['mia', defaultHash, 'Mia', 'model'],
    ['emma', defaultHash, 'Emma', 'model'],
    ['clara', defaultHash, 'Clara', 'model'],
  ];
  for (const u of modelUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', u);
  }

  const studentUsers = [
    ['lucas', studentHash, 'Lucas', 'student'],
    ['theo', studentHash, 'Théo', 'student'],
    ['yassine', studentHash, 'Yassine', 'student'],
    ['enzo', studentHash, 'Enzo', 'student'],
    ['mehdi', studentHash, 'Mehdi', 'student'],
    ['rayan', studentHash, 'Rayan', 'student'],
  ];
  for (const u of studentUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', u);
  }

  // Models
  const modelData = [
    ['Luna', '["onlyfans","fansly"]', 'active'],
    ['Jade', '["onlyfans"]', 'active'],
    ['Mia', '["onlyfans","fansly"]', 'active'],
    ['Emma', '["fansly"]', 'onboarding'],
    ['Clara', '["onlyfans"]', 'active'],
  ];
  for (const m of modelData) {
    await pool.query('INSERT INTO models (name, platforms, status) VALUES ($1, $2, $3)', m);
  }

  // Accounts
  const accountData = [
    [1, 'onlyfans', '@luna_exclusive', 1247],
    [1, 'instagram', '@luna.model', 5420],
    [1, 'tiktok', '@luna_vibes', 3210],
    [1, 'telegram', '@luna_vip', 682],
    [2, 'onlyfans', '@jade_premium', 892],
    [2, 'instagram', '@jade.official', 4180],
    [2, 'tiktok', '@jadexoxo', 2890],
    [2, 'telegram', '@jade_premium_tg', 0],
    [3, 'onlyfans', '@mia_dreams', 634],
    [3, 'instagram', '@mia.content', 3120],
    [3, 'tiktok', '@miadreams', 1540],
    [3, 'telegram', '@mia_vip_group', 736],
    [4, 'onlyfans', '@emma_exclusive', 189],
    [4, 'instagram', '@emma.new', 1240],
    [5, 'onlyfans', '@clara_vip', 312],
    [5, 'instagram', '@clara.lifestyle', 860],
    [5, 'telegram', '@claravip_channel', 420],
  ];
  for (const a of accountData) {
    await pool.query('INSERT INTO accounts (model_id, platform, handle, current_followers) VALUES ($1, $2, $3, $4)', a);
  }

  // Sample daily stats (last 7 days)
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    for (let accId = 1; accId <= 17; accId++) {
      const base = accId <= 4 ? 15 : accId <= 8 ? 10 : 7;
      const val = Math.max(-2, Math.floor(Math.random() * base * 2) + 1);
      await pool.query('INSERT INTO daily_stats (account_id, date, new_followers) VALUES ($1, $2, $3) ON CONFLICT (account_id, date) DO NOTHING', [accId, dateStr, val]);
    }
  }

  // Students
  const studentData = [
    [19, 'Lucas', 'elite', '2026-01-15', 4, 5, 75, '@lucas_dc', 'active'],
    [20, 'Théo', 'vip', '2026-02-01', 3, 4, 60, '@theo_dc', 'active'],
    [21, 'Yassine', 'pro', '2026-03-01', 1, 7, 35, '@yassine_dc', 'active'],
    [22, 'Enzo', 'elite', '2025-12-10', 3, 2, 85, '@enzo_dc', 'active'],
    [23, 'Mehdi', 'starter', '2026-03-15', 0, 3, 15, '@mehdi_dc', 'active'],
    [24, 'Rayan', 'pro', '2026-02-10', 2, 2, 50, '@rayan_dc', 'active'],
  ];
  for (const s of studentData) {
    await pool.query('INSERT INTO students (user_id, name, program, start_date, models_signed, active_discussions, progression, contact, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', s);
  }

  // Team members
  const memberData = [
    [2, 'Sarah', 'chatter', '08h-16h', '["Luna","Jade"]', null, '@sarah_dc', 'online'],
    [3, 'Tom', 'chatter', '16h-00h', '["Luna","Mia"]', null, '@tom_dc', 'online'],
    [4, 'Karim', 'chatter', '00h-08h', '["Jade","Clara"]', null, '@karim_dc', 'offline'],
    [5, 'Léa', 'chatter', '08h-16h', '["Mia","Emma"]', null, '@lea_dc', 'online'],
    [6, 'Nathan', 'chatter', '16h-00h', '["Luna","Clara"]', null, '@nathan_dc', 'break'],
    [7, 'Maxime', 'outreach', '09h-17h', '[]', 'Instagram', '@maxime_dc', 'online'],
    [8, 'Yasmine', 'outreach', '09h-17h', '[]', 'TikTok, Reddit', '@yasmine_dc', 'online'],
    [9, 'Dylan', 'outreach', '14h-22h', '[]', 'Twitter, Reddit', '@dylan_dc', 'offline'],
    [10, 'Inès', 'outreach', '09h-17h', '[]', 'Instagram, TikTok', '@ines_dc', 'online'],
    [11, 'Amine', 'va', '07h-15h', '[]', null, '@amine_dc', 'online'],
    [12, 'Rania', 'va', '09h-17h', '[]', null, '@rania_dc', 'online'],
    [13, 'Jules', 'va', '14h-22h', '[]', null, '@jules_dc', 'offline'],
  ];
  for (const m of memberData) {
    await pool.query('INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', m);
  }

  // Agency settings
  const settingsData = [
    ['agency_name', 'LCX Agency'],
    ['agency_subtitle', 'Management Suite'],
    ['default_password_team', 'team123'],
    ['default_password_student', 'eleve123'],
  ];
  for (const s of settingsData) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', s);
  }

  console.log('Seed complete!');
}

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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
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

app.get('/api/me', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role FROM users WHERE id = $1', [req.user.id]);
  res.json(rows[0]);
});

// ============ USERS CRUD (Admin only) ============
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, created_at FROM users ORDER BY role, display_name');
  res.json(rows);
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name || !role) return res.status(400).json({ error: 'Champs requis manquants' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id', [username, hash, display_name, role]);
    res.json({ id: rows[0].id, username, display_name, role });
  } catch (e) {
    res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
  }
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, async (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENTS CRUD ============
app.get('/api/students', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM students WHERE user_id = $1', [req.user.id]);
    return res.json(rows);
  }
  const { rows } = await pool.query('SELECT s.*, u.username FROM students s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.name');
  res.json(rows);
});

app.post('/api/students', authMiddleware, adminOnly, async (req, res) => {
  const { name, program, start_date, contact, user_id } = req.body;
  const { rows } = await pool.query('INSERT INTO students (user_id, name, program, start_date, contact) VALUES ($1, $2, $3, $4, $5) RETURNING id', [user_id || null, name, program || 'starter', start_date, contact]);
  res.json({ id: rows[0].id });
});

app.put('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, program, models_signed, active_discussions, progression, contact, status } = req.body;
  await pool.query(`UPDATE students SET
    name = COALESCE($1, name), program = COALESCE($2, program), models_signed = COALESCE($3, models_signed),
    active_discussions = COALESCE($4, active_discussions), progression = COALESCE($5, progression),
    contact = COALESCE($6, contact), status = COALESCE($7, status) WHERE id = $8`,
    [name, program, models_signed, active_discussions, progression, contact, status, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ TEAM MEMBERS CRUD ============
app.get('/api/team', authMiddleware, async (req, res) => {
  const role = req.query.role;
  if (role) {
    const { rows } = await pool.query('SELECT * FROM team_members WHERE role = $1 ORDER BY name', [role]);
    res.json(rows);
  } else {
    const { rows } = await pool.query('SELECT * FROM team_members ORDER BY name');
    res.json(rows);
  }
});

app.post('/api/team', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, user_id } = req.body;
  const { rows } = await pool.query('INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [user_id || null, name, role, shift, JSON.stringify(models_assigned || []), platform, contact]);
  res.json({ id: rows[0].id });
});

app.put('/api/team/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, status } = req.body;
  await pool.query(`UPDATE team_members SET
    name = COALESCE($1, name), role = COALESCE($2, role), shift = COALESCE($3, shift),
    models_assigned = COALESCE($4, models_assigned), platform = COALESCE($5, platform),
    contact = COALESCE($6, contact), status = COALESCE($7, status) WHERE id = $8`,
    [name, role, shift, models_assigned ? JSON.stringify(models_assigned) : null, platform, contact, status, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/team/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM team_members WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ MODELS CRUD ============
app.get('/api/models', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM models ORDER BY name');
  res.json(rows.map(m => ({ ...m, platforms: JSON.parse(m.platforms || '[]') })));
});

app.post('/api/models', authMiddleware, adminOnly, async (req, res) => {
  const { name, platforms, status } = req.body;
  const { rows } = await pool.query('INSERT INTO models (name, platforms, status) VALUES ($1, $2, $3) RETURNING id', [name, JSON.stringify(platforms || []), status || 'active']);
  res.json({ id: rows[0].id });
});

app.delete('/api/models/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM models WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ ACCOUNTS CRUD ============
app.get('/api/accounts', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, m.name as model_name FROM accounts a
    JOIN models m ON a.model_id = m.id ORDER BY m.name, a.platform
  `);
  res.json(rows);
});

app.post('/api/accounts', authMiddleware, adminOnly, async (req, res) => {
  const { model_id, platform, handle, current_followers } = req.body;
  const { rows } = await pool.query('INSERT INTO accounts (model_id, platform, handle, current_followers) VALUES ($1, $2, $3, $4) RETURNING id', [model_id, platform, handle, current_followers || 0]);
  res.json({ id: rows[0].id });
});

app.delete('/api/accounts/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ DAILY STATS ============
app.get('/api/stats', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const { rows } = await pool.query(`
    SELECT ds.*, a.handle, a.platform, a.current_followers, m.name as model_name
    FROM daily_stats ds
    JOIN accounts a ON ds.account_id = a.id
    JOIN models m ON a.model_id = m.id
    WHERE ds.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text
    ORDER BY ds.date DESC, m.name, a.platform
  `, [days]);
  res.json(rows);
});

app.post('/api/stats', authMiddleware, adminOnly, async (req, res) => {
  const { account_id, date, new_followers } = req.body;
  const dateStr = date || new Date().toISOString().split('T')[0];
  await pool.query(`INSERT INTO daily_stats (account_id, date, new_followers) VALUES ($1, $2, $3)
    ON CONFLICT (account_id, date) DO UPDATE SET new_followers = $3`, [account_id, dateStr, new_followers]);
  await pool.query('UPDATE accounts SET current_followers = current_followers + $1 WHERE id = $2', [new_followers, account_id]);
  res.json({ ok: true });
});

// ============ TASKS CRUD ============
app.get('/api/tasks', authMiddleware, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM tasks ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC");
  res.json(rows);
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  const { title, assigned_to, team, priority, deadline, notes } = req.body;
  const { rows } = await pool.query('INSERT INTO tasks (title, assigned_to, team, priority, deadline, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [title, assigned_to, team, priority || 'medium', deadline, notes]);
  res.json({ id: rows[0].id });
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ CALLS CRUD ============
app.get('/api/calls', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, s.name as student_name FROM calls c
    JOIN students s ON c.student_id = s.id
    ORDER BY c.scheduled_at ASC
  `);
  res.json(rows);
});

app.post('/api/calls', authMiddleware, adminOnly, async (req, res) => {
  const { student_id, type, scheduled_at, notes } = req.body;
  const { rows } = await pool.query('INSERT INTO calls (student_id, type, scheduled_at, notes) VALUES ($1, $2, $3, $4) RETURNING id', [student_id, type, scheduled_at, notes]);
  res.json({ id: rows[0].id });
});

app.delete('/api/calls/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM calls WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ DASHBOARD STATS ============
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const totalFollowers = (await pool.query('SELECT COALESCE(SUM(current_followers), 0) as total FROM accounts')).rows[0].total;
  const modelsCount = (await pool.query("SELECT COUNT(*) as count FROM models WHERE status = 'active'")).rows[0].count;
  const teamCount = (await pool.query('SELECT COUNT(*) as count FROM team_members')).rows[0].count;
  const studentsCount = (await pool.query("SELECT COUNT(*) as count FROM students WHERE status = 'active'")).rows[0].count;
  const todayStats = (await pool.query("SELECT COALESCE(SUM(new_followers), 0) as today FROM daily_stats WHERE date = CURRENT_DATE::text")).rows[0].today;
  const weekStats = (await pool.query("SELECT COALESCE(SUM(new_followers), 0) as week FROM daily_stats WHERE date >= (CURRENT_DATE - INTERVAL '7 days')::date::text")).rows[0].week;

  res.json({
    totalFollowers: parseInt(totalFollowers),
    modelsCount: parseInt(modelsCount),
    teamCount: parseInt(teamCount),
    studentsCount: parseInt(studentsCount),
    todayStats: parseInt(todayStats),
    weekStats: parseInt(weekStats)
  });
});

// ============ ADMIN SETTINGS ============
app.get('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
  }
  res.json({ ok: true });
});

app.put('/api/users/:id/role', authMiddleware, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas changer ton propre rôle' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/users/:id/display_name', authMiddleware, adminOnly, async (req, res) => {
  const { display_name } = req.body;
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [display_name, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/models/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, platforms, status } = req.body;
  await pool.query(`UPDATE models SET
    name = COALESCE($1, name), platforms = COALESCE($2, platforms), status = COALESCE($3, status) WHERE id = $4`,
    [name, platforms ? JSON.stringify(platforms) : null, status, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/accounts/:id', authMiddleware, adminOnly, async (req, res) => {
  const { handle, current_followers } = req.body;
  await pool.query(`UPDATE accounts SET
    handle = COALESCE($1, handle), current_followers = COALESCE($2, current_followers) WHERE id = $3`,
    [handle, current_followers, req.params.id]);
  res.json({ ok: true });
});

// Reset all passwords for a role
app.post('/api/admin/reset-passwords', authMiddleware, adminOnly, async (req, res) => {
  const { role, new_password } = req.body;
  if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });
  const hash = bcrypt.hashSync(new_password, 10);
  const result = await pool.query('UPDATE users SET password = $1 WHERE role = $2 AND id != $3', [hash, role, req.user.id]);
  res.json({ ok: true, updated: result.rowCount });
});

// Import CSV leads
app.post('/api/admin/import-csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Créer Gaby si elle n'existe pas
    let gaby = (await pool.query("SELECT id FROM users WHERE username = 'gaby'")).rows[0];
    if (!gaby) {
      const hash = bcrypt.hashSync('team123', 10);
      gaby = (await pool.query(
        "INSERT INTO users (username, password, display_name, role) VALUES ('gaby', $1, 'Gaby', 'outreach') RETURNING id", [hash]
      )).rows[0];
      // Créer aussi comme team member
      await pool.query(
        "INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact, status) VALUES ($1, 'Gaby', 'outreach', '09h-17h', '[]', 'Instagram', null, 'online')",
        [gaby.id]
      );
    }

    // Lire le CSV
    const csvPath = path.join(__dirname, 'public', 'data.csv');
    if (!fs.existsSync(csvPath)) return res.status(404).json({ error: 'Fichier data.csv introuvable' });

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Mapping des statuts CSV → app
    const statusMap = {
      'sent': 'sent',
      'to send': 'sent',
      'talking - cold': 'talking-cold',
      'talking - warm': 'talking-warm',
      'call booked': 'call-booked',
      'signed': 'signed'
    };

    // Colonnes: Username, link, Type, Status, Script, Account, Notes, (vides...), reply rate, %
    // Le lien IG peut contenir "==" donc on parse intelligemment les 7 premières colonnes
    let imported = 0;
    let updated = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Extraire username (avant la première virgule)
      const firstComma = line.indexOf(',');
      if (firstComma === -1) continue;
      const username = line.substring(0, firstComma).replace(/"/g, '').trim();
      if (!username) continue;

      // Extraire le lien (entre première et deuxième virgule — peut contenir ==)
      const afterUsername = line.substring(firstComma + 1);
      // Le lien finit avant ",Type" — chercher le pattern après le lien IG
      const linkMatch = afterUsername.match(/^(https?:\/\/[^,]*(?:={0,2})),(.*)/);
      let igLink = '', rest = afterUsername;
      if (linkMatch) {
        igLink = linkMatch[1].replace(/"/g, '').trim();
        rest = linkMatch[2];
      } else {
        // Pas de lien, tout est dans rest
        rest = afterUsername;
      }

      // Parser le reste : Type, Status, Script, Account, Notes
      const restCols = rest.split(',');
      const leadType = (restCols[0] || '').replace(/"/g, '').trim().toLowerCase() || 'model';
      const rawStatus = (restCols[1] || '').replace(/"/g, '').trim().toLowerCase();
      const script = (restCols[2] || '').replace(/"/g, '').trim();
      const account = (restCols[3] || '').replace(/"/g, '').trim();
      const notes = (restCols[4] || '').replace(/"/g, '').trim();

      const status = statusMap[rawStatus] || 'sent';

      // Vérifier si le lead existe déjà
      const exists = await pool.query(
        'SELECT id FROM outreach_leads WHERE username = $1 AND user_id = $2', [username, gaby.id]
      );

      if (exists.rows.length > 0) {
        // Mettre à jour le lead existant avec les bonnes données
        await pool.query(
          `UPDATE outreach_leads SET ig_link = $1, lead_type = $2, status = $3, script_used = $4, ig_account_used = $5, notes = $6, updated_at = NOW() WHERE id = $7`,
          [igLink, leadType, status, script, account, notes, exists.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          'INSERT INTO outreach_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [gaby.id, username, igLink, leadType, script, account, notes, status]
        );
        imported++;
      }
    }

    broadcast('lead-added', { bulk: true });
    res.json({ ok: true, imported, updated, total: lines.length - 1, user: 'Gaby' });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'import' });
  }
});

// ============ OUTREACH LEADS ============

// Get leads — outreach voit ses propres leads, admin voit tout
app.get('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role === 'outreach') {
    const { rows } = await pool.query('SELECT * FROM outreach_leads WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(`
      SELECT ol.*, u.display_name as agent_name
      FROM outreach_leads ol
      JOIN users u ON ol.user_id = u.id
      ORDER BY ol.created_at DESC
    `);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

// Add lead
app.post('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { username, ig_link, lead_type, script_used, ig_account_used, notes } = req.body;
  if (!username) return res.status(400).json({ error: 'Username requis' });
  const { rows } = await pool.query(
    'INSERT INTO outreach_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [req.user.id, username, ig_link, lead_type || 'model', script_used, ig_account_used, notes]
  );
  broadcast('lead-added', rows[0]);
  res.json(rows[0]);
});

// Update lead status
app.put('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { status, notes } = req.body;
  // Outreach ne peut modifier que ses propres leads
  if (req.user.role === 'outreach') {
    const check = await pool.query('SELECT id FROM outreach_leads WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Ce lead ne t\'appartient pas' });
  }
  await pool.query('UPDATE outreach_leads SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3',
    [status, notes, req.params.id]);
  broadcast('lead-updated', { id: parseInt(req.params.id), status, notes });
  res.json({ ok: true });
});

// Delete lead
app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'outreach') {
    const check = await pool.query('SELECT id FROM outreach_leads WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Ce lead ne t\'appartient pas' });
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query('DELETE FROM outreach_leads WHERE id = $1', [req.params.id]);
  broadcast('lead-deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// Stats outreach personnelles (pour l'assistante connectée)
app.get('/api/leads/my-stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const uid = req.user.id;
  const today = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND created_at::date = CURRENT_DATE", [uid])).rows[0].count;
  const sent = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'sent' AND created_at::date = CURRENT_DATE", [uid])).rows[0].count;
  const warm = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'talking-warm'", [uid])).rows[0].count;
  const booked = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'call-booked'", [uid])).rows[0].count;
  res.json({
    leads_today: parseInt(today),
    dm_sent_today: parseInt(sent),
    talking_warm: parseInt(warm),
    call_booked: parseInt(booked)
  });
});

// Stats outreach globales (pour l'admin)
app.get('/api/leads/admin-stats', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name as agent_name,
      COALESCE(COUNT(*), 0) as total_leads,
      COALESCE(SUM(CASE WHEN ol.created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0) as leads_today,
      COALESCE(SUM(CASE WHEN ol.status = 'sent' AND ol.created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0) as dm_sent_today,
      COALESCE(SUM(CASE WHEN ol.status = 'talking-cold' THEN 1 ELSE 0 END), 0) as talking_cold,
      COALESCE(SUM(CASE WHEN ol.status = 'talking-warm' THEN 1 ELSE 0 END), 0) as talking_warm,
      COALESCE(SUM(CASE WHEN ol.status = 'call-booked' THEN 1 ELSE 0 END), 0) as call_booked,
      COALESCE(SUM(CASE WHEN ol.status = 'signed' THEN 1 ELSE 0 END), 0) as signed
    FROM users u
    LEFT JOIN outreach_leads ol ON ol.user_id = u.id
    WHERE u.role = 'outreach'
    GROUP BY u.id, u.display_name
    ORDER BY u.display_name
  `);
  res.json(rows);
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

// ============ WEBSOCKET ============
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

// ============ START ============
async function start() {
  await initDB();
  await seedData();
  server.listen(PORT, () => {
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
}

start().catch(err => {
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});
