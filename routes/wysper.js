// ============ WYSPER (Telegram) — ROUTES DU CRM ============
// Monté dans server.js :  app.use('/api/wysper', require('./routes/wysper'));
// (le webhook /api/wysper/webhook/:token est monté à part, avant express.json, pour garder le corps brut)
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const sync = require('../services/wysper/sync');
const api = require('../services/wysper/client');
const modelScope = require('../services/scope');

const router = express.Router();
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[WYSPER]', e);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : 'Erreur : ' + e.message });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parisDate = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + off * 86400000));
function range(req, defDays = 30) {
  const to = isDate(req.query.to) ? req.query.to : parisDate(0);
  const from = isDate(req.query.from) ? req.query.from : parisDate(-(defDays - 1));
  return { from, to };
}
const accountOf = req => (/^-?\d{1,20}$/.test(String(req.query.account || '')) ? String(req.query.account) : null);
const currencyOf = req => (/^[A-Z]{3}$/i.test(String(req.query.currency || '')) ? String(req.query.currency).toUpperCase() : 'EUR');
// associé : seulement les comptes Telegram reliés à ses modèles (null = tous)
async function tgScope(req) {
  const s = modelScope.scopeOf(req);
  if (!s) return null;
  const { rows } = await pool.query(`SELECT telegram_id::text FROM wysper_accounts WHERE agency_id = $1 AND crm_model_id = ANY($2::int[])`, [req.agencyId, s]);
  return rows.map(r => r.telegram_id);
}
// montant réellement gardé : un remboursement partiel garde la différence, un litige ouvert ne compte pas
const GROSS = `(CASE WHEN p.status = 'paid' THEN p.gross_cents WHEN p.status = 'refunded' THEN GREATEST(COALESCE(p.gross_cents,0) - COALESCE(p.refund_cents, p.gross_cents, 0), 0) ELSE 0 END)`;
const NET = `(CASE WHEN p.status = 'paid' THEN p.net_cents WHEN p.status = 'refunded' AND p.gross_cents > 0 THEN ROUND(p.net_cents::numeric * GREATEST(p.gross_cents - COALESCE(p.refund_cents, p.gross_cents), 0) / p.gross_cents) ELSE 0 END)`;
const PDAY = `to_char(p.paid_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')`;
const CDAY = `to_char(c.first_message_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')`;

router.use(authMiddleware, adminOnly);

// ---------- connexion ----------
router.get('/status', wrap(async (req, res) => {
  const st = req.modelScope ? await sync.state(req.agencyId) : await sync.ensureState(req.agencyId);
  const counts = (await pool.query(
    `SELECT (SELECT COUNT(*) FROM wysper_accounts WHERE agency_id = $1)::int AS accounts,
            (SELECT COUNT(*) FROM wysper_accounts WHERE agency_id = $1 AND crm_model_id IS NULL)::int AS accounts_unmapped,
            (SELECT COUNT(*) FROM wysper_payments WHERE agency_id = $1)::int AS payments,
            (SELECT COUNT(*) FROM wysper_conversations WHERE agency_id = $1)::int AS contacts`, [req.agencyId])).rows[0];
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0];
  res.json({
    connected: !!st?.key_enc, key_last4: st?.key_last4 || null, connected_at: st?.connected_at, last_sync_at: st?.last_sync_at,
    last_error: st?.last_error, last_error_at: st?.last_error_at, backfilled: !!st?.backfilled,
    secret_set: !!st?.secret_enc, last_event_at: st?.last_event_at, last_event_type: st?.last_event_type,
    sale_alert_min: st?.sale_alert_min != null ? Number(st.sale_alert_min) : null,
    webhook_url: req.modelScope || !st?.webhook_token ? null : `${proto}://${host}/api/wysper/webhook/${st.webhook_token}`,
    counts,
  });
}));

const ownerOnly = req => { if (req.modelScope) throw fail(403, 'Réservé au compte principal'); };

