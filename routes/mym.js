// ============ MYM — ROUTES DU CRM ============
// Monté dans server.js :  app.use('/api/mym', require('./routes/mym'));
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const sync = require('../services/mym/sync');

const router = express.Router();
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[MYM]', e);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : 'Erreur : ' + e.message });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parisDate = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + off * 86400000));
const range = req => ({ to: isDate(req.query.to) ? req.query.to : parisDate(0), from: isDate(req.query.from) ? req.query.from : parisDate(-29) });
const modelOf = req => (/^\d+$/.test(String(req.query.model || '')) ? Number(req.query.model) : null);
const TDAY = `to_char(t.at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')`;
const ownerOnly = req => { if (req.modelScope) throw fail(403, 'Réservé au compte principal'); };

// modèles de l'agence visibles par l'utilisateur (associé : seulement les siennes)
async function visibleModels(req) {
  return (await pool.query(`SELECT id, name, chart_color FROM models WHERE (agency_id = $1 OR agency_id IS NULL) AND ($2::int[] IS NULL OR id = ANY($2::int[])) ORDER BY name`,
    [req.agencyId, req.modelScope || null])).rows;
}
async function ownModel(req, id) {
  const ok = (await visibleModels(req)).some(m => m.id === Number(id));
  if (!ok) throw fail(404, 'Modèle introuvable');
}

router.use(authMiddleware, adminOnly);

router.get('/bookmarklet', (req, res) => res.json({ bookmarklet: sync.BOOKMARKLET }));

// comptes MyM reliés (une session par modèle)
router.get('/accounts', wrap(async (req, res) => {
  const models = await visibleModels(req);
  const { rows } = await pool.query(
    `SELECT model_id, status, checked_at, last_sync_at, last_error, last_error_at, subscribers, total_cents, pending_cents, validated_cents, next_payout, (session_enc IS NOT NULL) has_session
     FROM mym_accounts WHERE model_id = ANY($1::int[])`, [models.map(m => m.id)]);
  res.json({ models, accounts: rows });
}));

router.post('/accounts', wrap(async (req, res) => {
  ownerOnly(req);
  const modelId = Number(req.body?.model_id);
  if (!modelId) throw fail(400, 'Choisis la modèle');
  await ownModel(req, modelId);
  try { await sync.saveSession(req.agencyId, modelId, req.body?.export); } catch (e) { throw fail(400, e.message); }
  // 1re synchro en arrière-plan (l'historique des transactions peut prendre quelques minutes)
  sync.syncModel(modelId).catch(e => console.log('[MYM] 1re synchro :', e.message));
  res.json({ ok: true });
}));

router.post('/accounts/:id/sync', wrap(async (req, res) => {
  ownerOnly(req);
  await ownModel(req, req.params.id);
  res.json(await sync.syncModel(Number(req.params.id)));
}));

