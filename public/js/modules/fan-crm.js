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
    + '<input type="text" id="fan-search" class="form-input" placeholder="' + t('fan.search_placeholder') + '" style="max-width:250px;font-size:12px;padding:7px 12px" oninput="fanSearch=this.value;fanPage=0;loadFans()">'
    + '<select id="fan-segment-filter" class="form-input" style="max-width:150px;font-size:12px;padding:7px" onchange="fanSegment=this.value;fanPage=0;loadFans()">'
    + '<option value="">' + t('fan.all_segments') + '</option><option value="whale">🐋 Whales</option><option value="vip">⭐ VIP</option><option value="new">' + t('fan.new_segment') + '</option><option value="silent">' + t('fan.silent_segment') + '</option><option value="at_risk">' + t('fan.at_risk_segment') + '</option></select>'
    + '<select id="fan-sort" class="form-input" style="max-width:140px;font-size:12px;padding:7px" onchange="fanSort=this.value;loadFans()">'
    + '<option value="total_spent">' + t('fan.top_spent') + '</option><option value="last_interaction">' + t('fan.last_interaction_sort') + '</option><option value="first_seen">' + t('fan.most_recent') + '</option></select>'
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
  el.innerHTML = '<div class="coaching-kpi-bar" style="grid-template-columns:repeat(auto-fit,minmax(90px,1fr));margin-bottom:16px">'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value">' + (stats.total || 0) + '</div><div class="coaching-kpi-label">' + t('fan.total_fans') + '</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#3B82F6">' + (stats.whales || 0) + '</div><div class="coaching-kpi-label">🐋 Whales</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#F59E0B">' + (stats.vips || 0) + '</div><div class="coaching-kpi-label">⭐ VIP</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#10B981">' + (stats.new_fans || 0) + '</div><div class="coaching-kpi-label">' + t('fan.new_segment') + '</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#6B7280">' + (stats.silent || 0) + '</div><div class="coaching-kpi-label">' + t('fan.silent_segment') + '</div></div>'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#EF4444">' + (stats.at_risk || 0) + '</div><div class="coaching-kpi-label">' + t('fan.at_risk_segment') + '</div></div>'
    + '</div>';
}