router.post('/key', wrap(async (req, res) => {
  ownerOnly(req);
  await sync.saveKey(req.agencyId, req.body?.key);
  res.json(await sync.fullSync(req.agencyId, { force: true }).catch(e => ({ ok: false, error: e.message })));
}));
router.delete('/key', wrap(async (req, res) => {
  ownerOnly(req);
  await pool.query(`UPDATE wysper_state SET key_enc = NULL, key_last4 = NULL WHERE agency_id = $1`, [req.agencyId]);
  res.json({ ok: true });
}));
router.post('/secret', wrap(async (req, res) => {
  ownerOnly(req);
  await sync.saveSecret(req.agencyId, req.body?.secret);
  res.json({ ok: true });
}));
router.put('/options', wrap(async (req, res) => {
  ownerOnly(req);
  const b = req.body || {};
  const min = b.sale_alert_min === '' || b.sale_alert_min == null ? null : Math.max(0, Number(b.sale_alert_min) || 0) || null;
  await sync.ensureState(req.agencyId);
  await pool.query(`UPDATE wysper_state SET sale_alert_min = $2 WHERE agency_id = $1`, [req.agencyId, min]);
  res.json({ ok: true });
}));
router.post('/sync', wrap(async (req, res) => { ownerOnly(req); res.json(await sync.fullSync(req.agencyId, { force: true })); }));
// demande à Wysper d'envoyer un faux paiement à l'adresse du CRM
router.post('/test-webhook', wrap(async (req, res) => {
  ownerOnly(req);
  const key = await sync.getKey(req.agencyId);
  if (!key) throw fail(400, 'Connecte d\'abord la clé Wysper');
  const r = await api.testWebhook(key, 'payment.succeeded');
  res.json(r);
}));

// ---------- comptes Telegram ↔ modèles ----------
router.get('/accounts', wrap(async (req, res) => {
  const sc = await tgScope(req);
  const accounts = (await pool.query(
    `SELECT a.telegram_id::text, a.name, a.status, a.currency, a.crm_model_id, m.name AS crm_name
     FROM wysper_accounts a LEFT JOIN models m ON m.id = a.crm_model_id
     WHERE a.agency_id = $1 AND ($2::text[] IS NULL OR a.telegram_id::text = ANY($2::text[])) ORDER BY a.name`, [req.agencyId, sc])).rows;
  const crm = (await pool.query(`SELECT id, name FROM models WHERE (agency_id = $1 OR agency_id IS NULL) AND ($2::int[] IS NULL OR id = ANY($2::int[])) ORDER BY name`, [req.agencyId, req.modelScope || null])).rows;
  res.json({ accounts, crm });
}));
router.put('/accounts/:tid/map', wrap(async (req, res) => {
  ownerOnly(req);
  if (!/^-?\d{1,20}$/.test(req.params.tid)) throw fail(400, 'Compte invalide');
  const crmId = req.body?.crm_model_id ? Number(req.body.crm_model_id) : null;
  if (crmId && !(await pool.query(`SELECT 1 FROM models WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`, [crmId, req.agencyId])).rows[0]) throw fail(404, 'Modèle introuvable');
  const r = await pool.query(`UPDATE wysper_accounts SET crm_model_id = $3 WHERE agency_id = $1 AND telegram_id = $2`, [req.agencyId, req.params.tid, crmId]);
  if (!r.rowCount) throw fail(404, 'Compte Telegram introuvable');
  res.json({ ok: true });
}));

