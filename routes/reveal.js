// ============ API REVEAL — ROUTES DU CRM ============
// Monté dans server.js :  app.use('/api/reveal', require('./routes/reveal'));
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const sync = require('../services/reveal-api/sync');

const router = express.Router();
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[REVEAL API]', e);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : 'Erreur : ' + e.message });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function range(req, defDays = 30) {
  const to = isDate(req.query.to) ? req.query.to : sync.parisDate(0);
  const from = isDate(req.query.from) ? req.query.from : sync.parisDate(-(defDays - 1));
  return { from, to };
}
const modelOf = req => (req.query.model && /^[\w-]{1,80}$/.test(req.query.model) ? req.query.model : null);

// Le chatteur connecté est-il suivi par l'API (saisie PPV / pourboires inutile) ?
async function revealManagesUser(userId, agencyId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM reveal_chatters rc JOIN reveal_api_state st ON st.agency_id = rc.agency_id
     WHERE rc.crm_user_id = $1 AND st.key_enc IS NOT NULL AND (rc.agency_id = $2 OR $2 IS NULL) LIMIT 1`, [userId, agencyId || null]).catch(() => ({ rows: [] }));
  return rows.length > 0;
}

// accessible à tous les connectés
router.get('/me', authMiddleware, wrap(async (req, res) => {
  res.json({ managed: await revealManagesUser(req.user.id, req.agencyId) });
}));

router.use(authMiddleware, adminOnly);

// ---------- connexion ----------
router.get('/status', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM reveal_api_state WHERE agency_id = $1`, [req.agencyId]);
  const st = rows[0] || {};
  const counts = (await pool.query(
    `SELECT (SELECT COUNT(*) FROM reveal_models WHERE agency_id = $1)::int AS models,
            (SELECT COUNT(*) FROM reveal_models WHERE agency_id = $1 AND crm_model_id IS NULL)::int AS models_unmapped,
            (SELECT COUNT(*) FROM reveal_chatters WHERE agency_id = $1 AND NOT is_bot AND removed_at IS NULL)::int AS chatters,
            (SELECT COUNT(*) FROM reveal_chatters c WHERE c.agency_id = $1 AND NOT c.is_bot AND c.removed_at IS NULL AND c.crm_user_id IS NULL
               AND EXISTS (SELECT 1 FROM reveal_chatter_daily d WHERE d.chatter_id = c.chatter_id AND d.date >= CURRENT_DATE - 31 AND d.sales_count > 0))::int AS chatters_unmapped,
            (SELECT COUNT(*) FROM reveal_sales WHERE agency_id = $1)::int AS sales`, [req.agencyId])).rows[0];
  res.json({
    connected: !!st.key_enc, key_last4: st.key_last4 || null, connected_at: st.connected_at, last_sync_at: st.last_sync_at,
    last_sales_sync_at: st.last_sales_sync_at, last_error: st.last_error, last_error_at: st.last_error_at,
    sales_enabled: st.sales_enabled, backfilled: !!st.backfilled, shifts_since: st.shifts_since ? (st.shifts_since instanceof Date
      ? new Date(st.shifts_since.getTime() - st.shifts_since.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(st.shifts_since).slice(0, 10)) : null,
    objectives_base: st.objectives_base || 'net', sale_alert_min: st.sale_alert_min != null ? Number(st.sale_alert_min) : null,
    counts,
  });
}));

router.post('/key', wrap(async (req, res) => {
  await sync.saveKey(req.agencyId, req.body?.key);
  const r = await sync.fullSync(req.agencyId, { force: true }).catch(e => ({ ok: false, error: e.message }));
  res.json(r);
}));

router.delete('/key', wrap(async (req, res) => {
  await pool.query(`UPDATE reveal_api_state SET key_enc = NULL, key_last4 = NULL WHERE agency_id = $1`, [req.agencyId]);
  res.json({ ok: true });
}));

