// ============ WORKER AUTO-POST REVEAL ============
// Service séparé (Render "Background Worker", image Docker Playwright).
// Il partage la base de données du CRM : il planifie, publie, collecte les stats et envoie les rapports.
//   node worker/index.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { initAutopostDB, apLog } = require('../db/autopost-schema');
const storage = require('../services/autopost/storage');
const sessionLib = require('../services/autopost/session');
const planner = require('../services/autopost/planner');
const { generateReport } = require('../services/autopost/analysis');
const reveal = require('./reveal');

let sendWhatsApp = async () => {};
try { ({ sendWhatsApp } = require('../services/whatsapp')); } catch (e) { /* optionnel */ }

const WORKER_ID = process.env.AUTOPOST_WORKER_ID || `worker-${os.hostname()}`;
const TICK_MS = 20000;
const MAX_LATE_MIN = 120;      // créneau raté depuis plus de 2 h -> sauté
const MAX_ATTEMPTS = 2;
const TMP = path.join(os.tmpdir(), 'autopost');
fs.mkdirSync(TMP, { recursive: true });

let chromium;
function browserType() {
  if (!chromium) ({ chromium } = require('playwright'));
  return chromium;
}

const state = { lastPlan: 0, lastStatsDay: null, lastReportWeek: null, lastStockAlertDay: {}, busy: false };

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }

async function heartbeat(status, info) {
  await pool.query(
    `INSERT INTO autopost_worker (id, last_seen, status, info) VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_seen = NOW(), status = $2, info = $3`,
    [WORKER_ID, status, JSON.stringify(info || {})]);
}

async function notify(agencyId, kindFlag, msg) {
  try {
    const { rows } = await pool.query(`SELECT ${kindFlag} AS on FROM autopost_agency WHERE agency_id = $1`, [agencyId]);
    if (rows[0]?.on === false) return;
    await sendWhatsApp(msg, agencyId);
  } catch (e) { log('WhatsApp KO', e.message); }
}

