const https = require('https');
const pool = require('../db/pool');

async function sendWhatsAppToNumber(number, apiKey, message, provider) {
  number = number.replace(/[^0-9]/g, '');
  if (!number || !apiKey) return;
  if (provider === 'callmebot' || !provider) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${number}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    httpGet(url).catch(e => console.log('WhatsApp error:', e.message));
  }
}

async function sendWhatsApp(message, agencyId) {
  try {
    const aid = agencyId || 1;
    const { rows } = await pool.query("SELECT key, value FROM settings WHERE key IN ('whatsapp_number', 'whatsapp_api_key', 'whatsapp_provider', 'whatsapp_extra_recipients') AND (agency_id = $1 OR agency_id IS NULL) ORDER BY agency_id DESC NULLS LAST", [aid]);
    const settings = {};
    rows.forEach(r => { if (!settings[r.key]) settings[r.key] = r.value; });
    if (!settings.whatsapp_number || !settings.whatsapp_api_key) return;

    const provider = settings.whatsapp_provider || 'callmebot';
    // Send to primary number
    await sendWhatsAppToNumber(settings.whatsapp_number, settings.whatsapp_api_key, message, provider);
    // Send to extra recipients (format: number:apikey,number:apikey)
    if (settings.whatsapp_extra_recipients) {
      const extras = settings.whatsapp_extra_recipients.split(',').map(s => s.trim()).filter(Boolean);
      for (const entry of extras) {
        const [num, key] = entry.split(':').map(s => s.trim());
        if (num && key) {
          await new Promise(r => setTimeout(r, 2000)); // CallMeBot rate limit
          await sendWhatsAppToNumber(num, key, message, provider);
        }
      }
    }
  } catch(e) { console.log('WhatsApp send error:', e.message); }
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


module.exports = { sendWhatsApp, sendWhatsAppToNumber, getNotifSetting, isNotifEnabled };
