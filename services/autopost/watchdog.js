// Surveillance du bot depuis le site : si le worker ne donne plus signe de vie, WhatsApp (une fois par panne).
const pool = require('../../db/pool');
const { sendWhatsApp } = require('../whatsapp');

const DOWN_AFTER_MIN = 10;
let downSince = null;

async function check() {
  try {
    const { rows: act } = await pool.query(
      `SELECT DISTINCT s.agency_id FROM autopost_settings s LEFT JOIN autopost_agency a ON a.agency_id = s.agency_id
       WHERE s.enabled = true AND COALESCE(a.paused, false) = false`);
    if (!act.length) { downSince = null; return; } // personne n'utilise le bot : rien à surveiller
    const { rows } = await pool.query(`SELECT MAX(last_seen) AS t FROM autopost_worker`);
    const last = rows[0]?.t ? new Date(rows[0].t) : null;
    const down = !last || Date.now() - last.getTime() > DOWN_AFTER_MIN * 60000;
    if (down && !downSince) {
      downSince = new Date();
      for (const a of act) {
        const { rows: f } = await pool.query(`SELECT whatsapp_failures FROM autopost_agency WHERE agency_id = $1`, [a.agency_id]);
        if (f[0]?.whatsapp_failures === false) continue;
        await sendWhatsApp(`🛑 Auto-post Reveal : le bot ne répond plus depuis ${DOWN_AFTER_MIN} min, plus rien n'est publié.\n👉 Vérifie le service « lcx-autopost-worker » sur Render (onglet Logs / Events).`, a.agency_id);
      }
    } else if (!down && downSince) {
      downSince = null;
      for (const a of act) await sendWhatsApp(`✅ Auto-post Reveal : le bot est de nouveau en ligne.`, a.agency_id);
    }
  } catch (e) { console.log('[AUTOPOST] watchdog :', e.message); }
}

function start() {
  setTimeout(check, 60000);
  setInterval(check, 5 * 60000);
}

module.exports = { start, check };
