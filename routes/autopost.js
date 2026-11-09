// ============ AUTO-POST REVEAL — API ============
// Monté dans server.js :  app.use('/api/autopost', require('./routes/autopost'));
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');
const storage = require('../services/autopost/storage');
const session = require('../services/autopost/session');
const planner = require('../services/autopost/planner');
const { generateReport } = require('../services/autopost/analysis');

const router = express.Router();
router.use(authMiddleware, adminOnly);

const KINDS = planner.KINDS;
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[AUTOPOST API]', e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur serveur : ' + e.message });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });

async function ownModel(req, modelId) {
  const { rows } = await pool.query('SELECT id, name FROM models WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)', [modelId, req.agencyId]);
  if (!rows[0]) throw fail(404, 'Modèle introuvable');
  return rows[0];
}
async function ownMedia(req, id) {
  const { rows } = await pool.query('SELECT * FROM autopost_media WHERE id = $1 AND agency_id = $2', [id, req.agencyId]);
  if (!rows[0]) throw fail(404, 'Média introuvable');
  return rows[0];
}
async function agencyRow(agencyId) {
  await pool.query('INSERT INTO autopost_agency (agency_id) VALUES ($1) ON CONFLICT DO NOTHING', [agencyId]);
  return (await pool.query('SELECT * FROM autopost_agency WHERE agency_id = $1', [agencyId])).rows[0];
}

const SETTINGS_DEFAULTS = {
  enabled: false, reveal_model_id: null, posts_per_day: 2, reels_per_day: 1, stories_per_day: 3,
  window_start: '09:00', window_end: '23:00', post_audience: 'subscribers', story_public: true,
  rotation_enabled: true, rotation_cooldown_days: 30, rotation_mix_pct: 0, captions: '', rotation_archive_old: true,
};

