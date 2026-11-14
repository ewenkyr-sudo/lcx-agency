// Page SFS : abonnés par modèle (Reveal via l'API, MyM à la main) + planning des SFS en mass DM
const express = require('express');
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[sfs]', e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur serveur' });
});
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const PLATFORMS = ['reveal', 'mym'];
const scopeIds = req => req.modelScope || null;

async function ownModel(req, id) {
  const { rows } = await pool.query('SELECT id FROM models WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)', [id, req.agencyId]);
  if (!rows[0] || (req.modelScope && !req.modelScope.includes(rows[0].id))) throw fail(404, 'Modèle introuvable');
}
async function ownPush(req, id) {
  const { rows } = await pool.query('SELECT * FROM sfs_pushes WHERE id = $1 AND agency_id = $2', [id, req.agencyId]);
  if (!rows[0] || (req.modelScope && !req.modelScope.includes(rows[0].model_id))) throw fail(404, 'SFS introuvable');
  return rows[0];
}
function clean(b) {
  const v = {};
  if (b.platform !== undefined) { if (!PLATFORMS.includes(b.platform)) throw fail(400, 'Plateforme : reveal ou mym'); v.platform = b.platform; }
  if (b.partner_name !== undefined) { v.partner_name = String(b.partner_name || '').trim().slice(0, 120); if (!v.partner_name) throw fail(400, 'Nom de la partenaire obligatoire'); }
  if (b.partner_link !== undefined) v.partner_link = String(b.partner_link || '').trim().slice(0, 500) || null;
  if (b.partner_subs !== undefined) v.partner_subs = b.partner_subs === '' || b.partner_subs == null ? null : Math.max(0, parseInt(b.partner_subs) || 0);
  if (b.scheduled_at !== undefined) { const d = new Date(b.scheduled_at); if (isNaN(d)) throw fail(400, 'Date invalide'); v.scheduled_at = d.toISOString(); }
  if (b.our_sent !== undefined) v.our_sent = !!b.our_sent;
  if (b.partner_sent !== undefined) v.partner_sent = !!b.partner_sent;
  if (b.status !== undefined) { if (!['planned', 'done', 'cancelled'].includes(b.status)) throw fail(400, 'Statut invalide'); v.status = b.status; }
  if (b.subs_gained !== undefined) v.subs_gained = b.subs_gained === '' || b.subs_gained == null ? null : parseInt(b.subs_gained) || 0;
  if (b.notes !== undefined) v.notes = String(b.notes || '').slice(0, 2000) || null;
  if (b.message !== undefined) v.message = String(b.message || '').slice(0, 2000) || null;
  if (b.auto_send !== undefined) v.auto_send = !!b.auto_send;
  if (b.audience !== undefined) { if (!['active', 'expired'].includes(b.audience)) throw fail(400, 'Audience invalide'); v.audience = b.audience; }
  return v;
}

function checkAuto(message, when) {
  if (!message || !String(message).trim()) throw fail(400, 'Écris le message du mass DM pour l\'envoi automatique');
  if (new Date(when).getTime() < Date.now() - 5 * 60000) throw fail(400, 'L\'heure est déjà passée : le bot ne peut plus l\'envoyer');
}

// ---------- abonnés par modèle ----------
router.get('/subs', wrap(async (req, res) => {
  const { rows: models } = await pool.query(
    `SELECT m.id, m.name, m.photo_url, m.chart_color, m.platforms,
       (SELECT rm.avatar_url FROM reveal_models rm WHERE rm.crm_model_id = m.id AND rm.avatar_url IS NOT NULL LIMIT 1) AS reveal_avatar_url
     FROM models m WHERE (m.agency_id = $1 OR m.agency_id IS NULL) AND COALESCE(m.status, 'active') <> 'archived'
       AND ($2::int[] IS NULL OR m.id = ANY($2::int[])) ORDER BY m.name`, [req.agencyId, scopeIds(req)]);
  // Reveal : chiffres de l'API (abonnés actuels + nouveaux abonnés sur 30 jours)
  const rv = await pool.query(
    `SELECT rm.crm_model_id, SUM(rm.subscribers_count)::int AS subscribers,
       (SELECT COALESCE(SUM(s.new_subscribers), 0)::int FROM reveal_stats_daily s JOIN reveal_models r2 ON r2.reveal_model_id = s.reveal_model_id
        WHERE r2.crm_model_id = rm.crm_model_id AND s.date > CURRENT_DATE - 30) AS new_30,
       MAX(st.last_sync_at) AS updated_at
     FROM reveal_models rm LEFT JOIN reveal_api_state st ON st.agency_id = rm.agency_id
     WHERE rm.agency_id = $1 AND rm.crm_model_id IS NOT NULL GROUP BY rm.crm_model_id`, [req.agencyId]).catch(() => ({ rows: [] }));
  const manual = await pool.query(`SELECT * FROM model_platform_subs WHERE model_id = ANY($1::int[])`, [models.map(m => m.id)]);
  res.json(models.map(m => {
    const r = rv.rows.find(x => x.crm_model_id === m.id);
    const man = p => manual.rows.find(x => x.model_id === m.id && x.platform === p);
    const mr = man('reveal'), mm = man('mym');
    return {
      ...m,
      reveal: r ? { subscribers: r.subscribers, new_30: r.new_30, source: 'api', updated_at: r.updated_at }
        : (mr ? { subscribers: mr.subscribers, new_30: mr.new_subs_30, source: 'manual', updated_at: mr.updated_at } : null),
      mym: mm ? { subscribers: mm.subscribers, new_30: mm.new_subs_30, source: 'manual', updated_at: mm.updated_at } : null,
    };
  }));
}));

