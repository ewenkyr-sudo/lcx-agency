// Synchronisation API Reveal -> CRM.
//  - toutes les minutes : ventes (Fan CRM, alertes WhatsApp)
//  - toutes les 15 min  : modèles, équipe, stats par modèle, CA par chatteur, liens de suivi
//  - 1re connexion      : rattrapage des 31 derniers jours
const pool = require('../../db/pool');
const api = require('./client');
const { encrypt, decrypt } = require('../autopost/session');

let sendWhatsApp = async () => {};
try { ({ sendWhatsApp } = require('../whatsapp')); } catch (e) { /* optionnel */ }

const FULL_EVERY_MIN = 15;
const SALE_TYPES_FR = { subscription: 'abonnement', renewal: 'renouvellement', ppv: 'PPV', mass_dm: 'Mass DM', tip: 'pourboire', payment_link: 'lien de paiement', boudoir: 'boudoir', paid_message: 'message payant', other: 'autre' };

// ---------- dates (heure de Paris, comme Reveal) ----------
function parisDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const cents = v => (v === null || v === undefined ? null : Math.round(Number(v)));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- clé ----------
async function getKey(agencyId) {
  const { rows } = await pool.query('SELECT key_enc FROM reveal_api_state WHERE agency_id = $1', [agencyId]);
  if (!rows[0]?.key_enc) return null;
  return decrypt(rows[0].key_enc).key;
}

async function saveKey(agencyId, key) {
  key = String(key || '').trim();
  if (!/^rvl_[A-Za-z0-9_\-]{8,}$/.test(key)) throw Object.assign(new Error('Ce n\'est pas une clé Reveal (elle commence par rvl_)'), { status: 400 });
  // vérifie la clé avant de l'enregistrer
  try { await api.models(key); } catch (e) {
    throw Object.assign(new Error(e.status === 401 ? 'Reveal refuse cette clé (révoquée ou mal copiée)' : e.message), { status: 400 });
  }
  await pool.query(
    `INSERT INTO reveal_api_state (agency_id, key_enc, key_last4, connected_at, backfilled, shifts_since, last_error, sales_cursor, sales_enabled)
     VALUES ($1, $2, $3, NOW(), false, $4, NULL, NULL, NULL)
     ON CONFLICT (agency_id) DO UPDATE SET key_enc = $2, key_last4 = $3, connected_at = NOW(), last_error = NULL, sales_enabled = NULL,
       shifts_since = COALESCE(reveal_api_state.shifts_since, $4), backfilled = false`,
    [agencyId, encrypt({ key }), key.slice(-4), parisDate(0)]);
}

async function setError(agencyId, err) {
  const msg = String(err.message || err).slice(0, 500);
  const prev = (await pool.query(`SELECT last_error FROM reveal_api_state WHERE agency_id = $1`, [agencyId])).rows[0]?.last_error;
  await pool.query(`UPDATE reveal_api_state SET last_error = $2, last_error_at = NOW() WHERE agency_id = $1`, [agencyId, msg]);
  // WhatsApp seulement pour une clé refusée, et une seule fois tant que l'erreur ne change pas
  if (err.status === 401 && prev !== msg) {
    await sendWhatsApp(`🔑 API Reveal : ${msg}\n👉 CRM > Reveal > Réglages.`, agencyId).catch(() => {});
  }
}

// ---------- modèles & équipe ----------
async function syncDirectory(agencyId, key) {
  const m = await api.models(key);
  for (const x of m.data || []) {
    await pool.query(
      `INSERT INTO reveal_models (reveal_model_id, agency_id, user_name, display_name, avatar_url, is_active, status, subscribers_count, subscription_price, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (reveal_model_id) DO UPDATE SET agency_id=$2, user_name=$3, display_name=$4, avatar_url=$5, is_active=$6, status=$7,
         subscribers_count=$8, subscription_price=$9, updated_at=NOW()`,
      [x.modelId, agencyId, x.userName, x.displayName, x.avatarUrl, x.isActive, x.status, x.subscribersCount, cents(x.subscriptionPrice)]);
  }
  await autoMapModels(agencyId);

  const c = await api.chatters(key);
  for (const x of c.data || []) {
    await pool.query(
      `INSERT INTO reveal_chatters (chatter_id, agency_id, first_name, last_name, email, role, is_bot, is_external, removed_at, model_ids, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (chatter_id) DO UPDATE SET agency_id=$2, first_name=$3, last_name=$4, email=$5, role=$6, is_bot=$7, is_external=$8,
         removed_at=$9, model_ids=$10, updated_at=NOW()`,
      [x.chatterId, agencyId, x.firstName, x.lastName, x.email, x.role, !!x.isBot, !!x.isExternal, x.removedAt, JSON.stringify(x.modelIds || [])]);
  }
  await autoMapChatters(agencyId);
}

