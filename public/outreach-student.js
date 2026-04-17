// ========== OUTREACH ÉLÈVES (pour assistantes) ==========
// Quand une assistante est assignée à l'outreach d'un élève, elle voit une section séparée

let assignedStudents = [];
let studentOutreachData = {}; // { studentUserId: { leads: [], options: {}, filter: 'all' } }
let selectedSOLeadIds = {}; // { studentUserId: Set<leadId> }
const debouncedRenderSOLeadTable = debounce(function(id) { renderSOLeadTable(id); }, 300);

function toggleSOLeadSelection(studentUserId, leadId, checked) {
  if (!selectedSOLeadIds[studentUserId]) selectedSOLeadIds[studentUserId] = new Set();
  if (checked) selectedSOLeadIds[studentUserId].add(leadId); else selectedSOLeadIds[studentUserId].delete(leadId);
  renderSOBulkBar(studentUserId);
}

function toggleAllSOLeads(studentUserId, checked) {
  if (!selectedSOLeadIds[studentUserId]) selectedSOLeadIds[studentUserId] = new Set();
  var set = selectedSOLeadIds[studentUserId];
  document.querySelectorAll('#so-table-' + studentUserId + ' .so-lead-cb').forEach(function(cb) {
    cb.checked = checked;
    var id = parseInt(cb.dataset.id);
    if (checked) set.add(id); else set.delete(id);
  });
  renderSOBulkBar(studentUserId);
}

function clearSOSelection(studentUserId) {
  if (selectedSOLeadIds[studentUserId]) selectedSOLeadIds[studentUserId].clear();
  document.querySelectorAll('#so-table-' + studentUserId + ' .so-lead-cb').forEach(function(cb) { cb.checked = false; });
  var master = document.getElementById('so-master-cb-' + studentUserId);
  if (master) master.checked = false;
  renderSOBulkBar(studentUserId);
}

function renderSOBulkBar(studentUserId) {
  var bar = document.getElementById('so-bulk-bar-' + studentUserId);
  if (!bar) return;
  var set = selectedSOLeadIds[studentUserId] || new Set();
  var n = set.size;
  if (n === 0) { bar.style.display = 'none'; return; }
  var existing = bar.querySelector('strong');
  if (existing && bar.style.display === 'block') {
    existing.textContent = n + ' lead' + (n>1?'s':'') + ' sélectionné' + (n>1?'s':'');
    return;
  }
  var opts = (studentOutreachData[studentUserId] || {}).options || {};
  var scriptOpts = (opts.script || []).map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('');
  var accountOpts = (opts.account || []).map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('');
  bar.style.display = 'block';
  bar.innerHTML = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:var(--bg3);border:1px solid var(--accent);border-radius:10px;margin-bottom:16px">'
    + '<strong style="color:var(--accent);font-size:13px">' + n + ' lead' + (n>1?'s':'') + ' sélectionné' + (n>1?'s':'') + '</strong>'
    + '<select id="so-bulk-script-' + studentUserId + '" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">Appliquer script...</option>' + scriptOpts + '</select>'
    + '<select id="so-bulk-account-' + studentUserId + '" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">Appliquer compte IG...</option>' + accountOpts + '</select>'
    + '<button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="applySOLeadsBulk(' + studentUserId + ')">Appliquer</button>'
    + '<button class="btn" style="background:var(--bg2);color:var(--text2);border:none;padding:6px 14px;font-size:12px;cursor:pointer" onclick="clearSOSelection(' + studentUserId + ')">Désélectionner</button>'
    + '</div>';
}

