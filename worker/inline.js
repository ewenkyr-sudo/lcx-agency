// Lance la boucle du worker auto-post dans le process du site (AUTOPOST_INLINE_WORKER=true).
// Pratique en local ou sur une machine unique ; en production on préfère le service séparé.
const w = require('./index');
function start() {
  console.log('[AUTOPOST] worker intégré démarré');
  setTimeout(async () => { await w.init(); w.tick(); setInterval(w.tick, 20000); }, 15000);
}
module.exports = { start };
