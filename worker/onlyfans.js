// Bot OnlyFans (lecture seule) : ouvre la page Statistiques > Revenus avec la session de la modèle et
// LIT les réponses que la page reçoit d'elle-même (revenus par type, soldes, profil). Il n'appelle rien
// directement et ne clique sur rien : OnlyFans signe ses propres requêtes, comme pour une personne.
// Passage toutes les ~6 h par modèle (avec un peu de hasard), jamais plusieurs modèles en même temps.
const pool = require('../db/pool');
const sessionLib = require('../services/autopost/session');
const of = require('../services/onlyfans/session');

const BASE = (process.env.OF_BASE || of.ORIGIN).replace(/\/$/, '');
const PAGE = BASE + '/my/statistics/statements/earnings';
const EVERY_H = Number(process.env.OF_EVERY_HOURS || 6);
class OfExpired extends Error {}

function due() {
  return pool.query(
    `SELECT * FROM of_accounts WHERE session_enc IS NOT NULL AND status <> 'expired'
       AND (status = 'unchecked' OR last_sync_at IS NULL OR last_sync_at < NOW() - make_interval(hours => $1) - make_interval(mins => (model_id * 7) % 50))
     ORDER BY last_sync_at NULLS FIRST LIMIT 3`, [EVERY_H]).then(r => r.rows);
}

