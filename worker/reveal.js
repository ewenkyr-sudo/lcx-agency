// Pilotage de dashboard.reveal.me avec Playwright (parcours relevés sur l'interface réelle, nov. 2026).
// Si Reveal change son interface, c'est ce fichier qu'il faut adapter.
const BASE = process.env.REVEAL_BASE || 'https://dashboard.reveal.me';

const AUDIENCE_LABEL = { subscribers: 'Abonnés uniquement', public: 'Feed public', video: 'Feed vidéo' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const human = (min = 900, max = 2600) => sleep(min + Math.random() * (max - min));

class SessionExpired extends Error {}

// Cherche une fois un bouton / option / texte visible, en priorité dans la fenêtre du dessus
async function findOnce(page, text, exact) {
  for (const loc of [page.getByRole('button', { name: text, exact }), page.getByRole('radio', { name: text, exact }), page.getByText(text, { exact })]) {
    const n = await loc.count();
    for (let i = n - 1; i >= 0; i--) {
      const el = loc.nth(i);
      try { if (await el.isVisible() && await el.isEnabled()) return el; } catch (e) { /* élément détaché */ }
    }
  }
  return null;
}

// Premier élément visible parmi un ou plusieurs libellés possibles
async function visibleAny(page, texts, { exact = false, timeout = 30000 } = {}) {
  const end = Date.now() + timeout;
  do {
    for (const t of texts) { const el = await findOnce(page, t, exact); if (el) return el; }
    await sleep(400);
  } while (Date.now() < end);
  throw new Error(`Élément introuvable à l'écran : « ${texts.join(' » ou « ')} »`);
}

async function visible(page, text, opts) { return visibleAny(page, [text], opts); }

async function isShown(page, text) {
  const loc = page.getByText(text, { exact: true });
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible().catch(() => false)) return true;
  return false;
}

async function waitGone(page, text, timeout = 120000) {
  const end = Date.now() + timeout;
  while (await isShown(page, text)) {
    if (Date.now() > end) throw new Error(`« ${text} » toujours affiché après ${Math.round(timeout / 1000)} s`);
    await sleep(800);
  }
}

