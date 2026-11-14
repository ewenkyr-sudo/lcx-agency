// ============ ACCÈS LIMITÉ À CERTAINES MODÈLES (associés) ============
// Un utilisateur avec users.model_scope = [ids] ne voit que ces modèles.
// Sécurité par défaut : toute route qui n'est pas listée ici lui est refusée.
const pool = require('../db/pool');

function scopeOf(req) { return Array.isArray(req.modelScope) ? req.modelScope : null; }
function inScope(req, id) { const s = scopeOf(req); return !s || s.includes(Number(id)); }

async function scopeNames(req) {
  const s = scopeOf(req);
  if (!s) return null;
  const { rows } = await pool.query('SELECT name FROM models WHERE id = ANY($1::int[])', [s]);
  return rows.map(r => r.name);
}
async function scopeRevealIds(req) {
  const s = scopeOf(req);
  if (!s) return null;
  const { rows } = await pool.query('SELECT reveal_model_id FROM reveal_models WHERE crm_model_id = ANY($1::int[])', [s]).catch(() => ({ rows: [] }));
  return rows.map(r => r.reveal_model_id);
}

const lookup = table => async (req, m) => {
  const { rows } = await pool.query(`SELECT model_id FROM ${table} WHERE id = $1`, [m[1]]);
  return !!rows[0] && inScope(req, rows[0].model_id);
};
const byParam = (req, m) => inScope(req, m[1]);
const byBody = req => req.body && req.body.model_id != null && inScope(req, req.body.model_id);
const byRevealId = async (req, m) => (await scopeRevealIds(req)).includes(m[1]);

