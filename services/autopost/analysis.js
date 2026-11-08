// Analyse : qu'est-ce qui marche le mieux (type, heure, jour, rotation, légende) + recommandations.
const pool = require('../../db/pool');

const KIND_LABEL = { post: 'posts', reel: 'reels', story: 'stories' };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const SLOTS = [
  { key: 'matin', label: 'le matin (6h-12h)', from: 6, to: 12 },
  { key: 'midi', label: 'le midi (12h-15h)', from: 12, to: 15 },
  { key: 'aprem', label: "l'après-midi (15h-18h)", from: 15, to: 18 },
  { key: 'soir', label: 'le soir (18h-21h)', from: 18, to: 21 },
  { key: 'nuit', label: 'la nuit (21h-6h)', from: 21, to: 30 },
];
const MIN_SAMPLE = 3;

function parisHourDay(d) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return { hour: Number(p.hour), day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
function slotOf(h) { const hh = h < 6 ? h + 24 : h; return SLOTS.find(s => hh >= s.from && hh < s.to)?.key || 'nuit'; }
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const r1 = x => x == null ? null : Math.round(x * 10) / 10;

function groupAvg(items, keyFn) {
  const g = {};
  for (const it of items) { const k = keyFn(it); if (k == null) continue; (g[k] = g[k] || []).push(it.likes); }
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { n: v.length, avg: r1(avg(v)) }]));
}
function bestWorst(groups) {
  const ok = Object.entries(groups).filter(([, v]) => v.n >= MIN_SAMPLE && v.avg != null).sort((a, b) => b[1].avg - a[1].avg);
  if (ok.length < 2) return null;
  const best = ok[0], worst = ok[ok.length - 1];
  const ratio = worst[1].avg > 0 ? best[1].avg / worst[1].avg : (best[1].avg > 0 ? Infinity : 1);
  return { best: best[0], bestAvg: best[1].avg, worst: worst[0], worstAvg: worst[1].avg, ratio };
}
const fmtRatio = r => r === Infinity ? 'beaucoup plus' : (r >= 1.95 ? `${Math.round(r * 10) / 10}x plus` : `${Math.round((r - 1) * 100)} % de plus`);

