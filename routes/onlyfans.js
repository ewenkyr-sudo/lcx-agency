// ============ ONLYFANS — ROUTES DU CRM ============
// Monté dans server.js :  app.use('/api/onlyfans', require('./routes/onlyfans'));
// Le relevé lui-même est fait par le bot (worker/onlyfans.js), qui a un vrai navigateur.
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const { encrypt } = require('../services/autopost/session');
const of = require('../services/onlyfans/session');
const { toEurRate } = require('../services/fx');

const router = express.Router();
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[OF]', e);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : 'Erreur : ' + e.message });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parisDate = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + off * 86400000));
const range = req => ({ to: isDate(req.query.to) ? req.query.to : parisDate(0), from: isDate(req.query.from) ? req.query.from : parisDate(-29) });
const ownerOnly = req => { if (req.modelScope) throw fail(403, 'Réservé au compte principal'); };
const GROSS = `ROUND(d.net_cents / ${of.OF_PERIOD_NET})`;   // brut payé par les fans = net ÷ 0,8

async function visibleModels(req) {
  return (await pool.query(`SELECT id, name FROM models WHERE (agency_id = $1 OR agency_id IS NULL) AND ($2::int[] IS NULL OR id = ANY($2::int[])) ORDER BY name`,
    [req.agencyId, req.modelScope || null])).rows;
}
async function ownModel(req, id) {
  if (!(await visibleModels(req)).some(m => m.id === Number(id))) throw fail(404, 'Modèle introuvable');
}
async function scopeIds(req) {
  const m = /^\d+$/.test(String(req.query.model || '')) ? Number(req.query.model) : null;
  const ids = (await pool.query(`SELECT a.model_id FROM of_accounts a JOIN models m ON m.id = a.model_id
    WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND ($2::int[] IS NULL OR a.model_id = ANY($2::int[]))`, [req.agencyId, req.modelScope || null])).rows.map(r => r.model_id);
  if (m && !ids.includes(m)) throw fail(404, 'Pas de compte OnlyFans pour cette modèle');
  return m ? [m] : ids;
}

router.use(authMiddleware, adminOnly);

router.get('/bookmarklet', (req, res) => res.json({ bookmarklet: of.BOOKMARKLET }));

router.get('/accounts', wrap(async (req, res) => {
  const models = await visibleModels(req);
  const { rows } = await pool.query(
    `SELECT model_id, status, checked_at, last_sync_at, last_error, last_error_at, subscribers, balances, (session_enc IS NOT NULL) has_session
     FROM of_accounts WHERE model_id = ANY($1::int[])`, [models.map(m => m.id)]);
  res.json({ models, accounts: rows });
}));

router.post('/accounts', wrap(async (req, res) => {
  ownerOnly(req);
  const modelId = Number(req.body?.model_id);
  if (!modelId) throw fail(400, 'Choisis la modèle');
  await ownModel(req, modelId);
  let sess;
  try { sess = of.normalize(req.body?.export); } catch (e) { throw fail(400, e.message); }
  await pool.query(
    `INSERT INTO of_accounts (model_id, agency_id, session_enc, status, last_error) VALUES ($1,$2,$3,'unchecked',NULL)
     ON CONFLICT (model_id) DO UPDATE SET agency_id = $2, session_enc = $3, status = 'unchecked', last_error = NULL`,
    [modelId, req.agencyId, encrypt(sess)]);
  res.json({ ok: true });   // le bot fait le 1er relevé dans les minutes qui suivent
}));

// demande au bot de relever tout de suite (au prochain tour, ~1 min)
router.post('/accounts/:id/sync', wrap(async (req, res) => {
  ownerOnly(req);
  await ownModel(req, req.params.id);
  await pool.query(`UPDATE of_accounts SET last_sync_at = NULL WHERE model_id = $1 AND session_enc IS NOT NULL`, [Number(req.params.id)]);
  res.json({ ok: true });
}));

