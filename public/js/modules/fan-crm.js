// FAN CRM MODULE
// Fan management for model cockpit + global view

var fanPage = 0, fanTotal = 0, fanModelId = null, fanSearch = '', fanSegment = '', fanSort = 'total_spent';

var SEGMENT_ICONS = { whale: '🐋', vip: '⭐', silent: '💤', at_risk: '⚠️', new_fan: '🆕' };
var SEGMENT_COLORS = { whale: '#3B82F6', vip: '#F59E0B', silent: '#6B7280', at_risk: '#EF4444', new_fan: '#10B981' };
var TAG_COLORS = { whale: '#3B82F6', VIP: '#F59E0B', toxic: '#EF4444', in_negotiation: '#F97316', new: '#10B981', at_risk: '#EF4444' };

function getFanSegment(fan) {
  if (parseFloat(fan.total_spent) >= 500) return 'whale';
  if (parseFloat(fan.total_spent) >= 100) return 'vip';
  if (fan.subscription_expires_at && new Date(fan.subscription_expires_at) < new Date(Date.now() + 7*24*60*60*1000) && new Date(fan.subscription_expires_at) > new Date()) return 'at_risk';
  if (fan.first_seen_at && new Date(fan.first_seen_at) > new Date(Date.now() - 7*24*60*60*1000)) return 'new_fan';
  if (fan.last_interaction_at && new Date(fan.last_interaction_at) < new Date(Date.now() - 30*24*60*60*1000)) return 'silent';
  return null;
}

// ========== MAIN VIEW ==========
async function renderFanCRM(modelId) {
  fanModelId = modelId || null;
  fanPage = 0;
  var container = document.getElementById(modelId ? 'cockpit-fans-content' : 'fans-global-content');
  if (!container) return;
  container.innerHTML = '<div id="fan-kpis"></div>'
    + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">'
    + '<input type="text" id="fan-search" class="form-input" placeholder="Rechercher un fan..." style="max-width:250px;font-size:12px;padding:7px 12px" oninput="fanSearch=this.value;fanPage=0;loadFans()">'
    + '<select id="fan-segment-filter" class="form-input" style="max-width:150px;font-size:12px;padding:7px" onchange="fanSegment=this.value;fanPage=0;loadFans()">'
    + '<option value="">Tous les segments</option><option value="whale">🐋 Whales</option><option value="vip">⭐ VIP</option><option value="new">🆕 Nouveaux</option><option value="silent">💤 Silencieux</option><option value="at_risk">⚠️ À risque</option></select>'
    + '<select id="fan-sort" class="form-input" style="max-width:140px;font-size:12px;padding:7px" onchange="fanSort=this.value;loadFans()">'
    + '<option value="total_spent">Top dépenses</option><option value="last_interaction">Dernière interaction</option><option value="first_seen">Plus récents</option></select>'
    + (isAdmin() ? '<button class="btn btn-primary" style="font-size:12px;margin-left:auto" onclick="openAddFanModal()">+ Ajouter</button>' : '')
    + (isAdmin() ? '<button class="btn btn-secondary" style="font-size:12px" onclick="openImportCSVModal()">📤 Import CSV</button>' : '')
    + '</div>'
    + '<div id="fan-list"></div>'
    + '<div id="fan-pagination"></div>';
  loadFans();
}

async function loadFans() {
  var url = '/api/fans?limit=50&offset=' + (fanPage * 50) + '&sort=' + fanSort;
  if (fanModelId) url += '&model_id=' + fanModelId;
  if (fanSearch) url += '&search=' + encodeURIComponent(fanSearch);
  if (fanSegment) url += '&segment=' + fanSegment;
  var res = await fetch(url, { credentials: 'include' });
  var data = await res.json();
  fanTotal = data.total;
  renderFanKPIs(data.stats);
  renderFanList(data.fans);
  renderFanPagination();
}