const OK = 'ok';
// [méthodes, chemin, règle]  — règle : 'ok' (la route filtre elle-même), { empty }, ou fonction (req, match) => bool
const RULES = [
  ['GET|PUT', /^\/api\/me(\/email)?$/, OK],
  ['POST', /^\/api\/logout$/, OK],
  ['GET|POST|PUT', /^\/api\/messages/, OK],
  ['GET', /^\/api\/messages-unread$/, OK],
  ['GET|PUT|POST', /^\/api\/notifications/, OK],
  ['GET|PUT', /^\/api\/agency\/language$/, OK],
  ['GET', /^\/api\/dashboard$/, { empty: {} }],
  ['GET', /^\/api\/(students|team|tasks|calls)$/, { empty: [] }],

  // Modèles + cockpit
  ['GET', /^\/api\/models$/, OK],
  ['GET', /^\/api\/accounts$/, OK],
  ['PUT', /^\/api\/models\/(\d+)(\/full|\/avatar|\/color)?$/, byParam],
  ['DELETE', /^\/api\/models\/(\d+)\/avatar$/, byParam],
  ['GET|POST', /^\/api\/models\/(\d+)\/planning$/, byParam],
  ['GET', /^\/api\/model-cockpit\/(\d+)$/, byParam],
  ['GET|PUT', /^\/api\/model-profile\/(\d+)$/, byParam],
  ['GET', /^\/api\/model-(?:schedule|tracklinks)\/(\d+)$/, byParam],
  ['POST', /^\/api\/model-(?:schedule|tracklinks)$/, byBody],
  ['PUT|DELETE', /^\/api\/model-schedule\/(\d+)$/, lookup('model_schedule')],
  ['PUT|DELETE', /^\/api\/model-tracklinks\/(\d+)$/, lookup('model_tracklinks')],
  ['GET', /^\/api\/fans$/, OK],
  ['GET|PUT|DELETE', /^\/api\/fans\/(\d+)$/, lookup('fans')],
  ['POST', /^\/api\/fans\/(\d+)\/interactions$/, lookup('fans')],
  ['DELETE', /^\/api\/fans\/(\d+)\/interactions\/\d+$/, lookup('fans')],
  ['POST', /^\/api\/fans(\/import-csv)?$/, byBody],
  ['GET', /^\/api\/fans\/stats\/(\d+)$/, byParam],
  ['GET', /^\/api\/content-posts$/, OK],
  ['POST', /^\/api\/content-posts$/, byBody],
  ['PUT|DELETE', /^\/api\/content-posts\/(\d+)$/, lookup('content_posts')],

  // Finances
  ['GET', /^\/api\/finance\/(summary|monthly|breakdown|due|commissions)$/, OK],
  ['GET', /^\/api\/payments$/, OK],
  ['POST', /^\/api\/payments$/, byBody],
  ['PUT|DELETE', /^\/api\/payments\/(\d+)$/, lookup('payments')],
  ['GET', /^\/api\/model-revenue-objectives$/, OK],
  ['POST', /^\/api\/model-revenue-objectives$/, byBody],
  ['PUT', /^\/api\/model-revenue-objectives\/(\d+)$/, lookup('model_revenue_objectives')],

  // Chatters (shifts)
  ['GET', /^\/api\/shifts$/, OK],
  ['GET', /^\/api\/shifts\/(my-stats|admin-stats)$/, OK],
  ['GET', /^\/api\/online-users$/, { empty: [] }],
  ['GET', /^\/api\/chatter-shifts\/active$/, OK],

  // Stats Reveal (lecture, filtrée sur leurs modèles)
  ['GET', /^\/api\/reveal\/(me|status|overview|daily-by-model|models|chatters|tracking|sales)$/, OK],
  ['GET', /^\/api\/reveal\/models\/([\w-]+)\/daily$/, byRevealId],

  // SFS (les routes filtrent et vérifient la modèle elles-mêmes)
  ['GET|POST|PUT|DELETE', /^\/api\/sfs\//, OK],

  // Auto-post (les routes vérifient la modèle via ownModel / ownMedia)
  ['GET', /^\/api\/autopost\/(overview|jobs|reports)$/, OK],
  ['PUT', /^\/api\/autopost\/models\/(\d+)\/settings$/, byParam],
  ['GET', /^\/api\/autopost\/models\/(\d+)\/media$/, byParam],
  ['POST', /^\/api\/autopost\/models\/(\d+)\/run-now$/, byParam],
  ['POST', /^\/api\/autopost\/media(\/upload-url)?$/, byBody],
  ['PUT', /^\/api\/autopost\/media\/local-upload$/, OK],
  ['PATCH|DELETE', /^\/api\/autopost\/media\/(\d+)$/, lookup('autopost_media')],
  ['GET', /^\/api\/autopost\/media\/(\d+)\/file$/, lookup('autopost_media')],
  ['POST', /^\/api\/autopost\/jobs\/(\d+)\/(retry|cancel)$/, lookup('autopost_jobs')],
  ['GET', /^\/api\/autopost\/jobs\/(\d+)\/screenshot$/, lookup('autopost_jobs')],
  ['POST', /^\/api\/autopost\/reports\/generate$/, byBody],
];

// Renvoie true si la requête peut continuer ; sinon a déjà répondu.
async function guard(req, res) {
  if (!scopeOf(req)) return true;
  const path = String(req.originalUrl || req.url).split('?')[0].replace(/\/+$/, '');
  for (const [methods, re, rule] of RULES) {
    if (!methods.split('|').includes(req.method)) continue;
    const m = path.match(re);
    if (!m) continue;
    if (rule === OK) return true;
    if (rule && rule.empty !== undefined) { res.json(rule.empty); return false; }
    let ok = false;
    try { ok = await rule(req, m); } catch (e) { ok = false; }
    if (ok) return true;
    res.status(403).json({ error: 'Cette modèle ne fait pas partie de tes accès' });
    return false;
  }
  res.status(403).json({ error: 'Accès réservé : tu ne vois que les modèles dont tu es associé' });
  return false;
}

module.exports = { scopeOf, inScope, scopeNames, scopeRevealIds, guard };