async function applySOLeadsBulk(studentUserId) {
  var script = (document.getElementById('so-bulk-script-' + studentUserId) || {}).value || '';
  var account = (document.getElementById('so-bulk-account-' + studentUserId) || {}).value || '';
  if (!script && !account) return showToast('Choisis un script ou un compte IG', 'warning');
  var ids = Array.from(selectedSOLeadIds[studentUserId] || []);
  var body = { ids: ids };
  if (script) body.script_used = script;
  if (account) body.ig_account_used = account;
  var btn = document.querySelector('#so-bulk-bar-' + studentUserId + ' .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Mise à jour...'; }
  await fetch('/api/student-leads/bulk-update', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  var leads = (studentOutreachData[studentUserId] || {}).leads || [];
  ids.forEach(function(id) { var l = leads.find(function(x) { return x.id === id; }); if (l) { if (script) l.script_used = script; if (account) l.ig_account_used = account; } });
  showToast(ids.length + ' lead' + (ids.length>1?'s':'') + ' mis à jour', 'success');
  clearSOSelection(studentUserId);
  renderSOLeadTable(studentUserId);
}

async function loadAssignedStudents() {
  if (currentUser.role !== 'outreach') return;
  try {
    const res = await fetch('/api/student-outreach-assignments', { credentials: 'include' });
    if (res.ok) assignedStudents = await res.json();
  } catch(e) {}
}

// Ajouter les nav items et sections pour chaque élève assigné
async function initOutreachStudentSections() {
  if (currentUser.role !== 'outreach') return;
  await loadAssignedStudents();
  if (assignedStudents.length === 0) return;

  // Ajouter une section nav
  const navTeams = document.getElementById('nav-teams');
  if (!navTeams) return;

  // Supprimer les anciens items dynamiques
  document.querySelectorAll('.nav-item-student-outreach').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.section-student-outreach').forEach(function(el) { el.remove(); });

  assignedStudents.forEach(function(a) {
    // Nav item
    var navItem = document.createElement('div');
    navItem.className = 'nav-item nav-item-student-outreach';
    navItem.setAttribute('data-section', 'so-' + a.student_user_id);
    navItem.onclick = function(e) { switchSection(e); renderStudentOutreachForAssistant(a.student_user_id, a.student_name); };
    navItem.innerHTML = '<span class="nav-icon">📨</span> Outreach ' + a.student_name;
    navTeams.appendChild(navItem);

    // Section HTML
    var section = document.createElement('div');
    section.className = 'section section-student-outreach';
    section.id = 'section-so-' + a.student_user_id;
    document.querySelector('.main').appendChild(section);

    // Init data store
    studentOutreachData[a.student_user_id] = { leads: [], options: { script: [], account: [], type: [] }, filter: 'all' };
  });
}

async function renderStudentOutreachForAssistant(studentUserId, studentName) {
  var data = studentOutreachData[studentUserId];
  if (!data) return;

  // Load leads + options + stats
  var [leadsRes, optsRes, statsRes] = await Promise.all([
    fetch('/api/student-leads?student_user_id=' + studentUserId, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }),
    fetch('/api/user-options?student_user_id=' + studentUserId, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : {}; }),
    fetch('/api/student-leads/stats?student_user_id=' + studentUserId, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : {}; })
  ]);
  data.leads = leadsRes;
  data.options = optsRes.script ? optsRes : { script: [], account: [], type: [] };

  var c = document.getElementById('section-so-' + studentUserId);
  if (!c) return;

  c.innerHTML = '<div class="page-header"><div><div class="page-title">Outreach ' + studentName + '</div><div class="page-subtitle">Gestion des leads pour ' + studentName + '</div></div>'
    + '<div class="header-actions" style="display:flex;gap:8px"><button class="btn btn-primary" onclick="showSOLeadForm(' + studentUserId + ')">+ Nouveau Lead</button>'
    + '<button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="showSOOptionsManager(' + studentUserId + ')">Mes options</button></div></div>'
    + '<div class="stats-grid" style="margin-bottom:20px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + (statsRes.dm_sent_today || 0) + '</div><div class="stat-label">DMs aujourd\'hui</div></div>'
    + '<div class="stat-card"><div class="stat-value">' + (statsRes.dm_sent || 0) + '</div><div class="stat-label">DMs total</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">' + (statsRes.talking_warm || 0) + '</div><div class="stat-label">Talking Warm</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + (statsRes.reply_rate || 0) + '%</div><div class="stat-label">Taux de réponse</div></div>'
    + '</div>'
    + '<div id="so-form-wrap-' + studentUserId + '"></div>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    + ['all','to-send','sent','talking-cold','talking-warm','call-booked','signed'].map(function(f) {
      var active = data.filter === f;
      var label = f === 'all' ? 'Tous' : (leadStatusColors[f] ? leadStatusColors[f].label : f);
      return '<button class="btn so-filter-' + studentUserId + '" onclick="filterSOLeads(' + studentUserId + ',\'' + f + '\',this)" style="font-size:12px;padding:6px 14px;border-radius:20px;background:' + (active ? 'var(--accent)' : 'var(--bg3)') + ';color:' + (active ? 'white' : 'var(--text2)') + ';border:none;cursor:pointer">' + label + '</button>';
    }).join('')
    + '</div>'
    + '<div style="margin-bottom:16px"><input type="text" id="so-search-' + studentUserId + '" class="form-input" placeholder="Rechercher..." oninput="debouncedRenderSOLeadTable(' + studentUserId + ')" style="max-width:350px"></div>'
    + '<div id="so-bulk-bar-' + studentUserId + '" style="display:none"></div>'
    + '<div class="panel"><table class="table mobile-cards" id="so-table-' + studentUserId + '"><thead><tr><th style="width:30px"><input type="checkbox" id="so-master-cb-' + studentUserId + '" onclick="toggleAllSOLeads(' + studentUserId + ', this.checked)" title="Tout sélectionner"></th><th>#</th><th>Username</th><th>Type</th><th>Script</th><th>Compte</th><th>Statut</th><th>Ajouté par</th><th>Notes</th><th></th></tr></thead><tbody></tbody></table></div>';

  renderSOLeadTable(studentUserId);
}

