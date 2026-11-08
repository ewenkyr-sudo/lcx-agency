// Planificateur : crée les créneaux du jour et choisit le média au moment de publier
// (contenu neuf d'abord, puis rotation des anciens posts selon les réglages).
const pool = require('../../db/pool');

const TZ = 'Europe/Paris';
const KINDS = ['post', 'reel', 'story'];
const PER_DAY_COL = { post: 'posts_per_day', reel: 'reels_per_day', story: 'stories_per_day' };

// ---------- dates à l'heure de Paris ----------
function parisParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function parisToday(offsetDays = 0) {
  return parisParts(new Date(Date.now() + offsetDays * 86400000)).date;
}
// "2026-11-08" + minutes depuis minuit (heure de Paris) -> Date UTC
function parisDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 0, minutes);
  for (let i = 0; i < 2; i++) {
    const p = parisParts(new Date(guess));
    const [py, pm, pd] = p.date.split('-').map(Number);
    const diff = (Date.UTC(y, m - 1, d) - Date.UTC(py, pm - 1, pd)) / 60000 + (minutes - p.minutes);
    guess += diff * 60000;
  }
  return new Date(guess);
}
function hm(str, def) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  return m ? Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2])) : def;
}

// ---------- création des créneaux ----------
// Répartit n créneaux sur la plage horaire, avec un décalage aléatoire pour faire "humain".
function slotsFor(n, startMin, endMin, seed) {
  if (n <= 0) return [];
  if (endMin <= startMin) endMin = startMin + 60;
  const seg = (endMin - startMin) / n;
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const jitter = Math.min(seg / 3, 25);
  const out = [];
  for (let i = 0; i < n; i++) {
    const center = startMin + seg * (i + 0.5);
    out.push(Math.round(center + (rnd() * 2 - 1) * jitter));
  }
  return out;
}

function seedOf(str) { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 233280; return h; }

// Planifie une journée pour une modèle (idempotent : ne recrée pas ce qui existe déjà)
async function planModelDay(settings, dateStr, { replace = false } = {}) {
  const now = Date.now();
  if (replace) {
    await pool.query(
      `UPDATE autopost_jobs SET status = 'cancelled' WHERE model_id = $1 AND status = 'pending'
       AND scheduled_at >= $2 AND scheduled_at < $3 AND scheduled_at > NOW()`,
      [settings.model_id, parisDate(dateStr, 0), parisDate(dateStr, 24 * 60)]
    );
  }
  if (!settings.enabled) return 0;
  let created = 0;
  for (const kind of KINDS) {
    const n = Math.max(0, Math.min(20, Number(settings[PER_DAY_COL[kind]]) || 0));
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM autopost_jobs WHERE model_id = $1 AND kind = $2
       AND status <> 'cancelled' AND scheduled_at >= $3 AND scheduled_at < $4`,
      [settings.model_id, kind, parisDate(dateStr, 0), parisDate(dateStr, 24 * 60)]
    );
    if (rows[0].c >= n) continue;
    const startMin = hm(settings.window_start, 9 * 60);
    const endMin = hm(settings.window_end, 23 * 60);
    const slots = slotsFor(n, startMin, endMin, seedOf(`${dateStr}|${settings.model_id}|${kind}`))
      .map(min => parisDate(dateStr, min))
      .filter(d => d.getTime() > now + 60000);
    // si une partie est déjà planifiée (planif en cours de journée), on complète seulement
    const missing = slots.slice(Math.max(0, slots.length - (n - rows[0].c)));
    for (const at of missing) {
      await pool.query(
        `INSERT INTO autopost_jobs (agency_id, model_id, kind, scheduled_at, audience) VALUES ($1,$2,$3,$4,$5)`,
        [settings.agency_id, settings.model_id, kind, at, audienceFor(kind, settings)]
      );
      created++;
    }
  }
  return created;
}

function audienceFor(kind, s) {
  if (kind === 'reel') return 'video';
  if (kind === 'story') return s.story_public ? 'public' : 'subscribers';
  return s.post_audience === 'public' ? 'public' : 'subscribers';
}

// Planifie aujourd'hui + demain pour toutes les modèles actives
async function planAll() {
  const { rows } = await pool.query(
    `SELECT s.* FROM autopost_settings s
     LEFT JOIN autopost_agency a ON a.agency_id = s.agency_id
     WHERE s.enabled = true AND COALESCE(a.paused, false) = false`
  );
  let total = 0;
  for (const s of rows) {
    total += await planModelDay(s, parisToday(0));
    total += await planModelDay(s, parisToday(1));
  }
  return total;
}

// Re-planifie une modèle après un changement de réglages
async function replanModel(modelId) {
  const { rows } = await pool.query('SELECT * FROM autopost_settings WHERE model_id = $1', [modelId]);
  if (!rows[0]) return;
  const s = rows[0];
  const paused = (await pool.query('SELECT paused FROM autopost_agency WHERE agency_id = $1', [s.agency_id])).rows[0]?.paused;
  for (const d of [parisToday(0), parisToday(1)]) {
    await planModelDay({ ...s, enabled: s.enabled && !paused }, d, { replace: true });
  }
}

// ---------- choix du média ----------
function lines(text) { return String(text || '').split('\n').map(l => l.trim()).filter(Boolean); }

async function pickCaption(media, settings, agency, kind, avoid) {
  if (media.caption) return media.caption;
  if (kind === 'story') return '';
  const list = lines(settings.captions).length ? lines(settings.captions) : lines(agency?.captions);
  if (!list.length) return '';
  const choices = list.length > 1 ? list.filter(c => c !== avoid) : list;
  return choices[Math.floor(Math.random() * choices.length)];
}

// Stock dispo pour une modèle et un type
async function stockFor(modelId, kind, cooldownDays) {
  const videoOnly = kind === 'reel' ? "AND mime LIKE 'video/%'" : '';
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE times_posted = 0)::int AS fresh,
       COUNT(*) FILTER (WHERE times_posted > 0 AND (last_posted_at IS NULL OR last_posted_at < NOW() - make_interval(days => $3)))::int AS rotation_ready,
       COUNT(*)::int AS total
     FROM autopost_media WHERE model_id = $1 AND kind = $2 AND disabled = false ${videoOnly}`,
    [modelId, kind, Number(cooldownDays) || 30]
  );
  return rows[0];
}