router.delete('/accounts/:id', wrap(async (req, res) => {
  ownerOnly(req);
  await ownModel(req, req.params.id);
  await pool.query(`UPDATE of_accounts SET session_enc = NULL, status = 'unchecked' WHERE model_id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
}));

router.get('/overview', wrap(async (req, res) => {
  const { from, to } = range(req);
  const ids = await scopeIds(req);
  const byType = (await pool.query(
    `SELECT d.type, SUM(d.net_cents)::bigint net, SUM(${GROSS})::bigint gross, SUM(d.sales)::int sales
     FROM of_daily d WHERE d.model_id = ANY($1::int[]) AND d.date BETWEEN $2::date AND $3::date AND d.type <> 'total'
     GROUP BY 1 ORDER BY net DESC`, [ids, from, to])).rows;
  const daily = (await pool.query(
    `SELECT to_char(d.date,'YYYY-MM-DD') d, SUM(d.net_cents)::bigint net, SUM(${GROSS})::bigint gross, SUM(d.sales)::int sales
     FROM of_daily d WHERE d.model_id = ANY($1::int[]) AND d.date BETWEEN $2::date AND $3::date AND d.type = 'total' GROUP BY 1 ORDER BY 1`, [ids, from, to])).rows;
  const subsNew = (await pool.query(
    `SELECT COALESCE(SUM(d.sales),0)::int n FROM of_daily d WHERE d.model_id = ANY($1::int[]) AND d.date BETWEEN $2::date AND $3::date AND d.type = 'subscribes'`, [ids, from, to])).rows[0].n;
  const accounts = (await pool.query(
    `SELECT a.model_id, m.name, a.status, a.last_sync_at, a.last_error, a.subscribers, a.balances, a.currency,
       (SELECT COALESCE(SUM(net_cents),0) FROM of_daily d WHERE d.model_id = a.model_id AND d.type = 'total' AND d.date BETWEEN $2::date AND $3::date)::bigint net,
       (SELECT COALESCE(SUM(${GROSS}),0) FROM of_daily d WHERE d.model_id = a.model_id AND d.type = 'total' AND d.date BETWEEN $2::date AND $3::date)::bigint gross,
       (SELECT COALESCE(SUM(sales),0) FROM of_daily d WHERE d.model_id = a.model_id AND d.type = 'total' AND d.date BETWEEN $2::date AND $3::date)::int sales,
       (SELECT to_char(MIN(date),'YYYY-MM-DD') FROM of_daily d WHERE d.model_id = a.model_id) since
     FROM of_accounts a JOIN models m ON m.id = a.model_id WHERE a.model_id = ANY($1::int[]) ORDER BY gross DESC, m.name`, [ids, from, to])).rows;
  const t = daily.reduce((o, r) => { o.net += Number(r.net); o.gross += Number(r.gross); o.sales += r.sales; return o; }, { net: 0, gross: 0, sales: 0 });
  // TVA payée en plus par les fans (relevée vente par vente) -> TTC = brut + TVA
  const vat = (await pool.query(
    `SELECT COALESCE(SUM(vat_cents),0)::bigint vat, COALESCE(SUM(amount_cents),0)::bigint amount FROM of_transactions
     WHERE model_id = ANY($1::int[]) AND (created_at AT TIME ZONE 'UTC')::date BETWEEN $2::date - 30 AND $3::date`, [ids, from, to])).rows[0];
  const vatRatio = Number(vat.amount) > 0 ? Number(vat.vat) / Number(vat.amount) : null;
  const currency = accounts.find(a => a.currency)?.currency || 'USD';
  const eurRate = await toEurRate(currency);
  const topFans = (await pool.query(
    `SELECT COALESCE(NULLIF(MAX(t.fan_name),''), MAX(t.fan_username), 'fan ' || t.fan_id) fan, MAX(m.name) model_name, COUNT(*)::int n, SUM(t.amount_cents)::bigint total
     FROM of_transactions t JOIN models m ON m.id = t.model_id WHERE t.model_id = ANY($1::int[]) AND t.created_at > NOW() - INTERVAL '31 days'
     GROUP BY t.fan_id ORDER BY total DESC LIMIT 10`, [ids])).rows;
  const recent = (await pool.query(
    `SELECT t.created_at, m.name model_name, t.type, t.amount_cents, t.vat_cents, t.net_cents, COALESCE(NULLIF(t.fan_name,''), t.fan_username) fan
     FROM of_transactions t JOIN models m ON m.id = t.model_id WHERE t.model_id = ANY($1::int[]) ORDER BY t.created_at DESC LIMIT 50`, [ids])).rows;
  res.json({
    from, to, currency, eur_rate: eurRate, vat_ratio: vatRatio,
    totals: { ...t, ttc: Math.round(t.gross * (1 + (vatRatio || 0))), new_paid_subs: subsNew, subscribers: accounts.reduce((s, a) => s + (a.subscribers || 0), 0) },
    byType, daily, accounts, topFans, recent,
  });
}));

router.get('/daily-by-model', wrap(async (req, res) => {
  const { from, to } = range(req);
  const ids = await scopeIds(req);
  const { rows } = await pool.query(
    `SELECT to_char(d.date,'YYYY-MM-DD') d, d.model_id::text AS key, d.model_id AS crm_model_id, m.name, ${GROSS}::bigint AS gross
     FROM of_daily d JOIN models m ON m.id = d.model_id WHERE d.model_id = ANY($1::int[]) AND d.type = 'total' AND d.date BETWEEN $2::date AND $3::date ORDER BY 1`, [ids, from, to]);
  res.json({ from, to, rows });
}));

module.exports = router;