// Relie chaque modèle Reveal à sa fiche CRM : lien déjà connu, page auto-post, puis nom
async function autoMapModels(agencyId) {
  const { rows: rms } = await pool.query(`SELECT * FROM reveal_models WHERE agency_id = $1 AND crm_model_id IS NULL`, [agencyId]);
  if (!rms.length) return;
  const { rows: crm } = await pool.query(
    `SELECT m.id, m.name, m.reveal_model_id, s.reveal_model_id AS ap_id FROM models m
     LEFT JOIN autopost_settings s ON s.model_id = m.id WHERE (m.agency_id = $1 OR m.agency_id IS NULL)`, [agencyId]).catch(() => ({ rows: [] }));
  const taken = new Set((await pool.query(`SELECT crm_model_id FROM reveal_models WHERE crm_model_id IS NOT NULL`)).rows.map(r => r.crm_model_id));
  for (const rm of rms) {
    const match = crm.find(c => c.reveal_model_id === rm.reveal_model_id)
      || crm.find(c => c.ap_id === rm.reveal_model_id)
      || crm.find(c => !taken.has(c.id) && norm(c.name) && (norm(c.name) === norm(rm.display_name) || norm(c.name) === norm(rm.user_name)));
    if (match && !taken.has(match.id)) {
      await mapModel(rm.reveal_model_id, match.id);
      taken.add(match.id);
    }
  }
}

async function mapModel(revealModelId, crmModelId) {
  await pool.query(`UPDATE models SET reveal_model_id = NULL WHERE reveal_model_id = $1`, [revealModelId]);
  await pool.query(`UPDATE reveal_models SET crm_model_id = $2 WHERE reveal_model_id = $1`, [revealModelId, crmModelId || null]);
  if (crmModelId) {
    await pool.query(`UPDATE reveal_models SET crm_model_id = NULL WHERE crm_model_id = $1 AND reveal_model_id <> $2`, [crmModelId, revealModelId]);
    await pool.query(`UPDATE models SET reveal_model_id = $2 WHERE id = $1`, [crmModelId, revealModelId]);
  }
}

// Relie chaque chatteur Reveal à son compte CRM par l'e-mail
async function autoMapChatters(agencyId) {
  await pool.query(
    `UPDATE reveal_chatters rc SET crm_user_id = u.id FROM users u
     WHERE rc.agency_id = $1 AND rc.crm_user_id IS NULL AND rc.email IS NOT NULL AND LOWER(u.email) = LOWER(rc.email)
       AND NOT EXISTS (SELECT 1 FROM reveal_chatters x WHERE x.crm_user_id = u.id)`, [agencyId]);
}

// ---------- stats par modèle ----------
async function syncStats(agencyId, key, from, to) {
  const r = await api.statsDaily(key, from, to);
  for (const d of r.data || []) {
    await pool.query(
      `INSERT INTO reveal_stats_daily (reveal_model_id, date, agency_id, new_subscribers, unsubscribes, active_subscribers,
         revenue_ttc, revenue_ht, agency_revenue, model_revenue, ppv_sent, ppv_purchased, ppv_revenue_ttc, tips_count, tips_revenue_ttc,
         renewals, payment_links_count, boudoir_count, paid_messages_count, subscriptions_net, renewals_net, ppv_net, tips_net,
         payment_links_net, boudoir_net, paid_messages_net, other_net, messages_sent, messages_received, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW())
       ON CONFLICT (reveal_model_id, date) DO UPDATE SET agency_id=$3, new_subscribers=$4, unsubscribes=$5, active_subscribers=$6,
         revenue_ttc=$7, revenue_ht=$8, agency_revenue=$9, model_revenue=$10, ppv_sent=$11, ppv_purchased=$12, ppv_revenue_ttc=$13,
         tips_count=$14, tips_revenue_ttc=$15, renewals=$16, payment_links_count=$17, boudoir_count=$18, paid_messages_count=$19,
         subscriptions_net=$20, renewals_net=$21, ppv_net=$22, tips_net=$23, payment_links_net=$24, boudoir_net=$25,
         paid_messages_net=$26, other_net=$27,
         messages_sent=COALESCE($28, reveal_stats_daily.messages_sent), messages_received=COALESCE($29, reveal_stats_daily.messages_received),
         updated_at=NOW()`,
      [d.modelId, d.date, agencyId, d.newSubscribers, d.unsubscribes, d.activeSubscribers,
       cents(d.revenueTtc), cents(d.revenueHt), cents(d.agencyRevenue), cents(d.modelRevenue), d.ppvSent, d.ppvPurchased, cents(d.ppvRevenueTtc),
       d.tipsCount, cents(d.tipsRevenueTtc), d.renewals, d.paymentLinksCount, d.boudoirCount, d.paidMessagesCount,
       cents(d.subscriptionsNetRevenue), cents(d.renewalsNetRevenue), cents(d.ppvNetRevenue), cents(d.tipsNetRevenue),
       cents(d.paymentLinksNetRevenue), cents(d.boudoirNetRevenue), cents(d.paidMessagesNetRevenue), cents(d.otherNetRevenue),
       d.messagesSent ?? null, d.messagesReceived ?? null]);
  }
}

