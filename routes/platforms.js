// ============ TOUTES LES PLATEFORMES — CA TTC (dashboard) ============
// Monté dans server.js :  app.use('/api/platforms', require('./routes/platforms'));
//  - Reveal   : CA TTC de l'API officielle
//  - Telegram : montant payé par le fan (brut Wysper), remboursements déduits, litiges exclus
//  - MyM      : MyM ne donne que la part de la modèle -> TTC estimé (voir services/mym/ttc.js)
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const { netToTtc, MYM_TTC_NOTE } = require('../services/mym/ttc');
const { toEurRate } = require('../services/fx');

const router = express.Router();
const parisDate = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + off * 86400000));
const GROSS = `(CASE WHEN p.status = 'paid' THEN p.gross_cents WHEN p.status = 'refunded' THEN GREATEST(COALESCE(p.gross_cents,0) - COALESCE(p.refund_cents, p.gross_cents, 0), 0) ELSE 0 END)`;
// une plateforme pas encore installée (table absente) ne doit pas casser le dashboard ; toute autre erreur remonte
const safe = (q, v) => pool.query(q, v).then(r => r.rows).catch(e => { if (/does not exist/.test(e.message)) return []; throw e; });

router.get('/summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const today = parisDate(0), yest = parisDate(-1);
    const month = today.slice(0, 8) + '01';
    const from = yest < month ? yest : month;
    const a = req.agencyId, sc = req.modelScope || null;

    // lignes { d, model_id, name, v (centimes TTC), subs }
    const reveal = await safe(
      `SELECT to_char(s.date,'YYYY-MM-DD') d, rm.crm_model_id model_id, COALESCE(m.name, rm.display_name, rm.user_name) name,
              SUM(s.revenue_ttc)::bigint v, SUM(s.new_subscribers)::int subs
       FROM reveal_stats_daily s JOIN reveal_models rm ON rm.reveal_model_id = s.reveal_model_id LEFT JOIN models m ON m.id = rm.crm_model_id
       WHERE s.agency_id = $1 AND s.date BETWEEN $2::date AND $3::date AND ($4::int[] IS NULL OR rm.crm_model_id = ANY($4::int[]))
       GROUP BY 1,2,3`, [a, from, today, sc]);
    const telegram = await safe(
      `SELECT to_char(p.paid_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') d, w.crm_model_id model_id, COALESCE(m.name, w.name, p.account_name) name,
              SUM(${GROSS})::bigint v, 0 subs
       FROM wysper_payments p LEFT JOIN wysper_accounts w ON w.agency_id = p.agency_id AND w.telegram_id = p.account_tid LEFT JOIN models m ON m.id = w.crm_model_id
       WHERE p.agency_id = $1 AND p.currency = 'EUR' AND to_char(p.paid_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') BETWEEN $2::text AND $3::text
         AND ($4::int[] IS NULL OR w.crm_model_id = ANY($4::int[]))
       GROUP BY 1,2,3`, [a, from, today, sc]);
    const tgContacts = await safe(
      `SELECT to_char(c.first_message_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') d, COUNT(*)::int n
       FROM wysper_conversations c LEFT JOIN wysper_accounts w ON w.agency_id = c.agency_id AND w.telegram_id = c.account_tid
       WHERE c.agency_id = $1 AND to_char(c.first_message_at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') BETWEEN $2::text AND $3::text
         AND ($4::int[] IS NULL OR w.crm_model_id = ANY($4::int[])) GROUP BY 1`, [a, from, today, sc]);
    const mymRaw = await safe(
      `SELECT to_char(d.date,'YYYY-MM-DD') d, d.model_id, m.name, d.net_cents::bigint net,
              (SELECT COUNT(*) FROM mym_transactions t WHERE t.model_id = d.model_id AND t.type ILIKE 'abonnement%'
                 AND (t.at AT TIME ZONE 'Europe/Paris')::date = d.date)::int subs
       FROM mym_daily d JOIN models m ON m.id = d.model_id
       WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND d.date BETWEEN $2::date AND $3::date AND ($4::int[] IS NULL OR d.model_id = ANY($4::int[]))`, [a, from, today, sc]);
    // jours MyM sans vente mais avec des abonnés (le graphique MyM ne liste que les jours avec du CA)
    const mymSubsOnly = await safe(
      `SELECT to_char(t.at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') d, t.model_id, m.name, COUNT(*)::int subs
       FROM mym_transactions t JOIN models m ON m.id = t.model_id
       WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND t.type ILIKE 'abonnement%' AND ($4::int[] IS NULL OR t.model_id = ANY($4::int[]))
         AND to_char(t.at AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') BETWEEN $2::text AND $3::text
         AND NOT EXISTS (SELECT 1 FROM mym_daily d WHERE d.model_id = t.model_id AND d.date = (t.at AT TIME ZONE 'Europe/Paris')::date)
       GROUP BY 1,2,3`, [a, from, today, sc]);
    const mym = mymRaw.map(r => ({ ...r, net: Number(r.net), v: netToTtc(r.net) })).concat(mymSubsOnly.map(r => ({ ...r, net: 0, v: 0 })));

    // OnlyFans compte en dollars : brut (net ÷ 0,8) + TVA payée par les fans (taux relevé sur les ventes), converti en euros
    const usdEur = await toEurRate('USD');
    const onlyfans = await safe(
      `SELECT to_char(d.date,'YYYY-MM-DD') d, d.model_id, m.name,
              ROUND(d.net_cents / 0.8 * (1 + COALESCE((SELECT SUM(t.vat_cents)::numeric / NULLIF(SUM(t.amount_cents), 0) FROM of_transactions t
                 WHERE t.model_id = d.model_id AND t.created_at > NOW() - INTERVAL '60 days'), 0)) * $5)::bigint v,
              COALESCE((SELECT s.sales FROM of_daily s WHERE s.model_id = d.model_id AND s.date = d.date AND s.type = 'subscribes'), 0)::int subs
       FROM of_daily d JOIN models m ON m.id = d.model_id
       WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND d.type = 'total' AND d.date BETWEEN $2::date AND $3::date AND ($4::int[] IS NULL OR d.model_id = ANY($4::int[]))`,
      [a, from, today, sc, usdEur]);

    const connected = {
      reveal: (await safe(`SELECT 1 FROM reveal_api_state WHERE agency_id = $1 AND key_enc IS NOT NULL`, [a])).length > 0,
      telegram: (await safe(`SELECT 1 FROM wysper_state WHERE agency_id = $1 AND key_enc IS NOT NULL`, [a])).length > 0,
      onlyfans: (await safe(`SELECT 1 FROM of_accounts a JOIN models m ON m.id = a.model_id WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND a.session_enc IS NOT NULL`, [a])).length > 0,
      mym: (await safe(`SELECT 1 FROM mym_accounts a JOIN models m ON m.id = a.model_id WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND a.session_enc IS NOT NULL`, [a])).length > 0,
    };

    const P = { reveal, onlyfans, telegram, mym };
    const sum = (rows, test, k = 'v') => rows.filter(test).reduce((s, r) => s + Number(r[k] || 0), 0);
    const platforms = {};
    for (const [k, rows] of Object.entries(P)) {
      platforms[k] = {
        connected: connected[k],
        today: sum(rows, r => r.d === today), yesterday: sum(rows, r => r.d === yest), month: sum(rows, r => r.d >= month),
        subs_today: sum(rows, r => r.d === today, 'subs'), subs_month: sum(rows, r => r.d >= month, 'subs'),
      };
    }
    platforms.telegram.contacts_today = tgContacts.filter(r => r.d === today).reduce((s, r) => s + r.n, 0);
    platforms.telegram.contacts_month = tgContacts.filter(r => r.d >= month).reduce((s, r) => s + r.n, 0);
    platforms.mym.estimated = true;
    platforms.mym.net_month = sum(mym, r => r.d >= month, 'net');
    const total = ['today', 'yesterday', 'month', 'subs_today', 'subs_month'].reduce((o, k) => { o[k] = Object.values(platforms).reduce((s, p) => s + p[k], 0); return o; }, {});

    // CA TTC du mois par modèle, détaillé par plateforme
    const models = {};
    for (const [k, rows] of Object.entries(P)) {
      for (const r of rows) {
        if (r.d < month) continue;
        const key = r.model_id ? 'm' + r.model_id : k + ':' + r.name;
        const m = models[key] = models[key] || { model_id: r.model_id, name: r.name || 'Sans modèle', reveal: 0, onlyfans: 0, telegram: 0, mym: 0, total: 0, subs: 0 };
        m[k] += Number(r.v || 0); m.total += Number(r.v || 0); m.subs += Number(r.subs || 0);
      }
    }
    // CA TTC jour par jour du mois, par plateforme (graphique)
    const daily = [];
    for (const [k, rows] of Object.entries(P)) {
      const by = {};
      rows.filter(r => r.d >= month).forEach(r => { by[r.d] = (by[r.d] || 0) + Number(r.v || 0); });
      Object.entries(by).forEach(([d, v]) => daily.push({ d, platform: k, v }));
    }
    res.json({
      today, yesterday: yest, month, platforms, total, daily,
      models: Object.values(models).filter(m => m.total > 0 || m.subs > 0).sort((x, y) => y.total - x.total),
      mym_note: MYM_TTC_NOTE, usd_eur: usdEur,
    });
  } catch (e) {
    console.error('[PLATFORMS]', e);
    res.status(500).json({ error: 'Erreur : ' + e.message });
  }
});

module.exports = router;