// Choisit le média pour un créneau. Renvoie { media, isRotation } ou null si rien de dispo.
async function pickMedia(client, job, settings) {
  const videoOnly = job.kind === 'reel' ? "AND mime LIKE 'video/%'" : '';
  const busy = `AND id NOT IN (SELECT media_id FROM autopost_jobs WHERE status = 'running' AND media_id IS NOT NULL AND id <> ${Number(job.id)})`;
  const freshQ = `SELECT * FROM autopost_media WHERE model_id = $1 AND kind = $2 AND disabled = false AND times_posted = 0 ${videoOnly} ${busy}
                  ORDER BY filename ASC NULLS LAST, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
  // Rotation : en priorité ce qui a le mieux marché, puis ce qui n'a pas été reposté depuis longtemps
  const rotQ = `SELECT * FROM autopost_media WHERE model_id = $1 AND kind = $2 AND disabled = false AND times_posted > 0 ${videoOnly} ${busy}
                AND (last_posted_at IS NULL OR last_posted_at < NOW() - make_interval(days => $3))
                ORDER BY avg_likes DESC NULLS LAST, last_posted_at ASC NULLS FIRST, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

  const rotationOn = settings.rotation_enabled !== false;
  const wantRotation = rotationOn && Math.random() * 100 < (Number(settings.rotation_mix_pct) || 0);
  const tryFresh = async () => (await client.query(freshQ, [job.model_id, job.kind])).rows[0];
  const tryRot = async () => rotationOn ? (await client.query(rotQ, [job.model_id, job.kind, Number(settings.rotation_cooldown_days) || 30])).rows[0] : null;

  if (wantRotation) {
    const m = await tryRot(); if (m) return { media: m, isRotation: true };
    const f = await tryFresh(); if (f) return { media: f, isRotation: false };
  } else {
    const f = await tryFresh(); if (f) return { media: f, isRotation: false };
    const m = await tryRot(); if (m) return { media: m, isRotation: true };
  }
  return null;
}

module.exports = {
  KINDS, parisToday, parisDate, parisParts, slotsFor,
  planModelDay, planAll, replanModel, pickMedia, pickCaption, stockFor, audienceFor,
};
