// MyM ne montre que la part de la modèle. Pour comparer avec Reveal (TTC), on estime ce que le fan a payé.
// Règle publiée par MyM : sur le prix TTC payé par un fan français (TVA 20 %), MyM retire 7 % de frais
// bancaires (calculés sur le TTC) du prix HT, puis reverse 80 % (médias privés, pourboires, shows)
// ou 75 % (abonnements).
//   part modèle = (TTC / 1,2 − 0,07 × TTC) × taux  →  TTC = part ÷ (0,7633 × taux)
// Le graphique MyM jour par jour ne précise pas le type de vente : on applique le taux à 80 %.
// Dans le cas d'un fan hors de France, la TVA (et donc l'estimation) change un peu.
const SHARE = 1 / 1.2 - 0.07;            // ≈ 0,7633 : part du TTC qui reste avant le reversement
const RATE = { default: 0.80, subscription: 0.75 };
const FACTOR = SHARE * RATE.default;     // ≈ 0,6107

function netToTtc(netCents, type) {
  const rate = /abonnement|subscription/i.test(type || '') ? RATE.subscription : RATE.default;
  return Math.round((Number(netCents) || 0) / (SHARE * rate));
}

const MYM_TTC_NOTE = 'MyM ne donne que la part de la modèle : le TTC est estimé (part ÷ 0,61, d\'après les frais et le reversement de 80 % annoncés par MyM pour un fan français).';

module.exports = { netToTtc, FACTOR, MYM_TTC_NOTE };