async function readAccount(acc, { browserType, log }) {
  const sess = sessionLib.decrypt(acc.session_enc);
  const pw = of.toPlaywright(sess);
  const launch = { headless: process.env.AUTOPOST_HEADLESS !== 'false', args: ['--disable-blink-features=AutomationControlled'] };
  if (process.env.OF_PROXY || process.env.AUTOPOST_PROXY) launch.proxy = { server: process.env.OF_PROXY || process.env.AUTOPOST_PROXY };
  if (process.env.AUTOPOST_CHROMIUM_PATH) launch.executablePath = process.env.AUTOPOST_CHROMIUM_PATH;
  const browser = await browserType().launch(launch);
  const got = { charts: [], balances: null, me: null, tx: [], unauthorized: 0 };
  const known = new Set((await pool.query(`SELECT id FROM of_transactions WHERE model_id = $1 ORDER BY created_at DESC LIMIT 300`, [acc.model_id])).rows.map(r => r.id));
  try {
    const ctx = await browser.newContext({
      storageState: pw.storageState, locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 850 },
      ...(sess.ua ? { userAgent: sess.ua } : {}),
    });
    await ctx.addInitScript(pw.initScript);
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on('response', async r => {
      const u = r.url();
      if (!/\/api2\/v2\//.test(u)) return;
      if (r.status() === 401) { got.unauthorized++; return; }
      if (!r.ok()) return;
      try {
        if (/\/api2\/v2\/earnings\/chart/.test(u)) got.charts.push(await r.json());
        else if (/\/api2\/v2\/payouts\/balances/.test(u)) got.balances = await r.json();
        else if (/\/api2\/v2\/users\/me(\?|$)/.test(u)) got.me = await r.json();
        else { const j = await r.json(); const t = of.parseTransactions(j); if (t.length) got.tx.push(...t); }
      } catch (e) { /* réponse non JSON : on ignore */ }
    });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // on laisse la page charger ses statistiques (comme une personne qui regarde)
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      await page.waitForTimeout(1500);
      if (got.unauthorized >= 2 && !got.charts.length) break;
      if (got.charts.some(j => j && j.total) && got.balances && Date.now() - t0 > 8000) break;
    }
    await page.waitForTimeout(2000 + Math.random() * 3000);
    // la liste des ventes se charge en descendant : on fait défiler (lecture seule) jusqu'aux ventes déjà connues
    for (let i = 0; i < 8 && got.tx.length && !got.tx.some(t => known.has(t.id)); i++) {
      const n = got.tx.length;
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(2500 + Math.random() * 2000);
      if (got.tx.length === n) break;
    }
    const url = page.url();
    if (!got.charts.length && (got.unauthorized || !/\/my\//.test(url))) throw new OfExpired('OnlyFans ne reconnaît plus la session (page de connexion)');
    if (!got.charts.length) throw new Error('La page Statistiques d\'OnlyFans n\'a pas chargé les revenus (site lent ou changé)');
    // OnlyFans renouvelle ses cookies pendant la visite : on garde les nouveaux
    const st = await ctx.storageState();
    const host = new URL(BASE).hostname.replace(/^www\./, '');
    const cookies = (st.cookies || []).filter(c => String(c.domain).replace(/^\./, '').endsWith(host));
    if (cookies.some(c => c.name === 'sess')) {
      const og = (st.origins || []).find(o => o.origin === BASE) || {};
      const local = Object.fromEntries((og.localStorage || []).map(kv => [kv.name, kv.value]));
      const next = { ...sess, cookies, local: Object.keys(local).length ? local : sess.local, refreshedAt: new Date().toISOString() };
      await pool.query('UPDATE of_accounts SET session_enc = $2 WHERE model_id = $1', [acc.model_id, sessionLib.encrypt(next)]);
    }
    return got;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function saveData(acc, got) {
  const rows = got.charts.flatMap(of.parseChart);
  // une même journée peut revenir dans plusieurs réponses : on garde la dernière lue
  const seen = new Map();
  rows.forEach(r => seen.set(r.type + '|' + r.date, r));
  for (const r of seen.values()) {
    await pool.query(
      `INSERT INTO of_daily (model_id, date, type, net_cents, sales, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (model_id, date, type) DO UPDATE SET net_cents = $4, sales = $5, updated_at = NOW()`,
      [acc.model_id, r.date, r.type, r.net_cents, r.sales]);
  }
  for (const t of got.tx) {
    await pool.query(
      `INSERT INTO of_transactions (id, model_id, created_at, currency, amount_cents, vat_cents, net_cents, fee_cents, type, status, fan_id, fan_username, fan_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET status = $10, vat_cents = $6, fan_username = COALESCE($12, of_transactions.fan_username)`,
      [t.id, acc.model_id, t.created_at, t.currency, t.amount_cents, t.vat_cents, t.net_cents, t.fee_cents, t.type, t.status, t.fan_id, t.fan_username, t.fan_name]);
  }
  const currency = got.tx.find(t => t.currency)?.currency || null;
  if (currency) await pool.query(`UPDATE of_accounts SET currency = $2 WHERE model_id = $1`, [acc.model_id, currency]);
  const subs = of.findSubscribers(got.me);
  await pool.query(
    `UPDATE of_accounts SET status = 'ok', checked_at = NOW(), last_sync_at = NOW(), last_error = NULL,
       subscribers = COALESCE($2, subscribers), balances = COALESCE($3::jsonb, balances) WHERE model_id = $1`,
    [acc.model_id, subs, got.balances ? JSON.stringify(got.balances) : null]);
  return { days: seen.size, subs, tx: got.tx.length };
}

async function ofSync({ browserType, notify, log, stopping = () => false }) {
  for (const acc of await due()) {
    if (stopping()) return;
    const name = (await pool.query('SELECT name FROM models WHERE id = $1', [acc.model_id])).rows[0]?.name || 'une modèle';
    try {
      const got = await readAccount(acc, { browserType, log });
      const r = await saveData(acc, got);
      log(`🔵 OnlyFans ${name} : ${r.days} jours×types, ${r.tx} ventes relevées`);
    } catch (e) {
      if (e instanceof OfExpired) {
        await pool.query(`UPDATE of_accounts SET status = 'expired', checked_at = NOW(), last_error = $2, last_error_at = NOW() WHERE model_id = $1`, [acc.model_id, e.message]);
        if (acc.status !== 'expired') {
          await notify(acc.agency_id, 'whatsapp_failures', acc.status === 'unchecked'
            ? `🔑 OnlyFans (${name}) : la session que tu viens de coller ne marche pas. Recopie-la depuis onlyfans.com puis recolle-la dans le CRM (Stats OnlyFans > Connexion).`
            : `🔑 OnlyFans (${name}) : le CRM a été déconnecté du compte. Les stats OnlyFans ne se mettent plus à jour : reconnecte-le dans le CRM (Stats OnlyFans > Connexion).`);
        }
        log(`🔑 OnlyFans ${name} : session expirée`);
      } else {
        await pool.query(`UPDATE of_accounts SET checked_at = NOW(), last_sync_at = NOW(), last_error = $2, last_error_at = NOW() WHERE model_id = $1`, [acc.model_id, String(e.message).slice(0, 400)]);
        log(`OnlyFans ${name} :`, e.message);
      }
    }
  }
}

module.exports = { ofSync, readAccount, saveData, OfExpired };
