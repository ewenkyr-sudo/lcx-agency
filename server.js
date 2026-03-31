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

// Journée de travail commence à 9h (pour les stats "aujourd'hui")
const DAY_START_HOUR = 9;
// Expression SQL pour le début de la journée de travail courante
const SQL_TODAY_START = `(CASE WHEN CURRENT_TIME < '09:00' THEN CURRENT_TIMESTAMP::date - INTERVAL '1 day' ELSE CURRENT_TIMESTAMP::date END + INTERVAL '${DAY_START_HOUR} hours')`;

// ============ MIDDLEWARE ============
app.use(express.json({ limit: '15mb' }));
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
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$;

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
      previous_followers INTEGER DEFAULT 0,
      last_scraped TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS previous_followers INTEGER DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_scraped TIMESTAMPTZ;
    EXCEPTION WHEN others THEN NULL;
    END $$;

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
      progression_step TEXT DEFAULT 'onboarding',
      contact TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE students ADD COLUMN IF NOT EXISTS progression_step TEXT DEFAULT 'onboarding';
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to TEXT,
      team TEXT,
      priority TEXT DEFAULT 'normal',
      deadline TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

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
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS chatter_shifts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      model_name TEXT NOT NULL,
      ppv_total NUMERIC(10,2) DEFAULT 0,
      tips_total NUMERIC(10,2) DEFAULT 0,
      shift_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Call requests (élèves demandent un call)
    CREATE TABLE IF NOT EXISTS call_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT,
      availabilities TEXT,
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      admin_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Modèles recrutées par les élèves
    CREATE TABLE IF NOT EXISTS student_recruits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ig_name TEXT NOT NULL,
      ig_link TEXT,
      notes TEXT,
      status TEXT DEFAULT 'interested',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Leads outreach des élèves (isolé par élève)
    CREATE TABLE IF NOT EXISTS student_leads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      ig_link TEXT,
      lead_type TEXT DEFAULT 'model',
      script_used TEXT,
      ig_account_used TEXT,
      notes TEXT,
      status TEXT DEFAULT 'to-send',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Modèles gérées par les élèves (séparé de l'agence)
    CREATE TABLE IF NOT EXISTS student_models (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      of_handle TEXT,
      fans_count INTEGER DEFAULT 0,
      commission_rate NUMERIC(5,2) DEFAULT 0,
      status TEXT DEFAULT 'onboarding',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Revenus mensuels des élèves par modèle
    CREATE TABLE IF NOT EXISTS student_revenue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_model_id INTEGER NOT NULL REFERENCES student_models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      revenue NUMERIC(10,2) DEFAULT 0,
      UNIQUE(student_model_id, month)
    );

    -- Messagerie interne
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ressources / Formation
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      res_type TEXT DEFAULT 'link',
      url TEXT,
      file_data BYTEA,
      file_name TEXT,
      file_mime TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Objectifs hebdomadaires
    CREATE TABLE IF NOT EXISTS weekly_objectives (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      obj_type TEXT NOT NULL,
      description TEXT,
      target INTEGER DEFAULT 0,
      current INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Options personnalisées par utilisateur (scripts, comptes, types)
    CREATE TABLE IF NOT EXISTS user_options (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_type TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(user_id, option_type, value)
    );

    -- Assignation assistantes outreach → élèves
    CREATE TABLE IF NOT EXISTS student_outreach_assignments (
      id SERIAL PRIMARY KEY,
      student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      outreach_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_user_id, outreach_user_id)
    );

    -- Paires d'élèves partageant le même outreach
    CREATE TABLE IF NOT EXISTS student_outreach_pairs (
      id SERIAL PRIMARY KEY,
      student_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_a_id, student_b_id)
    );

    DO $$ BEGIN
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS added_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `);
}

// ============ SEED DEFAULT DATA ============
async function seedData() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(rows[0].count) > 0) return;

  console.log('Seeding initial data...');

  const adminHash = bcrypt.hashSync('admin123', 10);
  await pool.query('INSERT INTO users (username, password, display_name, role, plain_password) VALUES ($1, $2, $3, $4, $5)', ['ewen', adminHash, 'Ewen', 'admin', 'admin123']);

  const defaultHash = bcrypt.hashSync('team123', 10);
  const studentHash = bcrypt.hashSync('eleve123', 10);

  const teamUsers = [
    ['sarah', defaultHash, 'Sarah', 'chatter', 'team123'],
    ['tom', defaultHash, 'Tom', 'chatter', 'team123'],
    ['karim', defaultHash, 'Karim', 'chatter', 'team123'],
    ['lea', defaultHash, 'Léa', 'chatter', 'team123'],
    ['nathan', defaultHash, 'Nathan', 'chatter', 'team123'],
    ['maxime', defaultHash, 'Maxime', 'outreach', 'team123'],
    ['yasmine', defaultHash, 'Yasmine', 'outreach', 'team123'],
    ['dylan', defaultHash, 'Dylan', 'outreach', 'team123'],
    ['ines', defaultHash, 'Inès', 'outreach', 'team123'],
    ['amine', defaultHash, 'Amine', 'va', 'team123'],
    ['rania', defaultHash, 'Rania', 'va', 'team123'],
    ['jules', defaultHash, 'Jules', 'va', 'team123'],
  ];
  for (const u of teamUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role, plain_password) VALUES ($1, $2, $3, $4, $5)', u);
  }

  const modelUsers = [
    ['luna', defaultHash, 'Luna', 'model', 'team123'],
    ['jade', defaultHash, 'Jade', 'model', 'team123'],
    ['mia', defaultHash, 'Mia', 'model', 'team123'],
    ['emma', defaultHash, 'Emma', 'model', 'team123'],
    ['clara', defaultHash, 'Clara', 'model', 'team123'],
  ];
  for (const u of modelUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role, plain_password) VALUES ($1, $2, $3, $4, $5)', u);
  }

  const studentUsers = [
    ['lucas', studentHash, 'Lucas', 'student', 'eleve123'],
    ['theo', studentHash, 'Théo', 'student', 'eleve123'],
    ['yassine', studentHash, 'Yassine', 'student', 'eleve123'],
    ['enzo', studentHash, 'Enzo', 'student', 'eleve123'],
    ['mehdi', studentHash, 'Mehdi', 'student', 'eleve123'],
    ['rayan', studentHash, 'Rayan', 'student', 'eleve123'],
  ];
  for (const u of studentUsers) {
    await pool.query('INSERT INTO users (username, password, display_name, role, plain_password) VALUES ($1, $2, $3, $4, $5)', u);
  }

  // Models
  const modelData = [
    ['Luna', '["onlyfans"]', 'active'],
    ['Jade', '["onlyfans"]', 'active'],
    ['Mia', '["onlyfans"]', 'active'],
    ['Emma', '["onlyfans"]', 'onboarding'],
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
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  // Auto-créer l'entrée student si elle manque
  if (user.role === 'student') {
    const studentExists = await pool.query('SELECT id FROM students WHERE user_id = $1', [user.id]);
    if (studentExists.rows.length === 0) {
      await pool.query('INSERT INTO students (user_id, name, program, start_date, status) VALUES ($1, $2, $3, $4, $5)', [user.id, user.display_name, 'starter', new Date().toISOString().split('T')[0], 'active']);
    }
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
  const { rows } = await pool.query('SELECT id, username, display_name, role, avatar_url FROM users WHERE id = $1', [req.user.id]);
  res.json(rows[0]);
});

// ============ USERS CRUD (Admin only) ============
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, avatar_url, plain_password, created_at FROM users ORDER BY role, display_name');
  res.json(rows);
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name || !role) return res.status(400).json({ error: 'Champs requis manquants' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pool.query('INSERT INTO users (username, password, display_name, role, plain_password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, hash, display_name, role, password]);
    const newId = rows[0].id;
    // Auto-créer l'entrée student si rôle élève
    if (role === 'student') {
      await pool.query('INSERT INTO students (user_id, name, program, start_date, status) VALUES ($1, $2, $3, $4, $5)', [newId, display_name, 'starter', new Date().toISOString().split('T')[0], 'active']);
    }
    // Auto-créer l'entrée team_member si rôle team
    if (['chatter', 'outreach', 'va'].includes(role)) {
      await pool.query('INSERT INTO team_members (user_id, name, role, status) VALUES ($1, $2, $3, $4)', [newId, display_name, role, 'offline']);
    }
    res.json({ id: newId, username, display_name, role });
  } catch (e) {
    res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
  }
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, async (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE users SET password = $1, plain_password = $2 WHERE id = $3', [hash, password, req.params.id]);
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
  let query = `SELECT tm.*, u.avatar_url FROM team_members tm LEFT JOIN users u ON tm.user_id = u.id`;
  if (role) {
    query += ` WHERE tm.role = $1 ORDER BY tm.name`;
    const { rows } = await pool.query(query, [role]);
    res.json(rows);
  } else {
    query += ` ORDER BY tm.name`;
    const { rows } = await pool.query(query);
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
  let query, params = [];
  if (req.user.role === 'admin') {
    query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.deadline ASC NULLS LAST`;
  } else {
    query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
      WHERE t.assigned_to_id = $1 OR t.created_by = $1
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.deadline ASC NULLS LAST`;
    params = [req.user.id];
  }
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  const { title, description, assigned_to_id, priority, deadline, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  // Non-admin ne peut assigner qu'à soi-même
  const assignTo = req.user.role === 'admin' ? (assigned_to_id || req.user.id) : req.user.id;
  const { rows } = await pool.query(
    'INSERT INTO tasks (title, description, created_by, assigned_to_id, priority, deadline, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [title, description, req.user.id, assignTo, priority || 'normal', deadline, notes]);
  broadcast('task-new', rows[0]);
  res.json(rows[0]);
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  const { status, title, description, priority, deadline, assigned_to_id, notes } = req.body;
  // Non-admin ne peut modifier que ses propres tâches
  if (req.user.role !== 'admin') {
    const check = await pool.query('SELECT id FROM tasks WHERE id = $1 AND (assigned_to_id = $2 OR created_by = $2)', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query(`UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title),
    description = COALESCE($3, description), priority = COALESCE($4, priority),
    deadline = COALESCE($5, deadline), assigned_to_id = COALESCE($6, assigned_to_id),
    notes = COALESCE($7, notes) WHERE id = $8`,
    [status, title, description, priority, deadline, assigned_to_id, notes, req.params.id]);
  broadcast('task-updated', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    const check = await pool.query('SELECT id FROM tasks WHERE id = $1 AND created_by = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  broadcast('task-deleted', { id: parseInt(req.params.id) });
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

app.put('/api/users/:id/avatar', authMiddleware, adminOnly, async (req, res) => {
  const { avatar_url } = req.body;
  await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatar_url, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id/avatar', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('UPDATE users SET avatar_url = NULL WHERE id = $1', [req.params.id]);
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
  if (current_followers !== undefined) {
    await pool.query(`UPDATE accounts SET previous_followers = current_followers, current_followers = $1, handle = COALESCE($2, handle) WHERE id = $3`,
      [current_followers, handle, req.params.id]);
  } else {
    await pool.query(`UPDATE accounts SET handle = COALESCE($1, handle) WHERE id = $2`,
      [handle, req.params.id]);
  }
  res.json({ ok: true });
});

// Reset all passwords for a role
app.post('/api/admin/reset-passwords', authMiddleware, adminOnly, async (req, res) => {
  const { role, new_password } = req.body;
  if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });
  const hash = bcrypt.hashSync(new_password, 10);
  const result = await pool.query('UPDATE users SET password = $1, plain_password = $2 WHERE role = $3 AND id != $4', [hash, new_password, role, req.user.id]);
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
        "INSERT INTO users (username, password, display_name, role, plain_password) VALUES ('gaby', $1, 'Gaby', 'outreach', 'team123') RETURNING id", [hash]
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
      'to send': 'to-send',
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

// ============ CHATTER SHIFTS ============

// Get shifts — chatter voit ses propres shifts, admin voit tout
app.get('/api/shifts', authMiddleware, async (req, res) => {
  if (req.user.role === 'chatter') {
    const { rows } = await pool.query('SELECT * FROM chatter_shifts WHERE user_id = $1 ORDER BY date DESC, created_at DESC', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(`
      SELECT cs.*, u.display_name as chatter_name
      FROM chatter_shifts cs
      JOIN users u ON cs.user_id = u.id
      ORDER BY cs.date DESC, cs.created_at DESC
    `);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

// Add shift report
app.post('/api/shifts', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chatter' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { date, model_name, ppv_total, tips_total, shift_notes } = req.body;
  if (!model_name) return res.status(400).json({ error: 'Modèle requis' });
  const shiftDate = date || new Date().toISOString().split('T')[0];
  const { rows } = await pool.query(
    'INSERT INTO chatter_shifts (user_id, date, model_name, ppv_total, tips_total, shift_notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [req.user.id, shiftDate, model_name, ppv_total || 0, tips_total || 0, shift_notes]
  );
  broadcast('shift-added', rows[0]);
  res.json(rows[0]);
});

// Delete shift
app.delete('/api/shifts/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'chatter') {
    const check = await pool.query('SELECT id FROM chatter_shifts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Ce shift ne t\'appartient pas' });
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query('DELETE FROM chatter_shifts WHERE id = $1', [req.params.id]);
  broadcast('shift-deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// Stats chatter perso
app.get('/api/shifts/my-stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chatter' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const uid = req.user.id;
  const today = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1 AND date = CURRENT_DATE::text", [uid])).rows[0];
  const week = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1 AND date >= (CURRENT_DATE - INTERVAL '7 days')::date::text", [uid])).rows[0];
  const total = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1", [uid])).rows[0];
  res.json({
    today: { ppv: parseFloat(today.ppv), tips: parseFloat(today.tips), revenue: parseFloat(today.ppv) + parseFloat(today.tips), shifts: parseInt(today.shifts) },
    week: { ppv: parseFloat(week.ppv), tips: parseFloat(week.tips), revenue: parseFloat(week.ppv) + parseFloat(week.tips), shifts: parseInt(week.shifts) },
    total: { ppv: parseFloat(total.ppv), tips: parseFloat(total.tips), revenue: parseFloat(total.ppv) + parseFloat(total.tips), shifts: parseInt(total.shifts) }
  });
});

// Stats admin globales chatters
app.get('/api/shifts/admin-stats', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name as chatter_name,
      COALESCE(SUM(cs.ppv_total), 0) as total_ppv,
      COALESCE(SUM(cs.tips_total), 0) as total_tips,
      COALESCE(SUM(cs.ppv_total) + SUM(cs.tips_total), 0) as total_revenue,
      COUNT(cs.id) as total_shifts,
      COALESCE(SUM(CASE WHEN cs.date = CURRENT_DATE::text THEN cs.ppv_total ELSE 0 END), 0) as today_ppv,
      COALESCE(SUM(CASE WHEN cs.date = CURRENT_DATE::text THEN cs.tips_total ELSE 0 END), 0) as today_tips,
      COALESCE(SUM(CASE WHEN cs.date >= (CURRENT_DATE - INTERVAL '7 days')::date::text THEN cs.ppv_total ELSE 0 END), 0) as week_ppv,
      COALESCE(SUM(CASE WHEN cs.date >= (CURRENT_DATE - INTERVAL '7 days')::date::text THEN cs.tips_total ELSE 0 END), 0) as week_tips
    FROM users u
    LEFT JOIN chatter_shifts cs ON cs.user_id = u.id
    WHERE u.role = 'chatter'
    GROUP BY u.id, u.display_name
    ORDER BY total_revenue DESC
  `);
  res.json(rows);
});

