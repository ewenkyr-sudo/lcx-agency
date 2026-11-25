// Lecture des pages de creators.mym.fans (HTML rendu côté serveur).
// Rien d'autre que de la lecture : profil (abonnés), revenus (total, soldes, graphique jour par jour,
// récap mensuel) et liste des transactions.

const decode = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const text = html => decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// "10,803.52 €" / "10 803,52 €" / "+3.93 €" / "0 €"  -> centimes
function money(s) {
  let v = decode(s).replace(/[^\d,.\-+]/g, '');
  if (!v || !/\d/.test(v)) return null;
  if (/,\d{1,2}$/.test(v) && !/\.\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function isLoginPage(html) {
  return /\/app\/login/.test(String(html || '').slice(0, 3000)) && /Mot de passe|password/i.test(html) && !/my-income|Mon profil/.test(html);
}

function parseProfile(html) {
  const t = text(html);
  const m = t.match(/(\d[\d\s,.]*)\s*abonn[ée]s?\b/i);
  return { subscribers: m ? Number(m[1].replace(/\D/g, '')) : null };
}

function parseIncomes(html) {
  const out = { total_cents: null, pending_cents: null, validated_cents: null, next_payout: null, daily: [], monthly: [] };
  const tot = html.match(/my-income__summary--total-amount[^>]*>\s*([^<]+?)\s*<span/);
  if (tot) out.total_cents = money(tot[1]);
  const t = text(html);
  const val = t.match(/([\d][\d.,\s]*)\s*€\s*Validé pour le prochain versement/i);
  const pen = t.match(/([\d][\d.,\s]*)\s*€\s*En attente de validation/i);
  if (val) out.validated_cents = money(val[1]);
  if (pen) out.pending_cents = money(pen[1]);
  const nx = t.match(/Prochain versement\s*(.{0,60}?)\s*Voir mes versements/i);
  if (nx) out.next_payout = nx[1].trim();

  // graphique « depuis la création » : [[timestamp, montant €], ...]
  // Vérifié sur un vrai compte : le point affiché « 25/11 00:00 (Paris) » = 2026-11-24T23:00Z contient
  // les ventes du 24/11 (heure de Paris). Le bon jour est donc la date UTC du timestamp.
  const ch = html.match(/data-charts="([^"]*)"/) || html.match(/data-charts='([^']*)'/);
  if (ch) {
    try {
      const pts = JSON.parse(decode(ch[1]));
      const byDay = {};
      for (const [ts, eur] of pts) {
        if (!Number.isFinite(Number(ts))) continue;
        const d = new Date(Number(ts)).toISOString().slice(0, 10);
        byDay[d] = (byDay[d] || 0) + Math.round(Number(eur) * 100);
      }
      out.daily = Object.entries(byDay).map(([date, net_cents]) => ({ date, net_cents })).sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { /* graphique illisible : on garde le reste */ }
  }

  // récap mensuel, avec le détail par catégorie (médias privés, pourboires, …)
  const chunks = html.split(/class="card-income card-income--monthly"/).slice(1);
  for (const c of chunks) {
    const month = c.match(/card-income__info--month">\s*([^<]+?)\s*</);
    const amt = c.match(/card-income__info--amount">\s*([^<]+?)\s*</);
    if (!month || !amt) continue;
    const parts = [];
    const re = /percent-bar-thick__details__label">\s*([^<]+?)\s*<\/div>\s*<div class="percent-bar-thick__details__value">\s*([^<]+?)\s*</g;
    let m;
    while ((m = re.exec(c))) parts.push({ label: decode(m[1]), amount_cents: money(m[2]) });
    out.monthly.push({ month: decode(month[1]), amount_cents: money(amt[1]), parts });
  }
  return out;
}

// liste des transactions (page Revenus ou /app/income-fetch?page=N)
function parseTransactions(html) {
  const list = [];
  const chunks = String(html || '').split(/<div class="card-income"(?=[^>]*data-transaction-id)/).slice(1);
  for (const c of chunks) {
    const id = c.match(/data-transaction-id="(\d+)"/);
    if (!id) continue;
    const type = c.match(/card-income__info--title">\s*([^<]+?)\s*</);
    const amt = c.match(/card-income__info--amount[^"]*">\s*([^<]+?)\s*</);
    const at = c.match(/datetime="([^"]+)"/);
    const st = c.match(/card-income__info--status card-income__info--status-([\w-]+)">\s*([^<]+?)\s*</);
    const fan = c.match(/\/app\/chat\/fan\/(\d+)\/init">\s*@?([^<\s]+)/);
    const order = c.match(/Commande #(\d+)/);
    list.push({
      id: id[1], type: type ? decode(type[1]) : null, amount_cents: amt ? money(amt[1]) : null,
      at: at ? at[1] : null, status: st ? st[1] : null, status_label: st ? decode(st[2]) : null,
      fan_id: fan ? fan[1] : null, fan_username: fan ? decode(fan[2]) : null, order_no: order ? order[1] : null,
    });
  }
  return list;
}

module.exports = { money, text, isLoginPage, parseProfile, parseIncomes, parseTransactions };