router.put('/options', wrap(async (req, res) => {
  const b = req.body || {};
  const base = ['net', 'ttc', 'ht', 'agency'].includes(b.objectives_base) ? b.objectives_base : 'net';
  const min = b.sale_alert_min === '' || b.sale_alert_min == null ? null : Math.max(0, Number(b.sale_alert_min) || 0) || null;
  await pool.query(`INSERT INTO reveal_api_state (agency_id) VALUES ($1) ON CONFLICT DO NOTHING`, [req.agencyId]);
  await pool.query(`UPDATE reveal_api_state SET objectives_base = $2, sale_alert_min = $3, shifts_since = COALESCE($4::date, shifts_since) WHERE agency_id = $1`,
    [req.agencyId, base, min, isDate(b.shifts_since) ? b.shifts_since : null]);
  await sync.updateObjectives(req.agencyId);
  if (isDate(b.shifts_since)) {
    await pool.query(`DELETE FROM chatter_shifts WHERE agency_id = $1 AND reveal_key IS NOT NULL AND date < $2`, [req.agencyId, b.shifts_since]);
    await sync.updateShifts(req.agencyId);
  }
  res.json({ ok: true });
}));

router.post('/sync', wrap(async (req, res) => {
  // « Actualiser » retente aussi les ventes si l'accès vient d'être ajouté à la clé
  await pool.query(`UPDATE reveal_api_state SET sales_enabled = NULL WHERE agency_id = $1 AND sales_enabled = false`, [req.agencyId]);
  res.json(await sync.fullSync(req.agencyId, { force: true }));
}));

// ---------- vue d'ensemble ----------
router.get('/overview', wrap(async (req, res) => {
  const { from, to } = range(req);
  const a = req.agencyId, mid = modelOf(req);
  const totals = (await pool.query(
    `SELECT COALESCE(SUM(revenue_ttc),0)::bigint ttc, COALESCE(SUM(revenue_ht),0)::bigint ht, COALESCE(SUM(agency_revenue),0)::bigint agency,
            COALESCE(SUM(model_revenue),0)::bigint model, COALESCE(SUM(new_subscribers),0)::int new_subs, COALESCE(SUM(unsubscribes),0)::int unsubs,
            COALESCE(SUM(ppv_purchased),0)::int ppv_purchased, COALESCE(SUM(ppv_sent),0)::int ppv_sent, COALESCE(SUM(tips_count),0)::int tips,
            COALESCE(SUM(subscriptions_net),0)::bigint subs_net, COALESCE(SUM(renewals_net),0)::bigint renewals_net, COALESCE(SUM(ppv_net),0)::bigint ppv_net,
            COALESCE(SUM(tips_net),0)::bigint tips_net, COALESCE(SUM(payment_links_net),0)::bigint links_net, COALESCE(SUM(boudoir_net),0)::bigint boudoir_net,
            COALESCE(SUM(paid_messages_net),0)::bigint paid_msg_net, COALESCE(SUM(other_net),0)::bigint other_net,
            COALESCE(SUM(messages_sent),0)::int messages_sent, COALESCE(SUM(messages_received),0)::int messages_received
     FROM reveal_stats_daily WHERE agency_id = $1 AND date BETWEEN $2 AND $3 AND ($4::text IS NULL OR reveal_model_id = $4)`, [a, from, to, mid])).rows[0];
  const daily = (await pool.query(
    `SELECT to_char(date,'YYYY-MM-DD') d, SUM(revenue_ttc)::bigint ttc, SUM(agency_revenue)::bigint agency, SUM(agency_revenue + model_revenue)::bigint net,
            SUM(new_subscribers)::int new_subs
     FROM reveal_stats_daily WHERE agency_id = $1 AND date BETWEEN $2 AND $3 AND ($4::text IS NULL OR reveal_model_id = $4) GROUP BY date ORDER BY date`, [a, from, to, mid])).rows;
  const models = (await pool.query(
    `SELECT rm.reveal_model_id, rm.display_name, rm.user_name, rm.avatar_url, rm.subscribers_count, rm.subscription_price, rm.crm_model_id, m.name crm_name,
            COALESCE(SUM(s.revenue_ttc),0)::bigint ttc, COALESCE(SUM(s.agency_revenue),0)::bigint agency, COALESCE(SUM(s.agency_revenue + s.model_revenue),0)::bigint net,
            COALESCE(SUM(s.new_subscribers),0)::int new_subs, COALESCE(SUM(s.unsubscribes),0)::int unsubs,
            COALESCE(SUM(s.ppv_purchased),0)::int ppv_purchased, COALESCE(SUM(s.ppv_sent),0)::int ppv_sent, COALESCE(SUM(s.tips_count),0)::int tips
     FROM reveal_models rm LEFT JOIN models m ON m.id = rm.crm_model_id
     LEFT JOIN reveal_stats_daily s ON s.reveal_model_id = rm.reveal_model_id AND s.date BETWEEN $2 AND $3
     WHERE rm.agency_id = $1 AND ($4::text IS NULL OR rm.reveal_model_id = $4) GROUP BY rm.reveal_model_id, m.name ORDER BY net DESC`, [a, from, to, mid])).rows;
  res.json({ from, to, totals, daily, models });
}));