async function generateReport(modelId, { days = 14, save = false } = {}) {
  const { rows: [model] } = await pool.query('SELECT id, name, agency_id FROM models WHERE id = $1', [modelId]);
  const { rows: settingsRows } = await pool.query('SELECT * FROM autopost_settings WHERE model_id = $1', [modelId]);
  const s = settingsRows[0] || {};
  const since = new Date(Date.now() - days * 86400000);

  const { rows: jobs } = await pool.query(
    `SELECT j.*, m.mime, m.filename, m.times_posted FROM autopost_jobs j LEFT JOIN autopost_media m ON m.id = j.media_id
     WHERE j.model_id = $1 AND j.scheduled_at >= $2 AND j.status IN ('done','failed','skipped')`, [modelId, since]);
  const done = jobs.filter(j => j.status === 'done');
  const failed = jobs.filter(j => j.status === 'failed');
  const skipped = jobs.filter(j => j.status === 'skipped');
  // les stories n'ont pas de j'aime sur Reveal : on analyse posts + reels
  const scored = done.filter(j => j.kind !== 'story' && j.likes != null).map(j => {
    const { hour, day } = parisHourDay(j.done_at || j.scheduled_at);
    return { ...j, hour, day, slot: slotOf(hour), video: /^video\//.test(j.mime || '') };
  });

  const byKind = groupAvg(scored, j => j.kind);
  const byFormat = groupAvg(scored.filter(j => j.kind === 'post'), j => j.video ? 'vidéo' : 'photo');
  const bySlot = groupAvg(scored, j => j.slot);
  const byDay = groupAvg(scored, j => DAYS[j.day]);
  const byRotation = groupAvg(scored, j => j.is_rotation ? 'rotation' : 'neuf');
  const byCaption = groupAvg(scored.filter(j => j.kind === 'post'), j => (j.caption || '').trim() ? 'avec' : 'sans');
  const byAudience = groupAvg(scored.filter(j => j.kind === 'post'), j => j.audience);

  // top / flop médias (sur toute la vie du média)
  const { rows: top } = await pool.query(
    `SELECT id, kind, filename, avg_likes, best_likes, times_posted FROM autopost_media
     WHERE model_id = $1 AND avg_likes IS NOT NULL AND kind <> 'story' ORDER BY avg_likes DESC LIMIT 5`, [modelId]);
  const { rows: flops } = await pool.query(
    `SELECT id, kind, filename, avg_likes, times_posted FROM autopost_media
     WHERE model_id = $1 AND avg_likes IS NOT NULL AND kind <> 'story' AND times_posted >= 2 AND disabled = false ORDER BY avg_likes ASC LIMIT 3`, [modelId]);

  // jours avec plus de publications => plus d'abonnés / de revenus ?
  const { rows: daily } = await pool.query(
    `SELECT d.date, d.revenue, d.new_subs,
       (SELECT COUNT(*) FROM autopost_jobs j WHERE j.model_id = d.model_id AND j.status = 'done'
          AND (j.done_at AT TIME ZONE 'Europe/Paris')::date = d.date)::int AS published
     FROM autopost_daily_stats d WHERE d.model_id = $1 AND d.date >= $2::date ORDER BY d.date`, [modelId, since]);
  let volumeEffect = null;
  if (daily.length >= 6) {
    const sorted = [...daily].sort((a, b) => a.published - b.published);
    const half = Math.floor(sorted.length / 2);
    const low = sorted.slice(0, half), high = sorted.slice(-half);
    if (avg(high.map(d => d.published)) > avg(low.map(d => d.published))) {
      volumeEffect = {
        lowPub: r1(avg(low.map(d => d.published))), highPub: r1(avg(high.map(d => d.published))),
        lowSubs: r1(avg(low.map(d => Number(d.new_subs) || 0))), highSubs: r1(avg(high.map(d => Number(d.new_subs) || 0))),
        lowRev: r1(avg(low.map(d => Number(d.revenue) || 0))), highRev: r1(avg(high.map(d => Number(d.revenue) || 0))),
      };
    }
  }

  // ---------- recommandations en clair ----------
  const tips = [];
  const k = bestWorst(byKind);
  if (k && k.ratio >= 1.25) {
    tips.push(`Les ${KIND_LABEL[k.best]} font ${fmtRatio(k.ratio)} de j'aime que les ${KIND_LABEL[k.worst]} (${k.bestAvg} vs ${k.worstAvg} en moyenne).`);
    const cur = Number(s[{ post: 'posts_per_day', reel: 'reels_per_day' }[k.best]]) || 0;
    tips.push(`👉 Je te conseille de passer à ${cur + 1} ${KIND_LABEL[k.best]} par jour pour ${model.name}.`);
  }
  const f = bestWorst(byFormat);
  if (f && f.ratio >= 1.25) tips.push(`En post, les ${f.best}s marchent mieux que les ${f.worst}s (${f.bestAvg} vs ${f.worstAvg} j'aime).`);
  const sl = bestWorst(bySlot);
  if (sl && sl.ratio >= 1.25) {
    const lb = x => SLOTS.find(z => z.key === x).label;
    tips.push(`Le meilleur créneau c'est ${lb(sl.best)} (${sl.bestAvg} j'aime en moyenne), le pire ${lb(sl.worst)} (${sl.worstAvg}).`);
  }
  const d = bestWorst(byDay);
  if (d && d.ratio >= 1.3) tips.push(`Meilleur jour : le ${d.best} (${d.bestAvg} j'aime), le moins bon : le ${d.worst} (${d.worstAvg}).`);
  if (byRotation.rotation?.n >= MIN_SAMPLE && byRotation.neuf?.n >= MIN_SAMPLE) {
    const ratio = byRotation.neuf.avg > 0 ? byRotation.rotation.avg / byRotation.neuf.avg : 1;
    if (ratio < 0.7) tips.push(`Les reposts font nettement moins que le contenu neuf (${byRotation.rotation.avg} vs ${byRotation.neuf.avg}) : augmente le délai avant de reposter ou ajoute du neuf.`);
    else if (ratio >= 0.9) tips.push(`Les reposts tiennent bien la route (${byRotation.rotation.avg} vs ${byRotation.neuf.avg} pour le neuf) : la rotation fonctionne.`);
  }
  const c = bestWorst(byCaption);
  if (c && c.ratio >= 1.25) tips.push(`Les posts ${c.best} légende font mieux que ${c.worst} (${c.bestAvg} vs ${c.worstAvg}).`);
  if (flops.length && top.length && flops[0].avg_likes < (top[0].avg_likes || 0) / 3) {
    tips.push(`À sortir de la rotation : ${flops.map(x => x.filename || '#' + x.id).join(', ')} (très peu de j'aime à chaque fois).`);
  }
  if (volumeEffect && volumeEffect.highSubs > volumeEffect.lowSubs * 1.2) {
    tips.push(`Les jours où ${model.name} publie le plus (~${volumeEffect.highPub}/jour) elle gagne ${volumeEffect.highSubs} abonnés en moyenne contre ${volumeEffect.lowSubs} les jours calmes : publier plus paie.`);
  }
  const total = jobs.length;
  if (total && failed.length / total > 0.15) tips.push(`⚠️ ${failed.length} publications ratées sur ${total} : regarde l'historique (captures d'erreur).`);
  if (skipped.length) tips.push(`⚠️ ${skipped.length} créneaux sautés faute de contenu : remets du stock.`);
  if (!scored.length) tips.push(`Pas encore assez de données (il faut des posts publiés depuis au moins 24 h pour avoir les j'aime).`);
  else if (tips.length === 0) tips.push(`Rien de flagrant pour l'instant, les résultats sont homogènes. Je repasse la semaine prochaine.`);

  const summary =
    `📊 ${model.name} — ${days} derniers jours\n` +
    `${done.length} publiées (${done.filter(j => j.kind === 'post').length} posts, ${done.filter(j => j.kind === 'reel').length} reels, ${done.filter(j => j.kind === 'story').length} stories)` +
    (failed.length ? `, ${failed.length} ratées` : '') + '\n\n' + tips.map(t => '• ' + t).join('\n');

  const data = { days, byKind, byFormat, bySlot, byDay, byRotation, byCaption, byAudience, top, flops, volumeEffect,
    counts: { done: done.length, failed: failed.length, skipped: skipped.length, scored: scored.length } };

  if (save) {
    const end = new Date();
    await pool.query(
      `INSERT INTO autopost_reports (agency_id, model_id, period_start, period_end, summary, data) VALUES ($1,$2,$3,$4,$5,$6)`,
      [model.agency_id, modelId, since.toISOString().slice(0, 10), end.toISOString().slice(0, 10), summary, JSON.stringify(data)]);
  }
  return { summary, data };
}

module.exports = { generateReport, slotOf, parisHourDay };