function renderFanKPIs(stats) {
  var el = document.getElementById('fan-kpis');
  if (!el || !stats) return;
  el.innerHTML = '<div class="coaching-kpi-bar" style="grid-template-columns:repeat(6,1fr);margin-bottom:16px">'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value">' + (stats.total || 0) + '</div><div class="coaching-kpi-label">Total fans</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#3B82F6">' + (stats.whales || 0) + '</div><div class="coaching-kpi-label">🐋 Whales</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#F59E0B">' + (stats.vips || 0) + '</div><div class="coaching-kpi-label">⭐ VIP</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#10B981">' + (stats.new_fans || 0) + '</div><div class="coaching-kpi-label">🆕 Nouveaux</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#6B7280">' + (stats.silent || 0) + '</div><div class="coaching-kpi-label">💤 Silencieux</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#EF4444">' + (stats.at_risk || 0) + '</div><div class="coaching-kpi-label">⚠️ À risque</div></div>'
    + '</div>';
}

function renderFanList(fans) {
  var el = document.getElementById('fan-list');
  if (!el) return;
  if (fans.length === 0) { el.innerHTML = '<div style="text-align:center;color:var(--text3);padding:40px">Aucun fan trouvé</div>'; return; }
  var platIcons = { onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥' };
  el.innerHTML = '<table class="table mobile-cards"><thead><tr><th>Fan</th><th>Dépensé</th><th>Tags</th><th>Dernière interaction</th><th>Sub</th><th></th></tr></thead><tbody>'
    + fans.map(function(f) {
      var seg = getFanSegment(f);
      var segIcon = seg ? (SEGMENT_ICONS[seg] || '') + ' ' : '';
      var tags = [];
      try { tags = typeof f.tags === 'string' ? JSON.parse(f.tags) : (f.tags || []); } catch(e) {}
      var lastInt = f.last_interaction_at ? timeSince(f.last_interaction_at) : '-';
      var subColor = f.subscription_status === 'active' ? 'var(--green)' : f.subscription_status === 'expired' ? 'var(--red)' : 'var(--text3)';
      return '<tr onclick="openFanDetail(' + f.id + ')" style="cursor:pointer">'
        + '<td data-label="" class="mc-title"><div style="display:flex;align-items:center;gap:8px">'
        + '<div style="width:32px;height:32px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (f.username||'?').charAt(0).toUpperCase() + '</div>'
        + '<div><strong>' + f.username + '</strong>' + (f.display_name ? '<div style="font-size:11px;color:var(--text3)">' + f.display_name + '</div>' : '') + '</div>'
        + '<span style="font-size:12px">' + (platIcons[f.platform] || '') + '</span>'
        + (!fanModelId ? '<span style="font-size:10px;color:var(--text3)">' + (f.model_name || '') + '</span>' : '')
        + '</div></td>'
        + '<td data-label="Dépensé" class="mc-half" style="font-weight:700;color:' + (seg === 'whale' ? '#3B82F6' : seg === 'vip' ? '#F59E0B' : 'var(--text)') + '">' + segIcon + '$' + parseFloat(f.total_spent).toFixed(0) + '</td>'
        + '<td data-label="Tags" class="mc-half">' + tags.map(function(t) { return '<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:' + (TAG_COLORS[t]||'var(--bg4)') + '20;color:' + (TAG_COLORS[t]||'var(--text3)') + ';font-weight:600">' + t + '</span>'; }).join(' ') + '</td>'
        + '<td data-label="Interaction" class="mc-half" style="font-size:12px;color:var(--text2)">' + lastInt + '</td>'
        + '<td data-label="Sub" class="mc-half"><span style="font-size:11px;font-weight:600;color:' + subColor + '">' + (f.subscription_status || '-') + '</span></td>'
        + '<td data-label="" class="mc-half">' + (f.is_important ? '⭐' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderFanPagination() {
  var el = document.getElementById('fan-pagination');
  if (!el) return;
  var totalPages = Math.ceil(fanTotal / 50);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 0">'
    + '<button class="btn btn-secondary" style="font-size:12px" onclick="fanPage=Math.max(0,fanPage-1);loadFans()" ' + (fanPage <= 0 ? 'disabled' : '') + '>← Précédent</button>'
    + '<span style="font-size:12px;color:var(--text2)">Page ' + (fanPage + 1) + ' / ' + totalPages + ' (' + fanTotal + ' fans)</span>'
    + '<button class="btn btn-secondary" style="font-size:12px" onclick="fanPage++;loadFans()" ' + (fanPage >= totalPages - 1 ? 'disabled' : '') + '>Suivant →</button></div>';
}

// ========== FAN DETAIL MODAL ==========
async function openFanDetail(fanId) {
  var res = await fetch('/api/fans/' + fanId, { credentials: 'include' });
  var data = await res.json();
  var f = data.fan, ints = data.interactions || [];
  var seg = getFanSegment(f);
  var tags = []; try { tags = typeof f.tags === 'string' ? JSON.parse(f.tags) : (f.tags || []); } catch(e) {}
  var platIcons = { onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥' };

  var html = '<div class="modal-overlay show" id="fan-detail-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:600px;max-height:90vh;overflow-y:auto">'
    + '<div class="modal-header"><div class="modal-title">' + (platIcons[f.platform] || '') + ' ' + f.username + '</div><button class="modal-close" onclick="document.getElementById(\'fan-detail-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    // Header info
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">'
    + '<div><div style="font-size:24px;font-weight:800;color:' + (seg === 'whale' ? '#3B82F6' : seg === 'vip' ? '#F59E0B' : 'var(--text)') + '">$' + parseFloat(f.total_spent).toFixed(2) + '</div>'
    + '<div style="font-size:12px;color:var(--text3)">' + (seg ? SEGMENT_ICONS[seg] + ' ' + seg.toUpperCase() : 'Regular') + ' · ' + f.platform + ' · ' + (f.model_name || '') + '</div></div>'
    + '<button onclick="toggleFanImportant(' + f.id + ',' + !f.is_important + ')" style="background:none;border:none;font-size:24px;cursor:pointer" title="Top fan">' + (f.is_important ? '⭐' : '☆') + '</button></div>'
    // Sub status
    + '<div style="display:flex;gap:12px;margin-bottom:16px">'
    + '<div style="background:var(--bg3);padding:8px 12px;border-radius:8px;font-size:12px"><strong>Sub:</strong> <span style="color:' + (f.subscription_status === 'active' ? 'var(--green)' : 'var(--red)') + '">' + (f.subscription_status || '-') + '</span></div>'
    + (f.subscription_expires_at ? '<div style="background:var(--bg3);padding:8px 12px;border-radius:8px;font-size:12px"><strong>Expire:</strong> ' + new Date(f.subscription_expires_at).toLocaleDateString('fr-FR') + '</div>' : '')
    + '</div>'
    // Tags
    + '<div style="margin-bottom:16px"><strong style="font-size:12px;color:var(--text2)">Tags</strong><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">'
    + tags.map(function(t) { return '<span style="font-size:11px;padding:3px 8px;border-radius:8px;background:' + (TAG_COLORS[t] || 'var(--bg4)') + '20;color:' + (TAG_COLORS[t] || 'var(--text3)') + ';font-weight:600">' + t + ' <button onclick="removeFanTag(' + f.id + ',\'' + t + '\')" style="background:none;border:none;color:inherit;cursor:pointer;font-size:10px">✕</button></span>'; }).join('')
    + (isAdmin() ? '<button onclick="addFanTag(' + f.id + ')" style="font-size:11px;padding:3px 8px;border-radius:8px;background:var(--bg4);color:var(--text3);border:1px dashed var(--border);cursor:pointer">+ Tag</button>' : '')
    + '</div></div>'
    // Notes
    + '<div style="margin-bottom:16px"><strong style="font-size:12px;color:var(--text2)">Notes</strong>'
    + '<textarea id="fan-notes-' + f.id + '" class="form-input" rows="2" style="margin-top:6px;font-size:12px" onblur="saveFanNotes(' + f.id + ')">' + (f.notes || '') + '</textarea></div>'
    // Timeline
    + '<div><strong style="font-size:12px;color:var(--text2)">Timeline</strong>'
    + (isAdmin() ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 10px;margin-left:8px" onclick="addFanInteraction(' + f.id + ')">+ Interaction</button>' : '')
    + '<div style="margin-top:8px;max-height:250px;overflow-y:auto">'
    + (ints.length === 0 ? '<div style="color:var(--text3);font-size:12px;padding:12px;text-align:center">Aucune interaction</div>' : '')
    + ints.map(function(int) {
      var icons = { note_added: '📝', purchase: '💰', tip: '💵', message: '💬', tag_added: '🏷️', flagged: '🚩' };
      return '<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">'
        + '<span>' + (icons[int.interaction_type] || '📌') + '</span>'
        + '<div style="flex:1"><div style="color:var(--text2)">' + (int.content || int.interaction_type) + '</div>'
        + '<div style="font-size:10px;color:var(--text3)">' + (int.user_name || '') + ' · ' + timeSince(int.created_at) + (int.amount ? ' · $' + parseFloat(int.amount).toFixed(2) : '') + '</div></div></div>';
    }).join('')
    + '</div></div>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function toggleFanImportant(fanId, val) {
  await fetch('/api/fans/' + fanId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ is_important: val }) });
  document.getElementById('fan-detail-modal')?.remove();
  loadFans();
}

async function saveFanNotes(fanId) {
  var el = document.getElementById('fan-notes-' + fanId);
  if (!el) return;
  await fetch('/api/fans/' + fanId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ notes: el.value }) });
}

async function addFanTag(fanId) {
  var tag = await showPromptModal('Ajouter un tag', 'Ex: whale, VIP, toxic, in_negotiation');
  if (!tag) return;
  var res = await fetch('/api/fans/' + fanId, { credentials: 'include' });
  var data = await res.json();
  var tags = []; try { tags = typeof data.fan.tags === 'string' ? JSON.parse(data.fan.tags) : (data.fan.tags || []); } catch(e) {}
  if (!tags.includes(tag)) tags.push(tag);
  await fetch('/api/fans/' + fanId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ tags: tags }) });
  document.getElementById('fan-detail-modal')?.remove();
  openFanDetail(fanId);
}