router.get('/models/:id/daily', wrap(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await pool.query(
    `SELECT to_char(date,'YYYY-MM-DD') d, * FROM reveal_stats_daily WHERE agency_id = $1 AND reveal_model_id = $2 AND date BETWEEN $3 AND $4 ORDER BY date`,
    [req.agencyId, req.params.id, from, to]);
  res.json(rows);
}));

// ---------- correspondances modèles ----------
router.get('/models', wrap(async (req, res) => {
  const reveal = (await pool.query(`SELECT * FROM reveal_models WHERE agency_id = $1 ORDER BY display_name`, [req.agencyId])).rows;
  const crm = (await pool.query(`SELECT id, name FROM models WHERE (agency_id = $1 OR agency_id IS NULL) ORDER BY name`, [req.agencyId])).rows;
  res.json({ reveal, crm });
}));

router.put('/models/:id/map', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT 1 FROM reveal_models WHERE reveal_model_id = $1 AND agency_id = $2`, [req.params.id, req.agencyId]);
  if (!rows[0]) throw fail(404, 'Modèle Reveal introuvable');
  const crmId = req.body?.crm_model_id ? Number(req.body.crm_model_id) : null;
  if (crmId) {
    const ok = await pool.query(`SELECT 1 FROM models WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`, [crmId, req.agencyId]);
    if (!ok.rows[0]) throw fail(404, 'Modèle CRM introuvable');
  }
  await sync.mapModel(req.params.id, crmId);
  await sync.updateObjectives(req.agencyId);
  await sync.updateShifts(req.agencyId);
  res.json({ ok: true });
}));

// ---------- chatteurs ----------
router.get('/chatters', wrap(async (req, res) => {
  const { from, to } = range(req);
  const a = req.agencyId, mid = modelOf(req);
  const rows = (await pool.query(
    `SELECT rc.chatter_id, rc.first_name, rc.last_name, rc.email, rc.role, rc.is_bot, rc.is_external, rc.removed_at, rc.crm_user_id, u.display_name crm_name,
            COALESCE(SUM(d.sales_count),0)::int sales, COALESCE(SUM(d.revenue_ttc),0)::bigint ttc, COALESCE(SUM(d.revenue_ht),0)::bigint ht,
            COALESCE(SUM(d.agency_revenue),0)::bigint agency, COALESCE(SUM(d.net_revenue),0)::bigint net,
            COALESCE(SUM(d.ppv_purchased),0)::int ppv_purchased, COALESCE(SUM(d.ppv_net),0)::bigint ppv_net,
            COALESCE(SUM(d.tips_count),0)::int tips, COALESCE(SUM(d.tips_net),0)::bigint tips_net,
            COALESCE(SUM(d.messages_sent),0)::int messages_sent, COALESCE(SUM(d.ppv_sent),0)::int ppv_sent
     FROM reveal_chatters rc LEFT JOIN users u ON u.id = rc.crm_user_id
     LEFT JOIN reveal_chatter_daily d ON d.chatter_id = rc.chatter_id AND d.date BETWEEN $2 AND $3 AND ($4::text IS NULL OR d.reveal_model_id = $4)
     WHERE rc.agency_id = $1 AND ($4::text IS NULL OR rc.model_ids ? $4 OR d.chatter_id IS NOT NULL)
     GROUP BY rc.chatter_id, u.display_name ORDER BY net DESC, rc.first_name`, [a, from, to, mid])).rows;
  const nobody = (await pool.query(
    `SELECT COALESCE(SUM(net_revenue),0)::bigint net, COALESCE(SUM(revenue_ttc),0)::bigint ttc FROM reveal_chatter_daily
     WHERE agency_id = $1 AND chatter_id = '' AND date BETWEEN $2 AND $3 AND ($4::text IS NULL OR reveal_model_id = $4)`, [a, from, to, mid])).rows[0];
  const users = (await pool.query(
    `SELECT DISTINCT u.id, u.display_name, u.role FROM users u
     LEFT JOIN agency_memberships am ON am.user_id = u.id
     WHERE (am.agency_id = $1 OR u.agency_id = $1) ORDER BY u.display_name`, [a]).catch(() =>
    pool.query(`SELECT id, display_name, role FROM users ORDER BY display_name`))).rows;
  res.json({ from, to, chatters: rows, nobody, users });
}));

router.put('/chatters/:id/map', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT 1 FROM reveal_chatters WHERE chatter_id = $1 AND agency_id = $2`, [req.params.id, req.agencyId]);
  if (!rows[0]) throw fail(404, 'Chatteur Reveal introuvable');
  const uid = req.body?.crm_user_id ? Number(req.body.crm_user_id) : null;
  if (uid) await pool.query(`UPDATE reveal_chatters SET crm_user_id = NULL WHERE crm_user_id = $1`, [uid]);
  await pool.query(`UPDATE reveal_chatters SET crm_user_id = $2 WHERE chatter_id = $1`, [req.params.id, uid]);
  await sync.updateShifts(req.agencyId);
  res.json({ ok: true });
}));

