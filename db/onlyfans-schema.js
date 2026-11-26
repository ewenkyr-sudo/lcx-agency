// ============ ONLYFANS (connexion par session, lue par le bot) — TABLES ============
const pool = require('./pool');

async function initOnlyfansDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS of_accounts (
      model_id INTEGER PRIMARY KEY,            -- une session OnlyFans par modèle du CRM
      agency_id INTEGER,
      session_enc TEXT,
      status TEXT DEFAULT 'unchecked',          -- unchecked | ok | expired
      checked_at TIMESTAMPTZ, last_sync_at TIMESTAMPTZ,
      last_error TEXT, last_error_at TIMESTAMPTZ,
      subscribers INTEGER,
      balances JSONB,                           -- réponse brute de payouts/balances (soldes)
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- CA jour par jour, par type (total, subscribes, tips, chat_messages, post, stream, ...)
    -- tel que la page Statistiques > Revenus d'OnlyFans le reçoit (montants nets = part de la modèle)
    CREATE TABLE IF NOT EXISTS of_daily (
      model_id INTEGER NOT NULL,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      net_cents BIGINT NOT NULL DEFAULT 0,
      sales INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (model_id, date, type)
    );

    -- ventes une par une (liste de la page Revenus) ; montants dans la devise du compte (USD)
    CREATE TABLE IF NOT EXISTS of_transactions (
      id TEXT PRIMARY KEY,
      model_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ, currency TEXT,
      amount_cents INTEGER, vat_cents INTEGER, net_cents INTEGER, fee_cents INTEGER,
      type TEXT, status TEXT, fan_id BIGINT, fan_username TEXT, fan_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_of_tx_model ON of_transactions(model_id, created_at DESC);
    ALTER TABLE of_accounts ADD COLUMN IF NOT EXISTS currency TEXT;
  `);
}

module.exports = { initOnlyfansDB };