// ---------- vue d'ensemble ----------
router.get('/overview', wrap(async (req, res) => {
  const { from, to } = range(req);
  const a = req.agencyId, acc = accountOf(req), cur = currencyOf(req), sc = await tgScope(req);
  const P = `p.agency_id = $1 AND p.currency = $2 AND ($3::text IS NULL OR p.account_tid::text = $3) AND ($4::text[] IS NULL OR p.account_tid::text = ANY($4::text[]))`;
  const C = `c.agency_id = $1 AND ($3::text IS NULL OR c.account_tid::text = $3) AND ($4::text[] IS NULL OR c.account_tid::text = ANY($4::text[]))`;
  const base = [a, cur, acc, sc];
  const totals = (await pool.query(
    `SELECT COALESCE(SUM(${GROSS}),0)::bigint gross, COALESCE(SUM(${NET}),0)::bigint net,
            COUNT(*) FILTER (WHERE p.status = 'paid')::int sales, COUNT(DISTINCT p.buyer_tid) FILTER (WHERE p.status = 'paid')::int buyers,
            COUNT(*) FILTER (WHERE p.buyer_first AND p.status = 'paid')::int first_buyers,
            COUNT(*) FILTER (WHERE p.status = 'refunded')::int refunds, COALESCE(SUM(p.refund_cents) FILTER (WHERE p.status = 'refunded'),0)::bigint refunded,
            COUNT(*) FILTER (WHERE p.status = 'disputed')::int disputes
     FROM wysper_payments p WHERE ${P} AND ${PDAY} BETWEEN $5 AND $6`, [...base, from, to])).rows[0];
  totals.contacts = (await pool.query(`SELECT COUNT(*)::int n FROM wysper_conversations c WHERE ${C} AND ${CDAY} BETWEEN $5 AND $6 AND $2::text IS NOT NULL`, [...base, from, to])).rows[0].n;
  const dailyPay = (await pool.query(
    `SELECT ${PDAY} d, COALESCE(SUM(${GROSS}),0)::bigint gross, COALESCE(SUM(${NET}),0)::bigint net, COUNT(*) FILTER (WHERE p.status = 'paid')::int sales
     FROM wysper_payments p WHERE ${P} AND ${PDAY} BETWEEN $5 AND $6 GROUP BY 1`, [...base, from, to])).rows;
  const dailyCon = (await pool.query(`SELECT ${CDAY} d, COUNT(*)::int contacts FROM wysper_conversations c WHERE ${C} AND ${CDAY} BETWEEN $5 AND $6 AND $2::text IS NOT NULL GROUP BY 1`, [...base, from, to])).rows;
  const days = {};
  dailyPay.forEach(r => { days[r.d] = { d: r.d, gross: Number(r.gross), net: Number(r.net), sales: r.sales, contacts: 0 }; });
  dailyCon.forEach(r => { (days[r.d] = days[r.d] || { d: r.d, gross: 0, net: 0, sales: 0, contacts: 0 }).contacts = r.contacts; });
  const daily = Object.values(days).sort((x, y) => x.d.localeCompare(y.d));

  // par compte Telegram, avec la LTV sur tout l'historique
  const accounts = (await pool.query(
    `SELECT a.telegram_id::text, a.name, a.status, a.currency, a.crm_model_id, m.name crm_name,
       (SELECT COALESCE(SUM(${GROSS}),0) FROM wysper_payments p WHERE p.agency_id = a.agency_id AND p.account_tid = a.telegram_id AND p.currency = $2 AND ${PDAY} BETWEEN $5 AND $6)::bigint gross,
       (SELECT COALESCE(SUM(${NET}),0) FROM wysper_payments p WHERE p.agency_id = a.agency_id AND p.account_tid = a.telegram_id AND p.currency = $2 AND ${PDAY} BETWEEN $5 AND $6)::bigint net,
       (SELECT COUNT(*) FROM wysper_payments p WHERE p.agency_id = a.agency_id AND p.account_tid = a.telegram_id AND p.currency = $2 AND p.status = 'paid' AND ${PDAY} BETWEEN $5 AND $6)::int sales,
       (SELECT COUNT(*) FROM wysper_conversations c WHERE c.agency_id = a.agency_id AND c.account_tid = a.telegram_id AND ${CDAY} BETWEEN $5 AND $6)::int contacts,
       (SELECT COALESCE(SUM(${GROSS}),0) FROM wysper_payments p WHERE p.agency_id = a.agency_id AND p.account_tid = a.telegram_id AND p.currency = $2)::bigint life_gross,
       (SELECT COUNT(DISTINCT p.buyer_tid) FROM wysper_payments p WHERE p.agency_id = a.agency_id AND p.account_tid = a.telegram_id AND p.currency = $2 AND p.status <> 'disputed')::int life_buyers,
       (SELECT COUNT(*) FROM wysper_conversations c WHERE c.agency_id = a.agency_id AND c.account_tid = a.telegram_id)::int life_contacts
     FROM wysper_accounts a LEFT JOIN models m ON m.id = a.crm_model_id
     WHERE a.agency_id = $1 AND ($3::text IS NULL OR a.telegram_id::text = $3) AND ($4::text[] IS NULL OR a.telegram_id::text = ANY($4::text[]))
     ORDER BY gross DESC, a.name`, [...base, from, to])).rows;
  accounts.forEach(r => {
    r.ltv_contact = r.life_contacts ? Math.round(Number(r.life_gross) / r.life_contacts) : null;
    r.ltv_buyer = r.life_buyers ? Math.round(Number(r.life_gross) / r.life_buyers) : null;
  });
  const sum = k => accounts.reduce((x, r) => x + Number(r[k] || 0), 0);
  const since = (await pool.query(`SELECT to_char(MIN(p.paid_at) AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') d FROM wysper_payments p WHERE ${P}`, base)).rows[0].d;
  const ltv = {
    contact: sum('life_contacts') ? Math.round(sum('life_gross') / sum('life_contacts')) : null,   // ce que rapporte un fan qui écrit
    buyer: sum('life_buyers') ? Math.round(sum('life_gross') / sum('life_buyers')) : null,        // dépense moyenne d'un fan qui a payé
    buyers: sum('life_buyers'), contacts: sum('life_contacts'), since,
  };
  res.json({ from, to, currency: cur, totals, daily, accounts, ltv });
}));