// ---------- liens de suivi ----------
router.get('/tracking', wrap(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await pool.query(
    `SELECT l.*, rm.display_name model_name,
            COALESCE(SUM(d.clicks),0)::int p_clicks, COALESCE(SUM(d.new_subscribers),0)::int p_subs, COALESCE(SUM(d.revenue_ttc),0)::bigint p_revenue
     FROM reveal_tracking_links l LEFT JOIN reveal_models rm ON rm.reveal_model_id = l.reveal_model_id
     LEFT JOIN reveal_tracking_daily d ON d.tracking_link_id = l.tracking_link_id AND d.date BETWEEN $2 AND $3
     WHERE l.agency_id = $1 AND ($4::text IS NULL OR l.reveal_model_id = $4)
     GROUP BY l.tracking_link_id, rm.display_name ORDER BY p_revenue DESC, l.revenue_ttc DESC`, [req.agencyId, from, to, modelOf(req)]);
  res.json({ from, to, links: rows });
}));

// ---------- ventes ----------
router.get('/sales', wrap(async (req, res) => {
  const lim = Math.min(500, parseInt(req.query.limit, 10) || 100);
  const vals = [req.agencyId];
  let where = 's.agency_id = $1';
  if (req.query.model) { vals.push(req.query.model); where += ` AND s.reveal_model_id = $${vals.length}`; }
  if (req.query.type) { vals.push(req.query.type); where += ` AND s.type = $${vals.length}`; }
  const { rows } = await pool.query(
    `SELECT s.*, rm.display_name model_name, rc.first_name chatter_first, rc.last_name chatter_last
     FROM reveal_sales s LEFT JOIN reveal_models rm ON rm.reveal_model_id = s.reveal_model_id
     LEFT JOIN reveal_chatters rc ON rc.chatter_id = s.chatter_id
     WHERE ${where} ORDER BY s.sale_created_at DESC LIMIT ${lim}`, vals);
  const topFans = (await pool.query(
    `SELECT s.fan_username, rm.display_name model_name, COUNT(*)::int n, SUM(CASE WHEN s.status = 'refunded' THEN 0 ELSE s.amount_ttc END)::bigint total
     FROM reveal_sales s LEFT JOIN reveal_models rm ON rm.reveal_model_id = s.reveal_model_id
     WHERE s.agency_id = $1 AND s.fan_username IS NOT NULL AND s.sale_created_at > NOW() - INTERVAL '31 days'
       AND ($2::text IS NULL OR s.reveal_model_id = $2)
     GROUP BY s.fan_username, rm.display_name ORDER BY total DESC LIMIT 10`, [req.agencyId, modelOf(req)])).rows;
  res.json({ sales: rows, topFans });
}));

router.revealManagesUser = revealManagesUser;
module.exports = router;