function renderSOLeadTable(studentUserId) {
  var data = studentOutreachData[studentUserId];
  if (!data) return;
  var search = (document.getElementById('so-search-' + studentUserId) || {}).value || '';
  search = search.toLowerCase();
  var filtered = data.filter === 'all' ? data.leads : data.leads.filter(function(l) { return l.status === data.filter; });
  if (search) filtered = filtered.filter(function(l) { return l.username.toLowerCase().includes(search); });

  var tbody = document.querySelector('#so-table-' + studentUserId + ' tbody');
  if (!tbody) return;
  var selSet = selectedSOLeadIds[studentUserId] || new Set();
  tbody.innerHTML = filtered.map(function(l, idx) {
    var st = leadStatusColors[l.status] || leadStatusColors['sent'];
    var igLink = l.ig_link ? '<a href="' + l.ig_link + '" target="_blank" style="color:var(--accent)">' + l.username + '</a>' : l.username;
    var checked = selSet.has(l.id) ? 'checked' : '';
    return '<tr><td data-label="" style="width:30px"><input type="checkbox" class="so-lead-cb" data-id="' + l.id + '" ' + checked + ' onchange="toggleSOLeadSelection(' + studentUserId + ',' + l.id + ',this.checked)"></td>'
      + '<td data-label="#" style="color:var(--text3);font-size:12px">' + (filtered.length - idx) + '</td>'
      + '<td data-label="" class="mc-title"><strong>' + igLink + '</strong></td>'
      + '<td data-label="Type" class="mc-half">' + leadTypeSelect(l.id, l.lead_type, 'updateSOLead(' + l.id + ',{lead_type:this.value})') + '</td>'
      + '<td data-label="Script" class="mc-half">' + soInlineSelect(studentUserId, l.id, 'script_used', l.script_used, 'script') + '</td>'
      + '<td data-label="Compte" class="mc-half">' + soInlineSelect(studentUserId, l.id, 'ig_account_used', l.ig_account_used, 'account') + '</td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="updateSOLead(' + l.id + ',{status:this.value})" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(leadStatusColors).map(function(e) { return '<option value="' + e[0] + '"' + (l.status===e[0]?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + e[1].label + '</option>'; }).join('') + '</select></td>'
      + '<td data-label="Modifié par" class="mc-half" style="font-size:11px;color:var(--accent2)">' + (l.modified_by_name || l.added_by_name || '-') + '</td>'
      + '<td data-label="Notes" class="mc-full" style="color:var(--text2);font-size:12px">' + (l.notes || '-') + '</td>'
      + '<td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteSOLead(' + studentUserId + ',' + l.id + ')">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="10">' + emptyStateHTML('search', 'Aucun lead trouvé') + '</td></tr>';
  renderSOBulkBar(studentUserId);
}

function soInlineSelect(studentUserId, leadId, field, currentValue, optType) {
  var opts = (studentOutreachData[studentUserId] || {}).options || {};
  var optList = opts[optType] || [];
  var style = 'background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;min-height:28px;width:100%';
  var html = '<select onchange="updateSOLead(' + leadId + ',{' + field + ':this.value})" style="' + style + '">';
  html += '<option value="">-</option>';
  var has = optList.some(function(o) { return o.value === currentValue; });
  if (currentValue && !has) html += '<option value="' + currentValue + '" selected>' + currentValue + '</option>';
  optList.forEach(function(o) { html += '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.value + '</option>'; });
  html += '</select>';
  return html;
}

function filterSOLeads(studentUserId, filter, btn) {
  studentOutreachData[studentUserId].filter = filter;
  document.querySelectorAll('.so-filter-' + studentUserId).forEach(function(b) { b.style.background = 'var(--bg3)'; b.style.color = 'var(--text2)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  renderSOLeadTable(studentUserId);
}

function showSOLeadForm(studentUserId) {
  var wrap = document.getElementById('so-form-wrap-' + studentUserId);
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var opts = (studentOutreachData[studentUserId] || {}).options || {};
  function sel(id, optType, ph) {
    var list = opts[optType] || [];
    return '<div style="display:flex;gap:6px;align-items:center"><select id="' + id + '" class="form-input" style="flex:1"><option value="">-- ' + ph + ' --</option>'
      + list.map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('')
      + '</select><button class="btn" style="padding:6px 10px;font-size:14px;background:var(--bg3);color:var(--accent);border:none;cursor:pointer" onclick="addSOOption(' + studentUserId + ',\'' + optType + '\',\'' + id + '\')" title="Ajouter">+</button></div>';
  }
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:700px">'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Lien Instagram *</label><input type="text" id="so-iglink-' + studentUserId + '" class="form-input" placeholder="Coller le lien..." oninput="autoFillUsername(this.value)" onpaste="var s=' + studentUserId + ';setTimeout(function(){autoFillUsername(document.getElementById(\'so-iglink-\'+s).value)},100)"></div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Username (auto)</label><input type="text" id="lead-username" class="form-input" placeholder="Se remplit auto" style="opacity:0.7"></div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Type</label><select id="so-type-' + studentUserId + '" class="form-input"><option value="">-- Type --</option>' + Object.entries(leadTypeColors).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('') + '</select></div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Script</label>' + sel('so-script-' + studentUserId, 'script', 'Script') + '</div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Compte</label>' + sel('so-account-' + studentUserId, 'account', 'Compte IG') + '</div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Notes</label><input type="text" id="so-notes-' + studentUserId + '" class="form-input" placeholder="Notes..."></div>'
    + '</div><div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addSOLead(' + studentUserId + ')">Ajouter</button><button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'so-form-wrap-' + studentUserId + '\').innerHTML=\'\'">Annuler</button></div></div>';
}

async function addSOOption(studentUserId, optType, selectId) {
  var labels = { script: 'script', account: 'compte Instagram', type: 'type' };
  var value = prompt('Nouveau ' + (labels[optType] || optType) + ' :');
  if (!value) return;
  var res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value.trim(), student_user_id: studentUserId }) });
  if (res.ok) {
    var opt = await res.json();
    studentOutreachData[studentUserId].options[optType].push(opt);
    var select = document.getElementById(selectId);
    if (select) { var o = document.createElement('option'); o.value = opt.value; o.textContent = opt.value; o.selected = true; select.appendChild(o); }
    showToast('"' + opt.value + '" ajouté', 'success');
  }
}

async function addSOLead(studentUserId) {
  var igLink = document.getElementById('so-iglink-' + studentUserId).value.trim();
  var username = document.getElementById('lead-username').value.trim();
  if (!username && igLink) username = extractUsernameFromUrl(igLink);
  if (!username) return showToast('Colle un lien Instagram', 'error');

  var dup = studentOutreachData[studentUserId].leads.find(function(l) { return l.username.replace(/^@/,'').toLowerCase() === username.replace(/^@/,'').toLowerCase(); });
  if (dup) return showToast('Ce lead existe déjà (' + dup.status + ')', 'error');

  var res = await fetch('/api/student-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({
    student_user_id: studentUserId, username: username, ig_link: igLink,
    lead_type: (document.getElementById('so-type-' + studentUserId) || {}).value || '',
    script_used: (document.getElementById('so-script-' + studentUserId) || {}).value || '',
    ig_account_used: (document.getElementById('so-account-' + studentUserId) || {}).value || '',
    notes: (document.getElementById('so-notes-' + studentUserId) || {}).value || ''
  })});
  if (res.ok) {
    showToast('Lead ajouté !', 'success');
    document.getElementById('so-form-wrap-' + studentUserId).innerHTML = '';
    renderStudentOutreachForAssistant(studentUserId, assignedStudents.find(function(a) { return a.student_user_id === studentUserId; })?.student_name || '');
  } else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

function updateSOLead(leadId, data) {
  fetch('/api/student-leads/' + leadId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
}

async function deleteSOLead(studentUserId, leadId) {
  if (!(await confirmDelete('Supprimer ce lead ? Cette action est irréversible.'))) return;
  await fetch('/api/student-leads/' + leadId, { method: 'DELETE', credentials: 'include' });
  var name = (assignedStudents.find(function(a) { return a.student_user_id === studentUserId; }) || {}).student_name || '';
  renderStudentOutreachForAssistant(studentUserId, name);
}

function showSOOptionsManager(studentUserId) {
  var wrap = document.getElementById('so-form-wrap-' + studentUserId);
  if (wrap.querySelector('.so-options-mgr')) { wrap.innerHTML = ''; return; }
  var opts = (studentOutreachData[studentUserId] || {}).options || {};
  var labels = { type: 'Types', script: 'Scripts', account: 'Comptes IG' };
  wrap.innerHTML = '<div class="panel so-options-mgr" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Options partagées</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">'
    + Object.entries(labels).map(function(e) {
      var key = e[0], label = e[1];
      var list = opts[key] || [];
      return '<div style="background:var(--bg3);padding:14px;border-radius:10px"><strong style="font-size:13px;display:block;margin-bottom:10px">' + label + '</strong>'
        + (list.length === 0 ? '<div style="color:var(--text3);font-size:12px">Aucune</div>' : '')
        + list.map(function(o) { return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px"><span>' + o.value + '</span><button class="btn-delete-small" onclick="deleteSOOption(' + studentUserId + ',' + o.id + ')" style="font-size:10px">✕</button></div>'; }).join('')
        + '<div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="so-newopt-' + key + '-' + studentUserId + '" class="form-input" style="font-size:12px;padding:6px 8px;flex:1" placeholder="Ajouter..."><button class="btn btn-primary" style="padding:6px 10px;font-size:11px" onclick="addSOOptionFromMgr(' + studentUserId + ',\'' + key + '\')">+</button></div></div>';
    }).join('')
    + '</div><div style="margin-top:12px"><button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'so-form-wrap-' + studentUserId + '\').innerHTML=\'\'">Fermer</button></div></div>';
}

async function addSOOptionFromMgr(studentUserId, optType) {
  var input = document.getElementById('so-newopt-' + optType + '-' + studentUserId);
  var value = (input || {}).value || '';
  if (!value.trim()) return;
  var res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value.trim(), student_user_id: studentUserId }) });
  if (res.ok) {
    var opt = await res.json();
    studentOutreachData[studentUserId].options[optType].push(opt);
    showToast('"' + value.trim() + '" ajouté', 'success');
    showSOOptionsManager(studentUserId);
  }
}

async function deleteSOOption(studentUserId, optId) {
  await fetch('/api/user-options/' + optId, { method: 'DELETE', credentials: 'include' });
  ['script', 'account', 'type'].forEach(function(key) {
    var opts = studentOutreachData[studentUserId].options[key];
    studentOutreachData[studentUserId].options[key] = opts.filter(function(o) { return o.id !== optId; });
  });
  showToast('Supprimé', 'success');
  showSOOptionsManager(studentUserId);
}
