// Client de l'API officielle Reveal (lecture seule). Doc : dashboard Reveal > Paramètres > CRM / API.
const BASE = (process.env.REVEAL_API_BASE || 'https://api.reveal.me').replace(/\/$/, '');

class RevealApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MESSAGES = {
  400: 'Requête refusée par Reveal (dates ou curseur invalides)',
  401: 'Clé API refusée : absente, révoquée ou expirée. Crée une nouvelle clé dans Reveal et colle-la dans le CRM.',
  403: "Accès refusé : la clé n'a pas le droit demandé (Statistiques ou Ventes une par une) ou l'API est coupée pour l'agence",
  404: 'Introuvable côté Reveal',
  429: 'Trop d\'appels à l\'API Reveal, nouvel essai plus tard',
};

async function call(apiKey, path, query = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetch(url, { headers: { 'x-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (attempt === 2) throw new RevealApiError(0, 'Reveal injoignable : ' + e.message);
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
      continue;
    }
    if (r.status === 429 && attempt < 2) {
      const wait = Math.min(60, Number(r.headers.get('retry-after')) || 10);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 200); } catch (e) { /* vide */ }
      throw new RevealApiError(r.status, (MESSAGES[r.status] || `Erreur Reveal ${r.status}`) + (detail && r.status >= 500 ? ` (${detail})` : ''));
    }
    return r.json();
  }
}

module.exports = {
  BASE, RevealApiError,
  models: key => call(key, '/v1/models'),
  chatters: key => call(key, '/v1/chatters'),
  statsDaily: (key, from, to) => call(key, '/v1/stats/daily', { from, to }),
  chattersDaily: (key, from, to) => call(key, '/v1/stats/chatters/daily', { from, to }),
  trackingLinks: key => call(key, '/v1/tracking-links'),
  trackingDaily: (key, from, to) => call(key, '/v1/stats/tracking-links/daily', { from, to }),
  sales: (key, since, take = 500) => call(key, '/v1/sales', { since, take }),
};