// Objectifs de CA du mois : « réalisé » rempli depuis Reveal
async function updateObjectives(agencyId) {
  const { rows: st } = await pool.query(`SELECT objectives_base FROM reveal_api_state WHERE agency_id = $1`, [agencyId]);
  const base = st[0]?.objectives_base || 'net';
  const expr = { ttc: 's.revenue_ttc', ht: 's.revenue_ht', agency: 's.agency_revenue', net: 's.agency_revenue + s.model_revenue' }[base] || 's.agency_revenue + s.model_revenue';
  const month = parisDate(0).slice(0, 7);
  await pool.query(
    `INSERT INTO model_revenue_objectives (model_id, month, target, current, agency_id)
     SELECT rm.crm_model_id, $2, 0, ROUND(SUM(${expr})::numeric / 100, 2), $1
     FROM reveal_stats_daily s JOIN reveal_models rm ON rm.reveal_model_id = s.reveal_model_id
     WHERE s.agency_id = $1 AND rm.crm_model_id IS NOT NULL AND to_char(s.date, 'YYYY-MM') = $2
     GROUP BY rm.crm_model_id
     ON CONFLICT (model_id, month) DO UPDATE SET current = EXCLUDED.current`, [agencyId, month]);
}

// ---------- CA par chatteur ----------
async function syncChatterStats(agencyId, key, from, to) {
  const r = await api.chattersDaily(key, from, to);
  for (const d of r.data || []) {
    await pool.query(
      `INSERT INTO reveal_chatter_daily (date, chatter_id, reveal_model_id, agency_id, sales_count, revenue_ttc, revenue_ht, agency_revenue,
         model_revenue, net_revenue, ppv_purchased, ppv_net, tips_count, tips_net, messages_sent, ppv_sent, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (date, chatter_id, reveal_model_id) DO UPDATE SET agency_id=$4, sales_count=$5, revenue_ttc=$6, revenue_ht=$7,
         agency_revenue=$8, model_revenue=$9, net_revenue=$10, ppv_purchased=$11, ppv_net=$12, tips_count=$13, tips_net=$14,
         messages_sent=COALESCE($15, reveal_chatter_daily.messages_sent), ppv_sent=COALESCE($16, reveal_chatter_daily.ppv_sent), updated_at=NOW()`,
      [d.date, d.chatterId || '', d.modelId, agencyId, d.salesCount, cents(d.revenueTtc), cents(d.revenueHt), cents(d.agencyRevenue),
       cents(d.modelRevenue), cents(d.netRevenue), d.ppvPurchased, cents(d.ppvNetRevenue), d.tipsCount, cents(d.tipsNetRevenue),
       d.messagesSent ?? null, d.ppvSent ?? null]);
  }
}

