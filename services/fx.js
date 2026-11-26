// Taux de change du jour (Banque centrale européenne, via frankfurter.app), gardé 12 h en mémoire.
// Sert à afficher en euros les plateformes qui comptent en dollars (OnlyFans).
let cache = { at: 0, rates: {} };
const FALLBACK = { USD: Number(process.env.FX_USD_EUR) || 0.92 };

async function toEurRate(currency) {
  currency = String(currency || 'EUR').toUpperCase();
  if (currency === 'EUR') return 1;
  if (Date.now() - cache.at < 12 * 3600000 && cache.rates[currency]) return cache.rates[currency];
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=EUR`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const v = Number(j?.rates?.EUR);
    if (v > 0) { cache = { at: Date.now(), rates: { ...cache.rates, [currency]: v } }; return v; }
  } catch (e) { /* hors ligne : taux de secours */ }
  return cache.rates[currency] || FALLBACK[currency] || 1;
}

module.exports = { toEurRate };
