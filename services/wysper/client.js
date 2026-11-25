// Client de l'API Wysper v1 (lecture seule). Doc : https://wysper.io/docs/api
const BASE = (process.env.WYSPER_API_BASE || 'https://wysper.io/api/v1').replace(/\/$/, '');

class WysperApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const MESSAGES = {
  400: 'Requête refusée par Wysper',
  401: 'Clé Wysper refusée : absente, révoquée ou mal copiée. Crée une nouvelle clé dans Wysper > Intégrations et colle-la dans le CRM.',
  403: 'Accès refusé par Wysper pour cette clé',
  404: 'Introuvable côté Wysper',
  429: 'Trop d\'appels à l\'API Wysper, nouvel essai plus tard',
  503: 'Wysper prépare encore ces données, nouvel essai plus tard',
};

async function call(key, method, path, query = {}, body) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt === 3) throw new WysperApiError(0, 'Wysper injoignable : ' + e.message);
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
      continue;
    }
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      const wait = Math.min(60, Number(r.headers.get('retry-after')) || 5);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    if (!r.ok) {
      let err = {};
      try { err = (await r.json()).error || {}; } catch (e) { /* vide */ }
      throw new WysperApiError(r.status, (MESSAGES[r.status] || `Erreur Wysper ${r.status}`) + (err.message && r.status !== 401 ? ` (${String(err.message).slice(0, 150)})` : ''), err.code);
    }
    return r.json();
  }
}

// parcourt toutes les pages d'une liste ({ data, has_more, next_cursor })
async function* pages(key, path, query) {
  let cursor;
  for (let i = 0; i < 1000; i++) {
    const r = await call(key, 'GET', path, { ...query, limit: 200, cursor });
    yield r.data || [];
    if (!r.has_more || !r.next_cursor) return;
    cursor = r.next_cursor;
  }
}

module.exports = {
  BASE, WysperApiError, call, pages,
  accounts: key => call(key, 'GET', '/accounts'),
  trackingLinks: (key, q) => call(key, 'GET', '/tracking/links', q),
  testWebhook: (key, type) => call(key, 'POST', '/webhooks/test', {}, { type }),
};