async function removeFanTag(fanId, tag) {
  var res = await fetch('/api/fans/' + fanId, { credentials: 'include' });
  var data = await res.json();
  var tags = []; try { tags = typeof data.fan.tags === 'string' ? JSON.parse(data.fan.tags) : (data.fan.tags || []); } catch(e) {}
  tags = tags.filter(function(t) { return t !== tag; });
  await fetch('/api/fans/' + fanId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ tags: tags }) });
  document.getElementById('fan-detail-modal')?.remove();
  openFanDetail(fanId);
}

async function addFanInteraction(fanId) {
  var types = ['note_added', 'purchase', 'tip', 'message'];
  var labels = { note_added: '📝 Note', purchase: '💰 Achat', tip: '💵 Tip', message: '💬 Message' };
  var html = '<div class="modal-overlay show" id="fan-int-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:400px"><div class="modal-header"><div class="modal-title">Ajouter une interaction</div><button class="modal-close" onclick="document.getElementById(\'fan-int-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">Type</label><select id="fi-type" class="form-input">' + types.map(function(t) { return '<option value="' + t + '">' + labels[t] + '</option>'; }).join('') + '</select></div>'
    + '<div class="form-group"><label class="form-label">Montant ($)</label><input type="number" id="fi-amount" class="form-input" placeholder="0" step="0.01"></div>'
    + '<div class="form-group"><label class="form-label">Description</label><textarea id="fi-content" class="form-input" rows="2"></textarea></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'fan-int-modal\').remove()">Annuler</button>'
    + '<button class="btn btn-primary" onclick="saveFanInteraction(' + fanId + ')">Ajouter</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveFanInteraction(fanId) {
  var data = { interaction_type: document.getElementById('fi-type').value, amount: parseFloat(document.getElementById('fi-amount').value) || null, content: document.getElementById('fi-content').value };
  await fetch('/api/fans/' + fanId + '/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  document.getElementById('fan-int-modal')?.remove();
  document.getElementById('fan-detail-modal')?.remove();
  showToast(t('fan.interaction_added'), 'success');
  openFanDetail(fanId);
  loadFans();
}

// ========== ADD FAN MODAL ==========
function openAddFanModal() {
  var modelOpts = (window.allModels || []).map(function(m) { return '<option value="' + m.id + '"' + (fanModelId === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('');
  var html = '<div class="modal-overlay show" id="add-fan-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">Ajouter un fan</div><button class="modal-close" onclick="document.getElementById(\'add-fan-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div class="form-group"><label class="form-label">Modèle *</label><select id="af-model" class="form-input">' + modelOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">Plateforme</label><select id="af-platform" class="form-input"><option value="onlyfans">💎 OnlyFans</option><option value="fansly">🌸 Fansly</option><option value="fanvue">💚 Fanvue</option><option value="mym">🔥 MYM</option></select></div></div>'
    + '<div class="form-group"><label class="form-label">Username *</label><input id="af-username" class="form-input" placeholder="@username"></div>'
    + '<div class="form-group"><label class="form-label">Nom d\'affichage</label><input id="af-display" class="form-input" placeholder="Optionnel"></div>'
    + '<div class="form-group"><label class="form-label">Total dépensé ($)</label><input type="number" id="af-spent" class="form-input" value="0" step="0.01"></div>'
    + '<div class="form-group"><label class="form-label">Notes</label><textarea id="af-notes" class="form-input" rows="2"></textarea></div>'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="af-important" style="width:16px;height:16px"> ⭐ Top fan</label>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'add-fan-modal\').remove()">Annuler</button>'
    + '<button class="btn btn-primary" onclick="submitAddFan()">Ajouter</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitAddFan() {
  var username = document.getElementById('af-username').value.trim();
  if (!username) return showToast(t('fan.username_required'), 'error');
  var data = { model_id: parseInt(document.getElementById('af-model').value), platform: document.getElementById('af-platform').value, username: username, display_name: document.getElementById('af-display').value.trim() || null, total_spent: parseFloat(document.getElementById('af-spent').value) || 0, notes: document.getElementById('af-notes').value, is_important: document.getElementById('af-important').checked };
  var res = await fetch('/api/fans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) { document.getElementById('add-fan-modal')?.remove(); showToast(t('fan.fan_added_toast'), 'success'); loadFans(); }
  else { var err = await res.json(); showToast(err.error || 'Erreur', 'error'); }
}

// ========== IMPORT CSV MODAL ==========
var csvLines = [], csvHeaders = [], csvMapping = {};

function openImportCSVModal() {
  csvLines = []; csvHeaders = []; csvMapping = {};
  var modelOpts = (window.allModels || []).map(function(m) { return '<option value="' + m.id + '"' + (fanModelId === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('');
  var html = '<div class="modal-overlay show" id="csv-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:620px;max-height:90vh;overflow-y:auto"><div class="modal-header"><div class="modal-title">📤 Import CSV — Étape 1/3</div><button class="modal-close" onclick="document.getElementById(\'csv-modal\').remove()">✕</button></div>'
    + '<div class="modal-body" id="csv-body">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'
    + '<div class="form-group"><label class="form-label">Modèle *</label><select id="csv-model" class="form-input">' + modelOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">Plateforme</label><select id="csv-platform" class="form-input"><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="fanvue">Fanvue</option><option value="mym">MYM</option></select></div></div>'
    + '<div class="form-group"><label class="form-label">Fichier CSV</label>'
    + '<input type="file" id="csv-file" accept=".csv,.txt" class="form-input" onchange="previewCSV()">'
    + '</div>'
    + '<div id="csv-preview" style="display:none"></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'csv-modal\').remove()">Annuler</button>'
    + '<button class="btn btn-primary" id="csv-next-btn" onclick="csvStep2()" disabled>Suivant → Mapping</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function previewCSV() {
  var file = document.getElementById('csv-file').files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    csvLines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    if (csvLines.length < 2) { showToast('CSV vide', 'error'); return; }
    csvHeaders = parseCSVLineFront(csvLines[0]);
    var preview = document.getElementById('csv-preview');
    preview.style.display = '';
    preview.innerHTML = '<div style="font-size:12px;color:var(--text2);margin-bottom:8px">' + (csvLines.length - 1) + ' lignes détectées · ' + csvHeaders.length + ' colonnes</div>'
      + '<div style="overflow-x:auto;max-height:150px"><table class="table" style="font-size:11px"><thead><tr>' + csvHeaders.map(function(h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>'
      + csvLines.slice(1, 4).map(function(l) { var cols = parseCSVLineFront(l); return '<tr>' + csvHeaders.map(function(h, i) { return '<td>' + (cols[i] || '') + '</td>'; }).join('') + '</tr>'; }).join('')
      + '</tbody></table></div>';
    document.getElementById('csv-next-btn').disabled = false;
  };
  reader.readAsText(file);
}

function parseCSVLineFront(line) {
  var result = [], current = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ',' && !inQ) { result.push(current); current = ''; }
    else current += line[i];
  }
  result.push(current);
  return result;
}

function csvStep2() {
  var body = document.getElementById('csv-body');
  var title = document.querySelector('#csv-modal .modal-title');
  if (title) title.textContent = '📤 Import CSV — Étape 2/3 : Mapping';
  var fields = [{ key: '', label: '— Ignorer —' }, { key: 'username', label: 'Username *' }, { key: 'display_name', label: 'Nom affiché' }, { key: 'total_spent', label: 'Total dépensé' }, { key: 'subscription_status', label: 'Statut sub' }];
  body.innerHTML = '<p style="font-size:12px;color:var(--text3);margin-bottom:12px">Associez chaque colonne du CSV au champ correspondant :</p>'
    + '<div style="display:grid;gap:8px">' + csvHeaders.map(function(h, i) {
      var autoMatch = h.toLowerCase().includes('user') ? 'username' : h.toLowerCase().includes('spent') || h.toLowerCase().includes('total') ? 'total_spent' : h.toLowerCase().includes('name') && !h.toLowerCase().includes('user') ? 'display_name' : h.toLowerCase().includes('status') ? 'subscription_status' : '';
      return '<div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;font-weight:600;min-width:150px;color:var(--text2)">' + h + '</span>'
        + '<select class="form-input" style="font-size:12px;padding:6px" id="csv-map-' + i + '">' + fields.map(function(f) { return '<option value="' + f.key + '"' + (f.key === autoMatch ? ' selected' : '') + '>' + f.label + '</option>'; }).join('') + '</select></div>';
    }).join('') + '</div>';
  var footer = document.querySelector('#csv-modal .modal-footer');
  footer.innerHTML = '<button class="btn btn-secondary" onclick="document.getElementById(\'csv-modal\').remove()">Annuler</button>'
    + '<button class="btn btn-primary" onclick="csvStep3()">Importer (' + (csvLines.length - 1) + ' lignes)</button>';
}

async function csvStep3() {
  // Build mapping
  var mapping = {};
  csvHeaders.forEach(function(h, i) {
    var val = document.getElementById('csv-map-' + i)?.value;
    if (val) mapping[val] = h;
  });
  if (!mapping.username) { showToast('Le mapping "Username" est obligatoire', 'error'); return; }

  var title = document.querySelector('#csv-modal .modal-title');
  if (title) title.textContent = '📤 Import en cours...';
  var body = document.getElementById('csv-body');
  body.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div><div style="color:var(--text3);margin-top:12px">Import de ' + (csvLines.length - 1) + ' fans...</div></div>';

  var res = await fetch('/api/fans/import-csv', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ model_id: parseInt(document.getElementById('csv-model').value), platform: document.getElementById('csv-platform').value, csv_data: csvLines.join('\n'), column_mapping: mapping })
  });
  var data = await res.json();

  if (title) title.textContent = '📤 Import terminé !';
  body.innerHTML = '<div style="text-align:center;padding:20px">'
    + '<div style="font-size:48px;margin-bottom:12px">✅</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">'
    + '<div style="background:var(--green-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--green)">' + (data.imported || 0) + '</div><div style="font-size:11px;color:var(--text3)">Créés</div></div>'
    + '<div style="background:var(--blue-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--blue)">' + (data.updated || 0) + '</div><div style="font-size:11px;color:var(--text3)">Mis à jour</div></div>'
    + '<div style="background:var(--red-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--red)">' + ((data.errors || []).length) + '</div><div style="font-size:11px;color:var(--text3)">Erreurs</div></div>'
    + '</div>'
    + ((data.errors || []).length > 0 ? '<div style="text-align:left;max-height:100px;overflow-y:auto;font-size:11px;color:var(--red)">' + data.errors.map(function(e) { return '<div>Ligne ' + e.line + ': ' + e.error + '</div>'; }).join('') + '</div>' : '')
    + '</div>';
  var footer = document.querySelector('#csv-modal .modal-footer');
  footer.innerHTML = '<button class="btn btn-primary" onclick="document.getElementById(\'csv-modal\').remove();loadFans()">Fermer</button>';
}