router.put('/subs/:modelId/:platform', wrap(async (req, res) => {
  await ownModel(req, req.params.modelId);
  if (!PLATFORMS.includes(req.params.platform)) throw fail(400, 'Plateforme : reveal ou mym');
  const n = v => (v === '' || v == null ? null : Math.max(0, parseInt(v) || 0));
  await pool.query(
    `INSERT INTO model_platform_subs (model_id, platform, subscribers, new_subs_30, updated_at, updated_by) VALUES ($1,$2,$3,$4,NOW(),$5)
     ON CONFLICT (model_id, platform) DO UPDATE SET subscribers = EXCLUDED.subscribers, new_subs_30 = EXCLUDED.new_subs_30, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [req.params.modelId, req.params.platform, n(req.body.subscribers), n(req.body.new_30), req.user.id]);
  res.json({ ok: true });
}));

// ---------- planning des SFS ----------
router.get('/pushes', wrap(async (req, res) => {
  const vals = [req.agencyId, scopeIds(req)];
  let where = 'p.agency_id = $1 AND ($2::int[] IS NULL OR p.model_id = ANY($2::int[]))';
  if (req.query.from) { vals.push(req.query.from); where += ` AND p.scheduled_at >= $${vals.length}::timestamptz`; }
  if (req.query.to) { vals.push(req.query.to); where += ` AND p.scheduled_at < $${vals.length}::timestamptz`; }
  if (req.query.model_id) { vals.push(req.query.model_id); where += ` AND p.model_id = $${vals.length}`; }
  if (PLATFORMS.includes(req.query.platform)) { vals.push(req.query.platform); where += ` AND p.platform = $${vals.length}`; }
  const { rows } = await pool.query(
    `SELECT p.*, m.name AS model_name,
       -- Reveal : nouveaux abonnés de la modèle le jour du SFS (heure de Paris), via l'API
       CASE WHEN p.platform = 'reveal' THEN (
         SELECT SUM(s.new_subscribers)::int FROM reveal_stats_daily s JOIN reveal_models rm ON rm.reveal_model_id = s.reveal_model_id
         WHERE rm.crm_model_id = p.model_id AND s.date = (p.scheduled_at AT TIME ZONE 'Europe/Paris')::date) END AS reveal_new_subs_day
     FROM sfs_pushes p JOIN models m ON m.id = p.model_id
     WHERE ${where} ORDER BY p.scheduled_at LIMIT 500`, vals);
  res.json(rows);
}));

router.post('/pushes', wrap(async (req, res) => {
  const v = clean(req.body);
  if (!req.body.model_id) throw fail(400, 'Choisis la modèle');
  await ownModel(req, req.body.model_id);
  if (!v.partner_name || !v.scheduled_at) throw fail(400, 'Partenaire et date obligatoires');
  const platform = v.platform || 'reveal';
  const auto = !!v.auto_send && platform === 'reveal';
  if (auto) checkAuto(v.message, v.scheduled_at);
  const { rows } = await pool.query(
    `INSERT INTO sfs_pushes (agency_id, model_id, platform, partner_name, partner_link, partner_subs, scheduled_at, notes, created_by, auto_send, message, audience, bot_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.agencyId, req.body.model_id, platform, v.partner_name, v.partner_link || null, v.partner_subs ?? null, v.scheduled_at, v.notes || null, req.user.id,
     auto, v.message || null, v.audience || 'active', auto ? 'queued' : 'none']);
  res.json(rows[0]);
}));

