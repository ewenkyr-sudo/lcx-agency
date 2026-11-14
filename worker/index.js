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

const state = { lastPlan: 0, lastStatsDay: null, lastReportWeek: null, lastStockAlertDay: {}, busy: false, stopping: false };

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
  // handleSIGTERM: false -> à l'arrêt du bot, le navigateur reste ouvert le temps de finir la publication en cours
  const launch = { headless: process.env.AUTOPOST_HEADLESS !== 'false', args: ['--disable-blink-features=AutomationControlled'], handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false };
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
  let archived = 0;
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
          // le média envoyé garde le nom du fichier (job<id>.ext) : c'est le repère le plus sûr
          const byName = posts.find(x => x.mediaNames.includes(path.basename(file)));
          const recent = posts.filter(x => x.date && x.date >= new Date(started.getTime() - 120000)).sort((a, b) => b.date - a.date);
          postId = (byName || recent[0] || null)?.id || null;
          if (!posts.length) await apLog(job.agency_id, job.model_id, 'warn', "Aucun post lu depuis l'API Reveal (parseur à ajuster ?)");
        } catch (e) { /* pas bloquant */ }
        // repost : on archive l'ancienne publication du même contenu (elle reste restaurable dans Reveal)
        if (job.is_rotation && settings.rotation_archive_old !== false) {
          try {
            const { rows: old } = await pool.query(
              `SELECT id, reveal_post_id FROM autopost_jobs WHERE media_id = $1 AND id <> $2 AND status = 'done'
               AND kind IN ('post','reel') AND reveal_post_id IS NOT NULL AND archived_at IS NULL`, [media.id, job.id]);
            if (old.length) {
              const res = await reveal.archivePosts(p, settings.reveal_model_id, old.map(o => o.reveal_post_id));
              for (const r of res) {
                const o = old.find(x => x.reveal_post_id === r.id);
                if (r.ok) await pool.query(`UPDATE autopost_jobs SET archived_at = NOW(), likes = COALESCE($2, likes), likes_checked_at = CASE WHEN $2 IS NULL THEN likes_checked_at ELSE NOW() END WHERE id = $1`, [o.id, r.likes]);
                else await apLog(job.agency_id, job.model_id, 'warn', `Archivage de l'ancien post refusé par Reveal (code ${r.status})`, { post: r.id });
              }
              archived = res.filter(r => r.ok).length;
            }
          } catch (e) { await apLog(job.agency_id, job.model_id, 'warn', "Archivage de l'ancien post impossible : " + e.message); }
        }
      }
    }
    await pool.query(`UPDATE autopost_jobs SET status = 'done', done_at = NOW(), error = NULL, reveal_post_id = $2 WHERE id = $1`, [job.id, postId]);
    await pool.query(`UPDATE autopost_media SET times_posted = times_posted + 1, last_posted_at = NOW() WHERE id = $1`, [media.id]);
    await markSession(job.agency_id, 'ok');
    log(`✅ ${modelName} : ${job.kind} publié${archived ? ` (+ ${archived} ancien(s) post(s) archivé(s))` : ''}`);
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
// ---------- SFS : mass DM programmés chez Reveal ----------
const SFS_REVEAL_ID = `COALESCE(s.reveal_model_id, m.reveal_model_id,
  (SELECT rm.reveal_model_id FROM reveal_models rm WHERE rm.crm_model_id = m.id LIMIT 1))`;
