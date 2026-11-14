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
  `);
}

module.exports = { initSfsDB };
