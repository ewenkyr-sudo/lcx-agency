const pool = require('./pool');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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
      -- plain_password column removed for security
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
      ALTER TABLE students ADD COLUMN IF NOT EXISTS outreach_us_enabled BOOLEAN DEFAULT false;
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS market TEXT DEFAULT 'fr';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS drive_folder TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS drive_folder TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS drive_contract TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'active';
      -- Model onboarding quiz fields
      ALTER TABLE models ADD COLUMN IF NOT EXISTS stage_name TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS birth_date DATE;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS nationality TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS city TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS country TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS ig_handle TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS ig_followers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS tiktok_handle TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS tiktok_followers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS twitter_handle TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS snapchat_handle TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS other_socials TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS has_of_account BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS of_link TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS of_subscribers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS of_revenue_monthly DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS of_launch_date DATE;
      -- Fansly
      ALTER TABLE models ADD COLUMN IF NOT EXISTS has_fansly_account BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fansly_link TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fansly_subscribers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fansly_revenue_monthly DECIMAL(10,2) DEFAULT 0;
      -- Fanvue
      ALTER TABLE models ADD COLUMN IF NOT EXISTS has_fanvue_account BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fanvue_link TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fanvue_subscribers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS fanvue_revenue_monthly DECIMAL(10,2) DEFAULT 0;
      -- MYM
      ALTER TABLE models ADD COLUMN IF NOT EXISTS has_mym_account BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS mym_link TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS mym_subscribers INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS mym_revenue_monthly DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS content_types TEXT DEFAULT '[]';
      ALTER TABLE models ADD COLUMN IF NOT EXISTS post_frequency TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS has_photographer BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS content_stock INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS revenue_goal DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS availability_hours INTEGER DEFAULT 0;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS languages TEXT DEFAULT '[]';
      ALTER TABLE models ADD COLUMN IF NOT EXISTS target_markets TEXT DEFAULT '[]';
      ALTER TABLE models ADD COLUMN IF NOT EXISTS contract_link TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS gdpr_accepted BOOLEAN DEFAULT false;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS internal_notes TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS read_only BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'shift';
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS description TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS model_content_planning (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      drive_link TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Sessions actives (présence en ligne)
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_ping TIMESTAMPTZ DEFAULT NOW(),
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    );

    -- Activity log
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Shift clock (pointage)
    CREATE TABLE IF NOT EXISTS shift_clocks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clock_in TIMESTAMPTZ NOT NULL,
      clock_out TIMESTAMPTZ,
      duration_minutes INTEGER
    );

    -- Model revenue objectives
    CREATE TABLE IF NOT EXISTS model_revenue_objectives (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      target NUMERIC(10,2) DEFAULT 0,
      current NUMERIC(10,2) DEFAULT 0,
      UNIQUE(model_id, month)
    );

    -- Payments tracking
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

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
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS planning_shifts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_date DATE NOT NULL,
      shift_type TEXT DEFAULT 'custom',
      start_time TEXT,
      end_time TEXT,
      model_ids TEXT DEFAULT '[]',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Multi-agency support
    CREATE TABLE IF NOT EXISTS agencies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#8b5cf6',
      owner_id INTEGER,
      active BOOLEAN DEFAULT true,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'active',
      subscription_plan TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Invitation tokens for secure registration
    CREATE TABLE IF NOT EXISTS invitation_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      agency_id INTEGER,
      role TEXT DEFAULT 'super_admin',
      plan TEXT DEFAULT 'pro',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

  `);

  // Add agency_id columns individually (each in its own try/catch so one failure doesn't block others)
  const agencyTables = ['users', 'models', 'team_members', 'students', 'tasks', 'outreach_leads', 'chatter_shifts', 'settings', 'resources', 'planning_shifts', 'leave_requests', 'model_revenue_objectives', 'payments', 'weekly_objectives', 'activity_log'];
  for (const table of agencyTables) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS agency_id INTEGER`);
    } catch(e) {}
  }

  // Add Stripe columns to agencies (migration for existing DBs)
  const stripeCols = ['stripe_customer_id TEXT', 'stripe_subscription_id TEXT', 'subscription_status TEXT DEFAULT \'active\'', 'subscription_plan TEXT'];
  for (const col of stripeCols) {
    try {
      await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS ${col}`);
    } catch(e) {}
  }

  // Onboarding columns — DEFAULT TRUE so existing agencies are NOT affected
  const onboardingCols = [
    "onboarding_completed BOOLEAN DEFAULT TRUE",
    "onboarding_completed_at TIMESTAMPTZ",
    "country TEXT",
    "timezone TEXT",
    "currency TEXT DEFAULT 'EUR'",
    "service_type TEXT",
    "models_count INTEGER",
    "chatters_count INTEGER",
    "target_markets TEXT[]",
    "founded_at TEXT",
    "contact_email TEXT",
    "phone TEXT",
    "legal_name TEXT",
    "address_street TEXT",
    "address_city TEXT",
    "address_zip TEXT",
    "address_country TEXT",
    "vat_number TEXT",
    "default_work_start TEXT DEFAULT '09:00'",
    "default_work_end TEXT DEFAULT '18:00'",
    "work_days TEXT[] DEFAULT '{lundi,mardi,mercredi,jeudi,vendredi}'",
    "language TEXT DEFAULT 'fr'",
    "email_notifications_enabled BOOLEAN DEFAULT TRUE"
  ];
  for (const col of onboardingCols) {
    try {
      await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS ${col}`);
    } catch(e) {}
  }

  // Recruitment module tables
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruitment_settings (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        enabled BOOLEAN DEFAULT false,
        coaching_price DECIMAL(10,2) DEFAULT 1500.00,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agency_id)
      );
      CREATE TABLE IF NOT EXISTS recruiters (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        commission_percentage DECIMAL(5,2) DEFAULT 10.00,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS recruitment_leads (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER,
        recruiter_id INTEGER REFERENCES recruiters(id) ON DELETE CASCADE,
        prospect_name VARCHAR(255),
        prospect_pseudo VARCHAR(255),
        platform VARCHAR(50) DEFAULT 'instagram',
        status VARCHAR(50) DEFAULT 'prospect_chaud',
        call_recruiter BOOLEAN DEFAULT false,
        call_owner BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Password reset tokens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});

    // Model profile (fiche personnelle)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS model_profiles (
        id SERIAL PRIMARY KEY,
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE UNIQUE,
        -- Infos de base
        online_name TEXT, age INTEGER, birth_date DATE, zodiac_sign TEXT,
        sexual_orientation TEXT, ethnicity TEXT, height TEXT,
        shoe_size TEXT, bra_size TEXT, location TEXT, hometown TEXT,
        spoken_languages TEXT, english_level TEXT,
        -- Profil personnel
        about TEXT, personality TEXT, hobbies TEXT,
        fav_color TEXT, fav_food TEXT, fav_music TEXT, fav_singer TEXT,
        sports TEXT, pets TEXT,
        university TEXT, specialty TEXT, other_job TEXT,
        -- Préférences de contenu (JSON array of accepted types)
        content_prefs JSONB DEFAULT '{}',
        custom_requests BOOLEAN DEFAULT false, video_calls BOOLEAN DEFAULT false,
        live_of BOOLEAN DEFAULT false, other_people BOOLEAN DEFAULT false,
        -- Notes supplémentaires
        relationship_status TEXT, travel_experience TEXT, sexiest_body_part TEXT,
        physical_appearance TEXT, work_availability TEXT,
        of_experience TEXT, current_revenue TEXT, equipment TEXT,
        current_situation TEXT, blocked_notes TEXT,
        -- Meta
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});

    // Model schedule (planning modèle)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS model_schedule (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
        day_date DATE NOT NULL,
        time_slot TEXT,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'task',
        color TEXT DEFAULT '#22D3EE',
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_model_schedule ON model_schedule(model_id, day_date)').catch(function() {});

    // Tracklinks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS model_tracklinks (
        id SERIAL PRIMARY KEY,
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
        agency_id INTEGER REFERENCES agencies(id),
        platform TEXT NOT NULL,
        account_name TEXT,
        link TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});

    // Fan CRM
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fans (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
        platform VARCHAR(20) DEFAULT 'onlyfans',
        username VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        total_spent DECIMAL(10,2) DEFAULT 0,
        last_spent_at TIMESTAMPTZ,
        last_interaction_at TIMESTAMPTZ,
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        subscription_status VARCHAR(20) DEFAULT 'active',
        subscription_expires_at TIMESTAMPTZ,
        tags JSONB DEFAULT '[]',
        notes TEXT,
        custom_fields JSONB DEFAULT '{}',
        is_important BOOLEAN DEFAULT false,
        imported_from VARCHAR(50),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(model_id, platform, username)
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fans_agency_model ON fans(agency_id, model_id, is_important)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fans_model_spent ON fans(model_id, total_spent DESC)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fans_username ON fans(username)').catch(function() {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fan_interactions (
        id SERIAL PRIMARY KEY,
        fan_id INTEGER REFERENCES fans(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        interaction_type VARCHAR(30) NOT NULL,
        amount DECIMAL(10,2),
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fan_interactions ON fan_interactions(fan_id, created_at DESC)').catch(function() {});

    // Content posts (content planner)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_posts (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
        scheduled_at TIMESTAMPTZ,
        platform VARCHAR(30) DEFAULT 'instagram',
        content_type VARCHAR(30) DEFAULT 'post_instagram',
        caption TEXT,
        media_link VARCHAR(500),
        status VARCHAR(20) DEFAULT 'draft',
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_content_posts_agency_sched ON content_posts(agency_id, scheduled_at)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_content_posts_model_sched ON content_posts(model_id, scheduled_at)').catch(function() {});

    // Notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        link VARCHAR(255),
        metadata JSONB DEFAULT '{}',
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)').catch(function() {});

    // Agency accounts (comptes IG de l'agence)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agency_accounts (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        handle VARCHAR(255) NOT NULL,
        platform VARCHAR(30) DEFAULT 'instagram',
        category VARCHAR(30) DEFAULT 'agency',
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        purpose TEXT,
        current_followers INTEGER DEFAULT 0,
        previous_followers INTEGER DEFAULT 0,
        profile_picture_data TEXT,
        profile_picture_url TEXT,
        profile_picture_updated_at TIMESTAMPTZ,
        last_scraped TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_agency_accounts ON agency_accounts(agency_id, category)').catch(function() {});

    // Account profile pictures
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS profile_picture_data TEXT').catch(function() {});
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT').catch(function() {});
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMPTZ').catch(function() {});

    // Add email column to users
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT').catch(function() {});

    // Auto-enable recruitment for all agencies
    await pool.query(`INSERT INTO recruitment_settings (agency_id, enabled, coaching_price)
      SELECT id, true, 1500 FROM agencies
      ON CONFLICT (agency_id) DO UPDATE SET enabled = true`).catch(function() {});

    // Index on users.email
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)').catch(function() {});
    // Unique constraint on email per agency (allows NULL emails)
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_agency ON users(email, agency_id) WHERE email IS NOT NULL').catch(function() {});

    // Migrate emails from invitation_tokens to users where missing
    try {
      const migrated = await pool.query(`
        UPDATE users u SET email = it.email
        FROM invitation_tokens it
        JOIN agencies a ON it.agency_id = a.id
        WHERE u.agency_id = a.id
          AND u.role = 'super_admin'
          AND u.email IS NULL
          AND it.used_at IS NOT NULL
          AND it.email IS NOT NULL
      `);
      if (migrated.rowCount > 0) console.log('[MIGRATION] Emails migrés depuis invitation_tokens:', migrated.rowCount);
    } catch(e) {}

    // ============ V2 MIGRATIONS — Finances / Chatters / Performances / VA ============

    // Extend chatter_shifts for real-time shift system
    const shiftCols = [
      'start_time TIMESTAMPTZ',
      'end_time TIMESTAMPTZ',
      'planned_end_time TIMESTAMPTZ',
      'model_ids JSONB DEFAULT \'[]\'',
      'ppv_count INTEGER DEFAULT 0',
      'ppv_sold INTEGER DEFAULT 0',
      'handover_notes TEXT',
      'shift_status VARCHAR(20) DEFAULT \'completed\''
    ];
    for (const col of shiftCols) {
      await pool.query('ALTER TABLE chatter_shifts ADD COLUMN IF NOT EXISTS ' + col).catch(function() {});
    }

    // Extend payments for detailed finance tracking
    const paymentCols = [
      'commission_rate NUMERIC(5,2)',
      'commission_amount NUMERIC(10,2)',
      'net_amount NUMERIC(10,2)',
      'payment_date DATE',
      'source TEXT DEFAULT \'manual\''
    ];
    for (const col of paymentCols) {
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS ' + col).catch(function() {});
    }

    // Add commission_rate to team_members for chatter commission calculation
    await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) DEFAULT 0').catch(function() {});
    await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2) DEFAULT 0').catch(function() {});

    // VA recurring tasks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recurring_tasks (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        title TEXT NOT NULL,
        description TEXT,
        frequency VARCHAR(20) DEFAULT 'daily',
        assigned_role VARCHAR(20) DEFAULT 'va',
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});

    // Performance indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chatter_shifts_user ON chatter_shifts(user_id, date DESC)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chatter_shifts_agency ON chatter_shifts(agency_id, date DESC)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chatter_shifts_status ON chatter_shifts(shift_status) WHERE shift_status = \'active\'').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_agency ON payments(agency_id, month DESC)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_model ON payments(model_id, month DESC)').catch(function() {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_shift_clocks_user ON shift_clocks(user_id, clock_in DESC)').catch(function() {});

  } catch(e) {}
}