// ---------- vue d'ensemble ----------
router.get('/overview', wrap(async (req, res) => {
  const ag = await agencyRow(req.agencyId);
  const { rows: models } = await pool.query(
    `SELECT m.id, m.name, s.* , m.id AS id FROM models m
     LEFT JOIN autopost_settings s ON s.model_id = m.id
     WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND COALESCE(m.status, 'active') <> 'archived'
     ORDER BY m.name`, [req.agencyId]);
  const today0 = planner.parisDate(planner.parisToday(0), 0);
  const today1 = planner.parisDate(planner.parisToday(0), 24 * 60);
  const out = [];
  for (const m of models) {
    const settings = {};
    for (const k of Object.keys(SETTINGS_DEFAULTS)) settings[k] = m[k] ?? SETTINGS_DEFAULTS[k];
    const stock = {};
    for (const kind of KINDS) {
      const st = await planner.stockFor(m.id, kind, settings.rotation_cooldown_days);
      const perDay = Number(settings[{ post: 'posts_per_day', reel: 'reels_per_day', story: 'stories_per_day' }[kind]]) || 0;
      st.days_fresh = perDay ? Math.floor(st.fresh / perDay) : null;
      stock[kind] = st;
    }
    const { rows: today } = await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM autopost_jobs WHERE model_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3 GROUP BY status`,
      [m.id, today0, today1]);
    const { rows: next } = await pool.query(
      `SELECT kind, scheduled_at FROM autopost_jobs WHERE model_id = $1 AND status = 'pending' AND scheduled_at > NOW() ORDER BY scheduled_at LIMIT 1`, [m.id]);
    out.push({ id: m.id, name: m.name, settings, stock, today: Object.fromEntries(today.map(r => [r.status, r.c])), next: next[0] || null });
  }
  const { rows: w } = await pool.query("SELECT * FROM autopost_worker ORDER BY last_seen DESC NULLS LAST LIMIT 1");
  const worker = w[0] ? { ...w[0], online: w[0].last_seen && (Date.now() - new Date(w[0].last_seen).getTime() < 3 * 60000) } : { online: false };
  res.json({
    agency: { paused: ag.paused, session_status: ag.session_status, session_updated_at: ag.session_updated_at, session_checked_at: ag.session_checked_at,
      whatsapp_reports: ag.whatsapp_reports, whatsapp_failures: ag.whatsapp_failures, captions: ag.captions || '' },
    worker, storage: storage.isRemote() ? 'cloud' : 'local', models: out,
  });
}));

router.put('/agency', wrap(async (req, res) => {
  await agencyRow(req.agencyId);
  const b = req.body || {};
  const fields = [], vals = [];
  for (const k of ['paused', 'whatsapp_reports', 'whatsapp_failures']) if (k in b) { vals.push(!!b[k]); fields.push(`${k} = $${vals.length}`); }
  if ('captions' in b) { vals.push(String(b.captions || '').slice(0, 20000)); fields.push(`captions = $${vals.length}`); }
  if (fields.length) {
    vals.push(req.agencyId);
    await pool.query(`UPDATE autopost_agency SET ${fields.join(', ')} WHERE agency_id = $${vals.length}`, vals);
  }
  if ('paused' in b) {
    const { rows } = await pool.query('SELECT model_id FROM autopost_settings WHERE agency_id = $1', [req.agencyId]);
    for (const r of rows) await planner.replanModel(r.model_id);
  }
  res.json({ ok: true });
}));

// ---------- réglages d'une modèle ----------
router.put('/models/:id/settings', wrap(async (req, res) => {
  const m = await ownModel(req, req.params.id);
  const b = req.body || {};
  const cur = (await pool.query('SELECT * FROM autopost_settings WHERE model_id = $1', [m.id])).rows[0] || {};
  const v = { ...SETTINGS_DEFAULTS, ...cur, ...b };
  const int = (x, min, max) => Math.max(min, Math.min(max, parseInt(x, 10) || 0));
  const time = x => /^\d{1,2}:\d{2}$/.test(String(x)) ? String(x).padStart(5, '0') : '09:00';
  const revealId = v.reveal_model_id ? String(v.reveal_model_id).trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] : null;
  if (v.enabled && !revealId) throw fail(400, "Il faut l'identifiant Reveal de la modèle avant d'activer (copie l'adresse de sa page sur dashboard.reveal.me)");
  await pool.query(
    `INSERT INTO autopost_settings (model_id, agency_id, enabled, reveal_model_id, posts_per_day, reels_per_day, stories_per_day,
       window_start, window_end, post_audience, story_public, rotation_enabled, rotation_cooldown_days, rotation_mix_pct, captions, rotation_archive_old, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
     ON CONFLICT (model_id) DO UPDATE SET agency_id=$2, enabled=$3, reveal_model_id=$4, posts_per_day=$5, reels_per_day=$6, stories_per_day=$7,
       window_start=$8, window_end=$9, post_audience=$10, story_public=$11, rotation_enabled=$12, rotation_cooldown_days=$13,
       rotation_mix_pct=$14, captions=$15, rotation_archive_old=$16, updated_at=NOW()`,
    [m.id, req.agencyId, !!v.enabled, revealId, int(v.posts_per_day, 0, 20), int(v.reels_per_day, 0, 20), int(v.stories_per_day, 0, 20),
     time(v.window_start), time(v.window_end), v.post_audience === 'public' ? 'public' : 'subscribers', !!v.story_public,
     !!v.rotation_enabled, int(v.rotation_cooldown_days, 1, 365), int(v.rotation_mix_pct, 0, 100), String(v.captions || '').slice(0, 20000),
     v.rotation_archive_old !== false]
  );
  await planner.replanModel(m.id);
  res.json({ ok: true });
}));

// ---------- médias ----------
router.get('/models/:id/media', wrap(async (req, res) => {
  const m = await ownModel(req, req.params.id);
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
  const { rows } = await pool.query(
    `SELECT id, kind, filename, mime, size_bytes, caption, times_posted, last_posted_at, best_likes, avg_likes, disabled, created_at
     FROM autopost_media WHERE model_id = $1 ${kind ? 'AND kind = $2' : ''} ORDER BY times_posted ASC, filename ASC, id ASC`,
    kind ? [m.id, kind] : [m.id]);
  res.json(rows);
}));

router.post('/media/upload-url', wrap(async (req, res) => {
  const { model_id, kind, filename, mime, size } = req.body || {};
  await ownModel(req, model_id);
  if (!KINDS.includes(kind)) throw fail(400, 'Type invalide');
  if (!/^(image|video)\//.test(mime || '')) throw fail(400, 'Seulement des photos ou des vidéos');
  if (kind === 'reel' && !/^video\//.test(mime)) throw fail(400, 'Un reel doit être une vidéo');
  if (size > 2 * 1024 ** 3) throw fail(400, 'Fichier trop lourd (2 Go max)');
  const ext = (path.extname(filename || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [''])[0];
  const key = `a${req.agencyId}/m${model_id}/${kind}/${crypto.randomUUID()}${ext}`;
  if (storage.isRemote()) return res.json({ mode: 'cloud', key, url: await storage.presignPut(key, mime) });
  res.json({ mode: 'local', key, url: `/api/autopost/media/local-upload?key=${encodeURIComponent(key)}` });
}));

router.put('/media/local-upload', wrap(async (req, res) => {
  if (storage.isRemote()) throw fail(400, 'Upload direct désactivé (stockage cloud actif)');
  const key = String(req.query.key || '');
  if (!key.startsWith(`a${req.agencyId}/`)) throw fail(403, 'Clé refusée');
  await storage.putStream(key, req);
  res.json({ ok: true });
}));

router.post('/media', wrap(async (req, res) => {
  const { model_id, kind, key, filename, mime, size, caption } = req.body || {};
  await ownModel(req, model_id);
  if (!KINDS.includes(kind)) throw fail(400, 'Type invalide');
  if (!String(key || '').startsWith(`a${req.agencyId}/m${model_id}/${kind}/`)) throw fail(403, 'Clé refusée');
  const { rows } = await pool.query(
    `INSERT INTO autopost_media (agency_id, model_id, kind, storage_key, filename, mime, size_bytes, caption)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.agencyId, model_id, kind, key, String(filename || '').slice(0, 255), mime, size || null, caption || null]);
  res.json({ id: rows[0].id });
}));

