// ============ WYSPER (Telegram) — TABLES ============
const pool = require('./pool');

async function initWysperDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wysper_state (
      agency_id INTEGER PRIMARY KEY,
      key_enc TEXT, key_last4 TEXT,
      secret_enc TEXT,                       -- secret de signature des webhooks (whsec_…)
      webhook_token TEXT UNIQUE,             -- partie secrète de l'adresse de réception
      connected_at TIMESTAMPTZ, last_sync_at TIMESTAMPTZ,
      last_error TEXT, last_error_at TIMESTAMPTZ,
      payments_since TIMESTAMPTZ,            -- curseur : updated_at du dernier paiement lu
      conversations_since TIMESTAMPTZ,       -- curseur : first_message_at de la dernière conversation lue
      backfilled BOOLEAN DEFAULT false,
      sale_alert_min NUMERIC,
      last_event_at TIMESTAMPTZ, last_event_type TEXT
    );

    CREATE TABLE IF NOT EXISTS wysper_accounts (
      agency_id INTEGER NOT NULL,
      telegram_id BIGINT NOT NULL,
      name TEXT, status TEXT, currency TEXT,
      crm_model_id INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (agency_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS wysper_payments (
      payment_id TEXT PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      account_tid BIGINT, account_name TEXT,
      status TEXT, type TEXT,
      paid_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      currency TEXT,
      price_cents INTEGER, gross_cents INTEGER, net_cents INTEGER,
      refund_cents INTEGER,
      buyer_tid BIGINT, buyer_username TEXT, buyer_first BOOLEAN,
      sent_by_id BIGINT, sent_by_name TEXT,
      source_link TEXT, source_channel TEXT,
      alerted BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_wysper_pay_agency ON wysper_payments(agency_id, paid_at DESC);

    CREATE TABLE IF NOT EXISTS wysper_conversations (
      agency_id INTEGER NOT NULL,
      account_tid BIGINT NOT NULL,
      fan_tid BIGINT NOT NULL,
      fan_username TEXT,
      first_message_at TIMESTAMPTZ, first_reply_at TIMESTAMPTZ,
      source_link TEXT, source_channel TEXT,
      PRIMARY KEY (agency_id, account_tid, fan_tid)
    );
    CREATE INDEX IF NOT EXISTS idx_wysper_conv_agency ON wysper_conversations(agency_id, first_message_at DESC);

    CREATE TABLE IF NOT EXISTS wysper_events (
      id TEXT PRIMARY KEY,
      agency_id INTEGER, type TEXT,
      received_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { initWysperDB };