// Remplace la saisie manuelle des shifts : une ligne par chatteur, jour et modèle (montants nets, en €)
async function updateShifts(agencyId) {
  await pool.query(
    `INSERT INTO chatter_shifts (user_id, date, model_name, ppv_total, tips_total, ppv_count, ppv_sold, shift_status, shift_notes, agency_id, reveal_key)
     SELECT rc.crm_user_id, to_char(d.date, 'YYYY-MM-DD'), m.name,
            ROUND(COALESCE(d.ppv_net, 0)::numeric / 100, 2), ROUND(COALESCE(d.tips_net, 0)::numeric / 100, 2),
            COALESCE(d.ppv_sent, 0), COALESCE(d.ppv_purchased, 0), 'reveal', 'Relevé automatique Reveal', $1,
            to_char(d.date, 'YYYY-MM-DD') || '|' || d.chatter_id || '|' || d.reveal_model_id
     FROM reveal_chatter_daily d
     JOIN reveal_chatters rc ON rc.chatter_id = d.chatter_id AND rc.crm_user_id IS NOT NULL
     JOIN reveal_models rm ON rm.reveal_model_id = d.reveal_model_id AND rm.crm_model_id IS NOT NULL
     JOIN models m ON m.id = rm.crm_model_id
     JOIN reveal_api_state st ON st.agency_id = d.agency_id
     WHERE d.agency_id = $1 AND d.chatter_id <> '' AND d.date >= st.shifts_since
     ON CONFLICT (reveal_key) DO UPDATE SET user_id = EXCLUDED.user_id, model_name = EXCLUDED.model_name,
       ppv_total = EXCLUDED.ppv_total, tips_total = EXCLUDED.tips_total, ppv_count = EXCLUDED.ppv_count, ppv_sold = EXCLUDED.ppv_sold`,
    [agencyId]);
  // une correspondance retirée : ses lignes automatiques disparaissent
  await pool.query(
    `DELETE FROM chatter_shifts cs WHERE cs.agency_id = $1 AND cs.reveal_key IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM reveal_chatter_daily d JOIN reveal_chatters rc ON rc.chatter_id = d.chatter_id
       JOIN reveal_models rm ON rm.reveal_model_id = d.reveal_model_id
       WHERE to_char(d.date, 'YYYY-MM-DD') || '|' || d.chatter_id || '|' || d.reveal_model_id = cs.reveal_key
         AND rc.crm_user_id = cs.user_id AND rm.crm_model_id IS NOT NULL)`, [agencyId]);
}

// ---------- liens de suivi ----------
async function syncTracking(agencyId, key, from, to) {
  const l = await api.trackingLinks(key);
  for (const x of l.data || []) {
    await pool.query(
      `INSERT INTO reveal_tracking_links (tracking_link_id, agency_id, reveal_model_id, name, tracking_code, url, created_at, clicks,
         new_subscribers, free_subscribers, paid_subscribers, revenue_ttc, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (tracking_link_id) DO UPDATE SET agency_id=$2, reveal_model_id=$3, name=$4, tracking_code=$5, url=$6, created_at=$7,
         clicks=$8, new_subscribers=$9, free_subscribers=$10, paid_subscribers=$11, revenue_ttc=$12, updated_at=NOW()`,
      [x.trackingLinkId, agencyId, x.modelId, x.name, x.trackingCode, x.url, x.createdAt, x.clicks, x.newSubscribers,
       x.freeSubscribers, x.paidSubscribers, cents(x.revenueTtc)]);
  }
  const d = await api.trackingDaily(key, from, to);
  for (const x of d.data || []) {
    await pool.query(
      `INSERT INTO reveal_tracking_daily (tracking_link_id, date, agency_id, reveal_model_id, clicks, new_subscribers, revenue_ttc)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tracking_link_id, date) DO UPDATE SET clicks=$5, new_subscribers=$6, revenue_ttc=$7`,
      [x.trackingLinkId, x.date, agencyId, x.modelId, x.clicks, x.newSubscribers, cents(x.revenueTtc)]);
  }
}

