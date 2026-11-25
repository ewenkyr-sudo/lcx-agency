// Synchronisation Wysper (Telegram) -> CRM.
//  - en temps réel : événements signés (paiement, remboursement, litige, nouveau contact)
//  - toutes les 5 min : comptes, paiements et conversations modifiés depuis le dernier passage
//    (rattrape aussi les événements qui n'auraient pas été reçus)
//  - 1re connexion : tout l'historique
const crypto = require('crypto');
const pool = require('../../db/pool');
const api = require('./client');
const { encrypt, decrypt } = require('../autopost/session');

let sendWhatsApp = async () => {};
try { ({ sendWhatsApp } = require('../whatsapp')); } catch (e) { /* optionnel */ }

const EVERY_MIN = 5;
const HISTORY_START = '2020-01-01T00:00:00Z';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const eur = c => ((Number(c) || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

// ---------- clés ----------
async function state(agencyId) {
  return (await pool.query('SELECT * FROM wysper_state WHERE agency_id = $1', [agencyId])).rows[0] || null;
}
async function getKey(agencyId) {
  const st = await state(agencyId);
  return st?.key_enc ? decrypt(st.key_enc).key : null;
}

async function ensureState(agencyId) {
  await pool.query(`INSERT INTO wysper_state (agency_id, webhook_token) VALUES ($1, $2) ON CONFLICT (agency_id) DO NOTHING`,
    [agencyId, crypto.randomBytes(24).toString('hex')]);
  await pool.query(`UPDATE wysper_state SET webhook_token = $2 WHERE agency_id = $1 AND webhook_token IS NULL`, [agencyId, crypto.randomBytes(24).toString('hex')]);
  return state(agencyId);
}

async function saveKey(agencyId, key) {
  key = String(key || '').trim();
  if (!/^wsk_live_[A-Za-z0-9]{16,64}$/.test(key)) throw Object.assign(new Error('Ce n\'est pas une clé Wysper (elle commence par wsk_live_)'), { status: 400 });
  try { await api.accounts(key); } catch (e) {
    throw Object.assign(new Error(e.status === 401 ? 'Wysper refuse cette clé (révoquée ou mal copiée)' : e.message), { status: 400 });
  }
  await ensureState(agencyId);
  await pool.query(`UPDATE wysper_state SET key_enc = $2, key_last4 = $3, connected_at = NOW(), last_error = NULL WHERE agency_id = $1`,
    [agencyId, encrypt({ key }), key.slice(-4)]);
}

async function saveSecret(agencyId, secret) {
  secret = String(secret || '').trim();
  if (!/^whsec_[0-9a-f]{64}$/i.test(secret)) throw Object.assign(new Error('Ce n\'est pas un secret de signature Wysper (whsec_ suivi de 64 caractères)'), { status: 400 });
  await ensureState(agencyId);
  await pool.query(`UPDATE wysper_state SET secret_enc = $2 WHERE agency_id = $1`, [agencyId, encrypt({ secret })]);
}

async function setError(agencyId, err) {
  const msg = String(err.message || err).slice(0, 500);
  const prev = (await state(agencyId))?.last_error;
  await pool.query(`UPDATE wysper_state SET last_error = $2, last_error_at = NOW() WHERE agency_id = $1`, [agencyId, msg]);
  if (err.status === 401 && prev !== msg) await sendWhatsApp(`🔑 API Wysper (Telegram) : ${msg}\n👉 CRM > Stats Telegram > Réglages.`, agencyId).catch(() => {});
}

// ---------- comptes ----------
async function syncAccounts(agencyId, key) {
  const r = await api.accounts(key);
  for (const a of r.data || []) {
    await pool.query(
      `INSERT INTO wysper_accounts (agency_id, telegram_id, name, status, currency, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (agency_id, telegram_id) DO UPDATE SET name = $3, status = $4, currency = $5, updated_at = NOW()`,
      [agencyId, a.telegram_id, a.name, a.status, a.currency]);
  }
  await autoMapAccounts(agencyId);
}

// relie un compte Telegram à la modèle du CRM qui porte le même prénom
async function autoMapAccounts(agencyId) {
  const accs = (await pool.query(`SELECT telegram_id, name FROM wysper_accounts WHERE agency_id = $1 AND crm_model_id IS NULL`, [agencyId])).rows;
  if (!accs.length) return;
  const models = (await pool.query(`SELECT id, name FROM models WHERE agency_id = $1 OR agency_id IS NULL`, [agencyId])).rows;
  for (const a of accs) {
    const n = norm(a.name);
    const exact = models.filter(m => norm(m.name) && n === norm(m.name));
    const hit = exact.length ? exact : models.filter(m => norm(m.name) && (n.startsWith(norm(m.name)) || norm(m.name).startsWith(n)));
    if (hit.length === 1) await pool.query(`UPDATE wysper_accounts SET crm_model_id = $3 WHERE agency_id = $1 AND telegram_id = $2`, [agencyId, a.telegram_id, hit[0].id]);
  }
}

// ---------- paiements ----------
// garde la version la plus récente d'un paiement (les événements peuvent arriver dans le désordre)
async function upsertPayment(agencyId, p, { live = false } = {}) {
  const src = p.buyer?.source || null;
  const { rows } = await pool.query(
    `INSERT INTO wysper_payments (payment_id, agency_id, account_tid, account_name, status, type, paid_at, updated_at, currency,
       price_cents, gross_cents, net_cents, refund_cents, buyer_tid, buyer_username, buyer_first, sent_by_id, sent_by_name, source_link, source_channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (payment_id) DO UPDATE SET status = $5, updated_at = $8, gross_cents = $11, net_cents = $12, refund_cents = $13,
       account_name = $4, buyer_username = COALESCE($15, wysper_payments.buyer_username), sent_by_name = COALESCE($18, wysper_payments.sent_by_name)
     WHERE wysper_payments.updated_at IS NULL OR wysper_payments.updated_at <= EXCLUDED.updated_at
     RETURNING (xmax = 0) AS inserted, alerted`,
    [p.payment_id, agencyId, p.account?.telegram_id ?? null, p.account?.name ?? null, p.status, p.type, p.paid_at, p.updated_at || p.paid_at, p.currency,
     p.price_cents ?? null, p.amount_gross_cents ?? null, p.amount_net_cents ?? null, p.refund?.amount_cents ?? null,
     p.buyer?.telegram_id ?? null, p.buyer?.telegram_username ?? null, p.buyer?.is_first_payment ?? null,
     p.sent_by?.user_id ?? null, p.sent_by?.name ?? null, src?.link?.name ?? null, src?.channel?.title ?? null]);
  if (!rows[0]) return; // version plus ancienne que celle déjà en base
  await updateFan(agencyId, p).catch(e => console.log('[WYSPER] Fan CRM :', e.message));
  if (live && p.status === 'paid' && !rows[0].alerted) await maybeAlert(agencyId, p);
}

// Fan CRM : Wysper donne directement le total dépensé par l'acheteur
async function updateFan(agencyId, p) {
  if (!p.buyer?.telegram_id || !p.account?.telegram_id) return;
  const acc = (await pool.query(`SELECT crm_model_id FROM wysper_accounts WHERE agency_id = $1 AND telegram_id = $2`, [agencyId, p.account.telegram_id])).rows[0];
  if (!acc?.crm_model_id) return;
  const username = p.buyer.telegram_username || 'tg:' + p.buyer.telegram_id;
  const total = (Number(p.buyer.total_spent_cents) || 0) / 100;
  const f = (await pool.query(
    `SELECT id FROM fans WHERE model_id = $1 AND platform = 'telegram' AND (LOWER(username) = LOWER($2) OR username = $3) ORDER BY id LIMIT 1`,
    [acc.crm_model_id, username, 'tg:' + p.buyer.telegram_id])).rows[0];
  if (f) {
    await pool.query(`UPDATE fans SET username = $2, total_spent = $3, last_spent_at = GREATEST(COALESCE(last_spent_at, $4), $4) WHERE id = $1`, [f.id, username, total, p.paid_at]);
  } else {
    await pool.query(
      `INSERT INTO fans (agency_id, model_id, platform, username, display_name, total_spent, first_seen_at, last_spent_at, notes)
       VALUES ($1, $2, 'telegram', $3, $4, $5, $6, $6, 'Ajouté automatiquement depuis Wysper (Telegram)')`,
      [agencyId, acc.crm_model_id, username, p.buyer.telegram_username || null, total, p.paid_at]);
  }
}

async function maybeAlert(agencyId, p) {
  const st = await state(agencyId);
  const min = st?.sale_alert_min != null ? Number(st.sale_alert_min) : null;
  if (!min || !st.backfilled || (Number(p.amount_gross_cents) || 0) < min * 100) return;
  if (Date.now() - new Date(p.paid_at).getTime() > 6 * 3600000) return; // pas d'alerte pour une vieille vente rattrapée
  const { rowCount } = await pool.query(`UPDATE wysper_payments SET alerted = true WHERE payment_id = $1 AND NOT alerted`, [p.payment_id]);
  if (!rowCount) return;
  const who = p.buyer?.telegram_username ? '@' + p.buyer.telegram_username : 'un fan';
  await sendWhatsApp(`💸 Telegram — ${p.account?.name || 'compte'} : ${eur(p.amount_gross_cents)} de ${who}`
    + (p.buyer?.is_first_payment ? ' (1er achat 🆕)' : ` (${p.buyer?.payments_count || '?'} achats, ${eur(p.buyer?.total_spent_cents)} au total)`)
    + (p.sent_by?.name ? `\n👤 envoyé par ${p.sent_by.name}` : ''), agencyId).catch(() => {});
}

async function syncPayments(agencyId, key) {
  const st = await state(agencyId);
  const since = st?.payments_since ? new Date(st.payments_since).toISOString() : HISTORY_START;
  let max = st?.payments_since ? new Date(st.payments_since) : null;
  for await (const list of api.pages(key, '/payments', { since })) {
    for (const p of list) {
      await upsertPayment(agencyId, p, { live: !!st?.backfilled });
      const u = new Date(p.updated_at || p.paid_at);
      if (!max || u > max) max = u;
    }
  }
  if (max) await pool.query(`UPDATE wysper_state SET payments_since = $2 WHERE agency_id = $1`, [agencyId, max]);
}

// ---------- conversations (nouveaux contacts) ----------
async function upsertConversation(agencyId, c) {
  const src = c.source || null;
  await pool.query(
    `INSERT INTO wysper_conversations (agency_id, account_tid, fan_tid, fan_username, first_message_at, first_reply_at, source_link, source_channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (agency_id, account_tid, fan_tid) DO UPDATE SET fan_username = COALESCE($4, wysper_conversations.fan_username),
       first_reply_at = COALESCE($6, wysper_conversations.first_reply_at), source_link = COALESCE($7, wysper_conversations.source_link),
       source_channel = COALESCE($8, wysper_conversations.source_channel)`,
    [agencyId, c.account?.telegram_id, c.fan?.telegram_id, c.fan?.telegram_username ?? null, c.first_message_at, c.first_reply_at ?? null,
     src?.link?.name ?? null, src?.channel?.title ?? null]);
}

async function syncConversations(agencyId, key) {
  const st = await state(agencyId);
  const since = st?.conversations_since ? new Date(new Date(st.conversations_since).getTime() - 3600000).toISOString() : HISTORY_START;
  let max = st?.conversations_since ? new Date(st.conversations_since) : null;
  for await (const list of api.pages(key, '/conversations', { since })) {
    for (const c of list) {
      if (!c.account?.telegram_id || !c.fan?.telegram_id) continue;
      await upsertConversation(agencyId, c);
      const u = new Date(c.first_message_at);
      if (!max || u > max) max = u;
    }
  }
  if (max) await pool.query(`UPDATE wysper_state SET conversations_since = $2 WHERE agency_id = $1`, [agencyId, max]);
}

// ---------- webhook ----------
// vérifie la signature « v1=<hex> » (HMAC-SHA256 de « timestamp.corps brut »)
function verifySignature(secret, timestamp, rawBody, header) {
  if (!secret || !timestamp || !header) return false;
  if (!/^\d+$/.test(String(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + '.').update(rawBody).digest('hex');
  return String(header).split(',').map(s => s.trim()).some(sig => {
    const m = /^v1=([0-9a-f]{64})$/i.exec(sig);
    if (!m) return false;
    const a = Buffer.from(m[1].toLowerCase(), 'hex'), b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// renvoie le code HTTP à répondre
async function handleWebhook(token, headers, rawBody) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return 404;
  const st = (await pool.query('SELECT * FROM wysper_state WHERE webhook_token = $1', [token])).rows[0];
  if (!st) return 404;
  if (!st.secret_enc) return 401;
  const secret = decrypt(st.secret_enc).secret;
  if (!verifySignature(secret, headers['x-wysper-timestamp'], rawBody, headers['x-wysper-signature'])) return 401;
  let evt;
  try { evt = JSON.parse(rawBody.toString('utf8')); } catch (e) { return 400; }
  if (!evt?.id || !evt.type) return 400;
  await pool.query(`UPDATE wysper_state SET last_event_at = NOW(), last_event_type = $2 WHERE agency_id = $1`,
    [st.agency_id, evt.livemode === false ? evt.type + ' (test)' : evt.type]);
  if (evt.livemode === false) return 200; // événement de test : on note juste qu'il est arrivé
  const { rowCount } = await pool.query(`INSERT INTO wysper_events (id, agency_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [evt.id, st.agency_id, evt.type]);
  if (!rowCount) return 200; // déjà traité (Wysper peut renvoyer le même événement)
  try {
    if (String(evt.type).startsWith('payment.')) await upsertPayment(st.agency_id, evt.data || {}, { live: true });
    else if (evt.type === 'conversation.started') await upsertConversation(st.agency_id, evt.data || {});
  } catch (e) {
    await pool.query(`DELETE FROM wysper_events WHERE id = $1`, [evt.id]); // Wysper réessaiera
    throw e;
  }
  return 200;
}

// ---------- orchestration ----------
async function fullSync(agencyId, { force = false } = {}) {
  const key = await getKey(agencyId);
  if (!key) return { skipped: true };
  const first = !(await state(agencyId))?.backfilled;
  try {
    await syncAccounts(agencyId, key);
    await syncPayments(agencyId, key);
    await syncConversations(agencyId, key);
    await pool.query(`UPDATE wysper_state SET last_sync_at = NOW(), last_error = NULL, backfilled = true WHERE agency_id = $1`, [agencyId]);
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
    const { rows } = await pool.query(`SELECT agency_id, last_sync_at FROM wysper_state WHERE key_enc IS NOT NULL`);
    for (const r of rows) {
      if (!r.last_sync_at || Date.now() - new Date(r.last_sync_at).getTime() > EVERY_MIN * 60000) await fullSync(r.agency_id);
    }
  } catch (e) {
    console.log('[WYSPER] synchro :', e.message);
  } finally { running = false; }
}

function start() {
  setTimeout(tick, 25000);
  setInterval(tick, 60000);
}

module.exports = { start, tick, fullSync, saveKey, saveSecret, getKey, ensureState, state, handleWebhook, verifySignature, autoMapAccounts, upsertPayment };