router.put('/pushes/:id', wrap(async (req, res) => {
  await ownPush(req, req.params.id);
  const v = clean(req.body);
  if (req.body.model_id !== undefined) { await ownModel(req, req.body.model_id); v.model_id = parseInt(req.body.model_id); }
  // les deux mass DM envoyés => SFS fait
  if ((v.our_sent || v.partner_sent) && v.status === undefined) {
    const cur = await ownPush(req, req.params.id);
    const ours = v.our_sent ?? cur.our_sent, theirs = v.partner_sent ?? cur.partner_sent;
    if (ours && theirs && cur.status === 'planned') v.status = 'done';
  }
  // envoi automatique (Reveal) : on dit au bot quoi faire
  {
    const cur = await ownPush(req, req.params.id);
    const platform = v.platform || cur.platform;
    const auto = (v.auto_send ?? cur.auto_send) && platform === 'reveal';
    const cancelled = (v.status || cur.status) === 'cancelled';
    const onReveal = ['scheduled', 'queued', 'requeue'].includes(cur.bot_status);
    const touched = ['message', 'scheduled_at', 'audience', 'model_id', 'platform'].some(k => v[k] !== undefined && String(v[k]) !== String(k === 'scheduled_at' ? new Date(cur[k]).toISOString() : cur[k]));
    if (cur.bot_status === 'sent' && touched) throw fail(400, 'Ce mass DM est déjà parti : il ne peut plus être modifié');
    if (!auto || cancelled) {
      if (cur.bot_status === 'queued') v.bot_status = 'none';
      else if (onReveal) v.bot_status = 'cancel_requested';
    } else if (cur.bot_status !== 'sent') {
      checkAuto(v.message ?? cur.message, v.scheduled_at || cur.scheduled_at);
      if (cur.bot_status === 'scheduled' && touched) v.bot_status = 'requeue';
      else if (['none', 'failed', 'cancelled'].includes(cur.bot_status) || (cur.bot_status === 'cancel_requested')) v.bot_status = cur.reveal_mass_dm_id && cur.bot_status === 'cancel_requested' ? 'requeue' : 'queued';
      if (v.bot_status === 'queued' || v.bot_status === 'requeue') v.bot_error = null;
    }
  }
  const keys = Object.keys(v);
  if (!keys.length) return res.json({ ok: true });
  const set = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rows } = await pool.query(`UPDATE sfs_pushes SET ${set}, updated_at = NOW() WHERE id = $1 AND agency_id = $2 RETURNING *`,
    [req.params.id, req.agencyId, ...keys.map(k => v[k])]);
  res.json(rows[0]);
}));

router.delete('/pushes/:id', wrap(async (req, res) => {
  const cur = await ownPush(req, req.params.id);
  if (cur.reveal_mass_dm_id && ['scheduled', 'requeue'].includes(cur.bot_status)) {
    // le mass DM est programmé chez Reveal : le bot le retire, la ligne reste en « annulé »
    await pool.query(`UPDATE sfs_pushes SET status = 'cancelled', bot_status = 'cancel_requested', updated_at = NOW() WHERE id = $1`, [cur.id]);
    return res.json({ ok: true, cancelled: true });
  }
  if (cur.bot_status === 'sent') throw fail(400, 'Ce mass DM est déjà parti : passe-le en « Annulé » si besoin, il restera dans l\'historique');
  await pool.query('DELETE FROM sfs_pushes WHERE id = $1 AND agency_id = $2', [req.params.id, req.agencyId]);
  res.json({ ok: true });
}));

// relancer un envoi en erreur
router.post('/pushes/:id/retry', wrap(async (req, res) => {
  const cur = await ownPush(req, req.params.id);
  if (cur.platform !== 'reveal' || !cur.auto_send) throw fail(400, 'Pas d\'envoi automatique sur ce SFS');
  checkAuto(cur.message, cur.scheduled_at);
  await pool.query(`UPDATE sfs_pushes SET bot_status = $2, bot_error = NULL, status = 'planned', updated_at = NOW() WHERE id = $1`, [cur.id, cur.reveal_mass_dm_id ? 'requeue' : 'queued']);
  res.json({ ok: true });
}));

// partenaires déjà utilisés (pour l'autocomplétion et l'historique)
router.get('/partners', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT partner_name, MAX(partner_link) AS partner_link, MAX(partner_subs) AS partner_subs, COUNT(*)::int AS n,
            MAX(scheduled_at) AS last_at, SUM(subs_gained)::int AS subs_gained
     FROM sfs_pushes WHERE agency_id = $1 AND ($2::int[] IS NULL OR model_id = ANY($2::int[])) AND status <> 'cancelled'
     GROUP BY partner_name ORDER BY MAX(scheduled_at) DESC LIMIT 200`, [req.agencyId, scopeIds(req)]);
  res.json(rows);
}));

module.exports = router;