// ---------- navigateur ----------
async function withBrowser(agencyId, fn) {
  const { rows } = await pool.query('SELECT session_enc FROM autopost_agency WHERE agency_id = $1', [agencyId]);
  if (!rows[0]?.session_enc) throw new reveal.SessionExpired('Pas de connexion Reveal : colle la session du compte agence dans le CRM (Auto-post > Connexion)');
  const sess = sessionLib.decrypt(rows[0].session_enc);
  const origin = new URL(reveal.BASE).origin;
  const pw = sessionLib.toPlaywright(sess, origin);
  const launch = { headless: process.env.AUTOPOST_HEADLESS !== 'false', args: ['--disable-blink-features=AutomationControlled'] };
  if (process.env.AUTOPOST_PROXY) launch.proxy = { server: process.env.AUTOPOST_PROXY };
  if (process.env.AUTOPOST_CHROMIUM_PATH) launch.executablePath = process.env.AUTOPOST_CHROMIUM_PATH;
  const browser = await browserType().launch(launch);
  try {
    const ctx = await browser.newContext({
      storageState: pw.storageState, locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 850 },
    });
    await ctx.addInitScript(pw.initScript);
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function markSession(agencyId, status) {
  await pool.query('UPDATE autopost_agency SET session_status = $1, session_checked_at = NOW() WHERE agency_id = $2', [status, agencyId]);
}

// ---------- publication d'un créneau ----------
async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT j.* FROM autopost_jobs j
       LEFT JOIN autopost_agency a ON a.agency_id = j.agency_id
       WHERE j.status = 'pending' AND j.scheduled_at <= NOW() AND COALESCE(a.paused, false) = false
         AND COALESCE(a.session_status, 'missing') NOT IN ('missing', 'expired')
       ORDER BY j.scheduled_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
    const job = rows[0];
    if (!job) { await client.query('ROLLBACK'); return null; }
    const settings = (await client.query('SELECT * FROM autopost_settings WHERE model_id = $1', [job.model_id])).rows[0] || {};
    const agency = (await client.query('SELECT * FROM autopost_agency WHERE agency_id = $1', [job.agency_id])).rows[0] || {};

    if (Date.now() - new Date(job.scheduled_at).getTime() > MAX_LATE_MIN * 60000) {
      await client.query(`UPDATE autopost_jobs SET status = 'skipped', error = $2, done_at = NOW() WHERE id = $1`,
        [job.id, 'Créneau trop ancien (le bot était arrêté ?)']);
      await client.query('COMMIT');
      return { skipped: true };
    }
    if (!settings.reveal_model_id) {
      await client.query(`UPDATE autopost_jobs SET status = 'failed', error = $2, done_at = NOW() WHERE id = $1`, [job.id, 'Identifiant Reveal manquant']);
      await client.query('COMMIT');
      return { skipped: true };
    }
    let media = job.media_id ? (await client.query('SELECT * FROM autopost_media WHERE id = $1', [job.media_id])).rows[0] : null;
    let isRotation = job.is_rotation;
    if (!media) {
      const picked = await planner.pickMedia(client, job, settings);
      if (!picked) {
        await client.query(`UPDATE autopost_jobs SET status = 'skipped', error = $2, done_at = NOW() WHERE id = $1`,
          [job.id, `Plus de contenu dispo (${job.kind})`]);
        await client.query('COMMIT');
        return { skipped: true, noStock: true, job };
      }
      media = picked.media; isRotation = picked.isRotation;
    }
    const { rows: lastCap } = await client.query(
      `SELECT caption FROM autopost_jobs WHERE media_id = $1 AND status = 'done' ORDER BY done_at DESC LIMIT 1`, [media.id]);
    const caption = job.caption != null ? job.caption : await planner.pickCaption(media, settings, agency, job.kind, lastCap[0]?.caption);
    await client.query(
      `UPDATE autopost_jobs SET status = 'running', media_id = $2, is_rotation = $3, caption = $4, started_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
      [job.id, media.id, isRotation, caption]);
    await client.query('COMMIT');
    return { job: { ...job, caption, is_rotation: isRotation }, media, settings };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function runJob({ job, media, settings }) {
  const modelName = (await pool.query('SELECT name FROM models WHERE id = $1', [job.model_id])).rows[0]?.name || `#${job.model_id}`;
  const ext = path.extname(media.filename || media.storage_key) || (media.mime?.startsWith('video') ? '.mp4' : '.jpg');
  const file = path.join(TMP, `job${job.id}${ext}`);
  log(`▶ ${modelName} | ${job.kind} | média #${media.id} ${media.filename || ''}${job.is_rotation ? ' (rotation)' : ''}`);
  await heartbeat('publishing', { job: job.id, model: modelName, kind: job.kind });
  const started = new Date();
  try {
    await storage.getToFile(media.storage_key, file);
    let postId = null;
    await withBrowser(job.agency_id, async p => {
      try { await publishWith(p); } catch (e) {
        // capture de l'écran au moment de l'erreur (avant que le navigateur se ferme)
        e.screenshot = await p.screenshot({ fullPage: true }).catch(() => null);
        throw e;
      }
    });
    async function publishWith(p) {
      const args = { revealId: settings.reveal_model_id, filePath: file, caption: job.caption || '', audience: job.audience };
      if (job.kind === 'story') await reveal.publishStory(p, args);
      else {
        await reveal.publishPost(p, args);
        // retrouve l'identifiant Reveal du post qu'on vient de créer (pour suivre ses j'aime)
        try {
          const posts = await reveal.collectPosts(p, settings.reveal_model_id);
          const recent = posts.filter(x => x.date && x.date >= new Date(started.getTime() - 120000)).sort((a, b) => b.date - a.date);
          postId = (recent[0] || null)?.id || null;
          if (!posts.length) await apLog(job.agency_id, job.model_id, 'warn', "Aucun post lu depuis l'API Reveal (parseur à ajuster ?)");
        } catch (e) { /* pas bloquant */ }
      }
    }
    await pool.query(`UPDATE autopost_jobs SET status = 'done', done_at = NOW(), error = NULL, reveal_post_id = $2 WHERE id = $1`, [job.id, postId]);
    await pool.query(`UPDATE autopost_media SET times_posted = times_posted + 1, last_posted_at = NOW() WHERE id = $1`, [media.id]);
    await markSession(job.agency_id, 'ok');
    log(`✅ ${modelName} : ${job.kind} publié`);
  } catch (e) {
    let shotKey = null;
    try {
      if (e.screenshot) {
        shotKey = `a${job.agency_id}/screens/job${job.id}-${Date.now()}.png`;
        await storage.putBuffer(shotKey, e.screenshot, 'image/png');
      }
    } catch (e2) { shotKey = null; }
    const expired = e instanceof reveal.SessionExpired;
    const retry = !expired && job.attempts + 1 < MAX_ATTEMPTS;
    await pool.query(
      `UPDATE autopost_jobs SET status = $2, error = $3, screenshot_key = COALESCE($4, screenshot_key),
         scheduled_at = CASE WHEN $2 = 'pending' THEN NOW() + INTERVAL '10 minutes' ELSE scheduled_at END,
         done_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [job.id, expired ? 'pending' : (retry ? 'pending' : 'failed'), String(e.message).slice(0, 1000), shotKey]);
    if (expired) {
      // on remet le créneau en attente (attempts inchangé) et on bloque tout jusqu'à reconnexion
      await pool.query('UPDATE autopost_jobs SET attempts = GREATEST(attempts - 1, 0) WHERE id = $1', [job.id]);
      const was = (await pool.query('SELECT session_status FROM autopost_agency WHERE agency_id = $1', [job.agency_id])).rows[0]?.session_status;
      await markSession(job.agency_id, 'expired');
      if (was !== 'expired') await notify(job.agency_id, 'whatsapp_failures', `🔑 Auto-post Reveal en pause : la connexion au compte agence a expiré. Reconnecte-le dans le CRM (Auto-post > Connexion).`);
    } else if (!retry) {
      await notify(job.agency_id, 'whatsapp_failures', `❌ Auto-post : échec ${job.kind} pour ${modelName} — ${String(e.message).slice(0, 120)}`);
    }
    await apLog(job.agency_id, job.model_id, 'error', `Échec ${job.kind} : ${e.message}`, { job: job.id });
    log(`❌ ${modelName} : ${e.message}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---------- vérification de session ----------
async function checkPendingSessions() {
  const { rows } = await pool.query(`SELECT agency_id FROM autopost_agency WHERE session_status = 'unchecked' AND session_enc IS NOT NULL`);
  for (const r of rows) {
    try {
      const ok = await withBrowser(r.agency_id, page => reveal.checkSession(page));
      await markSession(r.agency_id, ok ? 'ok' : 'expired');
      log(`🔑 session agence ${r.agency_id} : ${ok ? 'ok' : 'refusée'}`);
    } catch (e) {
      await markSession(r.agency_id, 'expired');
      await apLog(r.agency_id, null, 'error', 'Vérif session : ' + e.message);
    }
  }
}

// ---------- collecte des j'aime et des stats ----------
async function collectStats() {
  const { rows: models } = await pool.query(
    `SELECT s.* FROM autopost_settings s JOIN autopost_agency a ON a.agency_id = s.agency_id
     WHERE s.reveal_model_id IS NOT NULL AND a.session_status = 'ok' AND (s.enabled OR EXISTS (SELECT 1 FROM autopost_jobs j WHERE j.model_id = s.model_id))`);
  const byAgency = {};
  models.forEach(m => (byAgency[m.agency_id] = byAgency[m.agency_id] || []).push(m));
  for (const [agencyId, list] of Object.entries(byAgency)) {
    try {
      await withBrowser(Number(agencyId), async page => {
        for (const s of list) {
          await heartbeat('stats', { model: s.model_id });
          try {
            const posts = await reveal.collectPosts(page, s.reveal_model_id);
            if (posts.length) {
              await apLog(s.agency_id, s.model_id, 'debug', `Stats : ${posts.length} posts lus`, { sample: posts.slice(0, 1).map(p => p.raw) });
            }
            for (const p of posts) {
              if (p.likes == null) continue;
              await pool.query(`UPDATE autopost_jobs SET likes = $1, likes_checked_at = NOW() WHERE model_id = $2 AND reveal_post_id = $3`, [p.likes, s.model_id, p.id]);
            }
            // moyenne / record de j'aime par média
            await pool.query(
              `UPDATE autopost_media m SET avg_likes = x.a, best_likes = x.b FROM (
                 SELECT media_id, AVG(likes) a, MAX(likes) b FROM autopost_jobs WHERE model_id = $1 AND likes IS NOT NULL GROUP BY media_id
               ) x WHERE x.media_id = m.id`, [s.model_id]);
            const st = await reveal.collectDailyStats(page, s.reveal_model_id);
            await pool.query(
              `INSERT INTO autopost_daily_stats (model_id, date, revenue, new_subs, sales, raw) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (model_id, date) DO UPDATE SET revenue = $3, new_subs = $4, sales = $5, raw = $6`,
              [s.model_id, planner.parisToday(0), st.revenue, st.new_subs, st.sales, JSON.stringify(st)]);
          } catch (e) {
            if (e instanceof reveal.SessionExpired) throw e;
            await apLog(s.agency_id, s.model_id, 'warn', 'Collecte stats : ' + e.message);
          }
        }
      });
    } catch (e) {
      if (e instanceof reveal.SessionExpired) await markSession(Number(agencyId), 'expired');
      await apLog(Number(agencyId), null, 'warn', 'Collecte stats : ' + e.message);
    }
  }
}

// ---------- rapports hebdo + alertes de stock ----------
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - y) / 86400000 + 1) / 7)}`;
}

async function weeklyReports() {
  const { rows } = await pool.query(`SELECT model_id, agency_id FROM autopost_settings WHERE enabled = true`);
  for (const r of rows) {
    try {
      const rep = await generateReport(r.model_id, { days: 7, save: true });
      await notify(r.agency_id, 'whatsapp_reports', rep.summary);
    } catch (e) { await apLog(r.agency_id, r.model_id, 'warn', 'Rapport : ' + e.message); }
  }
}

async function stockAlerts() {
  const today = planner.parisToday(0);
  const { rows } = await pool.query(`SELECT s.*, m.name FROM autopost_settings s JOIN models m ON m.id = s.model_id WHERE s.enabled = true`);
  for (const s of rows) {
    if (state.lastStockAlertDay[s.model_id] === today) continue;
    const low = [];
    for (const kind of planner.KINDS) {
      const perDay = Number(s[{ post: 'posts_per_day', reel: 'reels_per_day', story: 'stories_per_day' }[kind]]) || 0;
      if (!perDay) continue;
      const st = await planner.stockFor(s.model_id, kind, s.rotation_cooldown_days);
      if (st.fresh < perDay * 3 && (!s.rotation_enabled || st.rotation_ready < perDay)) low.push(`${kind}s : ${st.fresh} neufs`);
    }
    state.lastStockAlertDay[s.model_id] = today;
    if (low.length) await notify(s.agency_id, 'whatsapp_failures', `📦 Auto-post ${s.name} : stock bas (${low.join(', ')}). Ajoute du contenu dans le CRM.`);
  }
}

// ---------- boucle principale ----------
async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    await heartbeat('idle', { pid: process.pid });
    if (Date.now() - state.lastPlan > 10 * 60000) {
      const n = await planner.planAll();
      if (n) log(`🗓  ${n} créneaux planifiés`);
      state.lastPlan = Date.now();
    }
    await checkPendingSessions();
    // publie tout ce qui est dû
    for (let i = 0; i < 10; i++) {
      const c = await claimJob();
      if (!c) break;
      if (c.noStock) {
        const nm = (await pool.query('SELECT name FROM models WHERE id = $1', [c.job.model_id])).rows[0]?.name || `#${c.job.model_id}`;
        await notify(c.job.agency_id, 'whatsapp_failures', `📦 Auto-post : plus de ${c.job.kind}s à publier pour ${nm}. Ajoute du contenu dans le CRM.`);
        continue;
      }
      if (c.skipped) continue;
      await runJob(c);
      const pause = process.env.AUTOPOST_PAUSE_MS ? Number(process.env.AUTOPOST_PAUSE_MS) : 15000 + Math.random() * 30000;
      await new Promise(r => setTimeout(r, pause)); // pause entre deux publications
    }
    const p = planner.parisParts();
    // stats : une fois par jour vers 23h30 (heure de Paris)
    if (p.minutes >= 23 * 60 + 30 && state.lastStatsDay !== p.date) { state.lastStatsDay = p.date; await collectStats(); }
    // rapport : le lundi à partir de 9h
    const week = isoWeek(new Date(planner.parisDate(p.date, 12 * 60)));
    if (new Date(planner.parisDate(p.date, 12 * 60)).getUTCDay() === 1 && p.minutes >= 9 * 60 && state.lastReportWeek !== week) {
      state.lastReportWeek = week; await weeklyReports();
    }
    // alerte stock : une fois par jour à partir de 10h
    if (p.minutes >= 10 * 60) await stockAlerts();
  } catch (e) {
    log('Erreur boucle :', e.message);
    await apLog(null, null, 'error', 'Boucle worker : ' + e.message).catch(() => {});
  } finally { state.busy = false; }
}

async function init() {
  await initAutopostDB();
  // un créneau resté "running" après un crash repasse en attente
  await pool.query(`UPDATE autopost_jobs SET status = 'pending' WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes'`);
  // évite de renvoyer le rapport/les stats en double si le worker redémarre
  const { rows } = await pool.query(`SELECT MAX(created_at) AS t FROM autopost_reports`);
  if (rows[0]?.t) state.lastReportWeek = isoWeek(new Date(rows[0].t));
  const { rows: st } = await pool.query(`SELECT MAX(date)::text AS d FROM autopost_daily_stats`);
  if (st[0]?.d === planner.parisToday(0)) state.lastStatsDay = st[0].d;
  log(`Worker auto-post démarré (${WORKER_ID}) — Reveal : ${reveal.BASE} — stockage : ${storage.isRemote() ? 'cloud' : 'local'}`);
}

async function main() {
  await init();
  await tick();
  setInterval(tick, TICK_MS);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { init, tick, claimJob, runJob, collectStats, state };
