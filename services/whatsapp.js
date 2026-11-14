const https = require('https');
const pool = require('../db/pool');

// GET simple qui renvoie { status, body } (suit une redirection)
function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        return httpGet(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 20000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('CallMeBot ne répond pas (délai dépassé)')));
    req.on('error', reject);
  });
}

// CallMeBot refuse les messages trop rapprochés : on les envoie un par un, espacés
let queue = Promise.resolve();
const GAP_MS = 3000;
function enqueue(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, GAP_MS)));
  return p;
}

function textOf(html) { return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

// Renvoie { ok: true } ou { ok: false, error }
async function sendWhatsAppToNumber(number, apiKey, message, provider) {
  number = String(number || '').replace(/[^0-9]/g, '');
  apiKey = String(apiKey || '').trim();
  if (!number || !apiKey) return { ok: false, error: 'Numéro ou clé API manquant' };
  if (provider && provider !== 'callmebot') return { ok: false, error: `Fournisseur « ${provider} » non géré` };
  const url = `https://api.callmebot.com/whatsapp.php?phone=${number}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
  return enqueue(async () => {
    try {
      const { status, body } = await httpGet(url);
      const txt = textOf(body);
      // CallMeBot répond souvent 200 même en cas d'erreur : on lit le texte
      if (status < 300 && /queued|sent|envoy/i.test(txt) && !/error|invalid|not (yet )?activ/i.test(txt)) return { ok: true };
      const error = `CallMeBot (${status}) : ${txt.slice(0, 200) || 'réponse vide'}`;
      console.log('WhatsApp KO +' + number.slice(0, 4) + '… :', error);
      return { ok: false, error };
    } catch (e) {
      console.log('WhatsApp error:', e.message);
      return { ok: false, error: e.message };
    }
  });
}

// Envoie au numéro principal + destinataires supplémentaires. Renvoie { sent, errors }
async function sendWhatsApp(message, agencyId) {
  const out = { sent: 0, errors: [] };
  try {
    const aid = agencyId || 1;
    const { rows } = await pool.query("SELECT key, value FROM settings WHERE key IN ('whatsapp_number', 'whatsapp_api_key', 'whatsapp_provider', 'whatsapp_extra_recipients') AND (agency_id = $1 OR agency_id IS NULL) ORDER BY agency_id DESC NULLS LAST", [aid]);
    const settings = {};
    rows.forEach(r => { if (!settings[r.key]) settings[r.key] = r.value; });
    if (!settings.whatsapp_number || !settings.whatsapp_api_key) { out.errors.push('WhatsApp pas configuré (numéro ou clé API vide)'); return out; }

    const provider = settings.whatsapp_provider || 'callmebot';
    const targets = [[settings.whatsapp_number, settings.whatsapp_api_key]];
    // destinataires supplémentaires : « numéro:clé » séparés par virgules ou retours à la ligne
    for (const entry of String(settings.whatsapp_extra_recipients || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
      const [num, key] = entry.split(':').map(s => s.trim());
      if (num && key) targets.push([num, key]);
    }
    for (const [num, key] of targets) {
      const r = await sendWhatsAppToNumber(num, key, message, provider);
      if (r.ok) out.sent++; else out.errors.push(`${num} : ${r.error}`);
    }
  } catch (e) {
    console.log('WhatsApp send error:', e.message);
    out.errors.push(e.message);
  }
  return out;
}

async function getNotifSetting(key, agencyId) {
  const aid = agencyId || 1;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1 AND (agency_id = $2 OR agency_id IS NULL) ORDER BY agency_id DESC NULLS LAST LIMIT 1", [key, aid]);
  return rows[0]?.value;
}

async function isNotifEnabled(key, agencyId) {
  const val = await getNotifSetting(key, agencyId);
  return val !== 'false';
}


module.exports = { sendWhatsApp, sendWhatsAppToNumber, getNotifSetting, isNotifEnabled, httpGet };
