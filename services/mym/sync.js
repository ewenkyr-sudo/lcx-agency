// Synchro MyM par session (une par modèle) : le CRM lit les pages du compte créatrice comme un navigateur.
//  - la connexion MyM = jetons Amazon Cognito dans des cookies, copiés avec un favori
//  - le jeton d'accès dure 1 h : le CRM le renouvelle tout seul avec le jeton de renouvellement
//  - toutes les 30 min : abonnés, revenus (jour par jour + mois + soldes), transactions récentes
const pool = require('../../db/pool');
const parse = require('./parse');
const { encrypt, decrypt } = require('../autopost/session');

let sendWhatsApp = async () => {};
try { ({ sendWhatsApp } = require('../whatsapp')); } catch (e) { /* optionnel */ }

const BASE = (process.env.MYM_BASE || 'https://creators.mym.fans').replace(/\/$/, '');
const EVERY_MIN = 30;
const BACKFILL_DAYS = 35;   // 1re synchro : transactions des 35 derniers jours (le CA, lui, vient du graphique depuis la création)
const MAX_PAGES = 400;
const PAGE_GAP_MS = Number(process.env.MYM_PAGE_GAP_MS || 700);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class SessionExpired extends Error {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COG = /^CognitoIdentityServiceProvider\.([^.]+)\.(.+)\.(idToken|accessToken|refreshToken)$/;

// ---------- session ----------
// accepte l'export du favori {v, site:'mym', cookies:'a=b; c=d', ua} ou directement la chaîne document.cookie
function normalize(input) {
  let o = input;
  if (typeof o === 'string') { const t = o.trim(); try { o = JSON.parse(t); } catch (e) { o = { cookies: t }; } }
  if (!o || typeof o !== 'object' || typeof o.cookies !== 'string') throw new Error('Export illisible : relance le favori « Session MyM » sur creators.mym.fans');
  if (o.site && o.site !== 'mym') throw new Error('Cet export ne vient pas de MyM');
  const cookies = {};
  o.cookies.split(';').map(s => s.trim()).filter(Boolean).forEach(s => { const i = s.indexOf('='); if (i > 0) cookies[s.slice(0, i)] = s.slice(i + 1); });
  const names = Object.keys(cookies);
  if (!names.some(n => /\.refreshToken$/.test(n) && COG.test(n))) throw new Error('Pas de connexion MyM dans cet export. Ouvre creators.mym.fans en étant connectée au compte de la modèle, puis clique sur le favori.');
  return { cookies, ua: typeof o.ua === 'string' ? o.ua.slice(0, 300) : UA, savedAt: new Date().toISOString() };
}

function cognitoInfo(sess) {
  const names = Object.keys(sess.cookies);
  const rt = names.find(n => /\.refreshToken$/.test(n) && COG.test(n));
  const [, clientId, user] = rt.match(COG);
  const pre = `CognitoIdentityServiceProvider.${clientId}.${user}`;
  return { clientId, pre, refresh: decodeURIComponent(sess.cookies[pre + '.refreshToken'] || '') };
}
function jwtPayload(t) {
  try { return JSON.parse(Buffer.from(String(decodeURIComponent(t || '')).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; }
}
function cognitoUrl(sess) {
  if (process.env.MYM_COGNITO_URL) return process.env.MYM_COGNITO_URL;
  const { pre } = cognitoInfo(sess);
  const iss = jwtPayload(sess.cookies[pre + '.idToken'])?.iss || '';
  const region = (iss.match(/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com/) || [])[1] || 'eu-west-3';
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

// renouvelle les jetons s'il reste moins de 10 min (renvoie true si la session a changé)
async function refreshIfNeeded(sess, force = false) {
  const { clientId, pre, refresh } = cognitoInfo(sess);
  const exp = jwtPayload(sess.cookies[pre + '.accessToken'])?.exp || 0;
  if (!force && exp * 1000 - Date.now() > 10 * 60000) return false;
  const r = await fetch(cognitoUrl(sess), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId, AuthParameters: { REFRESH_TOKEN: refresh } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (/NotAuthorized|InvalidParameter|UserNotFound|PasswordResetRequired/i.test(j.__type || '')) throw new SessionExpired('MyM a refusé de renouveler la connexion (session expirée ou déconnectée)');
    throw new Error('Renouvellement MyM impossible (' + r.status + ')');
  }
  const a = j.AuthenticationResult || {};
  if (!a.AccessToken || !a.IdToken) throw new Error('Réponse de renouvellement MyM incomplète');
  sess.cookies[pre + '.accessToken'] = a.AccessToken;
  sess.cookies[pre + '.idToken'] = a.IdToken;
  if (a.RefreshToken) sess.cookies[pre + '.refreshToken'] = a.RefreshToken;
  sess.refreshedAt = new Date().toISOString();
  return true;
}

async function get(sess, path) {
  const r = await fetch(BASE + path, {
    headers: {
      Cookie: Object.entries(sess.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      'User-Agent': sess.ua || UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'fr-FR,fr;q=0.9',
      ...(path.includes('income-fetch') ? { 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + '/app/incomes' } : {}),
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  if (r.status >= 300 && r.status < 400) {
    if (/login|connexion/i.test(r.headers.get('location') || '')) throw new SessionExpired('MyM renvoie vers la page de connexion');
    throw new Error(`MyM a redirigé ${path} (${r.status})`);
  }
  if (r.status === 401 || r.status === 403) throw new SessionExpired('MyM refuse la session (' + r.status + ')');
  if (!r.ok) throw new Error(`MyM ${path} : erreur ${r.status}`);
  const html = await r.text();
  if (parse.isLoginPage(html)) throw new SessionExpired('MyM affiche la page de connexion');
  return html;
}

// ---------- base ----------
async function saveSession(agencyId, modelId, exportText) {
  const sess = normalize(exportText);
  await pool.query(
    `INSERT INTO mym_accounts (model_id, agency_id, session_enc, status, last_error) VALUES ($1,$2,$3,'unchecked',NULL)
     ON CONFLICT (model_id) DO UPDATE SET agency_id = $2, session_enc = $3, status = 'unchecked', last_error = NULL`,
    [modelId, agencyId, encrypt(sess)]);
}

async function markExpired(acc, reason) {
  const was = acc.status;
  await pool.query(`UPDATE mym_accounts SET status = 'expired', checked_at = NOW(), last_error = $2, last_error_at = NOW() WHERE model_id = $1`, [acc.model_id, reason]);
  if (was !== 'expired') {
    const name = (await pool.query('SELECT name FROM models WHERE id = $1', [acc.model_id])).rows[0]?.name || 'une modèle';
    await sendWhatsApp(was === 'unchecked'
      ? `🔑 MyM (${name}) : la session que tu viens de coller ne marche pas. Relance le favori « Session MyM » sur creators.mym.fans puis recolle-la dans le CRM (Stats MyM > Réglages).`
      : `🔑 MyM (${name}) : le CRM a été déconnecté du compte. Les stats MyM ne se mettent plus à jour : reconnecte-le dans le CRM (Stats MyM > Réglages).`, acc.agency_id).catch(() => {});
  }
}

async function upsertTx(acc, t) {
  await pool.query(
    `INSERT INTO mym_transactions (id, agency_id, model_id, type, amount_cents, at, status, fan_id, fan_username, order_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET status = $7, amount_cents = $5, fan_username = COALESCE($9, mym_transactions.fan_username)`,
    [t.id, acc.agency_id, acc.model_id, t.type, t.amount_cents, t.at, t.status, t.fan_id, t.fan_username, t.order_no]);
}

// ---------- synchro d'un compte ----------
async function syncAccount(acc) {
  let sess = decrypt(acc.session_enc);
  let changed = false;
  const save = async () => { await pool.query('UPDATE mym_accounts SET session_enc = $2 WHERE model_id = $1', [acc.model_id, encrypt(sess)]); changed = false; };
  try {
    changed = await refreshIfNeeded(sess);
    if (changed) await save();

    let profile;
    try { profile = await get(sess, '/app/profile'); }
    catch (e) { // jeton refusé alors qu'il n'était pas expiré : un renouvellement forcé, puis on réessaie
      if (!(e instanceof SessionExpired)) throw e;
      await refreshIfNeeded(sess, true); await save();
      profile = await get(sess, '/app/profile');
    }
    const { subscribers } = parse.parseProfile(profile);
    const incomes = await get(sess, '/app/incomes');
    const inc = parse.parseIncomes(incomes);
    if (inc.total_cents == null && !inc.daily.length) throw new Error('Page Revenus MyM illisible (MyM a peut-être changé sa page)');

    for (const d of inc.daily) {
      await pool.query(`INSERT INTO mym_daily (model_id, date, net_cents) VALUES ($1,$2,$3) ON CONFLICT (model_id, date) DO UPDATE SET net_cents = $3`, [acc.model_id, d.date, d.net_cents]);
    }
    if (subscribers != null) {
      await pool.query(`INSERT INTO mym_subs_snap (model_id, date, subscribers) VALUES ($1, (NOW() AT TIME ZONE 'Europe/Paris')::date, $2)
        ON CONFLICT (model_id, date) DO UPDATE SET subscribers = $2`, [acc.model_id, subscribers]);
    }

    // transactions : page 1 dans la page Revenus, puis /app/income-fetch?page=2, 3, …
    const known = new Set((await pool.query(`SELECT id::text FROM mym_transactions WHERE model_id = $1 AND at > NOW() - INTERVAL '90 days'`, [acc.model_id])).rows.map(r => r.id));
    const cutoff = Date.now() - BACKFILL_DAYS * 86400000;
    let list = parse.parseTransactions(incomes);
    for (let page = 1; page <= MAX_PAGES && list.length; page++) {
      for (const t of list) await upsertTx(acc, t);
      const allKnown = list.every(t => known.has(t.id));
      const oldest = Math.min(...list.map(t => new Date(t.at).getTime()).filter(Number.isFinite));
      if (acc.tx_backfilled ? allKnown : oldest < cutoff) break;
      await sleep(PAGE_GAP_MS);
      list = parse.parseTransactions(await get(sess, '/app/income-fetch?page=' + (page + 1)));
    }

    await pool.query(
      `UPDATE mym_accounts SET status = 'ok', checked_at = NOW(), last_sync_at = NOW(), last_error = NULL, tx_backfilled = true,
         subscribers = COALESCE($2, subscribers), total_cents = $3, pending_cents = $4, validated_cents = $5, next_payout = $6, monthly = $7::jsonb
       WHERE model_id = $1`,
      [acc.model_id, subscribers, inc.total_cents, inc.pending_cents, inc.validated_cents, inc.next_payout, JSON.stringify(inc.monthly)]);

    // page SFS : abonnés MyM + nouveaux abonnés sur 30 jours, remplis tout seuls
    const n30 = (await pool.query(`SELECT COUNT(*)::int n FROM mym_transactions WHERE model_id = $1 AND type ILIKE 'abonnement%' AND at > NOW() - INTERVAL '30 days'`, [acc.model_id])).rows[0].n;
    await pool.query(
      `INSERT INTO model_platform_subs (model_id, platform, subscribers, new_subs_30, updated_at) VALUES ($1, 'mym', $2, $3, NOW())
       ON CONFLICT (model_id, platform) DO UPDATE SET subscribers = COALESCE($2, model_platform_subs.subscribers), new_subs_30 = $3, updated_at = NOW()`,
      [acc.model_id, subscribers, n30]).catch(() => {});
    return { ok: true, subscribers, days: inc.daily.length };
  } catch (e) {
    if (changed) await save().catch(() => {});
    if (e instanceof SessionExpired) { await markExpired(acc, e.message); return { ok: false, expired: true, error: e.message }; }
    await pool.query(`UPDATE mym_accounts SET checked_at = NOW(), last_error = $2, last_error_at = NOW() WHERE model_id = $1`, [acc.model_id, String(e.message).slice(0, 400)]);
    return { ok: false, error: e.message };
  }
}

async function syncModel(modelId) {
  const acc = (await pool.query('SELECT * FROM mym_accounts WHERE model_id = $1', [modelId])).rows[0];
  if (!acc?.session_enc) return { ok: false, error: 'Pas de session MyM pour cette modèle' };
  return syncAccount(acc);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mym_accounts WHERE session_enc IS NOT NULL AND status <> 'expired'
         AND (status = 'unchecked' OR last_sync_at IS NULL OR last_sync_at < NOW() - make_interval(mins => $1))`, [EVERY_MIN]);
    for (const acc of rows) await syncAccount(acc);
  } catch (e) {
    console.log('[MYM] synchro :', e.message);
  } finally { running = false; }
}
function start() { setTimeout(tick, 30000); setInterval(tick, 60000); }

// favori à glisser dans la barre de favoris (copie la connexion MyM dans le presse-papier)
const BOOKMARKLET = "javascript:(()=>{if(!/(^|\\.)mym\\.fans$/.test(location.hostname)){alert('Ouvre creators.mym.fans d\\'abord');return}const d={v:1,site:'mym',cookies:document.cookie,ua:navigator.userAgent};if(!/CognitoIdentityServiceProvider\\..+\\.refreshToken=/.test(d.cookies)){alert('Connecte-toi d\\'abord au compte MyM de la modèle');return}const t=JSON.stringify(d);navigator.clipboard.writeText(t).then(()=>alert('Session MyM copiée ✅ Colle-la dans le CRM (Stats MyM > Réglages).'),()=>prompt('Copie ce texte :',t))})()";

module.exports = { start, tick, syncModel, syncAccount, saveSession, normalize, refreshIfNeeded, BOOKMARKLET, SessionExpired };