// ============ OUTREACH LEADS ============

// Get leads — outreach voit ses propres leads, admin voit tout
app.get('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  // Tout le monde voit tous les leads agence
  const { rows } = await pool.query(`
    SELECT ol.*, u.display_name as agent_name
    FROM outreach_leads ol
    JOIN users u ON ol.user_id = u.id
    ORDER BY ol.created_at DESC
  `);
  res.json(rows);
});

// Add lead
app.post('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { username, ig_link, lead_type, script_used, ig_account_used, notes, status } = req.body;
  if (!username) return res.status(400).json({ error: 'Username requis' });
  const cleanUsername = username.replace(/^@/, '');
  const exists = await pool.query("SELECT id, status FROM outreach_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1)", [cleanUsername]);
  if (exists.rows.length > 0) return res.status(409).json({ error: `Ce lead existe déjà (statut : ${exists.rows[0].status})` });
  const { rows } = await pool.query(
    'INSERT INTO outreach_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [req.user.id, username, ig_link, lead_type || 'model', script_used, ig_account_used, notes, status || 'to-send']
  );
  broadcast('lead-added', rows[0]);
  res.json(rows[0]);
});

// Update lead
app.put('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { status, notes, lead_type, script_used, ig_account_used } = req.body;
  await pool.query(`UPDATE outreach_leads SET status = COALESCE($1, status), notes = COALESCE($2, notes),
    lead_type = COALESCE($3, lead_type), script_used = COALESCE($4, script_used),
    ig_account_used = COALESCE($5, ig_account_used), updated_at = NOW(),
    sent_at = CASE WHEN $1 = 'sent' AND (sent_at IS NULL) THEN NOW() ELSE sent_at END WHERE id = $6`,
    [status, notes, lead_type, script_used, ig_account_used, req.params.id]);
  broadcast('lead-updated', { id: parseInt(req.params.id), status, notes });
  res.json({ ok: true });
});