router.delete('/accounts/:id', wrap(async (req, res) => {
  ownerOnly(req);
  await ownModel(req, req.params.id);
  await pool.query(`UPDATE mym_accounts SET session_enc = NULL, status = 'unchecked' WHERE model_id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- stats ----------
async function scopeIds(req) {
  const m = modelOf(req);
  const ids = (await pool.query(`SELECT a.model_id FROM mym_accounts a JOIN models m ON m.id = a.model_id
    WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND ($2::int[] IS NULL OR a.model_id = ANY($2::int[]))`, [req.agencyId, req.modelScope || null])).rows.map(r => r.model_id);
  if (m && !ids.includes(m)) throw fail(404, 'Pas de compte MyM pour cette modèle');
  return m ? [m] : ids;
}

router.get('/overview', wrap(async (req, res) => {
  const { from, to } = range(req);
  const ids = await scopeIds(req);
  const net = (await pool.query(`SELECT COALESCE(SUM(net_cents),0)::bigint n FROM mym_daily WHERE model_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date`, [ids, from, to])).rows[0].n;
  const tx = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE t.type ILIKE 'abonnement%')::int new_subs,
            COUNT(*) FILTER (WHERE t.amount_cents > 0)::int sales,
            COUNT(DISTINCT t.fan_id) FILTER (WHERE t.amount_cents > 0)::int buyers,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint tx_net,
            MIN(t.at) first_tx
     FROM mym_transactions t WHERE t.model_id = ANY($1::int[]) AND ${TDAY} BETWEEN $2::text AND $3::text`, [ids, from, to])).rows[0];
  const byType = (await pool.query(
    `SELECT t.type, COUNT(*)::int n, COALESCE(SUM(t.amount_cents),0)::bigint amount FROM mym_transactions t
     WHERE t.model_id = ANY($1::int[]) AND ${TDAY} BETWEEN $2::text AND $3::text AND t.amount_cents > 0 GROUP BY 1 ORDER BY amount DESC`, [ids, from, to])).rows;
  const dNet = (await pool.query(`SELECT to_char(date,'YYYY-MM-DD') d, SUM(net_cents)::bigint net FROM mym_daily WHERE model_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date GROUP BY 1`, [ids, from, to])).rows;
  const dSubs = (await pool.query(`SELECT ${TDAY} d, COUNT(*)::int subs FROM mym_transactions t WHERE t.model_id = ANY($1::int[]) AND t.type ILIKE 'abonnement%' AND ${TDAY} BETWEEN $2::text AND $3::text GROUP BY 1`, [ids, from, to])).rows;
  const days = {};
  dNet.forEach(r => { days[r.d] = { d: r.d, net: Number(r.net), subs: 0 }; });
  dSubs.forEach(r => { (days[r.d] = days[r.d] || { d: r.d, net: 0, subs: 0 }).subs = r.subs; });
  const accounts = (await pool.query(
    `SELECT a.model_id, m.name, a.status, a.last_sync_at, a.last_error, a.subscribers, a.total_cents, a.pending_cents, a.validated_cents, a.next_payout,
       (SELECT COALESCE(SUM(net_cents),0) FROM mym_daily d WHERE d.model_id = a.model_id AND d.date BETWEEN $2::date AND $3::date)::bigint net,
       (SELECT COUNT(*) FROM mym_transactions t WHERE t.model_id = a.model_id AND t.type ILIKE 'abonnement%' AND ${TDAY} BETWEEN $2::text AND $3::text)::int new_subs,
       (SELECT COUNT(DISTINCT t.fan_id) FROM mym_transactions t WHERE t.model_id = a.model_id AND t.amount_cents > 0)::int buyers_known,
       (SELECT s.subscribers FROM mym_subs_snap s WHERE s.model_id = a.model_id AND s.date <= (NOW() AT TIME ZONE 'Europe/Paris')::date - 30 ORDER BY s.date DESC LIMIT 1) subs_30d_ago,
       (SELECT to_char(MIN(date),'YYYY-MM-DD') FROM mym_daily d WHERE d.model_id = a.model_id) since
     FROM mym_accounts a JOIN models m ON m.id = a.model_id WHERE a.model_id = ANY($1::int[]) ORDER BY net DESC, m.name`, [ids, from, to])).rows;
  accounts.forEach(a => { a.ltv = a.subscribers > 0 && a.total_cents != null ? Math.round(Number(a.total_cents) / a.subscribers) : null; });
  const totSubs = accounts.reduce((s, a) => s + (a.subscribers || 0), 0), totAll = accounts.reduce((s, a) => s + Number(a.total_cents || 0), 0);
  res.json({
    from, to, totals: { net: Number(net), ...tx, subscribers: totSubs, total_cents: totAll, pending_cents: accounts.reduce((s, a) => s + Number(a.pending_cents || 0), 0) },
    ltv: totSubs ? Math.round(totAll / totSubs) : null, byType, daily: Object.values(days).sort((x, y) => x.d.localeCompare(y.d)), accounts,
  });
}));

router.get('/daily-by-model', wrap(async (req, res) => {
  const { from, to } = range(req);
  const ids = await scopeIds(req);
  const { rows } = await pool.query(
    `SELECT to_char(d.date,'YYYY-MM-DD') d, d.model_id::text AS key, d.model_id AS crm_model_id, m.name, d.net_cents::bigint AS net
     FROM mym_daily d JOIN models m ON m.id = d.model_id WHERE d.model_id = ANY($1::int[]) AND d.date BETWEEN $2::date AND $3::date ORDER BY 1`, [ids, from, to]);
  res.json({ from, to, rows });
}));

router.get('/monthly', wrap(async (req, res) => {
  const ids = await scopeIds(req);
  const { rows } = await pool.query(`SELECT a.model_id, m.name, a.monthly FROM mym_accounts a JOIN models m ON m.id = a.model_id WHERE a.model_id = ANY($1::int[]) ORDER BY m.name`, [ids]);
  res.json({ accounts: rows });
}));

router.get('/transactions', wrap(async (req, res) => {
  const ids = await scopeIds(req);
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
  const paidOnly = req.query.paid === '1';
  const tx = (await pool.query(
    `SELECT t.id::text, t.model_id, m.name model_name, t.type, t.amount_cents, t.at, t.status, t.fan_username
     FROM mym_transactions t JOIN models m ON m.id = t.model_id WHERE t.model_id = ANY($1::int[]) AND ($3::bool = false OR t.amount_cents > 0)
     ORDER BY t.at DESC LIMIT $2`, [ids, limit, paidOnly])).rows;
  const topFans = (await pool.query(
    `SELECT COALESCE(t.fan_username, 'fan ' || t.fan_id) fan, MAX(m.name) model_name, COUNT(*)::int n, SUM(t.amount_cents)::bigint total
     FROM mym_transactions t JOIN models m ON m.id = t.model_id
     WHERE t.model_id = ANY($1::int[]) AND t.amount_cents > 0 AND t.at > NOW() - INTERVAL '31 days'
     GROUP BY t.fan_id, t.fan_username ORDER BY total DESC LIMIT 10`, [ids])).rows;
  res.json({ transactions: tx, topFans });
}));

module.exports = router;
