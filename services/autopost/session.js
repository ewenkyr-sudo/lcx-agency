// Session Reveal du compte agence : chiffrée en base (AES-256-GCM).
// Le dashboard Reveal garde sa connexion dans le localStorage / sessionStorage du navigateur.
// L'utilisateur la copie avec un favori (bookmarklet) depuis dashboard.reveal.me et la colle dans le CRM.
const crypto = require('crypto');

const REVEAL_ORIGIN = 'https://dashboard.reveal.me';

function key() {
  const secret = process.env.AUTOPOST_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('AUTOPOST_SECRET ou JWT_SECRET manquant');
  return crypto.createHash('sha256').update('autopost:' + secret).digest();
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

function decrypt(str) {
  const [iv, tag, data] = str.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

// Accepte : export du bookmarklet {v, origin, local, session, cookies}
//           ou un storageState Playwright {cookies, origins:[{origin, localStorage:[{name,value}]}]}
function normalize(input) {
  let o = input;
  if (typeof o === 'string') {
    try { o = JSON.parse(o.trim()); } catch (e) { throw new Error("Ce n'est pas un export valide (JSON illisible)"); }
  }
  if (!o || typeof o !== 'object') throw new Error('Export vide');

  let local = {}, session = {}, cookies = [];
  if (o.origins) { // storageState Playwright
    const og = o.origins.find(x => x.origin === REVEAL_ORIGIN) || o.origins[0] || {};
    (og.localStorage || []).forEach(kv => { local[kv.name] = kv.value; });
    cookies = o.cookies || [];
    session = o.sessionStorage || {};
  } else {
    local = o.local || {};
    session = o.session || {};
    cookies = (o.cookies || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.indexOf('=');
      return { name: s.slice(0, i), value: s.slice(i + 1), domain: '.reveal.me', path: '/', secure: true, sameSite: 'Lax', expires: -1 };
    });
  }
  const hasAuth = Object.keys(local).some(k => k.startsWith('auth_')) || Object.keys(session).some(k => k.startsWith('auth_'));
  if (!hasAuth) throw new Error("Aucune connexion Reveal dans cet export. Lance le favori depuis dashboard.reveal.me en étant connecté.");
  return { local, session, cookies, savedAt: new Date().toISOString() };
}

// Pour Playwright : storageState + script qui remet le sessionStorage
function toPlaywright(sess, origin = REVEAL_ORIGIN) {
  return {
    storageState: {
      cookies: sess.cookies || [],
      origins: [{ origin, localStorage: Object.entries(sess.local || {}).map(([name, value]) => ({ name, value })) }],
    },
    initScript: `(() => { try { if (location.origin !== ${JSON.stringify(origin)}) return; const s = ${JSON.stringify(sess.session || {})}; for (const k in s) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, s[k]); } catch (e) {} })();`,
  };
}

// Le favori à glisser dans la barre de favoris (copie la session dans le presse-papier)
const BOOKMARKLET = "javascript:(()=>{if(!location.hostname.endsWith('reveal.me')){alert('Ouvre dashboard.reveal.me d\\'abord');return}const d={v:1,origin:location.origin,local:{...localStorage},session:{...sessionStorage},cookies:document.cookie};const t=JSON.stringify(d);navigator.clipboard.writeText(t).then(()=>alert('Session Reveal copiée ✅ Colle-la dans le CRM (onglet Auto-post > Connexion).'),()=>prompt('Copie ce texte :',t))})()";

module.exports = { encrypt, decrypt, normalize, toPlaywright, BOOKMARKLET, REVEAL_ORIGIN };