// Delete lead
app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM outreach_leads WHERE id = $1', [req.params.id]);
  broadcast('lead-deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// Stats outreach personnelles (pour l'assistante connectée)
app.get('/api/leads/my-stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const uid = req.user.id;
  const today = (await pool.query(`SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND created_at >= ${SQL_TODAY_START}`, [uid])).rows[0].count;
  const dmSentToday = (await pool.query(`SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND sent_at >= ${SQL_TODAY_START}`, [uid])).rows[0].count;
  const dmSent = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status != 'to-send'", [uid])).rows[0].count;
  const warm = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'talking-warm'", [uid])).rows[0].count;
  const booked = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'call-booked'", [uid])).rows[0].count;
  const cold = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'talking-cold'", [uid])).rows[0].count;
  const signed = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'signed'", [uid])).rows[0].count;
  const replies = parseInt(cold) + parseInt(warm) + parseInt(booked) + parseInt(signed);
  const replyRate = parseInt(dmSent) > 0 ? ((replies / parseInt(dmSent)) * 100).toFixed(1) : '0';
  res.json({
    leads_today: parseInt(today),
    dm_sent_today: parseInt(dmSentToday),
    dm_sent: parseInt(dmSent),
    talking_warm: parseInt(warm),
    call_booked: parseInt(booked),
    reply_rate: replyRate
  });
});

