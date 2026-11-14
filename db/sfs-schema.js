// SFS (mass DM croisés entre créatrices) + abonnés par plateforme
const pool = require('./pool');

async function initSfsDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sfs_pushes (
      id SERIAL PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      platform TEXT NOT NULL DEFAULT 'reveal',           -- reveal | mym
      partner_name TEXT NOT NULL,                         -- créatrice partenaire
      partner_link TEXT,                                  -- profil / contact du manager
      partner_subs INTEGER,                               -- abonnés de la partenaire
      scheduled_at TIMESTAMPTZ NOT NULL,                  -- heure du mass DM
      our_sent BOOLEAN DEFAULT false,                     -- notre modèle a envoyé son mass DM
      partner_sent BOOLEAN DEFAULT false,                 -- la partenaire a envoyé le sien
      status TEXT DEFAULT 'planned',                      -- planned | done | cancelled
      subs_gained INTEGER,                                -- abonnés gagnés (saisis à la main, surtout MyM)
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sfs_pushes_agency_date ON sfs_pushes (agency_id, scheduled_at);

    -- abonnés saisis à la main (MyM n'a pas d'API) ; Reveal vient de l'API
    CREATE TABLE IF NOT EXISTS model_platform_subs (
      model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      subscribers INTEGER,
      new_subs_30 INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by INTEGER,
      PRIMARY KEY (model_id, platform)
    );

    -- envoi automatique par le bot (Reveal : mass DM programmé directement chez Reveal)
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS auto_send BOOLEAN DEFAULT false;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS message TEXT;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT 'active';          -- active | expired
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS bot_status TEXT DEFAULT 'none';          -- none | queued | requeue | scheduled | sent | failed | cancel_requested | cancelled
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS reveal_mass_dm_id TEXT;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS bot_error TEXT;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS bot_checked_at TIMESTAMPTZ;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS sent_count INTEGER;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS income_cents INTEGER;
    ALTER TABLE sfs_pushes ADD COLUMN IF NOT EXISTS media JSONB DEFAULT '[]'::jsonb;        -- photos / vidéos jointes [{key, filename, mime, size}]
  `);
}

module.exports = { initSfsDB };
