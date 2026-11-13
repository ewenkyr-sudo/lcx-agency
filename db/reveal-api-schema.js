// ============ API REVEAL — TABLES ============
// Données lues sur l'API officielle Reveal (https://api.reveal.me/v1). Montants en centimes d'euro.
const pool = require('./pool');

async function initRevealApiDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reveal_api_state (
      agency_id INTEGER PRIMARY KEY,
      key_enc TEXT,
      key_last4 TEXT,
      connected_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      last_sales_sync_at TIMESTAMPTZ,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      sales_cursor TEXT,
      sales_enabled BOOLEAN,
      backfilled BOOLEAN DEFAULT false,
      shifts_since DATE,
      objectives_base TEXT DEFAULT 'net',
      sale_alert_min NUMERIC
    );

    ALTER TABLE reveal_api_state ADD COLUMN IF NOT EXISTS history_from DATE;
    ALTER TABLE reveal_api_state ADD COLUMN IF NOT EXISTS history_done BOOLEAN DEFAULT false;

    CREATE TABLE IF NOT EXISTS reveal_models (
      reveal_model_id TEXT PRIMARY KEY,
      agency_id INTEGER,
      user_name TEXT,
      display_name TEXT,
      avatar_url TEXT,
      is_active BOOLEAN,
      status TEXT,
      subscribers_count INTEGER,
      subscription_price INTEGER,
      crm_model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reveal_stats_daily (
      reveal_model_id TEXT NOT NULL,
      date DATE NOT NULL,
      agency_id INTEGER,
      new_subscribers INTEGER, unsubscribes INTEGER, active_subscribers INTEGER,
      revenue_ttc INTEGER, revenue_ht INTEGER, agency_revenue INTEGER, model_revenue INTEGER,
      ppv_sent INTEGER, ppv_purchased INTEGER, ppv_revenue_ttc INTEGER,
      tips_count INTEGER, tips_revenue_ttc INTEGER, renewals INTEGER,
      payment_links_count INTEGER, boudoir_count INTEGER, paid_messages_count INTEGER,
      subscriptions_net INTEGER, renewals_net INTEGER, ppv_net INTEGER, tips_net INTEGER,
      payment_links_net INTEGER, boudoir_net INTEGER, paid_messages_net INTEGER, other_net INTEGER,
      messages_sent INTEGER, messages_received INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (reveal_model_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_reveal_stats_agency ON reveal_stats_daily(agency_id, date);

    CREATE TABLE IF NOT EXISTS reveal_chatters (
      chatter_id TEXT PRIMARY KEY,
      agency_id INTEGER,
      first_name TEXT, last_name TEXT, email TEXT, role TEXT,
      is_bot BOOLEAN, is_external BOOLEAN, removed_at TIMESTAMPTZ,
      model_ids JSONB DEFAULT '[]',
      crm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- chatter_id = '' : ventes « de personne » (abonnements, renouvellements, Mass DM…)
    CREATE TABLE IF NOT EXISTS reveal_chatter_daily (
      date DATE NOT NULL,
      chatter_id TEXT NOT NULL,
      reveal_model_id TEXT NOT NULL,
      agency_id INTEGER,
      sales_count INTEGER, revenue_ttc INTEGER, revenue_ht INTEGER,
      agency_revenue INTEGER, model_revenue INTEGER, net_revenue INTEGER,
      ppv_purchased INTEGER, ppv_net INTEGER, tips_count INTEGER, tips_net INTEGER,
      messages_sent INTEGER, ppv_sent INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (date, chatter_id, reveal_model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reveal_chatter_daily_agency ON reveal_chatter_daily(agency_id, date);

    CREATE TABLE IF NOT EXISTS reveal_tracking_links (
      tracking_link_id TEXT PRIMARY KEY,
      agency_id INTEGER,
      reveal_model_id TEXT,
      name TEXT, tracking_code TEXT, url TEXT,
      created_at TIMESTAMPTZ,
      clicks INTEGER, new_subscribers INTEGER, free_subscribers INTEGER, paid_subscribers INTEGER,
      revenue_ttc INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reveal_tracking_daily (
      tracking_link_id TEXT NOT NULL,
      date DATE NOT NULL,
      agency_id INTEGER,
      reveal_model_id TEXT,
      clicks INTEGER, new_subscribers INTEGER, revenue_ttc INTEGER,
      PRIMARY KEY (tracking_link_id, date)
    );

    CREATE TABLE IF NOT EXISTS reveal_sales (
      id TEXT PRIMARY KEY,
      agency_id INTEGER,
      cursor TEXT,
      reveal_model_id TEXT,
      type TEXT, status TEXT,
      sale_created_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ,
      amount_ttc INTEGER, amount_ht INTEGER, agency_revenue INTEGER, model_revenue INTEGER, net_amount INTEGER,
      fan_member_id TEXT, fan_username TEXT,
      chatter_id TEXT,
      fan_crm_applied BOOLEAN DEFAULT false,
      refund_applied BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reveal_sales_agency ON reveal_sales(agency_id, sale_created_at DESC);

    ALTER TABLE models ADD COLUMN IF NOT EXISTS reveal_model_id TEXT;
    ALTER TABLE chatter_shifts ADD COLUMN IF NOT EXISTS reveal_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chatter_shifts_reveal_key ON chatter_shifts(reveal_key);
  `);
}

module.exports = { initRevealApiDB };