// Stats outreach globales (pour l'admin)
app.get('/api/leads/admin-stats', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name as agent_name,
      COALESCE(COUNT(*), 0) as total_leads,
      COALESCE(SUM(CASE WHEN ol.created_at >= ${SQL_TODAY_START} THEN 1 ELSE 0 END), 0) as leads_today,
      COALESCE(SUM(CASE WHEN ol.status != 'to-send' THEN 1 ELSE 0 END), 0) as dm_sent,
      COALESCE(SUM(CASE WHEN ol.sent_at >= ${SQL_TODAY_START} THEN 1 ELSE 0 END), 0) as dm_sent_today,
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

// ============ PERFORMANCE CHARTS DATA ============

// Followers evolution par jour
app.get('/api/charts/followers', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT ds.date, m.name as model_name, a.platform, SUM(ds.new_followers) as new_followers
    FROM daily_stats ds
    JOIN accounts a ON ds.account_id = a.id
    JOIN models m ON a.model_id = m.id
    WHERE ds.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text
    GROUP BY ds.date, m.name, a.platform
    ORDER BY ds.date ASC
  `, [days]);
  res.json(rows);
});

// Revenue chatters par jour
app.get('/api/charts/revenue', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT cs.date,
      SUM(cs.ppv_total) as ppv,
      SUM(cs.tips_total) as tips,
      SUM(cs.ppv_total) + SUM(cs.tips_total) as revenue
    FROM chatter_shifts cs
    WHERE cs.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text
    GROUP BY cs.date
    ORDER BY cs.date ASC
  `, [days]);
  res.json(rows);
});

// Revenue chatters par jour par chatter
app.get('/api/charts/revenue-by-chatter', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT cs.date, u.display_name as chatter_name,
      SUM(cs.ppv_total) + SUM(cs.tips_total) as revenue
    FROM chatter_shifts cs
    JOIN users u ON cs.user_id = u.id
    WHERE cs.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text
    GROUP BY cs.date, u.display_name
    ORDER BY cs.date ASC
  `, [days]);
  res.json(rows);
});

// Leads outreach par jour
app.get('/api/charts/leads', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT created_at::date::text as date,
      COUNT(*) as total,
      SUM(CASE WHEN status != 'to-send' THEN 1 ELSE 0 END) as dm_sent,
      SUM(CASE WHEN status IN ('talking-cold','talking-warm','call-booked','signed') THEN 1 ELSE 0 END) as replies
    FROM outreach_leads
    WHERE created_at >= CURRENT_DATE - $1 * INTERVAL '1 day'
    GROUP BY created_at::date
    ORDER BY date ASC
  `, [days]);
  res.json(rows);
});

// ============ STUDENT PROGRESSION ============
app.put('/api/students/:id/progression', authMiddleware, adminOnly, async (req, res) => {
  const { progression_step } = req.body;
  const steps = ['onboarding', 'accounts-setup', 'outreach', 'model-setup', 'traffic'];
  if (!steps.includes(progression_step)) return res.status(400).json({ error: 'Étape invalide' });
  const progression = Math.round(((steps.indexOf(progression_step) + 1) / steps.length) * 100);
  await pool.query('UPDATE students SET progression_step = $1, progression = $2 WHERE id = $3', [progression_step, progression, req.params.id]);
  res.json({ ok: true });
});

// ============ CALL REQUESTS ============
app.get('/api/call-requests', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM call_requests WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(`SELECT cr.*, u.display_name as student_name FROM call_requests cr JOIN users u ON cr.user_id = u.id ORDER BY CASE cr.status WHEN 'pending' THEN 0 ELSE 1 END, cr.created_at DESC`);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/call-requests', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Réservé aux élèves' });
  const { message, availabilities } = req.body;
  const { rows } = await pool.query('INSERT INTO call_requests (user_id, message, availabilities) VALUES ($1, $2, $3) RETURNING *', [req.user.id, message, availabilities]);
  broadcast('call-request-new', rows[0]);
  res.json(rows[0]);
});

app.put('/api/call-requests/:id', authMiddleware, adminOnly, async (req, res) => {
  const { status, scheduled_at, admin_notes } = req.body;
  await pool.query('UPDATE call_requests SET status = COALESCE($1, status), scheduled_at = COALESCE($2, scheduled_at), admin_notes = COALESCE($3, admin_notes) WHERE id = $4', [status, scheduled_at, admin_notes, req.params.id]);
  broadcast('call-request-updated', { id: parseInt(req.params.id), status });
  res.json({ ok: true });
});