router.patch('/media/:id', wrap(async (req, res) => {
  const md = await ownMedia(req, req.params.id);
  const b = req.body || {};
  if ('caption' in b) await pool.query('UPDATE autopost_media SET caption = $1 WHERE id = $2', [b.caption ? String(b.caption).slice(0, 2000) : null, md.id]);
  if ('disabled' in b) await pool.query('UPDATE autopost_media SET disabled = $1 WHERE id = $2', [!!b.disabled, md.id]);
  if ('kind' in b && KINDS.includes(b.kind)) {
    if (b.kind === 'reel' && !/^video\//.test(md.mime)) throw fail(400, 'Un reel doit être une vidéo');
    await pool.query('UPDATE autopost_media SET kind = $1 WHERE id = $2', [b.kind, md.id]);
  }
  res.json({ ok: true });
}));

router.delete('/media/:id', wrap(async (req, res) => {
  const md = await ownMedia(req, req.params.id);
  await pool.query('DELETE FROM autopost_media WHERE id = $1', [md.id]);
  await storage.remove(md.storage_key);
  res.json({ ok: true });
}));

router.get('/media/:id/file', wrap(async (req, res) => {
  const md = await ownMedia(req, req.params.id);
  if (storage.isRemote()) return res.redirect(await storage.presignGet(md.storage_key, 600));
  const f = await storage.readStream(md.storage_key);
  if (!f) throw fail(404, 'Fichier absent');
  res.set('Content-Type', md.mime || 'application/octet-stream');
  if (f.size) res.set('Content-Length', String(f.size));
  f.stream.pipe(res);
}));

// ---------- créneaux / historique ----------
router.get('/jobs', wrap(async (req, res) => {
  const vals = [req.agencyId];
  let where = 'j.agency_id = $1';
  if (req.query.model_id) { vals.push(req.query.model_id); where += ` AND j.model_id = $${vals.length}`; }
  if (req.query.scope === 'upcoming') where += " AND j.status IN ('pending','running') AND j.scheduled_at >= NOW() - INTERVAL '1 hour'";
  else if (req.query.scope === 'history') where += " AND j.status IN ('done','failed','skipped')";
  const order = req.query.scope === 'upcoming' ? 'ASC' : 'DESC';
  const { rows } = await pool.query(
    `SELECT j.id, j.model_id, mo.name AS model_name, j.kind, j.scheduled_at, j.status, j.is_rotation, j.caption, j.audience,
            j.attempts, j.error, (j.screenshot_key IS NOT NULL) AS has_screenshot, j.likes, j.done_at, j.archived_at, j.media_id, m.filename
     FROM autopost_jobs j LEFT JOIN autopost_media m ON m.id = j.media_id LEFT JOIN models mo ON mo.id = j.model_id
     WHERE ${where} ORDER BY COALESCE(j.done_at, j.scheduled_at) ${order} LIMIT ${Math.min(500, parseInt(req.query.limit, 10) || 100)}`, vals);
  res.json(rows);
}));

router.post('/jobs/:id/retry', wrap(async (req, res) => {
  const r = await pool.query(
    `UPDATE autopost_jobs SET status = 'pending', scheduled_at = NOW(), error = NULL, attempts = 0
     WHERE id = $1 AND agency_id = $2 AND status IN ('failed','skipped') RETURNING id`, [req.params.id, req.agencyId]);
  if (!r.rowCount) throw fail(400, 'Ce créneau ne peut pas être relancé');
  res.json({ ok: true });
}));

router.post('/jobs/:id/cancel', wrap(async (req, res) => {
  await pool.query(`UPDATE autopost_jobs SET status = 'cancelled' WHERE id = $1 AND agency_id = $2 AND status = 'pending'`, [req.params.id, req.agencyId]);
  res.json({ ok: true });
}));

router.get('/jobs/:id/screenshot', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT screenshot_key FROM autopost_jobs WHERE id = $1 AND agency_id = $2', [req.params.id, req.agencyId]);
  if (!rows[0]?.screenshot_key) throw fail(404, 'Pas de capture');
  if (storage.isRemote()) return res.redirect(await storage.presignGet(rows[0].screenshot_key, 600));
  const f = await storage.readStream(rows[0].screenshot_key);
  if (!f) throw fail(404, 'Capture absente');
  res.set('Content-Type', 'image/png');
  f.stream.pipe(res);
}));