// ---------- ventes ----------
async function syncSales(agencyId, key) {
  const { rows } = await pool.query(`SELECT sales_cursor, sales_enabled, backfilled, sale_alert_min FROM reveal_api_state WHERE agency_id = $1`, [agencyId]);
  const st = rows[0] || {};
  if (st.sales_enabled === false) return 0;
  let cursor = st.sales_cursor || undefined, total = 0;
  for (let page = 0; page < 20; page++) {
    let r;
    try { r = await api.sales(key, cursor, 500); } catch (e) {
      if (e.status === 403) { // la clé n'a pas l'accès « Ventes une par une » : on n'insiste pas
        await pool.query(`UPDATE reveal_api_state SET sales_enabled = false WHERE agency_id = $1`, [agencyId]);
        return 0;
      }
      throw e;
    }
    if (st.sales_enabled !== true) { await pool.query(`UPDATE reveal_api_state SET sales_enabled = true WHERE agency_id = $1`, [agencyId]); st.sales_enabled = true; }
    for (const item of r.data || []) {
      await applySale(agencyId, item, st);
      total++;
    }
    if (r.pageInfo?.endCursor) {
      cursor = r.pageInfo.endCursor;
      await pool.query(`UPDATE reveal_api_state SET sales_cursor = $2, last_sales_sync_at = NOW() WHERE agency_id = $1`, [agencyId, cursor]);
    }
    if (!r.pageInfo?.hasNextPage) break;
  }
  await pool.query(`UPDATE reveal_api_state SET last_sales_sync_at = NOW() WHERE agency_id = $1`, [agencyId]);
  return total;
}

async function applySale(agencyId, item, st) {
  const s = item.sale || {};
  if (!s.id) return;
  const refunded = item.event === 'sale_refunded';
  const { rows: prev } = await pool.query(`SELECT * FROM reveal_sales WHERE id = $1`, [s.id]);
  await pool.query(
    `INSERT INTO reveal_sales (id, agency_id, cursor, reveal_model_id, type, status, sale_created_at, refunded_at, amount_ttc, amount_ht,
       agency_revenue, model_revenue, net_amount, fan_member_id, fan_username, chatter_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
     ON CONFLICT (id) DO UPDATE SET cursor=$3, status=$6, refunded_at=COALESCE($8, reveal_sales.refunded_at), updated_at=NOW()`,
    [s.id, agencyId, item.cursor, s.modelId, s.type, refunded ? 'refunded' : s.status, s.createdAt || item.occurredAt, s.refundedAt || (refunded ? item.occurredAt : null),
     cents(s.amountTtc), cents(s.amountHt), cents(s.agencyRevenue), cents(s.modelRevenue), cents(s.netAmount),
     s.fan?.memberId || null, s.fan?.userName || null, s.chatterId || null]);
  const sale = (await pool.query(`SELECT * FROM reveal_sales WHERE id = $1`, [s.id])).rows[0];

  // Fan CRM (une erreur ici ne doit jamais bloquer le relevé des ventes)
  const { rows: mm } = await pool.query(`SELECT rm.crm_model_id, m.name FROM reveal_models rm LEFT JOIN models m ON m.id = rm.crm_model_id WHERE rm.reveal_model_id = $1`, [sale.reveal_model_id]);
  const crmModel = mm[0]?.crm_model_id;
  if (crmModel && sale.fan_username) try {
    const chatterUser = sale.chatter_id ? (await pool.query(`SELECT crm_user_id FROM reveal_chatters WHERE chatter_id = $1`, [sale.chatter_id])).rows[0]?.crm_user_id : null;
    if (!refunded && !sale.fan_crm_applied) {
      const fanId = await upsertFan(agencyId, crmModel, sale);
      await pool.query(`UPDATE fans SET total_spent = COALESCE(total_spent, 0) + $2, last_spent_at = GREATEST(COALESCE(last_spent_at, $3), $3) WHERE id = $1`,
        [fanId, (sale.amount_ttc || 0) / 100, sale.sale_created_at]);
      await pool.query(`INSERT INTO fan_interactions (fan_id, user_id, interaction_type, amount, content, created_at) VALUES ($1,$2,'purchase',$3,$4,$5)`,
        [fanId, chatterUser || null, (sale.amount_ttc || 0) / 100, `${SALE_TYPES_FR[sale.type] || sale.type} (Reveal)`, sale.sale_created_at]);
      await pool.query(`UPDATE reveal_sales SET fan_crm_applied = true WHERE id = $1`, [sale.id]);
    }
    if (refunded && sale.fan_crm_applied && !sale.refund_applied) {
      const fanId = await upsertFan(agencyId, crmModel, sale);
      await pool.query(`UPDATE fans SET total_spent = GREATEST(COALESCE(total_spent, 0) - $2, 0) WHERE id = $1`, [fanId, (sale.amount_ttc || 0) / 100]);
      await pool.query(`INSERT INTO fan_interactions (fan_id, user_id, interaction_type, amount, content, created_at) VALUES ($1,NULL,'refund',$2,$3,$4)`,
        [fanId, -(sale.amount_ttc || 0) / 100, `Remboursement ${SALE_TYPES_FR[sale.type] || sale.type} (Reveal)`, item.occurredAt]);
      await pool.query(`UPDATE reveal_sales SET refund_applied = true WHERE id = $1`, [sale.id]);
    }
  } catch (e) {
    console.error('[reveal-api] fan CRM', sale.id, e.message);
  }

  // Alerte WhatsApp pour les grosses ventes (seulement les ventes récentes, pas le rattrapage)
  const min = st.sale_alert_min != null ? Number(st.sale_alert_min) : null;
  const recent = Date.now() - new Date(item.occurredAt || sale.sale_created_at).getTime() < 30 * 60000;
  if (!refunded && !prev.length && min && st.backfilled && recent && (sale.amount_ttc || 0) >= min * 100) {
    const chat = sale.chatter_id ? (await pool.query(`SELECT first_name FROM reveal_chatters WHERE chatter_id = $1`, [sale.chatter_id])).rows[0]?.first_name : null;
    const rmName = mm[0]?.name || (await pool.query(`SELECT display_name FROM reveal_models WHERE reveal_model_id = $1`, [sale.reveal_model_id])).rows[0]?.display_name || '';
    await sendWhatsApp(`💰 Vente Reveal : ${(sale.amount_ttc / 100).toFixed(2).replace('.', ',')} € (${SALE_TYPES_FR[sale.type] || sale.type})\n👤 ${rmName}` +
      (sale.fan_username ? ` · fan ${sale.fan_username}` : '') + (chat ? `\n💬 chatteur : ${chat}` : ''), agencyId).catch(() => {});
  }
}

