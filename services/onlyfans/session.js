// Session OnlyFans : ce qu'il faut pour ouvrir le site comme si on était connecté.
// Accepte :
//  - l'export du favori « Session OnlyFans » {v, site:'onlyfans', cookies:'a=b; …', local:{…}, session:{…}, ua}
//  - un export de cookies au format JSON (extension type Cookie-Editor) : [{name, value, domain, …}, …]
//  - un storageState Playwright {cookies:[…], origins:[…]}
const ORIGIN = 'https://onlyfans.com';
const OF_PERIOD_NET = 0.8;   // OnlyFans garde 20 % : brut = net ÷ 0,8

function cookieObj(c) {
  const sameSite = { lax: 'Lax', strict: 'Strict', none: 'None', no_restriction: 'None', unspecified: 'Lax' }[String(c.sameSite || 'lax').toLowerCase()] || 'Lax';
  const exp = c.expires != null ? Number(c.expires) : c.expirationDate != null ? Number(c.expirationDate) : -1;
  return { name: String(c.name), value: String(c.value), domain: c.domain || '.onlyfans.com', path: c.path || '/', secure: c.secure !== false, httpOnly: !!c.httpOnly, sameSite, expires: Number.isFinite(exp) ? exp : -1 };
}

function normalize(input) {
  let o = input;
  if (typeof o === 'string') {
    try { o = JSON.parse(o.trim()); } catch (e) { throw new Error('Export illisible : relance le favori « Session OnlyFans » sur onlyfans.com'); }
  }
  if (!o || typeof o !== 'object') throw new Error('Export vide');
  let cookies = [], local = {}, session = {}, ua = null;
  if (Array.isArray(o)) { // export de cookies (extension)
    cookies = o.filter(c => c && c.name && /onlyfans\.com$/.test(String(c.domain || '.onlyfans.com').replace(/^\./, ''))).map(cookieObj);
  } else if (o.origins) { // storageState
    cookies = (o.cookies || []).map(cookieObj);
    const og = o.origins.find(x => x.origin === ORIGIN) || {};
    (og.localStorage || []).forEach(kv => { local[kv.name] = kv.value; });
  } else {
    if (o.site && o.site !== 'onlyfans') throw new Error('Cet export ne vient pas d\'OnlyFans');
    local = o.local || {}; session = o.session || {}; ua = typeof o.ua === 'string' ? o.ua.slice(0, 300) : null;
    cookies = String(o.cookies || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.indexOf('=');
      return cookieObj({ name: s.slice(0, i), value: s.slice(i + 1) });
    });
    if (Array.isArray(o.cookieList)) cookies = cookies.concat(o.cookieList.map(cookieObj));
  }
  const names = new Set(cookies.map(c => c.name));
  if (!names.has('auth_id')) throw new Error('Pas de connexion OnlyFans dans cet export : ouvre onlyfans.com en étant connecté au compte de la modèle, puis relance le favori.');
  if (!names.has('sess')) throw Object.assign(new Error('Il manque le cookie « sess » (OnlyFans le cache aux favoris). Exporte les cookies avec l\'extension Cookie-Editor (bouton Export > JSON) et colle ce texte à la place.'), { code: 'NO_SESS' });
  return { cookies, local, session, ua, savedAt: new Date().toISOString() };
}

function toPlaywright(sess) {
  return {
    storageState: { cookies: sess.cookies || [], origins: [{ origin: ORIGIN, localStorage: Object.entries(sess.local || {}).map(([name, value]) => ({ name, value })) }] },
    initScript: `(() => { try { if (location.origin !== ${JSON.stringify(ORIGIN)}) return; const s = ${JSON.stringify(sess.session || {})}; for (const k in s) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, s[k]); } catch (e) {} })();`,
  };
}

// Réponse « earnings/chart » : { <type>: { chartAmount:[{date, count}], chartCount:[…], total, gross } }
function parseChart(json) {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  for (const [type, v] of Object.entries(json)) {
    if (!v || !Array.isArray(v.chartAmount)) continue;
    const counts = {};
    (v.chartCount || []).forEach(x => { counts[String(x.date).slice(0, 10)] = Number(x.count) || 0; });
    v.chartAmount.forEach(x => {
      const date = String(x.date).slice(0, 10);   // OnlyFans compte les journées en UTC
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      out.push({ type, date, net_cents: Math.round((Number(x.count) || 0) * 100), sales: counts[date] || 0 });
    });
  }
  return out;
}

// liste des ventes : { list: [{ id, amount, vatAmount, net, fee, createdAt, currency, descriptionDetails:{type}, user:{id, username, name}, status }], hasMore }
function parseTransactions(json) {
  if (!json || !Array.isArray(json.list)) return [];
  const c = v => Math.round((Number(v) || 0) * 100);
  return json.list.filter(x => x && x.id && x.createdAt && x.net != null && x.amount != null).map(x => ({
    id: String(x.id), created_at: x.createdAt, currency: x.currency || null,
    amount_cents: c(x.amount), vat_cents: c(x.vatAmount), net_cents: c(x.net), fee_cents: c(x.fee),
    type: x.descriptionDetails?.type || null, status: x.status || null,
    fan_id: x.user?.id ?? null, fan_username: x.user?.username || null, fan_name: x.user?.displayName || x.user?.name || null,
  }));
}

// nombre d'abonnés : cherché dans la réponse users/me (le nom exact du champ peut changer)
function findSubscribers(json) {
  if (!json || typeof json !== 'object') return null;
  for (const k of ['subscribersCount', 'subscribers_count', 'subscribersCountActive', 'activeSubscribersCount']) {
    if (Number.isFinite(Number(json[k])) && json[k] !== null && json[k] !== '') return Number(json[k]);
  }
  return null;
}

// favori : copie cookies visibles + localStorage + sessionStorage
const BOOKMARKLET = "javascript:(()=>{if(!/(^|\\.)onlyfans\\.com$/.test(location.hostname)){alert('Ouvre onlyfans.com d\\'abord');return}const d={v:1,site:'onlyfans',cookies:document.cookie,local:{...localStorage},session:{...sessionStorage},ua:navigator.userAgent};if(!/(^|; )auth_id=/.test(d.cookies)){alert('Connecte-toi d\\'abord au compte OnlyFans de la modèle');return}const t=JSON.stringify(d);navigator.clipboard.writeText(t).then(()=>alert('Session OnlyFans copiée ✅ Colle-la dans le CRM (Stats OnlyFans > Connexion).'),()=>prompt('Copie ce texte :',t))})()";

module.exports = { ORIGIN, OF_PERIOD_NET, normalize, toPlaywright, parseChart, parseTransactions, findSubscribers, BOOKMARKLET };