// Publier tout de suite (un créneau en plus, hors planning)
router.post('/models/:id/run-now', wrap(async (req, res) => {
  const m = await ownModel(req, req.params.id);
  const kind = req.body?.kind;
  if (!KINDS.includes(kind)) throw fail(400, 'Type invalide');
  const s = (await pool.query('SELECT * FROM autopost_settings WHERE model_id = $1', [m.id])).rows[0];
  if (!s?.reveal_model_id) throw fail(400, "Renseigne d'abord l'identifiant Reveal de la modèle");
  await pool.query(
    `INSERT INTO autopost_jobs (agency_id, model_id, kind, scheduled_at, audience) VALUES ($1,$2,$3,NOW(),$4)`,
    [req.agencyId, m.id, kind, planner.audienceFor(kind, s)]);
  res.json({ ok: true });
}));

// ---------- connexion Reveal ----------
router.get('/session/bookmarklet', (req, res) => res.json({ bookmarklet: session.BOOKMARKLET }));

router.post('/session', wrap(async (req, res) => {
  let norm;
  try { norm = session.normalize(req.body?.export); } catch (e) { throw fail(400, e.message); }
  await agencyRow(req.agencyId);
  await pool.query(
    `UPDATE autopost_agency SET session_enc = $1, session_updated_at = NOW(), session_status = 'unchecked', session_checked_at = NULL WHERE agency_id = $2`,
    [session.encrypt(norm), req.agencyId]);
  res.json({ ok: true });
}));

router.delete('/session', wrap(async (req, res) => {
  await pool.query(`UPDATE autopost_agency SET session_enc = NULL, session_status = 'missing' WHERE agency_id = $1`, [req.agencyId]);
  res.json({ ok: true });
}));

// ---------- rapports ----------
router.get('/reports', wrap(async (req, res) => {
  const vals = [req.agencyId];
  let where = 'r.agency_id = $1';
  if (req.query.model_id) { vals.push(req.query.model_id); where += ' AND r.model_id = $2'; }
  const { rows } = await pool.query(
    `SELECT r.*, m.name AS model_name FROM autopost_reports r LEFT JOIN models m ON m.id = r.model_id
     WHERE ${where} ORDER BY r.created_at DESC LIMIT 30`, vals);
  res.json(rows);
}));

router.post('/reports/generate', wrap(async (req, res) => {
  const m = await ownModel(req, req.body?.model_id);
  const report = await generateReport(m.id, { days: Math.max(3, Math.min(90, parseInt(req.body?.days, 10) || 14)), save: true });
  res.json(report);
}));

router.get('/logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, model_id, level, message, created_at FROM autopost_log WHERE agency_id = $1 OR agency_id IS NULL ORDER BY id DESC LIMIT 100`, [req.agencyId]);
  res.json(rows);
}));

module.exports = router;
