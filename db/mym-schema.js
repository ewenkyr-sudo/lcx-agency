// ============ MYM (connexion par session) — TABLES ============
const pool = require('./pool');

async function initMymDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mym_accounts (
      model_id INTEGER PRIMARY KEY,            -- une session MyM par modèle du CRM
      agency_id INTEGER,
      session_enc TEXT,
      status TEXT DEFAULT 'unchecked',          -- unchecked | ok | expired
      checked_at TIMESTAMPTZ, last_sync_at TIMESTAMPTZ,
      last_error TEXT, last_error_at TIMESTAMPTZ,
      subscribers INTEGER,
      total_cents BIGINT,                       -- revenus depuis la création du compte (net créatrice)
      pending_cents BIGINT, validated_cents BIGINT,
      next_payout TEXT,
      monthly JSONB,                            -- [{month, amount_cents, parts:[{label, amount_cents}]}]
      tx_backfilled BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mym_daily (
      model_id INTEGER NOT NULL,
      date DATE NOT NULL,
      net_cents BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (model_id, date)
    );

    CREATE TABLE IF NOT EXISTS mym_subs_snap (
      model_id INTEGER NOT NULL,
      date DATE NOT NULL,
      subscribers INTEGER,
      PRIMARY KEY (model_id, date)
    );

    CREATE TABLE IF NOT EXISTS mym_transactions (
      id BIGINT PRIMARY KEY,                    -- identifiant de la transaction chez MyM
      agency_id INTEGER, model_id INTEGER NOT NULL,
      type TEXT, amount_cents INTEGER, at TIMESTAMPTZ,
      status TEXT, fan_id BIGINT, fan_username TEXT, order_no TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mym_tx_model ON mym_transactions(model_id, at DESC);
  `);
}

module.exports = { initMymDB };