// ============ SEED DEFAULT DATA ============
const LEGACY_PASSWORDS = ['admin123', 'team123', 'eleve123', 'password', '12345678'];

async function seedData() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(rows[0].count) > 0) {
    // Check for users with legacy default passwords
    try {
      const allUsers = (await pool.query('SELECT id, username, password FROM users')).rows;
      let warnCount = 0;
      for (const u of allUsers) {
        for (const legacyPwd of LEGACY_PASSWORDS) {
          if (bcrypt.compareSync(legacyPwd, u.password)) {
            console.warn('[SECURITY WARNING] User "' + u.username + '" (id:' + u.id + ') uses a default password — CHANGE IT IMMEDIATELY');
            warnCount++;
            break;
          }
        }
      }
      if (warnCount > 0) console.warn('[SECURITY WARNING] ' + warnCount + ' user(s) with default passwords detected');
    } catch(e) {}
    return;
  }

  // First boot — create initial admin with random password
  const adminPassword = crypto.randomBytes(12).toString('base64url').substring(0, 16);
  const adminHash = bcrypt.hashSync(adminPassword, 10);
  await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', ['admin', adminHash, 'Admin', 'admin']);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  COMPTE ADMIN INITIAL CRÉÉ                          ║');
  console.log('║                                                          ║');
  console.log('║  Username : admin                                        ║');
  console.log('║  Mot de passe : ' + adminPassword + '                              ║');
  console.log('║                                                          ║');
  console.log('║  CHANGEZ CE MOT DE PASSE IMMÉDIATEMENT APRÈS CONNEXION  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Agency settings
  const settingsData = [
    ['agency_name', 'Fuzion Pilot'],
    ['agency_subtitle', 'Fuzion Pilot'],
  ];
  for (const s of settingsData) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', s);
  }

  console.log('Seed complete — admin account created (no test accounts).');
}