// CA par jour et par modèle (graphique « Revenu journalier »)
router.get('/daily-by-model', wrap(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await pool.query(
    `SELECT ${PDAY} AS d, p.account_tid::text AS key, a.crm_model_id, COALESCE(m.name, a.name, p.account_name) AS name, SUM(${GROSS})::bigint AS gross
     FROM wysper_payments p LEFT JOIN wysper_accounts a ON a.agency_id = p.agency_id AND a.telegram_id = p.account_tid LEFT JOIN models m ON m.id = a.crm_model_id
     WHERE p.agency_id = $1 AND p.currency = $2 AND ${PDAY} BETWEEN $3 AND $4 AND ($5::text[] IS NULL OR p.account_tid::text = ANY($5::text[]))
     GROUP BY 1, 2, 3, 4 ORDER BY 1`, [req.agencyId, currencyOf(req), from, to, await tgScope(req)]);
  res.json({ from, to, rows });
}));

// ---------- ventes ----------
router.get('/sales', wrap(async (req, res) => {
  const acc = accountOf(req), sc = await tgScope(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const sales = (await pool.query(
    `SELECT p.payment_id, p.account_tid::text, COALESCE(m.name, p.account_name) model_name, p.status, p.type, p.paid_at, p.currency,
            p.gross_cents, p.net_cents, p.refund_cents, p.buyer_username, p.buyer_tid::text, p.buyer_first, p.sent_by_name, p.source_link
     FROM wysper_payments p LEFT JOIN wysper_accounts a ON a.agency_id = p.agency_id AND a.telegram_id = p.account_tid LEFT JOIN models m ON m.id = a.crm_model_id
     WHERE p.agency_id = $1 AND ($2::text IS NULL OR p.account_tid::text = $2) AND ($3::text[] IS NULL OR p.account_tid::text = ANY($3::text[]))
     ORDER BY p.paid_at DESC LIMIT $4`, [req.agencyId, acc, sc, limit])).rows;
  const topFans = (await pool.query(
    `SELECT COALESCE(p.buyer_username, 'tg:' || p.buyer_tid) fan, COALESCE(MAX(m.name), MAX(p.account_name)) model_name, COUNT(*)::int n, SUM(${GROSS})::bigint total
     FROM wysper_payments p LEFT JOIN wysper_accounts a ON a.agency_id = p.agency_id AND a.telegram_id = p.account_tid LEFT JOIN models m ON m.id = a.crm_model_id
     WHERE p.agency_id = $1 AND p.currency = 'EUR' AND p.status = 'paid' AND p.paid_at > NOW() - INTERVAL '31 days'
       AND ($2::text IS NULL OR p.account_tid::text = $2) AND ($3::text[] IS NULL OR p.account_tid::text = ANY($3::text[]))
     GROUP BY p.buyer_tid, p.buyer_username ORDER BY total DESC LIMIT 10`, [req.agencyId, acc, sc])).rows;
  res.json({ sales, topFans });
}));

// ventes par membre de l'équipe (celui qui a envoyé le PPV)
router.get('/team', wrap(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await pool.query(
    `SELECT COALESCE(p.sent_by_name, 'Sans membre') name, COUNT(*) FILTER (WHERE p.status = 'paid')::int sales,
            COALESCE(SUM(${GROSS}),0)::bigint gross, COALESCE(SUM(${NET}),0)::bigint net, COUNT(DISTINCT p.buyer_tid)::int buyers
     FROM wysper_payments p WHERE p.agency_id = $1 AND p.currency = $2 AND ${PDAY} BETWEEN $3 AND $4
       AND ($5::text IS NULL OR p.account_tid::text = $5) AND ($6::text[] IS NULL OR p.account_tid::text = ANY($6::text[]))
     GROUP BY 1 ORDER BY gross DESC`, [req.agencyId, currencyOf(req), from, to, accountOf(req), await tgScope(req)]);
  res.json({ from, to, members: rows });
}));

// liens de tracking : lus en direct chez Wysper
router.get('/tracking', wrap(async (req, res) => {
  const key = await sync.getKey(req.agencyId);
  if (!key) throw fail(400, 'Wysper pas connecté');
  const { from, to } = range(req);
  const sc = await tgScope(req), acc = accountOf(req);
  if (sc && acc && !sc.includes(acc)) throw fail(403, 'Ce compte ne fait pas partie de tes accès');
  const r = await api.trackingLinks(key, { from, to, account: acc || undefined, currency: currencyOf(req) });
  // la réponse est regroupée par compte : on garde seulement ceux autorisés
  const keep = x => !sc || sc.includes(String(x.account?.telegram_id ?? x.account ?? x.telegram_id ?? ''));
  const accounts = Array.isArray(r.accounts) ? r.accounts.filter(keep) : null;
  const links = Array.isArray(r.links) ? r.links.filter(keep) : Array.isArray(r.data) ? r.data.filter(keep) : null;
  res.json({ from, to, accounts, links, raw: sc ? undefined : (accounts || links ? undefined : r) });
}));

module.exports = router;
