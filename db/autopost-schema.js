// ============ AUTO-POST REVEAL — TABLES ============
// Module autonome : appelé une fois au démarrage (server.js et worker).
const pool = require('./pool');

async function initAutopostDB() {
  await pool.query(`
    -- Réglages par modèle CRM
    CREATE TABLE IF NOT EXISTS autopost_settings (
      model_id INTEGER PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
      agency_id INTEGER,
      enabled BOOLEAN DEFAULT false,
      reveal_model_id TEXT,
      posts_per_day INTEGER DEFAULT 2,
      reels_per_day INTEGER DEFAULT 1,
      stories_per_day INTEGER DEFAULT 3,
      window_start TEXT DEFAULT '09:00',
      window_end TEXT DEFAULT '23:00',
      post_audience TEXT DEFAULT 'subscribers',      -- subscribers | public
      story_public BOOLEAN DEFAULT true,
      rotation_enabled BOOLEAN DEFAULT true,
      rotation_cooldown_days INTEGER DEFAULT 30,
      rotation_mix_pct INTEGER DEFAULT 0,            -- % de créneaux pris en rotation même s'il reste du neuf
      captions TEXT DEFAULT '',                      -- légendes de la modèle (une par ligne), sinon celles de l'agence
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Réglages globaux par agence (pause, session Reveal, statut worker)
    CREATE TABLE IF NOT EXISTS autopost_agency (
      agency_id INTEGER PRIMARY KEY,
      paused BOOLEAN DEFAULT false,
      session_enc TEXT,                 -- session Reveal chiffrée
      session_updated_at TIMESTAMPTZ,
      session_status TEXT DEFAULT 'missing',   -- missing | ok | expired
      session_checked_at TIMESTAMPTZ,
      whatsapp_reports BOOLEAN DEFAULT true,
      whatsapp_failures BOOLEAN DEFAULT true,
      captions TEXT DEFAULT ''          -- légendes par défaut (une par ligne)
    );

    -- Bibliothèque de médias
    CREATE TABLE IF NOT EXISTS autopost_media (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER,
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,               -- post | reel | story
      storage_key TEXT NOT NULL,
      filename TEXT,
      mime TEXT,
      size_bytes BIGINT,
      caption TEXT,                     -- légende fixe (sinon pioche dans la liste)
      times_posted INTEGER DEFAULT 0,
      last_posted_at TIMESTAMPTZ,
      best_likes INTEGER,
      avg_likes NUMERIC,
      disabled BOOLEAN DEFAULT false,   -- retiré de la rotation
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ap_media_model ON autopost_media(model_id, kind);

    -- Créneaux de publication (un par post/reel/story prévu)
    CREATE TABLE IF NOT EXISTS autopost_jobs (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER,
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      media_id INTEGER REFERENCES autopost_media(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending',    -- pending | running | done | failed | skipped | cancelled
      is_rotation BOOLEAN DEFAULT false,
      caption TEXT,
      audience TEXT,
      attempts INTEGER DEFAULT 0,
      error TEXT,
      screenshot_key TEXT,
      reveal_post_id TEXT,
      likes INTEGER,
      likes_checked_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE autopost_jobs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    ALTER TABLE autopost_agency ADD COLUMN IF NOT EXISTS expired_notified_at TIMESTAMPTZ;
    ALTER TABLE autopost_settings ADD COLUMN IF NOT EXISTS rotation_archive_old BOOLEAN DEFAULT true;
    CREATE INDEX IF NOT EXISTS idx_ap_jobs_due ON autopost_jobs(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_ap_jobs_model ON autopost_jobs(model_id, scheduled_at);

    -- Stats journalières Reveal par modèle
    CREATE TABLE IF NOT EXISTS autopost_daily_stats (
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      revenue NUMERIC,
      new_subs INTEGER,
      sales INTEGER,
      raw JSONB,
      PRIMARY KEY (model_id, date)
    );

    -- Rapports d'analyse
    CREATE TABLE IF NOT EXISTS autopost_reports (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER,
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      period_start DATE,
      period_end DATE,
      summary TEXT,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Battement de cœur du worker
    CREATE TABLE IF NOT EXISTS autopost_worker (
      id TEXT PRIMARY KEY,
      last_seen TIMESTAMPTZ,
      status TEXT,
      info JSONB
    );

    -- Journal (debug, réponses brutes de Reveal pour ajuster les parseurs)
    CREATE TABLE IF NOT EXISTS autopost_log (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER,
      model_id INTEGER,
      level TEXT,
      message TEXT,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function apLog(agencyId, modelId, level, message, data) {
  try {
    await pool.query(
      'INSERT INTO autopost_log (agency_id, model_id, level, message, data) VALUES ($1,$2,$3,$4,$5)',
      [agencyId || null, modelId || null, level, String(message).slice(0, 2000), data ? JSON.stringify(data) : null]
    );
    await pool.query("DELETE FROM autopost_log WHERE created_at < NOW() - INTERVAL '30 days'");
  } catch (e) { console.log('[AUTOPOST] log error', e.message); }
}

module.exports = { initAutopostDB, apLog };