async function upsertFan(agencyId, modelId, sale) {
  // Un fan peut déjà exister pour cette modèle (ajouté à la main ou par une autre agence) : on le réutilise
  const { rows } = await pool.query(
    `SELECT id FROM fans WHERE model_id = $1 AND platform = 'reveal' AND LOWER(username) = LOWER($2) ORDER BY (username = $2) DESC, id LIMIT 1`,
    [modelId, sale.fan_username]);
  if (rows[0]) return rows[0].id;
  const ins = await pool.query(
    `INSERT INTO fans (agency_id, model_id, platform, username, display_name, total_spent, first_seen_at, notes)
     VALUES ($1,$2,'reveal',$3,$3,0,$4,'Ajouté automatiquement depuis Reveal')
     ON CONFLICT (model_id, platform, username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [agencyId, modelId, sale.fan_username, sale.sale_created_at]);
  return ins.rows[0].id;
}

// ---------- orchestration ----------
async function fullSync(agencyId, { force = false } = {}) {
  const key = await getKey(agencyId);
  if (!key) return { skipped: true };
  const { rows } = await pool.query(`SELECT backfilled FROM reveal_api_state WHERE agency_id = $1`, [agencyId]);
  const first = !rows[0]?.backfilled;
  const from = first ? parisDate(-30) : parisDate(-1);
  const to = parisDate(0);
  try {
    await syncDirectory(agencyId, key);
    await syncStats(agencyId, key, from, to);
    await syncChatterStats(agencyId, key, from, to);
    await syncTracking(agencyId, key, from, to);
    await updateObjectives(agencyId);
    await updateShifts(agencyId);
    await pool.query(`UPDATE reveal_api_state SET last_sync_at = NOW(), last_error = NULL, backfilled = true WHERE agency_id = $1`, [agencyId]);
    await syncSales(agencyId, key);
    return { ok: true, first };
  } catch (e) {
    await setError(agencyId, e);
    if (force) throw e;
    return { ok: false, error: e.message };
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(`SELECT agency_id, last_sync_at FROM reveal_api_state WHERE key_enc IS NOT NULL`);
    for (const r of rows) {
      const due = !r.last_sync_at || Date.now() - new Date(r.last_sync_at).getTime() > FULL_EVERY_MIN * 60000;
      if (due) { await fullSync(r.agency_id); continue; }
      try {
        const key = await getKey(r.agency_id);
        await syncSales(r.agency_id, key);
      } catch (e) { await setError(r.agency_id, e); }
    }
  } catch (e) {
    console.log('[REVEAL API] synchro :', e.message);
  } finally { running = false; }
}

function start() {
  setTimeout(tick, 20000);
  setInterval(tick, 60000);
}

module.exports = { start, tick, fullSync, saveKey, getKey, mapModel, autoMapModels, autoMapChatters, updateShifts, updateObjectives, parisDate };
