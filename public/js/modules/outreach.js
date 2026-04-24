// OUTREACH MODULE
// Extracted from dashboard.html

let allLeads = [];
let currentLeadFilter = 'all';
let outreachOptions = { script: [], account: [], type: [] };
let selectedLeadIds = new Set();
// Plus besoin de flag — on utilise msg.data.by pour ignorer ses propres events WS

function toggleLeadSelection(id, checked) {
  if (checked) selectedLeadIds.add(id); else selectedLeadIds.delete(id);
  renderLeadsBulkBar();
}

function toggleAllLeads(checked) {
  document.querySelectorAll('#leads-table .lead-cb').forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) selectedLeadIds.add(id); else selectedLeadIds.delete(id);
  });
  renderLeadsBulkBar();
}

function clearLeadsSelection() {
  selectedLeadIds.clear();
  document.querySelectorAll('#leads-table .lead-cb').forEach(cb => cb.checked = false);
  const master = document.getElementById('leads-master-cb');
  if (master) master.checked = false;
  renderLeadsBulkBar();
}

function renderLeadsBulkBar() {
  const bar = document.getElementById('leads-bulk-bar');
  if (!bar) return;
  const n = selectedLeadIds.size;
  if (n === 0) { bar.style.display = 'none'; return; }
  // Si déjà affiché, ne met à jour que le compteur
  const existing = bar.querySelector('strong');
  if (existing && bar.style.display === 'block') {
    existing.textContent = n + ' ' + t('outreach.leads_selected');
    return;
  }
  const scriptOpts = (outreachOptions.script || []).map(o => `<option value="${o.value}">${o.value}</option>`).join('');
  const accountOpts = (outreachOptions.account || []).map(o => `<option value="${o.value}">${o.value}</option>`).join('');
  bar.style.display = 'block';
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:var(--bg-base);border:1px solid var(--accent);border-radius:10px;margin-bottom:16px">
    <strong style="color:var(--accent);font-size:13px">${n} ${t('outreach.leads_selected')}</strong>
    <select id="bulk-script" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">${t('outreach.apply_script')}</option>${scriptOpts}</select>
    <select id="bulk-account" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">${t('outreach.apply_ig')}</option>${accountOpts}</select>
    <button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="applyLeadsBulk()">${t('common.apply')}</button>
    <button class="btn" style="background:var(--bg2);color:var(--text-secondary);border:none;padding:6px 14px;font-size:12px;cursor:pointer" onclick="clearLeadsSelection()">${t('common.deselect')}</button>
  </div>`;
}

async function applyLeadsBulk() {
  const script = document.getElementById('bulk-script').value;
  const account = document.getElementById('bulk-account').value;
  if (!script && !account) return showToast(t('outreach.choose_script_ig'), 'warning');
  const body = { ids: Array.from(selectedLeadIds) };
  if (script) body.script_used = script;
  if (account) body.ig_account_used = account;
  const btn = document.querySelector('#leads-bulk-bar .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = t('common.update'); }
  await fetch('/api/leads/bulk-update', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  body.ids.forEach(id => { const l = allLeads.find(x => x.id === id); if (l) { if (script) l.script_used = script; if (account) l.ig_account_used = account; } });
  showToast(body.ids.length + ' ' + t('student.leads_updated'), 'success');
  clearLeadsSelection();
  renderLeads();
}

async function loadOutreachOptions() {
  try {
    const res = await fetch('/api/user-options', { credentials: 'include' });
    if (res.ok) outreachOptions = await res.json();
  } catch(e) {}
}

function outreachInlineSelect(leadId, field, currentValue, optType) {
  const opts = outreachOptions[optType] || [];
  const style = 'background:var(--bg-base);color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;min-height:28px;width:100%';
  let html = '<select onchange="updateLeadField(' + leadId + ',\'' + field + '\',this.value)" style="' + style + '">';
  html += '<option value="">-</option>';
  const hasVal = opts.some(o => o.value === currentValue);
  if (currentValue && !hasVal) html += '<option value="' + currentValue + '" selected>' + currentValue + '</option>';
  opts.forEach(o => { html += '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.value + '</option>'; });
  html += '</select>';
  return html;
}

function updateLeadField(id, field, value) {
  const lead = allLeads.find(l => l.id === id);
  if (lead) lead[field] = value;
  const body = {};
  body[field] = value;
  fetch('/api/leads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
    .catch(() => showToast(t('toast.error_network'), 'error'));
}

async function loadLeads() {
  if (currentUser.role !== 'outreach' && !isAdmin()) return;
  try {
    const res = await fetch('/api/leads', { credentials: 'include' });
    if (res.ok) allLeads = await res.json();
  } catch (e) { console.error('Leads load error:', e); }
}

async function loadOutreachKPIs() {
  const kpisDiv = document.getElementById('outreach-kpis');
  if (!kpisDiv) return;

  if (currentUser.role === 'outreach') {
    try {
      const res = await fetch('/api/leads/my-stats', { credentials: 'include' });
      if (res.ok) {
        const s = await res.json();
        kpisDiv.innerHTML = `
          <div class="stat-card"><div class="stat-value">${s.leads_today}</div><div class="stat-label">${t('outreach.leads_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--blue)">${s.dm_sent_today}</div><div class="stat-label">${t('outreach.dms_today')}</div></div>
          <div class="stat-card"><div class="stat-value">${s.dm_sent}</div><div class="stat-label">${t('outreach.dms_total')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${s.talking_warm}</div><div class="stat-label">${t('outreach.talking_warm')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">${s.call_booked}</div><div class="stat-label">${t('outreach.call_booked')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">${s.reply_rate}%</div><div class="stat-label">${t('outreach.reply_rate')}</div></div>
        `;
      }
    } catch (e) {}
  }

  if (isAdmin()) {
    try {
      const res = await fetch('/api/leads/admin-stats', { credentials: 'include' });
      if (res.ok) {
        const agents = await res.json();
        const totals = agents.reduce((acc, a) => ({
          leads_today: acc.leads_today + parseInt(a.leads_today),
          dm_sent: acc.dm_sent + parseInt(a.dm_sent),
          dm_sent_today: acc.dm_sent_today + parseInt(a.dm_sent_today || 0),
          talking_cold: acc.talking_cold + parseInt(a.talking_cold),
          talking_warm: acc.talking_warm + parseInt(a.talking_warm),
          call_booked: acc.call_booked + parseInt(a.call_booked),
          signed: acc.signed + parseInt(a.signed),
          total: acc.total + parseInt(a.total_leads)
        }), { leads_today: 0, dm_sent: 0, dm_sent_today: 0, talking_cold: 0, talking_warm: 0, call_booked: 0, signed: 0, total: 0 });

        const repliesAll = totals.talking_cold + totals.talking_warm + totals.call_booked + totals.signed;
        const replyRateAll = totals.dm_sent > 0 ? ((repliesAll / totals.dm_sent) * 100).toFixed(1) : '0';
        kpisDiv.innerHTML = `
          <div class="stat-card"><div class="stat-value">${totals.leads_today}</div><div class="stat-label">${t('outreach.leads_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--blue)">${totals.dm_sent_today}</div><div class="stat-label">${t('outreach.dms_today')}</div></div>
          <div class="stat-card"><div class="stat-value">${totals.dm_sent}</div><div class="stat-label">${t('outreach.dms_total')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${totals.talking_warm}</div><div class="stat-label">${t('outreach.talking_warm')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">${totals.call_booked}</div><div class="stat-label">${t('outreach.call_booked')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--pink)">${totals.signed}</div><div class="stat-label">${t('outreach.signed')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">${replyRateAll}%</div><div class="stat-label">${t('outreach.reply_rate')}</div></div>
          <div class="stat-card"><div class="stat-value">${totals.total}</div><div class="stat-label">${t('outreach.total_leads')}</div></div>
        `;

        // Admin agents table
        const adminDiv = document.getElementById('outreach-admin-stats');
        adminDiv.style.display = 'block';
        const tbody = document.querySelector('#outreach-agents-table tbody');
        tbody.innerHTML = agents.map(a => `<tr>
          <td data-label="" class="mc-title"><strong>${a.agent_name}</strong></td>
          <td data-label="${t('outreach.table_leads')}" class="mc-half">${a.leads_today}</td>
          <td data-label="${t('outreach.table_dms')}" class="mc-half" style="color:var(--blue)">${a.dm_sent_today || 0}</td>
          <td data-label="${t('outreach.table_dms_total')}" class="mc-half">${a.dm_sent}</td>
          <td data-label="${t('outreach.table_cold')}" class="mc-half">${a.talking_cold}</td>
          <td data-label="${t('outreach.table_warm')}" class="mc-half" style="color:var(--yellow)">${a.talking_warm}</td>
          <td data-label="${t('outreach.table_booked')}" class="mc-half" style="color:var(--green)">${a.call_booked}</td>
          <td data-label="${t('outreach.table_signed')}" class="mc-half" style="color:var(--pink)">${a.signed}</td>
          <td data-label="${t('common.total')}" class="mc-half">${a.total_leads}</td>
        </tr>`).join('');
      }
    } catch (e) {}
  }
}

const leadTypeColors = {
  'small creator': { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa', label: 'Small Creator' },
  'medium creator': { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', label: 'Medium Creator' },
  'big creator': { bg: 'rgba(30,64,175,0.15)', color: '#1e40af', label: 'Big Creator' },
  'superstar': { bg: 'rgba(59,130,246,0.15)', color: '#3B82F6', label: 'Superstar' }
};

function leadTypeSelect(leadId, currentValue, onchangeFunc) {
  var current = leadTypeColors[currentValue] || null;
  var bgStyle = current ? current.bg : 'var(--bg-elevated)';
  var colorStyle = current ? current.color : 'var(--text)';
  var html = '<select onchange="' + onchangeFunc + '" style="background:' + bgStyle + ';color:' + colorStyle + ';border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;min-height:28px;width:100%">';
  html += '<option value="" style="background:var(--bg2);color:var(--text)">-</option>';
  var hasVal = !!leadTypeColors[currentValue];
  if (currentValue && !hasVal) html += '<option value="' + currentValue + '" selected style="background:var(--bg2);color:var(--text)">' + currentValue + '</option>';
  Object.entries(leadTypeColors).forEach(function(e) {
    html += '<option value="' + e[0] + '"' + (currentValue === e[0] ? ' selected' : '') + ' style="background:var(--bg2);color:var(--text)">' + e[1].label + '</option>';
  });
  html += '</select>';
  return html;
}

const leadStatusColors = {
  'to-send': { bg: 'rgba(231,76,60,0.15)', color: '#e74c3c', label: 'To Send' },
  'sent': { bg: 'rgba(39,174,96,0.15)', color: '#27ae60', label: 'Sent' },
  'talking-cold': { bg: 'rgba(232,149,109,0.15)', color: '#e8956d', label: 'Talking Cold' },
  'talking-warm': { bg: 'rgba(244,200,66,0.15)', color: '#f4c842', label: 'Talking Warm' },
  'call-booked': { bg: 'rgba(59,130,246,0.15)', color: '#3B82F6', label: 'Call Booked' },
  'signed': { bg: 'rgba(52,152,219,0.15)', color: '#3498db', label: 'Signé' }
};

function renderLeads() {
  if (currentUser.role !== 'outreach' && !isAdmin()) return;

  const userIsAdmin = isAdmin();
  const showAgent = userIsAdmin || currentUser.role === 'outreach';
  const agentCol = document.getElementById('lead-col-agent');
  if (agentCol) agentCol.style.display = showAgent ? '' : 'none';

  const search = (document.getElementById('lead-search')?.value || '').toLowerCase().trim();
  let filtered = currentLeadFilter === 'all' ? allLeads : allLeads.filter(l => l.status === currentLeadFilter);
  if (search) filtered = filtered.filter(l => l.username.toLowerCase().includes(search));
  const table = document.getElementById('leads-table');
  table.classList.add('mobile-cards');
  const tbody = table.querySelector('tbody');
  const statusEntries = Object.entries(leadStatusColors);
  tbody.innerHTML = filtered.map((l, idx) => {
    const st = leadStatusColors[l.status] || leadStatusColors['sent'];
    const date = new Date(l.created_at).toLocaleDateString('fr-FR');
    const igLink = l.ig_link ? `<a href="${l.ig_link}" target="_blank" style="color:var(--accent)">${l.username}</a>` : l.username;
    const checked = selectedLeadIds.has(l.id) ? 'checked' : '';
    const statusOpts = statusEntries.map(([k, v]) => `<option value="${k}" ${l.status === k ? 'selected' : ''} style="background:var(--bg2);color:var(--text)">${v.label}</option>`).join('');
    return `<tr>
      <td data-label="" style="width:30px"><input type="checkbox" class="lead-cb" data-id="${l.id}" ${checked} onchange="toggleLeadSelection(${l.id}, this.checked)"></td>
      <td data-label="#" style="color:var(--text-tertiary);font-size:12px">${filtered.length - idx}</td>
      <td data-label="" class="mc-title"><strong>${igLink}</strong></td>
      <td data-label="${t('outreach.table_type')}" class="mc-half">${leadTypeSelect(l.id, l.lead_type, 'updateLeadField(' + l.id + ',\\\'lead_type\\\',this.value)')}</td>
      <td data-label="${t('outreach.table_script')}" class="mc-half">${outreachInlineSelect(l.id, 'script_used', l.script_used, 'script')}</td>
      <td data-label="${t('outreach.table_ig')}" class="mc-half">${outreachInlineSelect(l.id, 'ig_account_used', l.ig_account_used, 'account')}</td>
      <td data-label="${t('outreach.table_status')}" class="mc-half">
        <select onchange="updateLeadStatus(${l.id}, this.value, this)" style="background:${st.bg};color:${st.color};border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">
          ${statusOpts}
        </select>
      </td>
      <td data-label="${t('outreach.table_notes')}" class="mc-full" style="color:var(--text-secondary);font-size:12px">${l.notes || '-'}</td>
      ${showAgent ? `<td data-label="${t('outreach.table_agent')}" class="mc-half" style="color:var(--accent-blue-light)">${l.agent_name || '-'}</td>` : ''}
      <td data-label="${t('outreach.table_date')}" class="mc-half" style="font-size:12px;color:var(--text-tertiary)">${date}</td>
      <td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteLead(${l.id})" title="${t('common.delete')}">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="11">' + emptyStateHTML('search', t('outreach.no_lead_found')) + '</td></tr>';
  renderLeadsBulkBar();
}

// showToast, showPromptModal, autoFillUsername → moved to dashboard-utils.js

// extractUsernameFromUrl → moved to dashboard-utils.js

function outreachFormSelect(id, optType, placeholder) {
  var opts = outreachOptions[optType] || [];
  return '<div style="display:flex;gap:6px;align-items:center">'
    + '<select id="' + id + '" class="form-input" style="flex:1">'
    + '<option value="">-- ' + placeholder + ' --</option>'
    + opts.map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('')
    + '</select>'
    + '<button class="btn" style="padding:6px 10px;font-size:14px;background:var(--bg-base);color:var(--accent);border:none;cursor:pointer" onclick="addOutreachFormOption(\'' + optType + '\',\'' + id + '\')" title="Ajouter">+</button>'
    + '</div>';
}

async function addOutreachFormOption(optType, selectId) {
  var labels = { script: 'script', account: 'compte Instagram', type: 'type de lead' };
  var value = await showPromptModal(t('common.new_prefix') + ' ' + (labels[optType] || optType), t('common.example_prefix') + ' ' + (optType === 'script' ? 'Script DM v2' : optType === 'account' ? '@moncompte' : 'Model'));
  if (!value || !value.trim()) return;
  var res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value.trim() }) });
  if (res.ok) {
    var opt = await res.json();
    outreachOptions[optType].push(opt);
    var select = document.getElementById(selectId);
    var newOpt = document.createElement('option');
    newOpt.value = opt.value;
    newOpt.textContent = opt.value;
    newOpt.selected = true;
    select.appendChild(newOpt);
    showToast('"' + opt.value + '" ' + t('outreach.option_added'), 'success');
  }
}

function showAddLeadForm() {
  const form = document.getElementById('add-lead-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('lead-type-wrap').innerHTML = '<select id="lead-type" class="form-input"><option value="">' + t('outreach.type_select') + '</option>' + Object.entries(leadTypeColors).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('') + '</select>';
    document.getElementById('lead-script-wrap').innerHTML = outreachFormSelect('lead-script', 'script', t('student.script_used'));
    document.getElementById('lead-account-wrap').innerHTML = outreachFormSelect('lead-ig-account', 'account', t('outreach.ig_account_label'));
  }
}

async function addLead() {
  const igLink = document.getElementById('lead-ig-link').value.trim();
  let username = document.getElementById('lead-username').value.trim();
  if (!username && igLink) username = extractUsernameFromUrl(igLink);
  if (!username) return showToast(t('outreach.paste_ig'), 'error');
  const cleanName = username.replace(/^@/, '').toLowerCase();
  const duplicate = allLeads.find(l => l.username.replace(/^@/, '').toLowerCase() === cleanName);
  if (duplicate) return showToast(t('outreach.duplicate_lead') + ' : ' + duplicate.username + ' (' + duplicate.status + ')', 'error');

  // Récupérer les valeurs AVANT de toucher au DOM
  const leadData = {
    username,
    ig_link: igLink,
    lead_type: document.getElementById('lead-type')?.value || '',
    script_used: document.getElementById('lead-script')?.value || '',
    ig_account_used: document.getElementById('lead-ig-account')?.value || '',
    notes: document.getElementById('lead-notes').value.trim(),
    status: 'to-send'
  };

  // Vider le formulaire et le masquer immédiatement
  document.getElementById('lead-username').value = '';
  document.getElementById('lead-ig-link').value = '';
  document.getElementById('lead-notes').value = '';
  document.getElementById('add-lead-form').style.display = 'none';

  // Envoyer au serveur
  try {
    const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(leadData) });
    if (res.ok) {
      const newLead = await res.json();
      allLeads.unshift(newLead);
      renderLeads();
      showToast(t('outreach.lead_added_toast'), 'success');
    } else {
      const err = await res.json().catch(function() { return {}; });
      showToast(err.error || t('toast.error_server'), 'error');
    }
  } catch(e) {
    showToast(t('toast.error_network'), 'error');
  }
}

function updateLeadStatus(id, status, selectEl) {
  const lead = allLeads.find(l => l.id === id);
  if (lead) lead.status = status;
  // Mettre à jour la couleur du select immédiatement
  const st = leadStatusColors[status] || leadStatusColors['sent'];
  if (selectEl) { selectEl.style.background = st.bg; selectEl.style.color = st.color; }
  fetch('/api/leads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) })
    .catch(() => showToast(t('toast.error_network'), 'error'));
}

async function deleteLead(id) {
  if (!(await confirmDelete(t('outreach.delete_confirm')))) return;
  allLeads = allLeads.filter(l => l.id !== id);
  renderLeads();
  fetch('/api/leads/' + id, { method: 'DELETE', credentials: 'include' })
    .catch(() => showToast(t('toast.error_delete'), 'error'));
  loadOutreachKPIs();
}

function filterLeads(filter, btn) {
  currentLeadFilter = filter;
  document.querySelectorAll('.lead-filter').forEach(b => {
    b.style.background = 'var(--bg-elevated)';
    b.style.color = 'var(--text-secondary)';
  });
  btn.style.background = 'var(--accent)';
  btn.style.color = 'white';
  renderLeads();
}

async function importCSV() {
  if (!(await confirmDelete(t('outreach.import_confirm')))) return;
  const btn = document.getElementById('btn-import-csv');
  btn.textContent = t('outreach.import_progress');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/import-csv', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (res.ok) {
      showToast(t('outreach.import_complete') + ': ' + data.imported + ' nouveaux, ' + data.updated + ' mis à jour / ' + data.total, 'success');
      await loadLeads();
      renderLeads();
      await loadOutreachKPIs();
    } else {
      showToast(data.error || t('outreach.unknown_error'), 'error');
    }
  } catch (e) {
    showToast(t('toast.error_network'), 'error');
  }
  btn.textContent = t('outreach.import_csv');
  btn.disabled = false;
}

function showOutreachOptionsManager() {
  const existing = document.getElementById('outreach-options-mgr');
  if (existing) { existing.remove(); return; }
  const labels = { type: t('outreach.types_label'), script: t('outreach.scripts_label'), account: t('outreach.ig_account_label') };
  const panel = document.createElement('div');
  panel.id = 'outreach-options-mgr';
  panel.className = 'panel';
  panel.style.cssText = 'padding:20px;margin-bottom:20px';
  panel.innerHTML = '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('outreach.manage_options') + '</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">'
    + Object.entries(labels).map(function([key, label]) {
      var opts = outreachOptions[key] || [];
      return '<div style="background:var(--bg-base);padding:14px;border-radius:10px">'
        + '<strong style="font-size:13px;display:block;margin-bottom:10px">' + label + '</strong>'
        + (opts.length === 0 ? '<div style="color:var(--text-tertiary);font-size:12px">' + t('outreach.no_options') + '</div>' : '')
        + opts.map(function(o) { return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px"><span>' + o.value + '</span><button class="btn-delete-small" onclick="deleteOutreachOption(' + o.id + ')" style="font-size:10px">✕</button></div>'; }).join('')
        + '<div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="new-oopt-' + key + '" class="form-input" style="font-size:12px;padding:6px 8px;flex:1" placeholder="' + t('outreach.add_option') + '"><button class="btn btn-primary" style="padding:6px 10px;font-size:11px" onclick="addOutreachOption(\'' + key + '\')">+</button></div>'
        + '</div>';
    }).join('')
    + '</div>'
    + '<div style="margin-top:12px"><button class="btn" style="background:var(--bg-base);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById(\'outreach-options-mgr\').remove()">' + t('common.close') + '</button></div>';
  document.getElementById('section-outreach').querySelector('.page-header').after(panel);
}

async function addOutreachOption(optType) {
  var input = document.getElementById('new-oopt-' + optType);
  var value = input.value.trim();
  if (!value) return;
  var res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value }) });
  if (res.ok) {
    var opt = await res.json();
    outreachOptions[optType].push(opt);
    showToast('"' + value + '" ' + t('outreach.option_added'), 'success');
    document.getElementById('outreach-options-mgr').remove();
    showOutreachOptionsManager();
    renderLeads();
  } else {
    var e = await res.json();
    showToast(e.error || t('common.error'), 'error');
  }
}

async function deleteOutreachOption(id) {
  await fetch('/api/user-options/' + id, { method: 'DELETE', credentials: 'include' });
  ['script', 'account', 'type'].forEach(function(key) {
    outreachOptions[key] = outreachOptions[key].filter(function(o) { return o.id !== id; });
  });
  showToast(t('toast.option_deleted'), 'success');
  document.getElementById('outreach-options-mgr').remove();
  showOutreachOptionsManager();
  renderLeads();
}