async function sfsSync() {
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT p.*, m.name AS model_name, ${SFS_REVEAL_ID} AS reveal_id
       FROM sfs_pushes p JOIN models m ON m.id = p.model_id LEFT JOIN autopost_settings s ON s.model_id = p.model_id
       WHERE p.platform = 'reveal' AND (
         (p.bot_status IN ('queued', 'requeue', 'cancel_requested') AND (p.bot_checked_at IS NULL OR p.bot_checked_at < NOW() - INTERVAL '2 minutes'))
         OR (p.bot_status = 'scheduled' AND p.scheduled_at < NOW() - INTERVAL '3 minutes'
             AND (p.bot_checked_at IS NULL OR p.bot_checked_at < NOW() - INTERVAL '10 minutes')))
       ORDER BY p.scheduled_at LIMIT 30`));
  } catch (e) { return; } // tables SFS pas encore créées
  if (!rows.length) return;
  const byAgency = {};
  for (const r of rows) (byAgency[r.agency_id] = byAgency[r.agency_id] || []).push(r);
  for (const [agencyId, list] of Object.entries(byAgency)) {
    const set = (id, fields) => {
      const k = Object.keys(fields);
      return pool.query(`UPDATE sfs_pushes SET ${k.map((x, i) => `${x} = $${i + 2}`).join(', ')}, bot_checked_at = NOW(), updated_at = NOW() WHERE id = $1`, [id, ...k.map(x => fields[x])]);
    };
    // sans lien Reveal : erreur tout de suite, pas besoin d'ouvrir le navigateur
    const todo = [];
    for (const r of list) {
      if (!r.reveal_id && r.bot_status !== 'cancel_requested') {
        await set(r.id, { bot_status: 'failed', bot_error: `${r.model_name} n'est pas reliée à Reveal (Auto-post > Réglages, ou Stats Reveal > Réglages)` });
      } else todo.push(r);
    }
    if (!todo.length) continue;
    try {
      await withBrowser(Number(agencyId), async page => {
        const access = await reveal.apiAccess(page, todo.find(r => r.reveal_id).reveal_id);
        for (const r of todo) {
          try {
            if (r.bot_status === 'cancel_requested') {
              if (r.reveal_mass_dm_id) await reveal.deleteMassDM(page, access, r.reveal_mass_dm_id);
              await set(r.id, { bot_status: 'cancelled', reveal_mass_dm_id: null });
              log(`💬 SFS #${r.id} : mass DM retiré de Reveal`);
              continue;
            }
            if (r.bot_status === 'queued' || r.bot_status === 'requeue') {
              if (r.bot_status === 'requeue' && r.reveal_mass_dm_id) await reveal.deleteMassDM(page, access, r.reveal_mass_dm_id);
              const when = new Date(r.scheduled_at).getTime();
              if (when < Date.now() - 60 * 60000) {
                await set(r.id, { bot_status: 'failed', bot_error: 'Heure dépassée de plus d\'une heure : mass DM pas envoyé', reveal_mass_dm_id: null });
                await notify(r.agency_id, 'whatsapp_failures', `⚠️ SFS ${r.model_name} × ${r.partner_name} : heure dépassée, mass DM pas envoyé. Reprogramme-le dans le CRM.`);
                continue;
              }
              const plannedAt = new Date(Math.max(when, Date.now() + 2 * 60000));
              const md = await reveal.createMassDM(page, access, { revealId: r.reveal_id, content: r.message, plannedAt, audience: r.audience });
              await set(r.id, { bot_status: 'scheduled', reveal_mass_dm_id: md.id, bot_error: null });
              log(`💬 SFS #${r.id} : mass DM programmé chez Reveal pour ${plannedAt.toISOString()} (${md.id})`);
              continue;
            }
            // programmé et l'heure est passée : on vérifie qu'il est bien parti
            const t = new Date(r.scheduled_at).getTime();
            const found = (await reveal.listMassDMs(page, access, r.reveal_id, new Date(t - 2 * 86400000), new Date(t + 2 * 86400000)))
              .find(x => String(x.id) === String(r.reveal_mass_dm_id));
            if (!found) {
              if (Date.now() - t > 6 * 3600000) {
                await set(r.id, { bot_status: 'failed', bot_error: 'Mass DM introuvable chez Reveal (supprimé à la main ?)' });
              } else await set(r.id, {});
              continue;
            }
            if (found.status === 'sent') {
              await set(r.id, { bot_status: 'sent', our_sent: true, sent_count: found.sentCount ?? null, income_cents: found.totalIncome ?? null,
                status: r.partner_sent ? 'done' : r.status });
              log(`💬 SFS #${r.id} : mass DM envoyé à ${found.sentCount ?? '?'} fans`);
            } else if (found.status === 'deleted' || found.status === 'deleting') {
              await set(r.id, { bot_status: 'cancelled' });
            } else await set(r.id, {}); // encore en cours d'envoi
          } catch (e) {
            if (e instanceof reveal.SessionExpired) throw e;
            await set(r.id, { bot_status: 'failed', bot_error: e.message.slice(0, 300) });
            await notify(r.agency_id, 'whatsapp_failures', `⚠️ SFS ${r.model_name} × ${r.partner_name} : le mass DM n'a pas pu être programmé (${e.message.slice(0, 120)}).`);
            log(`💬 SFS #${r.id} : échec`, e.message);
          }
        }
      });
    } catch (e) {
      // on réessaiera dans 2 minutes ; l'erreur est visible sur le SFS dans le CRM
      const msg = e instanceof reveal.SessionExpired ? 'Connexion Reveal du bot expirée : reconnecte-la dans Auto-post' : 'Bot : ' + e.message.slice(0, 200);
      await pool.query(`UPDATE sfs_pushes SET bot_checked_at = NOW(), bot_error = $2 WHERE id = ANY($1::int[])`, [todo.map(r => r.id), msg]).catch(() => {});
      if (e instanceof reveal.SessionExpired) { await markSession(Number(agencyId), 'expired').catch(() => {}); log('SFS : session Reveal expirée'); }
      else log('SFS : erreur', e.message);
    }
  }
}

async function tick() {
  if (state.busy || state.stopping) return;
  state.busy = true;
  try {
    await heartbeat('idle', { pid: process.pid });
    // un créneau bloqué en « en cours » (bot coupé en pleine publication) repasse en attente
    await pool.query(`UPDATE autopost_jobs SET status = 'pending', scheduled_at = NOW() WHERE status = 'running' AND started_at < NOW() - INTERVAL '20 minutes'`);
    if (Date.now() - state.lastPlan > 10 * 60000) {
      const n = await planner.planAll();
      if (n) log(`🗓  ${n} créneaux planifiés`);
      state.lastPlan = Date.now();
    }
    await checkPendingSessions();
    // SFS : programme / retire / vérifie les mass DM chez Reveal
    if (!state.stopping) await sfsSync().catch(e => log('SFS :', e.message));
    // publie tout ce qui est dû
    for (let i = 0; i < 10; i++) {
      if (state.stopping) break; // arrêt demandé (mise à jour) : on ne prend plus rien
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
  await require('../db/sfs-schema').initSfsDB().catch(e => log('SFS : tables', e.message));
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
  // Lors d'une mise à jour, Render envoie SIGTERM à l'ancien bot : il finit sa publication en cours
  // puis s'arrête, sans prendre de nouveau créneau (sinon il serait coupé en plein milieu).
  process.on('SIGTERM', () => {
    state.stopping = true;
    log('Arrêt demandé : je termine la publication en cours et je m\'arrête');
    const wait = setInterval(() => { if (!state.busy) { clearInterval(wait); process.exit(0); } }, 500);
  });
  await tick();
  setInterval(tick, TICK_MS);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { init, tick, claimJob, runJob, collectStats, sfsSync, state };