// Ouvre une page modèle et vérifie qu'on est bien connecté
async function openModelPage(page, revealId, sub) {
  await page.goto(`${BASE}/models/${revealId}/${sub}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await visible(page, 'Publications', { exact: true, timeout: 25000 });
  } catch (e) {
    const url = page.url();
    if (/login|connexion|sign-?in/i.test(url) || await isShown(page, 'Se connecter') || await isShown(page, 'Connexion')) {
      throw new SessionExpired('Session Reveal expirée : reconnecte le compte agence dans le CRM');
    }
    throw new Error("La page modèle Reveal ne s'affiche pas (identifiant Reveal faux ou site en panne ?)");
  }
  await human(1500, 3000);
}

async function typeHuman(locator, text) {
  await locator.click();
  await locator.fill('');
  for (const ch of text) await locator.pressSequentially(ch, { delay: 30 + Math.random() * 90 });
}

// Import d'un fichier dans la fenêtre "Ajouter des médias" (commune aux posts et stories)
async function importMedia(page, filePath) {
  await page.getByText('Ajouter des médias', { exact: true }).last().waitFor({ timeout: 20000 });
  await page.locator('[role=dialog] input[type=file]').last().setInputFiles(filePath);
  await human(1200, 2200);
  // le bouton s'appelle « Importer » quand la fenêtre est vide, puis « Ajouter » une fois le fichier choisi
  await (await visibleAny(page, ['Ajouter', 'Importer'], { exact: true })).click();
  await waitGone(page, 'Ajouter des médias', 10 * 60000); // grosses vidéos : jusqu'à 10 min
  await human(2500, 4000);
}

// ---------- POST et REEL ----------
async function publishPost(page, { revealId, filePath, caption, audience, dryRun }) {
  await openModelPage(page, revealId, 'publications');
  await (await visible(page, 'Publiez pour être mis en avant')).click();
  await visible(page, 'Nouveau post', { exact: true });
  await human();
  await (await visible(page, AUDIENCE_LABEL[audience] || AUDIENCE_LABEL.subscribers)).click();
  await human();
  if (caption) await typeHuman(page.locator('[role=dialog] textarea[name=message]').last(), caption);
  await human();
  await (await visible(page, "Importer depuis l'ordinateur")).click();
  await importMedia(page, filePath);
  const btn = await visible(page, 'Poster', { exact: true });
  if (dryRun) return { dryRun: true };
  await btn.click();
  await waitGone(page, 'Nouveau post', 120000);
  return { ok: true };
}

// ---------- STORY ----------
async function publishStory(page, { revealId, filePath, caption, audience, dryRun }) {
  await openModelPage(page, revealId, 'stories');
  await (await visible(page, 'Nouvelle story')).click();
  await visible(page, 'Créer une nouvelle story', { exact: true });
  await human();
  await (await visible(page, 'Upload', { exact: true })).click();
  await importMedia(page, filePath);
  if (caption) await typeHuman(page.locator('[role=dialog] textarea[name=content]').last(), caption.slice(0, 280));
  // 1er interrupteur = "Story publique"
  const sw = page.locator('[role=dialog] [role=switch]').first();
  const wantPublic = audience !== 'subscribers';
  if (((await sw.getAttribute('aria-checked')) === 'true') !== wantPublic) { await sw.click(); await human(); }
  const btn = await visible(page, 'Publier la story', { exact: true });
  if (dryRun) return { dryRun: true };
  await btn.click();
  await waitGone(page, 'Créer une nouvelle story', 120000);
  return { ok: true };
}

// ---------- lecture des posts (j'aime) ----------
// Le dashboard charge les posts depuis l'API Reveal (…/models/<id>/posts). On écoute cette réponse.
const LIKE_KEYS = ['likesCount', 'likes_count', 'likeCount', 'nbLikes', 'totalLikes', 'likes', 'reactionsCount'];
const DATE_KEYS = ['publishedAt', 'published_at', 'publicationDate', 'scheduledAt', 'scheduled_at', 'createdAt', 'created_at', 'date'];

function findPostArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const k of ['data', 'items', 'posts', 'results', 'content', 'rows']) {
      if (Array.isArray(json[k])) return json[k];
      if (json[k] && typeof json[k] === 'object') { const a = findPostArray(json[k]); if (a.length) return a; }
    }
  }
  return [];
}
function pick(o, keys) {
  for (const k of keys) {
    if (o[k] == null) continue;
    if (Array.isArray(o[k])) return o[k].length;
    if (typeof o[k] === 'object' && o[k].count != null) return o[k].count;
    return o[k];
  }
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) { const r = pick(v, keys); if (r != null) return r; }
  return null;
}
function parsePosts(json) {
  return findPostArray(json).filter(p => p && typeof p === 'object' && (p.id || p.uuid)).map(p => {
    const likes = Number(pick(p, LIKE_KEYS));
    const d = pick(p, DATE_KEYS);
    const mediaNames = Array.isArray(p.medias) ? p.medias.map(m => m && m.name).filter(Boolean) : [];
    return { id: String(p.id || p.uuid), likes: Number.isFinite(likes) ? likes : null, date: d ? new Date(d) : null, mediaNames, archived: !!p.isArchived, raw: p };
  });
}

async function collectPosts(page, revealId) {
  const found = [];
  const re = new RegExp(`/models/${revealId}/posts(\\?|$)`);
  const onResp = async resp => {
    try {
      if (!re.test(resp.url()) || resp.request().method() !== 'GET') return;
      const ct = resp.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      found.push(...parsePosts(await resp.json()));
    } catch (e) { /* réponse illisible */ }
  };
  page.on('response', onResp);
  try {
    await openModelPage(page, revealId, 'publications');
    await sleep(4000);
    // fait défiler pour charger plus de posts
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await sleep(1500); }
  } finally { page.off('response', onResp); }
  const byId = new Map();
  for (const p of found) byId.set(p.id, p);
  return [...byId.values()];
}

// ---------- archivage d'anciens posts (rotation) ----------
// Même action que le menu ⋯ > « Archiver » du dashboard : PATCH <api>/posts/<id>/archive avec le jeton de la session.
// Le jeton et l'adresse de l'API sont repris d'une requête que le dashboard fait lui-même.
async function archivePosts(page, revealId, postIds) {
  let auth = null, apiBase = null;
  const re = new RegExp(`^(.*)/models/${revealId}/posts`);
  const onReq = req => {
    const m = re.exec(req.url());
    const a = req.headers()['authorization'];
    if (m && a && !auth) { auth = a; apiBase = m[1]; }
  };
  page.on('request', onReq);
  try {
    await openModelPage(page, revealId, 'publications');
    const end = Date.now() + 15000;
    while (!auth && Date.now() < end) await sleep(300);
  } finally { page.off('request', onReq); }
  if (!auth) throw new Error("Impossible de récupérer l'accès à l'API Reveal pour archiver");
  const results = [];
  for (const id of postIds) {
    await human(800, 1800);
    const r = await page.request.patch(`${apiBase}/posts/${encodeURIComponent(id)}/archive`, { headers: { Authorization: auth, Accept: 'application/json' } });
    let likes = null;
    try { const j = await r.json(); likes = Number(pick(j, LIKE_KEYS)); if (!Number.isFinite(likes)) likes = null; } catch (e) { /* corps vide */ }
    results.push({ id, ok: r.ok(), status: r.status(), likes });
  }
  return results;
}

// ---------- stats du jour (page Statistiques, vue "Jour") ----------
function parseEuro(s) { return s == null ? null : Number(String(s).replace(/\s| /g, '').replace(',', '.').replace('€', '')); }
async function collectDailyStats(page, revealId) {
  await openModelPage(page, revealId, '');
  try { await (await visible(page, 'Jour', { exact: true, timeout: 10000 })).click(); await sleep(3000); } catch (e) { /* vue par défaut */ }
  const text = await page.evaluate(() => document.body.innerText);
  const grab = label => { const m = new RegExp(label + '\\s*\\n+\\s*([\\d\\s\\u202f.,]+)').exec(text); return m ? m[1].trim() : null; };
  return {
    revenue: parseEuro(grab('Revenu modèle')),
    new_subs: grab('Nouveaux abonnés') ? parseInt(grab('Nouveaux abonnés').replace(/\D/g, ''), 10) : null,
    sales: grab('Ventes') ? parseInt(grab('Ventes').replace(/\D/g, ''), 10) : null,
  };
}

// 'ok' | 'expired' (page de connexion) | 'unknown' (Reveal ne répond pas)
async function sessionState(page) {
  try { await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { return 'unknown'; }
  try { await visible(page, 'Dashboard', { exact: true, timeout: 25000 }); }
  catch (e) {
    if (/login|connexion|sign-?in/i.test(page.url()) || await isShown(page, 'Se connecter') || await isShown(page, 'Connexion')) return 'expired';
    return 'unknown';
  }
  await sleep(4000); // laisse le dashboard renouveler ses jetons
  return 'ok';
}
async function checkSession(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await visible(page, 'Dashboard', { exact: true, timeout: 25000 }); return true; } catch (e) { return false; }
}

// ---------- mass DM (SFS) ----------
// Même appel que le bouton « Programmer un mass DM » du dashboard : POST <api>/mass-dm avec le jeton de la session.
// Reveal envoie lui-même le message à l'heure prévue (plannedAt) : le bot n'a pas besoin d'être en ligne à ce moment-là.
async function apiAccess(page, revealId) {
  let auth = null, apiBase = null;
  const onReq = req => {
    const a = req.headers()['authorization'];
    if (!a || auth) return;
    // l'API est sur un autre domaine que le dashboard (https://api.reveal.me/...) ; on prend la base devant /mass-dm, /models…
    const m = /^(https?:\/\/.+?)\/(mass-dm|models|users|conversations|fan-lists)(\/|\?|$)/.exec(req.url());
    if (m) { auth = a; apiBase = m[1]; }
  };
  page.on('request', onReq);
  try {
    await openModelPage(page, revealId, 'mass-dm');
    const end = Date.now() + 20000;
    while (!auth && Date.now() < end) await sleep(300);
  } finally { page.off('request', onReq); }
  if (!auth) throw new Error("Impossible de récupérer l'accès à l'API Reveal (mass DM)");
  return { auth, apiBase };
}

async function apiCall(page, access, method, path, body) {
  const r = await page.request.fetch(access.apiBase + path, {
    method, headers: { Authorization: access.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* corps vide */ }
  if (r.status() === 401) throw new SessionExpired('Session Reveal expirée');
  if (!r.ok()) {
    const msg = j && (j.message || j.error) ? (Array.isArray(j.message) ? j.message.join(', ') : (j.message || j.error)) : '';
    const e = new Error(`Reveal a refusé (${r.status()})${msg ? ' : ' + msg : ''}`);
    e.status = r.status();
    throw e;
  }
  return j;
}

// audience : 'active' (abonnés) ou 'expired' (anciens abonnés). Toujours gratuit (price 0).
async function createMassDM(page, access, { revealId, content, plannedAt, audience }) {
  const subscribersStatus = audience === 'expired' ? 'expired' : 'active';
  const j = await apiCall(page, access, 'POST', '/mass-dm', {
    massDM: { content, plannedAt: new Date(plannedAt).toISOString(), price: 0, modelId: revealId, status: 'pending', subscribersStatus },
    subscribersStatus,
  });
  const id = j && (j.id || (j.massDM && j.massDM.id));
  if (!id) throw new Error('Reveal n\'a pas renvoyé l\'identifiant du mass DM');
  return { id: String(id), raw: j };
}

// Mass DM avec photos / vidéos : on passe par la fenêtre « Programmer un mass DM » du dashboard,
// comme une personne (l'import des médias de Reveal se fait dans le navigateur).
function parisLocal(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
async function createMassDMViaUI(page, { revealId, content, plannedAt, audience, files }) {
  await openModelPage(page, revealId, 'mass-dm');
  await (await visible(page, 'Programmer un mass DM', { exact: true })).click();
  const dlg = page.locator('[role=dialog]').filter({ has: page.locator('textarea[name=content]') }).last();
  await dlg.waitFor({ timeout: 20000 });
  await human(800, 1500);
  // destinataires : 1re case = abonnés, 2e = anciens abonnés
  const box = dlg.locator('button[role=checkbox]').nth(audience === 'expired' ? 1 : 0);
  if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
  await human(400, 900);
  if ((await box.getAttribute('aria-checked')) !== 'true') throw new Error('Impossible de choisir les destinataires du mass DM');
  await typeHuman(dlg.locator('textarea[name=content]'), content);
  await human(500, 1000);
  const at = dlg.locator('input[name=plannedAt]');
  if (!(await at.isVisible().catch(() => false))) { await dlg.getByText('À une date', { exact: true }).click(); await human(400, 800); }
  await at.fill(parisLocal(plannedAt));
  await human(500, 1000);
  await dlg.getByText("Importer depuis l'ordinateur", { exact: true }).click();
  await importMedia(page, files);
  const price = dlg.locator('input[name=price]');
  if (await price.isVisible().catch(() => false)) await price.fill('0');
  const resP = page.waitForResponse(r => r.request().method() === 'POST' && /\/mass-dm(\?|$)/.test(r.url()), { timeout: 120000 });
  await dlg.getByRole('button', { name: 'Envoyer', exact: true }).click();
  const res = await resP;
  if (res.status() === 401) throw new SessionExpired();
  const j = await res.json().catch(() => null);
  if (!res.ok()) throw new Error(`Reveal a refusé le mass DM (${res.status()}${j && j.message ? ' : ' + String(j.message).slice(0, 120) : ''})`);
  await dlg.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  const id = j && (j.id || (j.massDM && j.massDM.id) || (j.data && (j.data.id || (j.data.massDM && j.data.massDM.id))));
  return { id: id ? String(id) : null, raw: j };
}

async function deleteMassDM(page, access, id) {
  try { return await apiCall(page, access, 'DELETE', '/mass-dm/' + encodeURIComponent(id)); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

// mass DM d'une modèle sur une période (pour savoir s'ils sont partis et à combien de fans)
async function listMassDMs(page, access, revealId, from, to) {
  const q = new URLSearchParams({ modelId: revealId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), take: '50', includeActiveTriggers: 'true' });
  const j = await apiCall(page, access, 'GET', '/mass-dm?' + q.toString());
  return ((j && j.data) || []).map(x => x.massDM || x);
}

module.exports = { BASE, sessionState, createMassDMViaUI, parisLocal, publishPost, publishStory, collectPosts, archivePosts, collectDailyStats, checkSession, parsePosts, SessionExpired,
  apiAccess, createMassDM, deleteMassDM, listMassDMs };