function renderFanList(fans) {
  var el = document.getElementById('fan-list');
  if (!el) return;
  if (fans.length === 0) { el.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px">' + t('fan.no_fans') + '</div>'; return; }
  var platIcons = { onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥' };
  el.innerHTML = '<table class="table mobile-cards"><thead><tr><th>Fan</th><th>' + t('fan.spent_col') + '</th><th>' + t('fan.tags_col') + '</th><th>' + t('fan.last_interaction_col') + '</th><th>' + t('fan.sub_col') + '</th><th></th></tr></thead><tbody>'
    + fans.map(function(f) {
      var seg = getFanSegment(f);
      var segIcon = seg ? (SEGMENT_ICONS[seg] || '') + ' ' : '';
      var tags = [];
      try { tags = typeof f.tags === 'string' ? JSON.parse(f.tags) : (f.tags || []); } catch(e) {}
      var lastInt = f.last_interaction_at ? timeSince(f.last_interaction_at) : '-';
      var subColor = f.subscription_status === 'active' ? 'var(--green)' : f.subscription_status === 'expired' ? 'var(--red)' : 'var(--text-tertiary)';
      return '<tr onclick="openFanDetail(' + f.id + ')" style="cursor:pointer">'
        + '<td data-label="" class="mc-title"><div style="display:flex;align-items:center;gap:8px">'
        + '<div style="width:32px;height:32px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (f.username||'?').charAt(0).toUpperCase() + '</div>'
        + '<div><strong>' + f.username + '</strong>' + (f.display_name ? '<div style="font-size:11px;color:var(--text-tertiary)">' + f.display_name + '</div>' : '') + '</div>'
        + '<span style="font-size:12px">' + (platIcons[f.platform] || '') + '</span>'
        + (!fanModelId ? '<span style="font-size:10px;color:var(--text-tertiary)">' + (f.model_name || '') + '</span>' : '')
        + '</div></td>'
        + '<td data-label="' + t('fan.spent_col') + '" class="mc-half" style="font-weight:700;color:' + (seg === 'whale' ? '#3B82F6' : seg === 'vip' ? '#F59E0B' : 'var(--text)') + '">' + segIcon + '$' + parseFloat(f.total_spent).toFixed(0) + '</td>'
        + '<td data-label="' + t('fan.tags_col') + '" class="mc-half">' + tags.map(function(t) { return '<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:' + (TAG_COLORS[t]||'var(--bg4)') + '20;color:' + (TAG_COLORS[t]||'var(--text-tertiary)') + ';font-weight:600">' + t + '</span>'; }).join(' ') + '</td>'
        + '<td data-label="' + t('fan.interaction_col') + '" class="mc-half" style="font-size:12px;color:var(--text-secondary)">' + lastInt + '</td>'
        + '<td data-label="' + t('fan.sub_col') + '" class="mc-half"><span style="font-size:11px;font-weight:600;color:' + subColor + '">' + (f.subscription_status || '-') + '</span></td>'
        + '<td data-label="" class="mc-half">' + (f.is_important ? '⭐' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderFanPagination() {
  var el = document.getElementById('fan-pagination');
  if (!el) return;
  var totalPages = Math.ceil(fanTotal / 50);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 0">'
    + '<button class="btn btn-secondary" style="font-size:12px" onclick="fanPage=Math.max(0,fanPage-1);loadFans()" ' + (fanPage <= 0 ? 'disabled' : '') + '>' + t('fan.prev_page') + '</button>'
    + '<span style="font-size:12px;color:var(--text-secondary)">Page ' + (fanPage + 1) + ' / ' + totalPages + ' (' + fanTotal + ' fans)</span>'
    + '<button class="btn btn-secondary" style="font-size:12px" onclick="fanPage++;loadFans()" ' + (fanPage >= totalPages - 1 ? 'disabled' : '') + '>' + t('fan.next_page') + '</button></div>';
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
    + '<div style="font-size:12px;color:var(--text-tertiary)">' + (seg ? SEGMENT_ICONS[seg] + ' ' + seg.toUpperCase() : 'Regular') + ' · ' + f.platform + ' · ' + (f.model_name || '') + '</div></div>'
    + '<button onclick="toggleFanImportant(' + f.id + ',' + !f.is_important + ')" style="background:none;border:none;font-size:24px;cursor:pointer" title="Top fan">' + (f.is_important ? '⭐' : '☆') + '</button></div>'
    // Sub status
    + '<div style="display:flex;gap:12px;margin-bottom:16px">'
    + '<div style="background:var(--bg-base);padding:8px 12px;border-radius:8px;font-size:12px"><strong>Sub:</strong> <span style="color:' + (f.subscription_status === 'active' ? 'var(--green)' : 'var(--red)') + '">' + (f.subscription_status || '-') + '</span></div>'
    + (f.subscription_expires_at ? '<div style="background:var(--bg-base);padding:8px 12px;border-radius:8px;font-size:12px"><strong>Expire:</strong> ' + new Date(f.subscription_expires_at).toLocaleDateString('fr-FR') + '</div>' : '')
    + '</div>'
    // Tags
    + '<div style="margin-bottom:16px"><strong style="font-size:12px;color:var(--text-secondary)">Tags</strong><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">'
    + tags.map(function(t) { return '<span style="font-size:11px;padding:3px 8px;border-radius:8px;background:' + (TAG_COLORS[t] || 'var(--bg4)') + '20;color:' + (TAG_COLORS[t] || 'var(--text-tertiary)') + ';font-weight:600">' + t + ' <button onclick="removeFanTag(' + f.id + ',\'' + t + '\')" style="background:none;border:none;color:inherit;cursor:pointer;font-size:10px">✕</button></span>'; }).join('')
    + (isAdmin() ? '<button onclick="addFanTag(' + f.id + ')" style="font-size:11px;padding:3px 8px;border-radius:8px;background:var(--bg4);color:var(--text-tertiary);border:1px dashed var(--border);cursor:pointer">+ Tag</button>' : '')
    + '</div></div>'
    // Notes
    + '<div style="margin-bottom:16px"><strong style="font-size:12px;color:var(--text-secondary)">Notes</strong>'
    + '<textarea id="fan-notes-' + f.id + '" class="form-input" rows="2" style="margin-top:6px;font-size:12px" onblur="saveFanNotes(' + f.id + ')">' + (f.notes || '') + '</textarea></div>'
    // Timeline
    + '<div><strong style="font-size:12px;color:var(--text-secondary)">Timeline</strong>'
    + (isAdmin() ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 10px;margin-left:8px" onclick="addFanInteraction(' + f.id + ')">+ Interaction</button>' : '')
    + '<div style="margin-top:8px;max-height:250px;overflow-y:auto">'
    + (ints.length === 0 ? '<div style="color:var(--text-tertiary);font-size:12px;padding:12px;text-align:center">' + t('fan.no_interaction') + '</div>' : '')
    + ints.map(function(int) {
      var icons = { note_added: '📝', purchase: '💰', tip: '💵', message: '💬', tag_added: '🏷️', flagged: '🚩' };
      return '<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">'
        + '<span>' + (icons[int.interaction_type] || '📌') + '</span>'
        + '<div style="flex:1"><div style="color:var(--text-secondary)">' + (int.content || int.interaction_type) + '</div>'
        + '<div style="font-size:10px;color:var(--text-tertiary)">' + (int.user_name || '') + ' · ' + timeSince(int.created_at) + (int.amount ? ' · $' + parseFloat(int.amount).toFixed(2) : '') + '</div></div></div>';
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
  var tag = await showPromptModal(t('fan.add_tag_prompt'), 'Ex: whale, VIP, toxic, in_negotiation');
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
    + '<div class="modal" style="width:400px"><div class="modal-header"><div class="modal-title">' + t('fan.add_interaction_title') + '</div><button class="modal-close" onclick="document.getElementById(\'fan-int-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('common.type') + '</label><select id="fi-type" class="form-input">' + types.map(function(t) { return '<option value="' + t + '">' + labels[t] + '</option>'; }).join('') + '</select></div>'
    + '<div class="form-group"><label class="form-label">' + t('perf.amount_label') + '</label><input type="number" id="fi-amount" class="form-input" placeholder="0" step="0.01"></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.description') + '</label><textarea id="fi-content" class="form-input" rows="2"></textarea></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'fan-int-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="saveFanInteraction(' + fanId + ')">' + t('common.add') + '</button></div></div></div>';
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
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">' + t('fans.addFan') + '</div><button class="modal-close" onclick="document.getElementById(\'add-fan-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="grid-2col" style="gap:10px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_model') + '</label><select id="af-model" class="form-input">' + modelOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_platform') + '</label><select id="af-platform" class="form-input"><option value="onlyfans">💎 OnlyFans</option><option value="fansly">🌸 Fansly</option><option value="fanvue">💚 Fanvue</option><option value="mym">🔥 MYM</option></select></div></div>'
    + '<div class="form-group"><label class="form-label">Username *</label><input id="af-username" class="form-input" placeholder="@username"></div>'
    + '<div class="form-group"><label class="form-label">' + t('fan.display_name_label') + '</label><input id="af-display" class="form-input" placeholder="Optionnel"></div>'
    + '<div class="form-group"><label class="form-label">' + t('fan.total_spent_label') + '</label><input type="number" id="af-spent" class="form-input" value="0" step="0.01"></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.notes') + '</label><textarea id="af-notes" class="form-input" rows="2"></textarea></div>'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="af-important" style="width:16px;height:16px"> ⭐ Top fan</label>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'add-fan-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="submitAddFan()">' + t('common.add') + '</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitAddFan() {
  var username = document.getElementById('af-username').value.trim();
  if (!username) return showToast(t('fan.username_required'), 'error');
  var data = { model_id: parseInt(document.getElementById('af-model').value), platform: document.getElementById('af-platform').value, username: username, display_name: document.getElementById('af-display').value.trim() || null, total_spent: parseFloat(document.getElementById('af-spent').value) || 0, notes: document.getElementById('af-notes').value, is_important: document.getElementById('af-important').checked };
  var res = await fetch('/api/fans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) { document.getElementById('add-fan-modal')?.remove(); showToast(t('fan.fan_added_toast'), 'success'); loadFans(); }
  else { var err = await res.json(); showToast(err.error || t('common.error'), 'error'); }
}

// ========== IMPORT CSV MODAL ==========
var csvLines = [], csvHeaders = [], csvMapping = {};

function openImportCSVModal() {
  csvLines = []; csvHeaders = []; csvMapping = {};
  var modelOpts = (window.allModels || []).map(function(m) { return '<option value="' + m.id + '"' + (fanModelId === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('');
  var html = '<div class="modal-overlay show" id="csv-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:620px;max-height:90vh;overflow-y:auto"><div class="modal-header"><div class="modal-title">' + t('fan.import_step1') + '</div><button class="modal-close" onclick="document.getElementById(\'csv-modal\').remove()">✕</button></div>'
    + '<div class="modal-body" id="csv-body">'
    + '<div class="grid-2col" style="gap:10px;margin-bottom:16px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_model') + '</label><select id="csv-model" class="form-input">' + modelOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_platform') + '</label><select id="csv-platform" class="form-input"><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="fanvue">Fanvue</option><option value="mym">MYM</option></select></div></div>'
    + '<div class="form-group"><label class="form-label">' + t('student.file_label') + '</label>'
    + '<input type="file" id="csv-file" accept=".csv,.txt" class="form-input" onchange="previewCSV()">'
    + '</div>'
    + '<div id="csv-preview" style="display:none"></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'csv-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" id="csv-next-btn" onclick="csvStep2()" disabled>' + t('common.next') + '</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function previewCSV() {
  var file = document.getElementById('csv-file').files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    csvLines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    if (csvLines.length < 2) { showToast(t('fan.csv_empty'), 'error'); return; }
    csvHeaders = parseCSVLineFront(csvLines[0]);
    var preview = document.getElementById('csv-preview');
    preview.style.display = '';
    preview.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">' + (csvLines.length - 1) + ' ' + t('fan.lines_detected') + ' · ' + csvHeaders.length + ' ' + t('fan.columns_detected') + '</div>'
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
  if (title) title.textContent = t('fan.import_step2');
  var fields = [{ key: '', label: t('fan.ignore_field') }, { key: 'username', label: t('fan.username_field') }, { key: 'display_name', label: t('fan.display_name_field') }, { key: 'total_spent', label: t('fan.total_spent_field') }, { key: 'subscription_status', label: t('fan.sub_status_field') }];
  body.innerHTML = '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">' + t('fan.mapping_instruction') + '</p>'
    + '<div style="display:grid;gap:8px">' + csvHeaders.map(function(h, i) {
      var autoMatch = h.toLowerCase().includes('user') ? 'username' : h.toLowerCase().includes('spent') || h.toLowerCase().includes('total') ? 'total_spent' : h.toLowerCase().includes('name') && !h.toLowerCase().includes('user') ? 'display_name' : h.toLowerCase().includes('status') ? 'subscription_status' : '';
      return '<div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;font-weight:600;min-width:150px;color:var(--text-secondary)">' + h + '</span>'
        + '<select class="form-input" style="font-size:12px;padding:6px" id="csv-map-' + i + '">' + fields.map(function(f) { return '<option value="' + f.key + '"' + (f.key === autoMatch ? ' selected' : '') + '>' + f.label + '</option>'; }).join('') + '</select></div>';
    }).join('') + '</div>';
  var footer = document.querySelector('#csv-modal .modal-footer');
  footer.innerHTML = '<button class="btn btn-secondary" onclick="document.getElementById(\'csv-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="csvStep3()">' + t('fan.import_lines', { count: csvLines.length - 1 }) + '</button>';
}

async function csvStep3() {
  // Build mapping
  var mapping = {};
  csvHeaders.forEach(function(h, i) {
    var val = document.getElementById('csv-map-' + i)?.value;
    if (val) mapping[val] = h;
  });
  if (!mapping.username) { showToast(t('fan.mapping_required'), 'error'); return; }

  var title = document.querySelector('#csv-modal .modal-title');
  if (title) title.textContent = t('fan.import_progress');
  var body = document.getElementById('csv-body');
  body.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div><div style="color:var(--text-tertiary);margin-top:12px">' + t('fan.importing_fans', { count: csvLines.length - 1 }) + '</div></div>';

  var res = await fetch('/api/fans/import-csv', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ model_id: parseInt(document.getElementById('csv-model').value), platform: document.getElementById('csv-platform').value, csv_data: csvLines.join('\n'), column_mapping: mapping })
  });
  var data = await res.json();

  if (title) title.textContent = t('fan.import_done');
  body.innerHTML = '<div style="text-align:center;padding:20px">'
    + '<div style="font-size:48px;margin-bottom:12px">✅</div>'
    + '<div class="grid-3col" style="gap:12px;margin-bottom:16px">'
    + '<div style="background:var(--green-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--green)">' + (data.imported || 0) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + t('fan.created_label') + '</div></div>'
    + '<div style="background:var(--blue-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--blue)">' + (data.updated || 0) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + t('fan.updated_label') + '</div></div>'
    + '<div style="background:var(--red-bg);padding:12px;border-radius:10px"><div style="font-size:20px;font-weight:800;color:var(--red)">' + ((data.errors || []).length) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + t('fan.errors_label') + '</div></div>'
    + '</div>'
    + ((data.errors || []).length > 0 ? '<div style="text-align:left;max-height:100px;overflow-y:auto;font-size:11px;color:var(--red)">' + data.errors.map(function(e) { return '<div>' + t('fan.line_error', { line: e.line }) + ': ' + e.error + '</div>'; }).join('') + '</div>' : '')
    + '</div>';
  var footer = document.querySelector('#csv-modal .modal-footer');
  footer.innerHTML = '<button class="btn btn-primary" onclick="document.getElementById(\'csv-modal\').remove();loadFans()">' + t('common.close') + '</button>';
}