async function migrateToMultiAgency() {
  try {
    // Ensure default agency exists
    const { rows: agencies } = await pool.query('SELECT id FROM agencies LIMIT 1');
    if (agencies.length === 0) {
      await pool.query("INSERT INTO agencies (id, name, primary_color) VALUES (1, 'Fuzion Pilot', '#8b5cf6')");
    }
    // ALWAYS fix orphaned data (idempotent) — assign all NULL agency_id rows to agency 1
    const tables = ['users', 'models', 'team_members', 'students', 'tasks', 'outreach_leads', 'chatter_shifts', 'resources', 'planning_shifts', 'leave_requests', 'model_revenue_objectives', 'payments', 'weekly_objectives', 'activity_log'];
    for (const table of tables) {
      await pool.query(`UPDATE ${table} SET agency_id = 1 WHERE agency_id IS NULL`);
    }
    await pool.query("UPDATE settings SET agency_id = 1 WHERE agency_id IS NULL");
    // Set owner if not set
    const { rows: ownerCheck } = await pool.query('SELECT owner_id FROM agencies WHERE id = 1');
    if (ownerCheck.length > 0 && !ownerCheck[0].owner_id) {
      const { rows: firstAdmin } = await pool.query("SELECT id FROM users WHERE role IN ('admin', 'super_admin') ORDER BY id LIMIT 1");
      if (firstAdmin.length > 0) {
        await pool.query('UPDATE agencies SET owner_id = $1 WHERE id = 1', [firstAdmin[0].id]);
      }
    }
    // Drop old settings PK if it exists (key was PK, now we need composite)
    const { rows: pkCheck } = await pool.query("SELECT 1 FROM pg_constraint WHERE conname = 'settings_pkey' AND conrelid = 'settings'::regclass");
    if (pkCheck.length > 0) {
      await pool.query('ALTER TABLE settings DROP CONSTRAINT settings_pkey');
      console.log('Dropped settings_pkey constraint');
    }
    // Promote platform admin from env var (PLATFORM_ADMIN_USER=ewen)
    const platformUser = process.env.PLATFORM_ADMIN_USER;
    if (platformUser) {
      const { rowCount } = await pool.query("UPDATE users SET role = 'platform_admin' WHERE LOWER(username) = LOWER($1) AND role != 'platform_admin'", [platformUser]);
      if (rowCount > 0) console.log('Promoted ' + platformUser + ' to platform_admin');
    }
    console.log('Multi-agency migration OK');
  } catch(e) {
    console.log('Migration note:', e.message);
  }
}


module.exports = { initDB, seedData, migrateToMultiAgency };