app.delete('/api/call-requests/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM call_requests WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM call_requests WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT RECRUITS (modèles recrutées) ============
app.get('/api/student-recruits', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM student_recruits WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const { rows } = await pool.query('SELECT sr.*, u.display_name as student_name FROM student_recruits sr JOIN users u ON sr.user_id = u.id ORDER BY sr.created_at DESC');
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/student-recruits', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { ig_name, ig_link, notes } = req.body;
  if (!ig_name) return res.status(400).json({ error: 'Nom Instagram requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query('INSERT INTO student_recruits (user_id, ig_name, ig_link, notes) VALUES ($1, $2, $3, $4) RETURNING *', [uid, ig_name, ig_link, notes]);
  res.json(rows[0]);
});

app.put('/api/student-recruits/:id', authMiddleware, async (req, res) => {
  const { status, notes } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_recruits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('UPDATE student_recruits SET status = COALESCE($1, status), notes = COALESCE($2, notes) WHERE id = $3', [status, notes, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/student-recruits/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_recruits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_recruits WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT OUTREACH ASSIGNMENTS ============
app.get('/api/student-outreach-assignments', authMiddleware, async (req, res) => {
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(`SELECT soa.*, s.display_name as student_name, o.display_name as outreach_name
      FROM student_outreach_assignments soa
      JOIN users s ON soa.student_user_id = s.id JOIN users o ON soa.outreach_user_id = o.id
      ORDER BY s.display_name`);
    return res.json(rows);
  }
  if (req.user.role === 'outreach') {
    const { rows } = await pool.query(`SELECT soa.*, s.display_name as student_name
      FROM student_outreach_assignments soa JOIN users s ON soa.student_user_id = s.id
      WHERE soa.outreach_user_id = $1 ORDER BY s.display_name`, [req.user.id]);
    return res.json(rows);
  }
  res.json([]);
});

app.post('/api/student-outreach-assignments', authMiddleware, adminOnly, async (req, res) => {
  const { student_user_id, outreach_user_id } = req.body;
  if (!student_user_id || !outreach_user_id) return res.status(400).json({ error: 'IDs requis' });
  try {
    const { rows } = await pool.query('INSERT INTO student_outreach_assignments (student_user_id, outreach_user_id) VALUES ($1, $2) RETURNING *', [student_user_id, outreach_user_id]);
    res.json(rows[0]);
  } catch(e) { res.status(409).json({ error: 'Assignation déjà existante' }); }
});

app.delete('/api/student-outreach-assignments/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM student_outreach_assignments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Helper: check if user can access student outreach
async function canAccessStudentOutreach(userId, userRole, studentUserId) {
  if (userRole === 'admin') return true;
  if (userRole === 'student') {
    if (userId === parseInt(studentUserId)) return true;
    // Vérifier si pairés
    const sharedIds = await getSharedOutreachIds(userId);
    if (sharedIds.includes(parseInt(studentUserId))) return true;
  }
  if (userRole === 'outreach') {
    // Vérifier assignation directe ou via un partenaire
    const sharedIds = await getSharedOutreachIds(studentUserId);
    const check = await pool.query('SELECT id FROM student_outreach_assignments WHERE student_user_id = ANY($1) AND outreach_user_id = $2', [sharedIds, userId]);
    return check.rows.length > 0;
  }
  return false;
}

// ============ STUDENT OUTREACH PAIRS ============
// Helper: get all user IDs sharing outreach with this student
async function getSharedOutreachIds(studentUserId) {
  const { rows } = await pool.query(
    `SELECT student_b_id as partner_id FROM student_outreach_pairs WHERE student_a_id = $1
     UNION SELECT student_a_id as partner_id FROM student_outreach_pairs WHERE student_b_id = $1`, [studentUserId]);
  const ids = [parseInt(studentUserId)];
  rows.forEach(r => ids.push(r.partner_id));
  return ids;
}

app.get('/api/student-outreach-pairs', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query(`SELECT sop.*, a.display_name as student_a_name, b.display_name as student_b_name
    FROM student_outreach_pairs sop JOIN users a ON sop.student_a_id = a.id JOIN users b ON sop.student_b_id = b.id ORDER BY a.display_name`);
  res.json(rows);
});

app.post('/api/student-outreach-pairs', authMiddleware, adminOnly, async (req, res) => {
  const { student_a_id, student_b_id } = req.body;
  if (!student_a_id || !student_b_id) return res.status(400).json({ error: 'Deux élèves requis' });
  if (student_a_id === student_b_id) return res.status(400).json({ error: 'Impossible de pairer un élève avec lui-même' });
  // Toujours stocker le plus petit ID en A pour éviter les doublons inversés
  const a = Math.min(student_a_id, student_b_id);
  const b = Math.max(student_a_id, student_b_id);
  try {
    const { rows } = await pool.query('INSERT INTO student_outreach_pairs (student_a_id, student_b_id) VALUES ($1, $2) RETURNING *', [a, b]);
    res.json(rows[0]);
  } catch(e) { res.status(409).json({ error: 'Cette paire existe déjà' }); }
});

app.delete('/api/student-outreach-pairs/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM student_outreach_pairs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT LEADS BULK IMPORT ============
app.post('/api/student-leads/import-csv', authMiddleware, async (req, res) => {
  const { csv_content, student_user_id } = req.body;
  if (!csv_content) return res.status(400).json({ error: 'Contenu CSV requis' });

  // Déterminer le propriétaire
  let ownerId;
  if (req.user.role === 'student') {
    ownerId = req.user.id;
  } else if (req.user.role === 'outreach' && student_user_id) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    ownerId = student_user_id;
  } else if (req.user.role === 'admin' && student_user_id) {
    ownerId = student_user_id;
  } else {
    ownerId = req.user.id;
  }

  const statusMap = {
    'sent': 'sent', 'to send': 'to-send', 'to-send': 'to-send',
    'talking - cold': 'talking-cold', 'talking-cold': 'talking-cold', 'talking cold': 'talking-cold',
    'talking - warm': 'talking-warm', 'talking-warm': 'talking-warm', 'talking warm': 'talking-warm',
    'call booked': 'call-booked', 'call-booked': 'call-booked',
    'signed': 'signed'
  };

  // Parser CSV avec gestion des guillemets
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const lines = csv_content.split('\n').filter(l => l.trim());
  let imported = 0, updated = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    let username = (cols[0] || '').trim();
    if (!username) continue;

    let igLink = (cols[1] || '').trim();
    const leadType = (cols[2] || '').trim().toLowerCase() || '';
    const rawStatus = (cols[3] || '').trim().toLowerCase();
    const script = (cols[4] || '').trim();
    const account = (cols[5] || '').trim();
    const notes = (cols[6] || '').trim();
    const status = statusMap[rawStatus] || 'sent';

    // Si le username est un lien Instagram, extraire le vrai username
    if (username.includes('instagram.com')) {
      const match = username.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
      if (match) { if (!igLink) igLink = username; username = match[1]; }
    }

    // Vérifier doublon dans le pool partagé
    const cleanUsername = username.replace(/^@/, '');
    const sharedIds = await getSharedOutreachIds(ownerId);
    const exists = await pool.query("SELECT id FROM student_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1) AND user_id = ANY($2)", [cleanUsername, sharedIds]);

    if (exists.rows.length > 0) {
      // Mettre à jour le lead existant
      await pool.query(`UPDATE student_leads SET ig_link = COALESCE(NULLIF($1,''), ig_link), lead_type = COALESCE(NULLIF($2,''), lead_type),
        status = COALESCE(NULLIF($3,''), status), script_used = COALESCE(NULLIF($4,''), script_used),
        ig_account_used = COALESCE(NULLIF($5,''), ig_account_used), notes = COALESCE(NULLIF($6,''), notes), updated_at = NOW() WHERE id = $7`,
        [igLink, leadType, status, script, account, notes, exists.rows[0].id]);
      updated++;
    } else {
      await pool.query('INSERT INTO student_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [ownerId, username, igLink, leadType, script, account, notes, status, req.user.id]);
      imported++;
    }
  }

  res.json({ ok: true, imported, updated, skipped: lines.length - 1 - imported - updated, total: lines.length - 1 });
});

// ============ STUDENT LEADS (outreach élèves) ============
// GET: student voit les siens, outreach voit ceux de l'élève assigné (via ?student_user_id=), admin voit tout
app.get('/api/student-leads', authMiddleware, async (req, res) => {
  const studentUserId = req.query.student_user_id;

  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    const { rows } = await pool.query('SELECT sl.*, ab.display_name as added_by_name FROM student_leads sl LEFT JOIN users ab ON sl.added_by = ab.id WHERE sl.user_id = ANY($1) ORDER BY sl.created_at DESC', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'outreach' && studentUserId) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, studentUserId);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    const sharedIds = await getSharedOutreachIds(studentUserId);
    const { rows } = await pool.query('SELECT sl.*, ab.display_name as added_by_name FROM student_leads sl LEFT JOIN users ab ON sl.added_by = ab.id WHERE sl.user_id = ANY($1) ORDER BY sl.created_at DESC', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    if (studentUserId) {
      const { rows } = await pool.query('SELECT sl.*, u.display_name as student_name, ab.display_name as added_by_name FROM student_leads sl JOIN users u ON sl.user_id = u.id LEFT JOIN users ab ON sl.added_by = ab.id WHERE sl.user_id = $1 ORDER BY sl.created_at DESC', [studentUserId]);
      return res.json(rows);
    }
    const { rows } = await pool.query('SELECT sl.*, u.display_name as student_name, ab.display_name as added_by_name FROM student_leads sl JOIN users u ON sl.user_id = u.id LEFT JOIN users ab ON sl.added_by = ab.id ORDER BY sl.created_at DESC');
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

// POST: student ajoute pour soi, outreach ajoute pour l'élève assigné (via student_user_id), admin pour tout le monde
app.post('/api/student-leads', authMiddleware, async (req, res) => {
  const { username, ig_link, lead_type, script_used, ig_account_used, notes, status, student_user_id } = req.body;
  if (!username) return res.status(400).json({ error: 'Username requis' });

  // Déterminer le propriétaire du lead
  let ownerId;
  if (req.user.role === 'student') {
    ownerId = req.user.id;
  } else if (req.user.role === 'outreach' && student_user_id) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    ownerId = student_user_id;
  } else if (req.user.role === 'admin' && student_user_id) {
    ownerId = student_user_id;
  } else {
    return res.status(400).json({ error: 'student_user_id requis' });
  }

  const cleanUsername = username.replace(/^@/, '');
  const sharedIds = await getSharedOutreachIds(ownerId);
  const exists = await pool.query("SELECT id FROM student_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1) AND user_id = ANY($2)", [cleanUsername, sharedIds]);
  if (exists.rows.length > 0) return res.status(409).json({ error: 'Ce lead existe déjà' });
  const { rows } = await pool.query('INSERT INTO student_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    [ownerId, username, ig_link, lead_type || '', script_used, ig_account_used, notes, status || 'to-send', req.user.id]);
  res.json(rows[0]);
});

app.put('/api/student-leads/:id', authMiddleware, async (req, res) => {
  const { status, notes, lead_type, script_used, ig_account_used } = req.body;
  // Vérifier l'accès
  const lead = (await pool.query('SELECT user_id FROM student_leads WHERE id = $1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, lead.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query(`UPDATE student_leads SET
    status = COALESCE($1, status), notes = COALESCE($2, notes),
    lead_type = COALESCE($3, lead_type), script_used = COALESCE($4, script_used),
    ig_account_used = COALESCE($5, ig_account_used), updated_at = NOW(),
    sent_at = CASE WHEN $1 = 'sent' AND (sent_at IS NULL) THEN NOW() ELSE sent_at END WHERE id = $6`,
    [status, notes, lead_type, script_used, ig_account_used, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/student-leads/:id', authMiddleware, async (req, res) => {
  const lead = (await pool.query('SELECT user_id FROM student_leads WHERE id = $1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, lead.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_leads WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/student-leads/stats', authMiddleware, async (req, res) => {
  let uid = req.query.student_user_id || req.query.user_id;
  if (req.user.role === 'student') uid = req.user.id;
  if (uid && req.user.role === 'outreach') {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, uid);
    if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  }
  if (!uid) return res.status(400).json({ error: 'user_id requis' });
  const sharedIds = await getSharedOutreachIds(uid);

  // Stats globales du pool partagé
  const total = (await pool.query('SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)', [sharedIds])).rows[0].c;
  const leadsToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND created_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;
  const dmSentToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND sent_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;
  const dmSent = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status != 'to-send'", [sharedIds])).rows[0].c;
  const cold = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status = 'talking-cold'", [sharedIds])).rows[0].c;
  const warm = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status = 'talking-warm'", [sharedIds])).rows[0].c;
  const booked = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status = 'call-booked'", [sharedIds])).rows[0].c;
  const signed = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status = 'signed'", [sharedIds])).rows[0].c;
  const replies = parseInt(cold) + parseInt(warm) + parseInt(booked) + parseInt(signed);
  const rate = parseInt(dmSent) > 0 ? ((replies / parseInt(dmSent)) * 100).toFixed(1) : '0';

  // Stats individuelles par membre du pool
  const contributions = [];
  for (const memberId of sharedIds) {
    const memberName = (await pool.query('SELECT display_name FROM users WHERE id = $1', [memberId])).rows[0]?.display_name || '?';
    const mLeads = (await pool.query('SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2)', [memberId, sharedIds])).rows[0].c;
    const mDms = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2) AND sent_at >= ${SQL_TODAY_START}`, [memberId, sharedIds])).rows[0].c;
    const mTotal = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2) AND status != 'to-send'", [memberId, sharedIds])).rows[0].c;
    contributions.push({ user_id: memberId, name: memberName, leads_added: parseInt(mLeads), dms_today: parseInt(mDms), dms_total: parseInt(mTotal) });
  }

  res.json({ total: parseInt(total), leads_today: parseInt(leadsToday), dm_sent_today: parseInt(dmSentToday), dm_sent: parseInt(dmSent), talking_cold: parseInt(cold), talking_warm: parseInt(warm), call_booked: parseInt(booked), signed: parseInt(signed), reply_rate: rate, contributions, shared: sharedIds.length > 1 });
});

// ============ STUDENT MODELS ============
app.get('/api/student-models', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM student_models WHERE user_id = $1 ORDER BY name', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const userId = req.query.user_id;
    const query = userId
      ? 'SELECT sm.*, u.display_name as student_name FROM student_models sm JOIN users u ON sm.user_id = u.id WHERE sm.user_id = $1 ORDER BY sm.name'
      : 'SELECT sm.*, u.display_name as student_name FROM student_models sm JOIN users u ON sm.user_id = u.id ORDER BY u.display_name, sm.name';
    const { rows } = await pool.query(query, userId ? [userId] : []);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/student-models', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { name, of_handle, fans_count, commission_rate, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query('INSERT INTO student_models (user_id, name, of_handle, fans_count, commission_rate, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [uid, name, of_handle, fans_count || 0, commission_rate || 0, status || 'onboarding']);
  res.json(rows[0]);
});

app.put('/api/student-models/:id', authMiddleware, async (req, res) => {
  const { name, of_handle, fans_count, commission_rate, status } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_models WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('UPDATE student_models SET name=COALESCE($1,name), of_handle=COALESCE($2,of_handle), fans_count=COALESCE($3,fans_count), commission_rate=COALESCE($4,commission_rate), status=COALESCE($5,status) WHERE id=$6',
    [name, of_handle, fans_count, commission_rate, status, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/student-models/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_models WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_models WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT REVENUE ============
app.get('/api/student-revenue', authMiddleware, async (req, res) => {
  const uid = req.user.role === 'student' ? req.user.id : req.query.user_id;
  if (!uid && req.user.role === 'admin') {
    // Admin global: all revenues with student + model names
    const { rows } = await pool.query(`SELECT sr.*, sm.name as model_name, sm.commission_rate, u.display_name as student_name
      FROM student_revenue sr JOIN student_models sm ON sr.student_model_id = sm.id JOIN users u ON sr.user_id = u.id ORDER BY sr.month DESC, u.display_name`);
    return res.json(rows);
  }
  if (!uid) return res.status(400).json({ error: 'user_id requis' });
  const { rows } = await pool.query(`SELECT sr.*, sm.name as model_name, sm.commission_rate
    FROM student_revenue sr JOIN student_models sm ON sr.student_model_id = sm.id WHERE sr.user_id = $1 ORDER BY sr.month DESC`, [uid]);
  res.json(rows);
});

app.post('/api/student-revenue', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  const { student_model_id, month, revenue } = req.body;
  if (!student_model_id || !month) return res.status(400).json({ error: 'Modèle et mois requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query(`INSERT INTO student_revenue (user_id, student_model_id, month, revenue) VALUES ($1, $2, $3, $4)
    ON CONFLICT (student_model_id, month) DO UPDATE SET revenue = EXCLUDED.revenue RETURNING *`, [uid, student_model_id, month, revenue || 0]);
  res.json(rows[0]);
});

// ============ MESSAGES (chat temps réel) ============
app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const myId = req.user.id;
  if (req.user.role !== 'admin' && req.user.role !== 'student') return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query(`SELECT * FROM messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1) ORDER BY created_at ASC`, [myId, otherId]);
  // Mark as read
  await pool.query('UPDATE messages SET read = true WHERE to_user_id = $1 AND from_user_id = $2 AND read = false', [myId, otherId]);
  res.json(rows);
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  const { to_user_id, content } = req.body;
  if (!content || !to_user_id) return res.status(400).json({ error: 'Destinataire et message requis' });
  const { rows } = await pool.query('INSERT INTO messages (from_user_id, to_user_id, content) VALUES ($1, $2, $3) RETURNING *', [req.user.id, to_user_id, content]);
  broadcast('new-message', { ...rows[0], from_name: req.user.display_name });
  res.json(rows[0]);
});

app.get('/api/messages-unread', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`SELECT from_user_id, COUNT(*) as unread FROM messages WHERE to_user_id = $1 AND read = false GROUP BY from_user_id`, [req.user.id]);
  res.json(rows);
});

// Conversations list (admin voit tous les étudiants, étudiant voit juste l'admin)
app.get('/api/conversations', authMiddleware, async (req, res) => {
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(`SELECT u.id, u.display_name, u.avatar_url, (SELECT COUNT(*) FROM messages WHERE to_user_id = $1 AND from_user_id = u.id AND read = false) as unread,
      (SELECT content FROM messages WHERE (from_user_id = u.id AND to_user_id = $1) OR (from_user_id = $1 AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message
      FROM users u WHERE u.role = 'student' ORDER BY unread DESC, u.display_name`, [req.user.id]);
    return res.json(rows);
  }
  // Student: find admin
  const { rows } = await pool.query(`SELECT u.id, u.display_name, u.avatar_url, (SELECT COUNT(*) FROM messages WHERE to_user_id = $1 AND from_user_id = u.id AND read = false) as unread,
    (SELECT content FROM messages WHERE (from_user_id = u.id AND to_user_id = $1) OR (from_user_id = $1 AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message
    FROM users u WHERE u.role = 'admin' LIMIT 1`, [req.user.id]);
  res.json(rows);
});

// ============ RESOURCES ============
app.get('/api/resources', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'student') return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query('SELECT id, title, category, res_type, url, file_name, description, created_at FROM resources ORDER BY category, created_at DESC');
  res.json(rows);
});

app.post('/api/resources', authMiddleware, adminOnly, async (req, res) => {
  const { title, category, res_type, url, file_data, file_name, file_mime, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  let fileBuffer = null;
  if (file_data) fileBuffer = Buffer.from(file_data.split(',')[1] || file_data, 'base64');
  const { rows } = await pool.query('INSERT INTO resources (title, category, res_type, url, file_data, file_name, file_mime, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, category, res_type, url, file_name, description',
    [title, category || 'general', res_type || 'link', url, fileBuffer, file_name, file_mime, description]);
  res.json(rows[0]);
});

app.get('/api/resources/:id/download', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT file_data, file_name, file_mime FROM resources WHERE id = $1', [req.params.id]);
  if (!rows[0] || !rows[0].file_data) return res.status(404).json({ error: 'Fichier introuvable' });
  res.set('Content-Type', rows[0].file_mime || 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="' + (rows[0].file_name || 'file') + '"');
  res.send(rows[0].file_data);
});

app.delete('/api/resources/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ USER OPTIONS (scripts, comptes, types) ============
// student_user_id param: pour outreach qui gère l'outreach d'un élève, utilise les options de l'élève
app.get('/api/user-options', authMiddleware, async (req, res) => {
  let uid = req.user.id;
  if (req.query.student_user_id) {
    const sid = req.query.student_user_id;
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, sid);
    if (allowed) uid = sid;
  } else if (req.query.user_id && req.user.role === 'admin') {
    uid = req.query.user_id;
  }
  const { rows } = await pool.query('SELECT * FROM user_options WHERE user_id = $1 ORDER BY option_type, value', [uid]);
  const grouped = { script: [], account: [], type: [] };
  rows.forEach(r => { if (grouped[r.option_type]) grouped[r.option_type].push(r); });
  res.json(grouped);
});

app.post('/api/user-options', authMiddleware, async (req, res) => {
  const { option_type, value, student_user_id } = req.body;
  if (!option_type || !value) return res.status(400).json({ error: 'Type et valeur requis' });
  if (!['script', 'account', 'type'].includes(option_type)) return res.status(400).json({ error: 'Type invalide' });
  // Si outreach travaille pour un élève, les options sont créées sous l'ID de l'élève
  let uid = req.user.id;
  if (student_user_id) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (allowed) uid = student_user_id;
  }
  try {
    const { rows } = await pool.query('INSERT INTO user_options (user_id, option_type, value) VALUES ($1, $2, $3) RETURNING *', [uid, option_type, value.trim()]);
    res.json(rows[0]);
  } catch (e) {
    res.status(409).json({ error: 'Cette option existe déjà' });
  }
});

app.delete('/api/user-options/:id', authMiddleware, async (req, res) => {
  // Vérifier si l'option appartient à l'utilisateur ou à un élève assigné
  const opt = (await pool.query('SELECT user_id FROM user_options WHERE id = $1', [req.params.id])).rows[0];
  if (!opt) return res.status(404).json({ error: 'Option introuvable' });
  const allowed = opt.user_id === req.user.id || req.user.role === 'admin' || await canAccessStudentOutreach(req.user.id, req.user.role, opt.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM user_options WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ WEEKLY OBJECTIVES ============
app.get('/api/objectives', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM weekly_objectives WHERE user_id = $1 ORDER BY week_start DESC, obj_type', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin') {
    const userId = req.query.user_id;
    const query = userId
      ? 'SELECT wo.*, u.display_name as student_name FROM weekly_objectives wo JOIN users u ON wo.user_id = u.id WHERE wo.user_id = $1 ORDER BY wo.week_start DESC, wo.obj_type'
      : 'SELECT wo.*, u.display_name as student_name FROM weekly_objectives wo JOIN users u ON wo.user_id = u.id ORDER BY wo.week_start DESC, u.display_name, wo.obj_type';
    const { rows } = await pool.query(query, userId ? [userId] : []);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/objectives', authMiddleware, adminOnly, async (req, res) => {
  const { user_id, week_start, obj_type, description, target } = req.body;
  if (!user_id || !week_start || !obj_type) return res.status(400).json({ error: 'Champs requis manquants' });
  const { rows } = await pool.query('INSERT INTO weekly_objectives (user_id, week_start, obj_type, description, target) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [user_id, week_start, obj_type, description, target || 0]);
  res.json(rows[0]);
});

app.put('/api/objectives/:id', authMiddleware, async (req, res) => {
  const { current, target, description } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM weekly_objectives WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
    // Élèves ne peuvent que mettre à jour le current
    await pool.query('UPDATE weekly_objectives SET current = COALESCE($1, current) WHERE id = $2', [current, req.params.id]);
  } else if (req.user.role === 'admin') {
    await pool.query('UPDATE weekly_objectives SET current=COALESCE($1,current), target=COALESCE($2,target), description=COALESCE($3,description) WHERE id=$4',
      [current, target, description, req.params.id]);
  } else return res.status(403).json({ error: 'Accès refusé' });
  res.json({ ok: true });
});

app.delete('/api/objectives/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM weekly_objectives WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
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

// ============ FOLLOWERS SCRAPER ============
const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function scrapeInstagramFollowers(handle) {
  try {
    const username = handle.replace(/^@/, '');
    const html = await httpGet(`https://www.instagram.com/${username}/`);
    // Chercher dans les meta tags ou le JSON
    const metaMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
    if (metaMatch) return parseInt(metaMatch[1]);
    const metaTag = html.match(/content="([\d,.]+[kKmM]?) Followers/);
    if (metaTag) {
      let val = metaTag[1].replace(/,/g, '');
      if (val.match(/[kK]$/)) return Math.round(parseFloat(val) * 1000);
      if (val.match(/[mM]$/)) return Math.round(parseFloat(val) * 1000000);
      return parseInt(val);
    }
    // Essayer le format JSON-LD ou og:description
    const ogMatch = html.match(/(\d[\d,.]*)\s*Followers/i);
    if (ogMatch) {
      let val = ogMatch[1].replace(/,/g, '');
      return parseInt(val);
    }
    return null;
  } catch (e) {
    console.log(`IG scrape failed for ${handle}:`, e.message);
    return null;
  }
}

async function scrapeTikTokFollowers(handle) {
  try {
    const username = handle.replace(/^@/, '');
    const html = await httpGet(`https://www.tiktok.com/@${username}`);
    // TikTok met les stats dans un JSON script
    const match = html.match(/"followerCount":(\d+)/);
    if (match) return parseInt(match[1]);
    // Fallback: meta description
    const metaMatch = html.match(/Followers[^\d]*(\d[\d,.]*)/i);
    if (metaMatch) return parseInt(metaMatch[1].replace(/,/g, ''));
    return null;
  } catch (e) {
    console.log(`TikTok scrape failed for ${handle}:`, e.message);
    return null;
  }
}

async function updateAllFollowers() {
  try {
    const { rows: accounts } = await pool.query(
      "SELECT id, platform, handle, current_followers FROM accounts WHERE platform IN ('instagram', 'tiktok')"
    );

    let updated = 0;
    for (const acc of accounts) {
      let newCount = null;
      if (acc.platform === 'instagram') {
        newCount = await scrapeInstagramFollowers(acc.handle);
      } else if (acc.platform === 'tiktok') {
        newCount = await scrapeTikTokFollowers(acc.handle);
      }

      if (newCount !== null && newCount !== acc.current_followers) {
        await pool.query(
          'UPDATE accounts SET previous_followers = current_followers, current_followers = $1, last_scraped = NOW() WHERE id = $2',
          [newCount, acc.id]
        );
        updated++;
      } else if (newCount !== null) {
        // Même valeur, juste mettre à jour last_scraped
        await pool.query('UPDATE accounts SET last_scraped = NOW() WHERE id = $1', [acc.id]);
      }

      // Pause entre chaque requête pour éviter le rate limit
      await new Promise(r => setTimeout(r, 2000));
    }

    if (updated > 0) {
      broadcast('followers-updated', { updated });
      console.log(`Followers updated: ${updated} accounts`);
    }
  } catch (e) {
    console.error('Follower update error:', e.message);
  }
}

// Route pour forcer un refresh des followers (admin)
app.post('/api/admin/refresh-followers', authMiddleware, adminOnly, async (req, res) => {
  updateAllFollowers(); // lancer en arrière-plan
  res.json({ ok: true, message: 'Mise à jour lancée en arrière-plan' });
});

// ============ START ============
async function start() {
  await initDB();
  await seedData();

  // Lancer le premier scrape après 10 secondes
  setTimeout(() => updateAllFollowers(), 10000);
  // Puis toutes les 15 minutes
  setInterval(() => updateAllFollowers(), 15 * 60 * 1000);

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
