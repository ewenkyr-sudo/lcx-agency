// ========== STUDENT MODULE ==========
// Handles all student-specific functionality

const STEPS = [
  { key: 'onboarding', labelKey: 'models.onboarding', icon: '📋' },
  { key: 'accounts-setup', labelKey: 'models.accounts', icon: '🔧' },
  { key: 'outreach', labelKey: 'nav.outreach', icon: '📨' },
  { key: 'model-setup', labelKey: 'student.step_model', icon: '👤' },
  { key: 'traffic', labelKey: 'resource.traffic', icon: '🚀' }
];
function getStepLabel(s) { return s.labelKey ? t(s.labelKey) : ''; }

const RECRUIT_STATUSES = {
  'interested': { labelKey: 'student.recruit_status_interested', color: 'var(--blue)', bg: 'var(--blue-bg)' },
  'whatsapp': { labelKey: 'student.recruit_status_whatsapp', color: 'var(--yellow)', bg: 'var(--yellow-bg)' },
  'call-planned': { labelKey: 'student.recruit_status_call', color: 'var(--accent)', bg: 'var(--accent-glow)' },
  'signed': { labelKey: 'student.recruit_status_signed', color: 'var(--green)', bg: 'var(--green-bg)' }
};
function getRecruitStatusLabel(rs) { return rs.labelKey ? t(rs.labelKey) : ''; }

let studentData = { leads: [], recruits: [], models: [], revenue: [], callRequests: [], objectives: [], conversations: [], messages: [] };
let userOptions = { script: [], account: [], type: [] };
let currentChatUserId = null;
let selectedStudentLeadIds = new Set();

function toggleStudentLeadSelection(id, checked) {
  if (checked) selectedStudentLeadIds.add(id); else selectedStudentLeadIds.delete(id);
  renderStudentBulkBar();
}

function toggleAllStudentLeads(checked) {
  document.querySelectorAll('#student-leads-table .student-lead-cb').forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) selectedStudentLeadIds.add(id); else selectedStudentLeadIds.delete(id);
  });
  renderStudentBulkBar();
}

function clearStudentLeadsSelection() {
  selectedStudentLeadIds.clear();
  document.querySelectorAll('#student-leads-table .student-lead-cb').forEach(cb => cb.checked = false);
  const master = document.getElementById('student-leads-master-cb');
  if (master) master.checked = false;
  renderStudentBulkBar();
}

function renderStudentBulkBar() {
  const bar = document.getElementById('student-leads-bulk-bar');
  if (!bar) return;
  const n = selectedStudentLeadIds.size;
  if (n === 0) { bar.style.display = 'none'; return; }
  const existing = bar.querySelector('strong');
  if (existing && bar.style.display === 'block') {
    existing.textContent = t('outreach.leads_selected').replace('{n}', n);
    return;
  }
  const scriptOpts = (userOptions.script || []).map(o => `<option value="${o.value}">${o.value}</option>`).join('');
  const accountOpts = (userOptions.account || []).map(o => `<option value="${o.value}">${o.value}</option>`).join('');
  bar.style.display = 'block';
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:var(--bg-elevated);border:1px solid var(--accent);border-radius:10px;margin-bottom:16px">
    <strong style="color:var(--accent);font-size:13px">${t('outreach.leads_selected').replace('{n}', n)}</strong>
    <select id="student-bulk-script" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">${t('outreach.apply_script')}</option>${scriptOpts}</select>
    <select id="student-bulk-account" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">${t('outreach.apply_ig')}</option>${accountOpts}</select>
    <button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="applyStudentLeadsBulk()">${t('common.apply')}</button>
    <button class="btn" style="background:var(--bg2);color:var(--text-secondary);border:none;padding:6px 14px;font-size:12px;cursor:pointer" onclick="clearStudentLeadsSelection()">${t('common.deselect')}</button>
  </div>`;
}

async function applyStudentLeadsBulk() {
  const script = document.getElementById('student-bulk-script').value;
  const account = document.getElementById('student-bulk-account').value;
  if (!script && !account) return showToast(t('outreach.choose_script_ig'), 'warning');
  const ids = Array.from(selectedStudentLeadIds);
  const body = { ids };
  if (script) body.script_used = script;
  if (account) body.ig_account_used = account;
  const btn = document.querySelector('#student-leads-bulk-bar .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = t('common.update'); }
  await fetch('/api/student-leads/bulk-update', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  ids.forEach(id => { const l = studentData.leads.find(x => x.id === id); if (l) { if (script) l.script_used = script; if (account) l.ig_account_used = account; } });
  showToast(t('student.leads_updated').replace('{n}', ids.length), 'success');
  clearStudentLeadsSelection();
  renderStudentLeadTable();
}

// ========== DEBOUNCED SEARCH ==========
const debouncedRenderStudentLeadTable = debounce(function() { renderStudentLeadTable(); }, 300);

// ========== DATA LOADING ==========
async function loadStudentData() {
  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [leads, recruits, models, revenue, callRequests, objectives, conversations, opts] = await Promise.all([
    f('/api/student-leads?market=' + currentStudentMarket), f('/api/student-recruits'), f('/api/student-models'),
    f('/api/student-revenue'), f('/api/call-requests'), f('/api/objectives'), f('/api/conversations'),
    f('/api/user-options')
  ]);
  studentData = { leads, recruits, models, revenue, callRequests, objectives, conversations, messages: studentData.messages };
  if (opts.script) userOptions = opts;
}

// ========== STUDENT HOME ==========
async function renderStudentHome() {
  await loadStudentData();
  const c = document.getElementById('section-student-home');
  if (!c) return;

  const student = allStudents[0];
  const step = student?.progression_step || 'onboarding';
  const stepIdx = STEPS.findIndex(s => s.key === step);
  const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);

  const leadStats = await fetch('/api/student-leads/stats', { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
  const pendingCalls = studentData.callRequests.filter(c => c.status === 'pending').length;
  const acceptedCalls = studentData.callRequests.filter(c => c.status === 'accepted').length;
  const unreadMsgs = studentData.conversations.reduce((s, c) => s + parseInt(c.unread || 0), 0);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.my_dashboard')}</div><div class="page-subtitle">${t('student.welcome')} ${currentUser.display_name}</div></div></div>

    <!-- Progression -->
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">${t('student.my_progression')} — ${pct}%</h3>
      <div style="display:flex;gap:4px;margin-bottom:16px;height:8px;border-radius:4px;overflow:hidden;background:var(--bg-elevated)">
        <div style="width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:4px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${STEPS.map((s, i) => {
          const done = i <= stepIdx;
          const active = i === stepIdx;
          return `<div style="flex:1;min-width:80px;text-align:center;padding:10px 6px;border-radius:8px;background:${active ? 'var(--accent-glow)' : done ? 'var(--green-bg)' : 'var(--bg-elevated)'};border:1px solid ${active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--border)'}">
            <div style="font-size:20px;margin-bottom:4px">${s.icon}</div>
            <div style="font-size:11px;font-weight:600;color:${active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--text-tertiary)'}">${getStepLabel(s)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- KPIs -->
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value">${leadStats.dm_sent || 0}</div><div class="stat-label">${t('student.dms_sent')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">${leadStats.reply_rate || 0}%</div><div class="stat-label">${t('student.reply_rate')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">${studentData.recruits.filter(r => r.status === 'signed').length}</div><div class="stat-label">${t('student.signed_models')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${studentData.models.length}</div><div class="stat-label">${t('student.managed_models')}</div></div>
    </div>

    <!-- Daily leads & DMs chart -->
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">${t('student.leads_dms_daily')}</h3>
      <div style="position:relative;height:220px"><canvas id="chart-student-daily"></canvas></div>
    </div>

    <div class="two-col">
      <!-- Calls -->
      <div class="panel" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="font-size:14px">${t('student.call_request_label')}</strong>
          <button class="btn btn-primary" style="font-size:12px;padding:6px 12px" onclick="showCallRequestForm()">${t('student.request_call')}</button>
        </div>
        ${studentData.callRequests.length === 0 ? '<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:16px">' + t('student.no_request') + '</div>' :
          studentData.callRequests.slice(0, 5).map(c => {
            const stColor = c.status === 'pending' ? 'var(--yellow)' : c.status === 'accepted' ? 'var(--green)' : 'var(--red)';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
              <span>${c.message?.substring(0, 40) || t('student.request_call')}${c.message?.length > 40 ? '...' : ''}</span>
              <span style="color:${stColor};font-weight:600;font-size:11px">${c.status === 'pending' ? t('student.call_pending') : c.status === 'accepted' ? t('student.call_accepted') + ' — ' + (c.scheduled_at || '') : t('student.call_refused')}</span>
            </div>`;
          }).join('')}
      </div>

      <!-- Messages -->
      <div class="panel" style="padding:16px">
        <strong style="font-size:14px;display:block;margin-bottom:12px">${t('student.messages_label')} ${unreadMsgs > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + unreadMsgs + ' ' + t('student.unread') + '</span>' : ''}</strong>
        ${studentData.conversations.map(c => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="document.querySelector('[data-section=student-messages]').click()">
            ${avatarHTML(c, 32)}
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${c.display_name}</div>
              <div style="font-size:11px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${c.last_message || t('student.no_message')}</div>
            </div>
            ${parseInt(c.unread) > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + c.unread + '</span>' : ''}
          </div>
        `).join('') || '<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:16px">' + t('student.no_message') + '</div>'}
      </div>
    </div>
  `;

  // Load daily chart
  try {
    const dailyRes = await fetch('/api/analytics/daily?days=30', { credentials: 'include' });
    const data = await dailyRes.json();
    const daily = data.daily || [];
    if (daily.length > 0) {
      const ctx = document.getElementById('chart-student-daily');
      if (ctx) {
        if (window._studentDailyChart) window._studentDailyChart.destroy();
        window._studentDailyChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: daily.map(function(d) { var dt = new Date(d.day); return dt.getDate() + '/' + (dt.getMonth()+1); }),
            datasets: [
              { label: 'Leads', data: daily.map(function(d) { return parseInt(d.leads); }), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 },
              { label: 'DMs', data: daily.map(function(d) { return parseInt(d.dms); }), backgroundColor: 'rgba(34,211,238,0.6)', borderRadius: 4 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' }, grid: { color: 'rgba(59,130,246,0.06)' } }, x: { ticks: { color: '#A1A1AA', maxRotation: 45 }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 12 } } } }
        });
      }
    }
  } catch(e) {}
}

// ========== CALL REQUEST FORM ==========
function showCallRequestForm() {
  const section = document.getElementById('section-student-home');
  const existing = document.getElementById('call-request-form');
  if (existing) { existing.remove(); return; }
  const form = document.createElement('div');
  form.id = 'call-request-form';
  form.className = 'panel';
  form.style.cssText = 'padding:20px;margin-bottom:20px';
  form.innerHTML = `
    <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">${t('student.request_call')}</h3>
    <div style="display:grid;gap:12px;max-width:500px">
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.call_subject')}</label>
        <textarea id="cr-message" class="form-input" rows="2" placeholder="${t('student.call_subject_placeholder')}"></textarea></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.call_availability')}</label>
        <input type="text" id="cr-avail" class="form-input" placeholder="${t('student.call_availability_placeholder')}"></div>
      <button class="btn btn-primary" onclick="submitCallRequest()">${t('student.send_request')}</button>
    </div>`;
  section.querySelector('.page-header').after(form);
}

async function submitCallRequest() {
  const message = document.getElementById('cr-message').value.trim();
  const availabilities = document.getElementById('cr-avail').value.trim();
  if (!message) return showToast(t('toast.message_required'), 'error');
  const res = await fetch('/api/call-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message, availabilities }) });
  if (res.ok) { showToast(t('planning.request_sent'), 'success'); document.getElementById('call-request-form')?.remove(); renderStudentHome(); }
}

// ========== STUDENT OUTREACH ==========
let studentLeadFilter = 'all';

let currentStudentMarket = 'fr';

async function renderStudentOutreach() {
  await loadStudentData();
  const student = allStudents[0];
  const usEnabled = student?.outreach_us_enabled;
  const stats = await fetch('/api/student-leads/stats?market=' + currentStudentMarket, { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
  // Reload leads filtered by market
  const leadsRes = await fetch('/api/student-leads?market=' + currentStudentMarket, { credentials: 'include' });
  if (leadsRes.ok) studentData.leads = await leadsRes.json();
  const c = document.getElementById('section-student-outreach');
  if (!c) return;

  var marketLabel = currentStudentMarket === 'us' ? 'US' : 'FR';
  c.innerHTML = `
    ${usEnabled ? '<div style="display:flex;gap:8px;margin-bottom:16px"><button onclick="switchStudentMarket(\'fr\')" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:13px;background:' + (currentStudentMarket==='fr'?'var(--accent)':'var(--bg-elevated)') + ';color:' + (currentStudentMarket==='fr'?'white':'var(--text-secondary)') + '">Outreach FR</button><button onclick="switchStudentMarket(\'us\')" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:13px;background:' + (currentStudentMarket==='us'?'var(--accent)':'var(--bg-elevated)') + ';color:' + (currentStudentMarket==='us'?'white':'var(--text-secondary)') + '">Outreach US</button></div>' : ''}
    <div class="page-header"><div><div class="page-title">${t('student.outreach_title')} ${marketLabel}</div><div class="page-subtitle">${t('student.outreach_subtitle')} ${marketLabel}</div></div>
      <div class="header-actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" onclick="showStudentLeadForm()">${t('common.new_lead')}</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer" onclick="showOptionsManager()">${t('outreach.my_options')}</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById('csv-import-input').click()">${t('outreach.import_csv')}</button><input type="file" id="csv-import-input" accept=".csv" style="display:none" onchange="importStudentCSV(this)"></div></div>
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value">${stats.leads_today || 0}</div><div class="stat-label">${t('student.leads_today')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--blue)">${stats.dm_sent_today || 0}</div><div class="stat-label">${t('student.dms_today')}</div></div>
      <div class="stat-card"><div class="stat-value">${stats.dm_sent || 0}</div><div class="stat-label">${t('student.dms_total')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${stats.talking_warm || 0}</div><div class="stat-label">${t('dash.talking_warm')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">${stats.call_booked || 0}</div><div class="stat-label">${t('dash.call_booked')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">${stats.reply_rate || 0}%</div><div class="stat-label">${t('student.reply_rate')}</div></div>
    </div>
    ${stats.shared && stats.contributions ? '<div class="panel" style="padding:14px;margin-bottom:20px"><strong style="font-size:13px;color:var(--accent-blue-light);display:block;margin-bottom:10px">' + t('student.contributions') + '</strong><div style="display:flex;gap:16px;flex-wrap:wrap">' + stats.contributions.map(function(c) { return '<div style="background:var(--bg-elevated);padding:10px 14px;border-radius:8px;flex:1;min-width:150px"><strong style="font-size:13px">' + c.name + '</strong><div style="font-size:12px;color:var(--text-secondary);margin-top:4px">' + c.leads_added + ' ' + t('student.leads_added') + '</div><div style="font-size:12px;color:var(--blue)">' + c.dms_today + ' ' + t('student.dms_short') + '</div><div style="font-size:12px;color:var(--text-tertiary)">' + c.dms_total + ' ' + t('student.dms_total') + '</div></div>'; }).join('') + '</div></div>' : ''}
    <div id="student-lead-form-wrap"></div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      ${['all','to-send','sent','talking-cold','talking-warm','call-booked','signed'].map(f => `<button class="btn lead-filter ${studentLeadFilter===f?'active':''}" onclick="filterStudentLeads('${f}',this)" style="font-size:12px;padding:6px 14px;border-radius:20px;background:${studentLeadFilter===f?'var(--accent)':'var(--bg-elevated)'};color:${studentLeadFilter===f?'white':'var(--text-secondary)'};border:none;cursor:pointer">${f==='all'?'Tous':leadStatusColors[f]?.label||f}</button>`).join('')}
    </div>
    <div style="margin-bottom:16px"><input type="text" id="student-lead-search" class="form-input" placeholder="${t('outreach.search_placeholder')}" oninput="debouncedRenderStudentLeadTable()" style="max-width:350px"></div>
    <div id="student-leads-bulk-bar" style="display:none"></div>
    <div class="panel"><table class="table mobile-cards" id="student-leads-table"><thead><tr><th style="width:30px"><input type="checkbox" id="student-leads-master-cb" onclick="toggleAllStudentLeads(this.checked)" title="Tout sélectionner"></th><th>#</th><th>Username</th><th>Type</th><th>Script</th><th>Compte</th><th>Statut</th><th>Ajouté par</th><th>Notes</th><th>Date</th><th></th></tr></thead><tbody></tbody></table></div>
  `;
  renderStudentLeadTable();
}

function inlineSelect(leadId, field, currentValue, optType) {
  const opts = userOptions[optType] || [];
  const selectStyle = 'background:var(--bg-elevated);color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;min-height:28px;width:100%';
  let html = '<select onchange="updateStudentLeadField(' + leadId + ',\'' + field + '\',this.value)" style="' + selectStyle + '">';
  html += '<option value="">-</option>';
  // Ajouter la valeur actuelle si elle n'est pas dans les options
  const hasCurrentInOpts = opts.some(o => o.value === currentValue);
  if (currentValue && !hasCurrentInOpts) {
    html += '<option value="' + currentValue + '" selected>' + currentValue + '</option>';
  }
  opts.forEach(o => {
    html += '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.value + '</option>';
  });
  html += '</select>';
  return html;
}

function renderStudentLeadTable() {
  const search = (document.getElementById('student-lead-search')?.value || '').toLowerCase();
  let filtered = studentLeadFilter === 'all' ? studentData.leads : studentData.leads.filter(l => l.status === studentLeadFilter);
  if (search) filtered = filtered.filter(l => l.username.toLowerCase().includes(search));
  const tbody = document.querySelector('#student-leads-table tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map((l, idx) => {
    const st = leadStatusColors[l.status] || leadStatusColors['sent'];
    const date = new Date(l.created_at).toLocaleDateString('fr-FR');
    const igLink = l.ig_link ? '<a href="' + l.ig_link + '" target="_blank" style="color:var(--accent)">' + l.username + '</a>' : l.username;
    const checked = selectedStudentLeadIds.has(l.id) ? 'checked' : '';
    return '<tr><td data-label="" style="width:30px"><input type="checkbox" class="student-lead-cb" data-id="' + l.id + '" ' + checked + ' onchange="toggleStudentLeadSelection(' + l.id + ',this.checked)"></td>'
      + '<td data-label="#" style="color:var(--text-tertiary);font-size:12px">' + (filtered.length - idx) + '</td>'
      + '<td data-label="" class="mc-title"><strong>' + igLink + '</strong></td>'
      + '<td data-label="Type" class="mc-half">' + leadTypeSelect(l.id, l.lead_type, 'updateStudentLeadField(' + l.id + ',\'lead_type\',this.value)') + '</td>'
      + '<td data-label="Script" class="mc-half">' + inlineSelect(l.id, 'script_used', l.script_used, 'script') + '</td>'
      + '<td data-label="Compte" class="mc-half">' + inlineSelect(l.id, 'ig_account_used', l.ig_account_used, 'account') + '</td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="var s=leadStatusColors[this.value]||leadStatusColors[\'sent\'];this.style.background=s.bg;this.style.color=s.color;updateStudentLead(' + l.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(leadStatusColors).map(([k,v]) => '<option value="' + k + '"' + (l.status===k?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + v.label + '</option>').join('') + '</select></td>'
      + '<td data-label="Modifié par" class="mc-half" style="font-size:11px;color:var(--accent-blue-light)">' + (l.modified_by_name || l.added_by_name || '-') + '</td>'
      + '<td data-label="Notes" class="mc-full" style="color:var(--text-secondary);font-size:12px">' + (l.notes || '-') + '</td>'
      + '<td data-label="Date" class="mc-half" style="font-size:12px;color:var(--text-tertiary)">' + date + '</td>'
      + '<td data-label=""><button class="btn-delete-small" onclick="deleteStudentLead(' + l.id + ')">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="11">' + emptyStateHTML('search', t('student.no_lead'), '+ Nouveau lead', 'showStudentLeadForm()') + '</td></tr>';
  renderStudentBulkBar();
}

function filterStudentLeads(f, btn) {
  studentLeadFilter = f;
  document.querySelectorAll('#section-student-outreach .lead-filter').forEach(b => { b.style.background = 'var(--bg-elevated)'; b.style.color = 'var(--text-secondary)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  renderStudentLeadTable();
}

function optionSelect(id, optType, placeholder) {
  const opts = userOptions[optType] || [];
  return '<div style="display:flex;gap:6px;align-items:center">'
    + '<select id="' + id + '" class="form-input" style="flex:1">'
    + '<option value="">-- ' + placeholder + ' --</option>'
    + opts.map(o => '<option value="' + o.value + '">' + o.value + '</option>').join('')
    + '</select>'
    + '<button class="btn" style="padding:6px 10px;font-size:14px;background:var(--bg-elevated);color:var(--accent);border:none;cursor:pointer" onclick="addNewOption(\'' + optType + '\',\'' + id + '\')" title="Ajouter">+</button>'
    + '</div>';
}

function showStudentLeadForm() {
  const wrap = document.getElementById('student-lead-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">' + t('student.add_lead_title') + '</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:700px">'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.username_label') + '</label><input type="text" id="sl-username" class="form-input" placeholder="' + t('student.username_placeholder') + '"></div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('outreach.ig_link') + '</label><input type="text" id="sl-iglink" class="form-input" placeholder="' + t('student.ig_link_placeholder') + '" oninput="autoFillUsername(this.value,\'sl-username\')"></div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.type_label') + '</label><select id="sl-type" class="form-input"><option value="">-- Type --</option>' + Object.entries(leadTypeColors).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('') + '</select></div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('outreach.script') + '</label>' + optionSelect('sl-script', 'script', t('student.script_placeholder')) + '</div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.account_label') + '</label>' + optionSelect('sl-account', 'account', t('student.account_placeholder')) + '</div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('common.notes') + '</label><input type="text" id="sl-notes" class="form-input" placeholder="' + t('student.notes_placeholder') + '"></div>'
    + '</div>'
    + '<div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addStudentLead()">' + t('common.add') + '</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary)" onclick="document.getElementById(\'student-lead-form-wrap\').innerHTML=\'\'">' + t('common.cancel') + '</button></div>'
    + '</div>';
}

async function addNewOption(optType, selectId) {
  const labels = { script: 'script', account: 'compte Instagram', type: 'type de lead' };
  const value = await showPromptModal(t('common.new_prefix') + ' ' + (labels[optType] || optType), t('common.example_prefix') + ' ' + (optType === 'script' ? 'Script DM v2' : optType === 'account' ? '@moncompte' : 'Model'));
  if (!value || !value.trim()) return;
  const res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value.trim() }) });
  if (res.ok) {
    const opt = await res.json();
    userOptions[optType].push(opt);
    // Ajouter l'option au select et la sélectionner
    const select = document.getElementById(selectId);
    const newOpt = document.createElement('option');
    newOpt.value = opt.value;
    newOpt.textContent = opt.value;
    newOpt.selected = true;
    select.appendChild(newOpt);
    showToast('"' + opt.value + '" ' + t('toast.option_added'), 'success');
  } else {
    const e = await res.json();
    showToast(e.error || t('common.error'), 'error');
  }
}

function autoFillUsername(url, targetId) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (match) document.getElementById(targetId).value = '@' + match[1];
}

async function deleteAllStudentLeads() {
  var label = currentStudentMarket === 'us' ? 'US' : 'FR';
  if (!(await confirmDelete(t('confirm.delete_all_leads')))) return;
  var res = await fetch('/api/student-leads/all?market=' + currentStudentMarket, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    var data = await res.json();
    showToast(data.deleted + ' ' + t('toast.leads_deleted'), 'success');
    await loadStudentData();
    renderStudentOutreach();
  }
}

function switchStudentMarket(m) {
  currentStudentMarket = m;
  studentLeadFilter = 'all';
  renderStudentOutreach();
}

async function addStudentLead() {
  const username = document.getElementById('sl-username').value.trim();
  if (!username) return showToast(t('toast.username_required'), 'error');
  const dup = studentData.leads.find(l => l.username.replace(/^@/,'').toLowerCase() === username.replace(/^@/,'').toLowerCase());
  if (dup) return showToast(t('student.lead_exists') + ' (' + dup.status + ')', 'error');
  const res = await fetch('/api/student-leads', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({
    username, ig_link: document.getElementById('sl-iglink').value.trim(), lead_type: document.getElementById('sl-type').value,
    script_used: document.getElementById('sl-script').value, ig_account_used: document.getElementById('sl-account')?.value || '', notes: document.getElementById('sl-notes').value.trim(),
    market: currentStudentMarket
  })});
  if (res.ok) {
    const newLead = await res.json();
    studentData.leads.unshift(newLead);
    document.getElementById('student-lead-form-wrap').innerHTML = '';
    renderStudentLeadTable();
    showToast(t('toast.lead_added_ex'), 'success');
  } else {
    try { const e = await res.json(); showToast(e.error || t('common.error'), 'error'); } catch(err) { showToast(t('toast.error_server'), 'error'); }
  }
}

function updateStudentLead(id, status) {
  const lead = studentData.leads.find(l => l.id === id);
  if (lead) lead.status = status;
  fetch('/api/student-leads/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) })
    .catch(() => showToast(t('toast.error_network'), 'error'));
}

function updateStudentLeadField(id, field, value) {
  const lead = studentData.leads.find(l => l.id === id);
  if (lead) lead[field] = value;
  const body = {};
  body[field] = value;
  fetch('/api/student-leads/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) })
    .catch(() => showToast(t('toast.error_network'), 'error'));
}

async function deleteStudentLead(id) {
  if (!(await confirmDelete(t('confirm.delete_lead')))) return;
  studentData.leads = studentData.leads.filter(l => l.id !== id);
  renderStudentLeadTable();
  fetch('/api/student-leads/' + id, { method:'DELETE', credentials:'include' })
    .catch(() => showToast(t('toast.error_delete'), 'error'));
}

function showOptionsManager() {
  const wrap = document.getElementById('student-lead-form-wrap');
  if (wrap.querySelector('#options-manager')) { wrap.innerHTML = ''; return; }
  const labels = { type: t('student.leads_types'), script: t('student.scripts'), account: t('student.ig_accounts') };
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px" id="options-manager">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('outreach.manage_options') + '</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">'
    + Object.entries(labels).map(([key, label]) => {
      const opts = userOptions[key] || [];
      return '<div style="background:var(--bg-elevated);padding:14px;border-radius:10px">'
        + '<strong style="font-size:13px;display:block;margin-bottom:10px">' + label + '</strong>'
        + (opts.length === 0 ? '<div style="color:var(--text-tertiary);font-size:12px">' + t('student.no_option') + '</div>' : '')
        + opts.map(o => '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px"><span>' + o.value + '</span><button class="btn-delete-small" onclick="deleteOption(' + o.id + ')" style="font-size:10px">✕</button></div>').join('')
        + '<div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="new-opt-' + key + '" class="form-input" style="font-size:12px;padding:6px 8px;flex:1" placeholder="' + t('student.add_option_placeholder') + '"><button class="btn btn-primary" style="padding:6px 10px;font-size:11px" onclick="addOptionFromManager(\'' + key + '\')">+</button></div>'
        + '</div>';
    }).join('')
    + '</div>'
    + '<div style="margin-top:12px"><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById(\'student-lead-form-wrap\').innerHTML=\'\'">' + t('common.close') + '</button></div>'
    + '</div>';
}

async function addOptionFromManager(optType) {
  const input = document.getElementById('new-opt-' + optType);
  const value = input.value.trim();
  if (!value) return;
  const res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value }) });
  if (res.ok) {
    const opt = await res.json();
    userOptions[optType].push(opt);
    showToast('"' + value + '" ' + t('toast.option_added'), 'success');
    showOptionsManager(); // Re-render
  } else {
    const e = await res.json();
    showToast(e.error || t('common.error'), 'error');
  }
}

async function deleteOption(id) {
  await fetch('/api/user-options/' + id, { method: 'DELETE', credentials: 'include' });
  // Retirer de userOptions
  ['script', 'account', 'type'].forEach(key => {
    userOptions[key] = userOptions[key].filter(o => o.id !== id);
  });
  showToast(t('toast.option_deleted'), 'success');
  showOptionsManager();
}

// ========== CSV IMPORT ==========
async function importStudentCSV(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';

  var reader = new FileReader();
  reader.onload = async function() {
    var content = reader.result;
    var lines = content.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) return showToast(t('toast.file_empty'), 'error');

    showToast(t('toast.import_progress') + ' (' + (lines.length - 1) + ' ' + t('student.lines_label') + ')', 'info');

    var res = await fetch('/api/student-leads/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ csv_content: content, market: currentStudentMarket })
    });

    if (res.ok) {
      var data = await res.json();
      showToast(data.imported + ' ' + t('student.imported') + ', ' + data.updated + ' ' + t('student.updated_of') + ' ' + data.total + ' ' + t('student.lines_label'), 'success');
    } else {
      var err = await res.json();
      showToast(err.error || t('student.import_error'), 'error');
    }
    await loadStudentData();
    renderStudentLeadTable();
  };
  reader.readAsText(file);
}

// ========== STUDENT RECRUITS ==========
async function renderStudentRecruits() {
  await loadStudentData();
  const c = document.getElementById('section-student-recruits');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.recruits_title')}</div><div class="page-subtitle">${t('student.recruits_subtitle')}</div></div>
      <div class="header-actions"><button class="btn btn-primary" onclick="showRecruitForm()">${t('student.add_recruit')}</button></div></div>
    <div id="recruit-form-wrap"></div>
    <div class="panel"><table class="table mobile-cards" id="recruits-table"><thead><tr><th>Instagram</th><th>Statut</th><th>Notes</th><th>Date</th><th></th></tr></thead><tbody></tbody></table></div>
  `;

  const tbody = document.querySelector('#recruits-table tbody');
  tbody.innerHTML = studentData.recruits.map(r => {
    const st = RECRUIT_STATUSES[r.status] || RECRUIT_STATUSES['interested'];
    const date = new Date(r.created_at).toLocaleDateString('fr-FR');
    return '<tr><td data-label="" class="mc-title"><strong>' + (r.ig_link ? '<a href="' + r.ig_link + '" target="_blank" style="color:var(--accent)">' + r.ig_name + '</a>' : r.ig_name) + '</strong></td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="updateRecruit(' + r.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(RECRUIT_STATUSES).map(([k,v]) => '<option value="' + k + '"' + (r.status===k?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + v.label + '</option>').join('') + '</select></td>'
      + '<td data-label="Notes" class="mc-full" style="color:var(--text-secondary);font-size:12px">' + (r.notes || '-') + '</td>'
      + '<td data-label="Date" class="mc-half" style="font-size:12px;color:var(--text-tertiary)">' + date + '</td>'
      + '<td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteRecruit(' + r.id + ')">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="5">' + emptyStateHTML('users', t('student.no_recruit')) + '</td></tr>';
}

function showRecruitForm() {
  const wrap = document.getElementById('recruit-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:500px">
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.ig_name_label')}</label><input type="text" id="rec-name" class="form-input" placeholder="@username"></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.profile_link')}</label><input type="text" id="rec-link" class="form-input" placeholder="https://instagram.com/..." oninput="autoFillUsername(this.value,'rec-name')"></div>
      <div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('common.notes')}</label><input type="text" id="rec-notes" class="form-input" placeholder="${t('student.notes_placeholder')}"></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addRecruit()">${t('common.add')}</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary)" onclick="document.getElementById('recruit-form-wrap').innerHTML=''">${t('common.cancel')}</button></div>
  </div>`;
}

async function addRecruit() {
  const ig_name = document.getElementById('rec-name').value.trim();
  if (!ig_name) return showToast(t('toast.ig_name_required'), 'error');
  const res = await fetch('/api/student-recruits', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ ig_name, ig_link: document.getElementById('rec-link').value.trim(), notes: document.getElementById('rec-notes').value.trim() })});
  if (res.ok) { showToast(t('toast.recruit_added'), 'success'); renderStudentRecruits(); }
}

async function updateRecruit(id, status) {
  await fetch('/api/student-recruits/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) });
  await loadStudentData(); renderStudentRecruits();
}

async function deleteRecruit(id) {
  if (!(await confirmDelete(t('confirm.delete_recruit')))) return;
  await fetch('/api/student-recruits/' + id, { method:'DELETE', credentials:'include' });
  renderStudentRecruits();
}

// ========== STUDENT MODELS ==========
async function renderStudentModels() {
  await loadStudentData();
  const c = document.getElementById('section-student-models');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.models_title')}</div><div class="page-subtitle">${t('student.my_models_subtitle')}</div></div>
      <div class="header-actions"><button class="btn btn-primary" onclick="showStudentModelForm()">${t('student.add_model')}</button></div></div>
    <div id="smodel-form-wrap"></div>
    <div id="smodel-cards"></div>
  `;

  const cards = document.getElementById('smodel-cards');
  cards.innerHTML = studentData.models.map(m => {
    const stColors = { active: 'var(--green)', onboarding: 'var(--yellow)', pause: 'var(--text-tertiary)' };
    const modelRev = studentData.revenue.filter(r => r.student_model_id === m.id);
    const totalRev = modelRev.reduce((s, r) => s + parseFloat(r.revenue), 0);
    const commission = totalRev * (parseFloat(m.commission_rate) / 100);
    return `<div class="panel" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><strong style="font-size:16px">${m.name}</strong> <span style="font-size:12px;color:var(--text-tertiary)">${m.of_handle || ''}</span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="updateStudentModel(${m.id},{status:this.value})" style="background:var(--bg-elevated);color:${stColors[m.status]||'var(--text)'};border:1px solid var(--border);padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">
            <option value="active" ${m.status==='active'?'selected':''}>${t('models.active_status')}</option><option value="onboarding" ${m.status==='onboarding'?'selected':''}>${t('models.onboarding')}</option><option value="pause" ${m.status==='pause'?'selected':''}>${t('model.status_pause')}</option>
          </select>
          <button class="btn-delete-small" onclick="deleteStudentModel(${m.id})">✕</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
        <div><span style="color:var(--text-tertiary)">Fans:</span> <strong>${m.fans_count}</strong></div>
        <div><span style="color:var(--text-tertiary)">Commission:</span> <strong>${m.commission_rate}%</strong></div>
        <div><span style="color:var(--text-tertiary)">${t('student.revenue_total_label')}:</span> <strong style="color:var(--green)">$${totalRev.toFixed(2)}</strong></div>
        <div><span style="color:var(--text-tertiary)">${t('student.commission_due')}:</span> <strong style="color:var(--accent)">$${commission.toFixed(2)}</strong></div>
      </div>
    </div>`;
  }).join('') || '<div class="panel">' + emptyStateHTML('users', t('student.no_model'), t('student.add_model'), 'showStudentModelForm()') + '</div>';
}

function showStudentModelForm() {
  const wrap = document.getElementById('smodel-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:600px">
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.model_name_label')}</label><input type="text" id="sm-name" class="form-input" placeholder="${t('student.model_name_placeholder')}"></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.profile_handle')}</label><input type="text" id="sm-handle" class="form-input" placeholder="${t('student.handle_placeholder')}"></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.fans_count')}</label><input type="number" id="sm-fans" class="form-input" placeholder="0" min="0"></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.commission_rate')}</label><input type="number" id="sm-commission" class="form-input" placeholder="15" min="0" max="100" step="0.5"></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addStudentModel()">${t('common.add')}</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary)" onclick="document.getElementById('smodel-form-wrap').innerHTML=''">${t('common.cancel')}</button></div>
  </div>`;
}

async function addStudentModel() {
  const name = document.getElementById('sm-name').value.trim();
  if (!name) return showToast(t('toast.name_required'), 'error');
  await fetch('/api/student-models', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name, of_handle: document.getElementById('sm-handle').value.trim(), fans_count: parseInt(document.getElementById('sm-fans').value)||0, commission_rate: parseFloat(document.getElementById('sm-commission').value)||0 })});
  showToast(t('toast.model_added'), 'success'); renderStudentModels();
}

async function updateStudentModel(id, data) {
  await fetch('/api/student-models/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(data) });
  await loadStudentData(); renderStudentModels();
}

async function deleteStudentModel(id) {
  if (!(await confirmDelete(t('student.delete_model_revenues')))) return;
  await fetch('/api/student-models/' + id, { method:'DELETE', credentials:'include' });
  renderStudentModels();
}

// ========== STUDENT REVENUE ==========
async function renderStudentRevenue() {
  await loadStudentData();
  const c = document.getElementById('section-student-revenue');
  if (!c) return;

  const currentMonth = new Date().toISOString().substring(0, 7);
  const monthRevenue = studentData.revenue.filter(r => r.month === currentMonth);
  const totalMonth = monthRevenue.reduce((s, r) => s + parseFloat(r.revenue), 0);
  const totalCommission = monthRevenue.reduce((s, r) => s + (parseFloat(r.revenue) * parseFloat(r.commission_rate) / 100), 0);
  const totalAll = studentData.revenue.reduce((s, r) => s + parseFloat(r.revenue), 0);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.revenue_title')}</div><div class="page-subtitle">${t('student.financial_tracking')}</div></div></div>
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${totalMonth.toFixed(2)}</div><div class="stat-label">${t('student.revenue_month')}</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent)">$${totalCommission.toFixed(2)}</div><div class="stat-label">${t('student.commission_month')}</div></div>
      <div class="stat-card"><div class="stat-value">$${totalAll.toFixed(2)}</div><div class="stat-label">${t('student.revenue_total_label')}</div></div>
      <div class="stat-card"><div class="stat-value">${studentData.models.length}</div><div class="stat-label">Modèles</div></div>
    </div>
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">${t('student.add_revenue')}</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
        <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.model_select')}</label>
          <select id="rev-model" class="form-input">${studentData.models.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('')}</select></div>
        <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.month_select')}</label>
          <input type="month" id="rev-month" class="form-input" value="${currentMonth}"></div>
        <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">${t('student.amount_label')}</label>
          <input type="number" id="rev-amount" class="form-input" placeholder="0.00" step="0.01" min="0"></div>
        <button class="btn btn-primary" onclick="addStudentRevenue()">${t('common.add')}</button>
      </div>
    </div>
    <div class="panel" style="padding:20px;margin-bottom:20px"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">${t('student.monthly_evolution')}</h3><div style="position:relative;height:250px"><canvas id="chart-student-revenue"></canvas></div></div>
    <div class="panel"><table class="table mobile-cards" id="revenue-table"><thead><tr><th>Mois</th><th>Modèle</th><th>Revenue</th><th>Commission</th></tr></thead><tbody>
      ${studentData.revenue.map(r => {
        const comm = (parseFloat(r.revenue) * parseFloat(r.commission_rate) / 100).toFixed(2);
        return '<tr><td data-label="Mois" class="mc-half">' + r.month + '</td><td data-label="Modèle" class="mc-half"><strong>' + r.model_name + '</strong></td><td data-label="Revenue" class="mc-half" style="color:var(--green)">$' + parseFloat(r.revenue).toFixed(2) + '</td><td data-label="Commission" class="mc-half" style="color:var(--accent)">$' + comm + ' (' + r.commission_rate + '%)</td></tr>';
      }).join('') || '<tr><td colspan="4">' + emptyStateHTML('dollar', t('student.no_revenue')) + '</td></tr>'}
    </tbody></table></div>
  `;

  // Chart
  const months = [...new Set(studentData.revenue.map(r => r.month))].sort();
  if (months.length > 0 && typeof Chart !== 'undefined') {
    const revByMonth = months.map(m => studentData.revenue.filter(r => r.month === m).reduce((s, r) => s + parseFloat(r.revenue), 0));
    new Chart(document.getElementById('chart-student-revenue'), {
      type: 'bar', data: { labels: months, datasets: [{ label: t('student.revenue_chart_label'), data: revByMonth, backgroundColor: '#3B82F6cc', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b80' } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b80' }, beginAtZero: true } }, plugins: { legend: { labels: { color: '#e4e4eb' } } } }
    });
  }
}

async function addStudentRevenue() {
  const student_model_id = document.getElementById('rev-model').value;
  const month = document.getElementById('rev-month').value;
  const revenue = parseFloat(document.getElementById('rev-amount').value) || 0;
  if (!student_model_id || !month) return showToast(t('toast.model_month_required'), 'error');
  await fetch('/api/student-revenue', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ student_model_id, month, revenue }) });
  showToast(t('toast.revenue_added'), 'success'); renderStudentRevenue();
}

// ========== MESSAGES (Chat) ==========
async function renderStudentMessages() {
  await loadStudentData();
  const c = document.getElementById('section-student-messages');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.messages_title')}</div><div class="page-subtitle">${t('student.messages_subtitle')}</div></div></div>
    <div style="display:flex;gap:0;height:calc(100vh - 200px);border-radius:12px;overflow:hidden;border:1px solid var(--border)">
      <div id="chat-contacts" style="width:280px;background:var(--bg2);border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0"></div>
      <div id="chat-area" style="flex:1;display:flex;flex-direction:column;background:var(--bg)">
        <div id="chat-header" style="padding:14px 20px;border-bottom:1px solid var(--border);font-weight:600;font-size:14px">${t('student.select_conversation')}</div>
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px"></div>
        <div id="chat-input-wrap" style="padding:12px;border-top:1px solid var(--border);display:none">
          <div style="display:flex;gap:8px"><input type="text" id="chat-input" class="form-input" placeholder="${t('student.message_placeholder')}" style="flex:1" onkeydown="if(event.key==='Enter')sendMessage()"><button class="btn btn-primary" onclick="sendMessage()" style="padding:8px 16px">${t('common.send')}</button></div>
        </div>
      </div>
    </div>
  `;

  renderChatContacts();
}

function renderChatContacts() {
  const contacts = document.getElementById('chat-contacts');
  if (!contacts) return;
  contacts.innerHTML = studentData.conversations.map(c => `
    <div onclick="openChat(${c.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--border);background:${currentChatUserId===c.id?'var(--bg-elevated)':'transparent'}" id="contact-${c.id}">
      ${avatarHTML(c, 36)}
      <div style="flex:1;overflow:hidden">
        <div style="font-size:13px;font-weight:600">${c.display_name}</div>
        <div style="font-size:11px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.last_message || '...'}</div>
      </div>
      ${parseInt(c.unread) > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + c.unread + '</span>' : ''}
    </div>
  `).join('') || '<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">' + t('student.no_conversation') + '</div>';
}

async function openChat(userId) {
  currentChatUserId = userId;
  const contact = studentData.conversations.find(c => c.id === userId);
  document.getElementById('chat-header').textContent = contact?.display_name || 'Chat';
  document.getElementById('chat-input-wrap').style.display = 'block';
  renderChatContacts();

  const res = await fetch('/api/messages/' + userId, { credentials: 'include' });
  if (res.ok) { studentData.messages = await res.json(); renderChatMessages(); }
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = studentData.messages.map(m => {
    const isMe = m.from_user_id === currentUser.id;
    return `<div style="display:flex;justify-content:${isMe?'flex-end':'flex-start'}">
      <div style="max-width:70%;padding:10px 14px;border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};background:${isMe?'var(--accent)':'var(--bg-elevated)'};color:${isMe?'white':'var(--text)'};font-size:13px">
        ${m.content}
        <div style="font-size:10px;margin-top:4px;opacity:0.6">${new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !currentChatUserId) return;
  input.value = '';
  await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ to_user_id: currentChatUserId, content }) });
  const res = await fetch('/api/messages/' + currentChatUserId, { credentials: 'include' });
  if (res.ok) { studentData.messages = await res.json(); renderChatMessages(); }
}

// ========== RESOURCES ==========
async function renderStudentResources() {
  const res = await fetch('/api/resources', { credentials: 'include' });
  const resources = res.ok ? await res.json() : [];
  const c = document.getElementById('section-student-resources');
  if (!c) return;

  const categories = { outreach: t('resource.outreach'), chatting: t('resource.chatting'), traffic: t('resource.traffic'), general: t('resource.general') };
  const grouped = {};
  resources.forEach(r => { if (!grouped[r.category]) grouped[r.category] = []; grouped[r.category].push(r); });

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t('student.resources_title')}</div><div class="page-subtitle">${t('student.resources_subtitle')}</div></div>
      ${(currentUser.role === 'admin' || currentUser.role === 'super_admin') ? '<div class="header-actions"><button class="btn btn-primary" onclick="showAddResourceForm()">' + t('student.add_resource') + '</button></div>' : ''}
    </div>
    <div id="resource-form-wrap"></div>
    ${Object.entries(grouped).map(([cat, items]) => `
      <div class="panel" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">${categories[cat] || cat}</h3>
        <div style="display:grid;gap:10px">
          ${items.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg-elevated);border-radius:8px">
            <div>
              <div style="font-size:14px;font-weight:600">${r.title}</div>
              ${r.description ? '<div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">' + r.description + '</div>' : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${r.url ? '<a href="' + r.url + '" target="_blank" class="btn btn-primary" style="padding:6px 12px;font-size:11px;text-decoration:none">' + t('student.open_btn') + '</a>' : ''}
              ${r.file_name ? '<a href="/api/resources/' + r.id + '/download" class="btn btn-primary" style="padding:6px 12px;font-size:11px;text-decoration:none">' + t('student.download_btn') + '</a>' : ''}
              ${(currentUser.role === 'admin' || currentUser.role === 'super_admin') ? '<button class="btn-delete-small" onclick="deleteResource(' + r.id + ')">✕</button>' : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
    `).join('') || '<div class="panel">' + emptyStateHTML('book', t('student.no_resource')) + '</div>'}
  `;
}

function showAddResourceForm() {
  const wrap = document.getElementById('resource-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:600px">
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.resource_title_label') + '</label><input type="text" id="res-title" class="form-input" placeholder="Titre"></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.category_label') + '</label><select id="res-cat" class="form-input"><option value="outreach">' + t('resource.outreach') + '</option><option value="chatting">' + t('resource.chatting') + '</option><option value="traffic">' + t('resource.traffic') + '</option><option value="general">' + t('resource.general') + '</option></select></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.type_label') + '</label><select id="res-type" class="form-input" onchange="document.getElementById(\'res-url-wrap\').style.display=this.value===\'link\'?\'\':\'none\';document.getElementById(\'res-file-wrap\').style.display=this.value===\'file\'?\'\':\'none\'"><option value="link">' + t('student.type_link') + '</option><option value="file">' + t('student.type_file') + '</option></select></div>
      <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.description_label') + '</label><input type="text" id="res-desc" class="form-input" placeholder="' + t('student.description_placeholder') + '"></div>
      <div id="res-url-wrap" style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.url_label') + '</label><input type="text" id="res-url" class="form-input" placeholder="' + t('student.url_placeholder') + '"></div>
      <div id="res-file-wrap" style="grid-column:1/-1;display:none"><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('student.file_label') + '</label><input type="file" id="res-file" class="form-input"></div>
    </div>
    <div style="margin-top:12px"><button class="btn btn-primary" onclick="addResource()">' + t('common.add') + '</button></div>
  </div>`;
}

async function addResource() {
  const title = document.getElementById('res-title').value.trim();
  if (!title) return showToast(t('toast.title_required'), 'error');
  const resType = document.getElementById('res-type').value;
  const body = { title, category: document.getElementById('res-cat').value, res_type: resType, description: document.getElementById('res-desc').value.trim() };

  if (resType === 'link') { body.url = document.getElementById('res-url').value.trim(); }
  else {
    const file = document.getElementById('res-file').files[0];
    if (!file) return showToast(t('toast.file_required'), 'error');
    if (file.size > 10 * 1024 * 1024) return showToast(t('toast.file_too_large'), 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      body.file_data = reader.result; body.file_name = file.name; body.file_mime = file.type;
      await fetch('/api/resources', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      showToast(t('toast.resource_added'), 'success'); renderStudentResources();
    };
    reader.readAsDataURL(file); return;
  }
  await fetch('/api/resources', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
  showToast(t('toast.resource_added'), 'success'); renderStudentResources();
}

async function deleteResource(id) {
  if (!(await confirmDelete(t('confirm.delete_resource')))) return;
  await fetch('/api/resources/' + id, { method:'DELETE', credentials:'include' });
  renderStudentResources();
}

// ========== WEEKLY OBJECTIVES ==========
async function renderStudentObjectives() {
  await loadStudentData();
  const c = document.getElementById('section-student-objectives');
  if (!c) return;

  const thisWeek = getWeekStart();
  const weekObjectives = studentData.objectives.filter(o => o.week_start === thisWeek);
  const pastObjectives = studentData.objectives.filter(o => o.week_start !== thisWeek);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">${t("student.objectives_title")}</div><div class="page-subtitle">${t("student.week_of")} ${thisWeek}</div></div></div>
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">${t("student.this_week")}</h3>
      ${weekObjectives.length === 0 ? '<div style="color:var(--text-tertiary);text-align:center;padding:16px">' + t('student.no_objectives') + '</div>' :
        '<div style="display:grid;gap:12px">' + weekObjectives.map(o => {
          const pct = o.target > 0 ? Math.min(100, Math.round((o.current / o.target) * 100)) : 0;
          const done = pct >= 100;
          return `<div style="background:var(--bg-elevated);padding:14px;border-radius:10px;border-left:3px solid ${done?'var(--green)':'var(--accent)'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="font-size:14px">${o.description || o.obj_type}</strong>
              <span style="font-size:13px;font-weight:700;color:${done?'var(--green)':'var(--accent)'}">${o.current} / ${o.target}</span>
            </div>
            <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${done?'var(--green)':'var(--accent)'};border-radius:3px;transition:width 0.3s"></div></div>
            ${currentUser.role === 'student' ? '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><input type="number" class="form-input" style="width:80px;padding:4px 8px;font-size:12px" value="' + o.current + '" id="obj-cur-' + o.id + '" min="0"><button class="btn btn-primary" style="padding:4px 10px;font-size:11px" onclick="updateObjective(' + o.id + ')">' + t('student.update_btn') + '</button></div>' : ''}
          </div>`;
        }).join('') + '</div>'}
    </div>
    ${pastObjectives.length > 0 ? `<div class="panel" style="padding:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text-secondary)">${t("student.past_weeks")}</h3>
      ${pastObjectives.map(o => {
        const pct = o.target > 0 ? Math.min(100, Math.round((o.current / o.target) * 100)) : 0;
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span>' + o.week_start + ' — ' + (o.description || o.obj_type) + '</span><span style="color:' + (pct>=100?'var(--green)':'var(--red)') + '">' + o.current + '/' + o.target + ' (' + pct + '%)</span></div>';
      }).join('')}
    </div>` : ''}
  `;
}

async function updateObjective(id) {
  const current = parseInt(document.getElementById('obj-cur-' + id).value) || 0;
  await fetch('/api/objectives/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ current }) });
  showToast(t('student.objective_updated'), 'success'); renderStudentObjectives();
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().split('T')[0];
}

// ========== STUDENT PLANNING (read-only week view) ==========
let studentPlanDate = new Date();

async function renderStudentPlanning() {
  const c = document.getElementById('section-student-planning');
  if (!c) return;

  const mon = getMonday(studentPlanDate);
  const sun = new Date(mon); sun.setDate(sun.getDate()+6);
  const start = fmtDate(mon);
  const end = fmtDate(sun);

  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [shifts, leaves] = await Promise.all([
    f('/api/planning-shifts?start=' + start + '&end=' + end),
    f('/api/leave-requests')
  ]);

  // Map shifts by date
  const shiftsByDate = {};
  shifts.forEach(s => {
    const dk = s.shift_date.slice(0,10);
    if (!shiftsByDate[dk]) shiftsByDate[dk] = [];
    shiftsByDate[dk].push(s);
  });

  // Leave set
  const leaveSet = {};
  leaves.filter(l => l.status === 'accepted').forEach(l => {
    const sd = new Date(l.start_date); const ed = new Date(l.end_date);
    while (sd <= ed) { leaveSet[fmtDate(sd)] = true; sd.setDate(sd.getDate()+1); }
  });

  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(d.getDate()+i); days.push(d); }

  let totalHours = 0;

  let html = '<div class="page-header"><div><div class="page-title">' + t('student.planning_title') + '</div><div class="page-subtitle">' + t('student.week_of') + ' ' + fmtDateFR(mon) + ' au ' + fmtDateFR(sun) + '</div></div></div>'
    + '<div class="panel" style="padding:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
    + '<button onclick="studentPlanNavigate(-1)" style="padding:8px 14px;background:var(--bg-elevated);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">‹</button>'
    + '<div style="text-align:center"><div style="font-size:15px;font-weight:700">' + mon.toLocaleDateString('fr-FR',{day:'numeric',month:'long'}) + ' — ' + sun.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) + '</div></div>'
    + '<button onclick="studentPlanNavigate(1)" style="padding:8px 14px;background:var(--bg-elevated);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">›</button>'
    + '</div>'
    + '<div style="display:grid;gap:8px">';

  days.forEach(d => {
    const dk = fmtDate(d);
    const isToday = dk === fmtDate(new Date());
    const dayShifts = shiftsByDate[dk] || [];
    const isLeave = leaveSet[dk];
    const dayLabel = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'short' });
    const dayShiftEntries = dayShifts.filter(s => s.entry_type !== 'task');
    const dayTaskEntries = dayShifts.filter(s => s.entry_type === 'task');

    html += '<div style="background:' + (isToday ? 'rgba(212,165,116,0.08)' : 'var(--bg-elevated)') + ';border-radius:12px;padding:14px 18px;border:1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + '">'
      + '<div style="font-size:14px;font-weight:600;text-transform:capitalize;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + ';margin-bottom:' + (dayShifts.length > 0 || isLeave ? '10px' : '0') + '">' + dayLabel + (isToday ? ' <span style="font-size:11px;background:var(--accent);color:white;padding:2px 8px;border-radius:10px;margin-left:6px">' + t('common.today') + '</span>' : '') + '</div>';

    if (isLeave) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--red-bg);border-radius:8px;color:var(--red);font-weight:600;font-size:13px">' + t('student.leave_badge') + '</div>';
    } else {
      if (dayShiftEntries.length > 0) {
        dayShiftEntries.forEach(s => {
          const st = SHIFT_TYPES[s.shift_type] || SHIFT_TYPES['custom'];
          const timeStr = s.start_time && s.end_time ? s.start_time + ' → ' + s.end_time : '';
          if (s.start_time && s.end_time && s.shift_type !== 'off') {
            const sh = parseInt(s.start_time.split(':')[0]) + parseInt(s.start_time.split(':')[1])/60;
            let eh = parseInt(s.end_time.split(':')[0]) + parseInt(s.end_time.split(':')[1])/60;
            if (eh < sh) eh += 24;
            totalHours += eh - sh;
          }
          html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg);border-radius:8px;margin-bottom:4px">'
            + '<div style="padding:6px 12px;border-radius:8px;background:' + st.bg + ';color:' + st.color + ';font-size:12px;font-weight:700;white-space:nowrap">' + (s.shift_type === 'off' ? 'OFF' : st.label) + '</div>'
            + (timeStr ? '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap">' + timeStr + '</div>' : '')
            + (s.notes ? '<div style="font-size:11px;color:var(--text-tertiary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.notes + '</div>' : '')
            + '</div>';
        });
      }
      if (dayTaskEntries.length > 0) {
        if (dayShiftEntries.length > 0) html += '<div style="height:1px;background:var(--border);margin:8px 0"></div>';
        dayTaskEntries.forEach(s => {
          const isUrgent = s.priority === 'urgent';
          const desc = s.description || s.notes || '';
          html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg);border-radius:8px;margin-bottom:4px;border-left:3px solid ' + (isUrgent ? 'var(--red)' : 'var(--green)') + '">'
            + '<div style="min-width:50px">'
            + (s.start_time ? '<div style="font-size:12px;font-weight:700;color:var(--text)">' + s.start_time + '</div>' : '')
            + (s.end_time ? '<div style="font-size:10px;color:var(--text-tertiary)">' + s.end_time + '</div>' : '')
            + '</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:13px;font-weight:600;color:var(--text)">' + desc + '</div>'
            + (isUrgent ? '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--red-bg);color:var(--red);font-weight:600;display:inline-block;margin-top:4px">URGENT</span>' : '')
            + '</div></div>';
        });
      }
      if (dayShifts.length === 0) {
        html += '<div style="color:var(--text-tertiary);font-size:12px;font-style:italic">' + t('planning.no_shift') + '</div>';
      }
    }
    html += '</div>';
  });

  html += '</div>'
    + '<div style="margin-top:16px;padding:14px 18px;background:var(--bg-elevated);border-radius:10px;display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:13px;color:var(--text-secondary)">' + t('planning.week_total') + '</span>'
    + '<span style="font-size:18px;font-weight:800;color:var(--accent)">' + totalHours.toFixed(0) + 'h</span>'
    + '</div>'
    + '</div>';

  c.innerHTML = html;
}

function studentPlanNavigate(dir) {
  studentPlanDate.setDate(studentPlanDate.getDate() + (dir * 7));
  renderStudentPlanning();
}

// ========== STUDENT TASKS ==========
async function renderStudentTasks() {
  const c = document.getElementById('section-student-tasks');
  if (!c) return;

  const tasks = await fetch('/api/tasks', { credentials: 'include' }).then(r => r.ok ? r.json() : []);

  const statusColors = { pending: { bg: 'var(--blue-bg)', color: 'var(--blue)', label: t('tasks.pending_label') }, in_progress: { bg: 'var(--yellow-bg)', color: 'var(--yellow)', label: t('tasks.in_progress_label') }, completed: { bg: 'var(--green-bg)', color: 'var(--green)', label: t('tasks.completed_label') } };

  const pending = tasks.filter(t => t.status !== 'completed');
  const completed = tasks.filter(t => t.status === 'completed');

  function card(t) {
    const isUrgent = t.priority === 'urgent';
    const dl = t.deadline || '';
    const today = new Date().toISOString().slice(0,10);
    const overdue = dl && dl < today && t.status !== 'completed';
    const borderColor = overdue ? 'var(--red)' : isUrgent ? 'var(--red)' : 'var(--accent)';
    const st = statusColors[t.status] || statusColors['pending'];
    return '<div style="background:var(--bg-elevated);padding:14px;border-radius:10px;border-left:4px solid ' + borderColor + ';position:relative">'
      + (isUrgent ? '<span style="position:absolute;top:10px;right:10px;background:var(--red);color:white;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700">URGENT</span>' : '')
      + '<strong style="font-size:14px;display:block;margin-bottom:6px;' + (t.status === 'completed' ? 'text-decoration:line-through;opacity:0.5' : '') + '">' + t.title + '</strong>'
      + (t.description ? '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">' + t.description + '</div>' : '')
      + '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px">'
      + '<select onchange="updateStudentTaskStatus(' + t.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;min-height:28px">'
      + '<option value="pending"' + (t.status==='pending'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + window.t('tasks.pending_label') + '</option>'
      + '<option value="in_progress"' + (t.status==='in_progress'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + window.t('tasks.in_progress_label') + '</option>'
      + '<option value="completed"' + (t.status==='completed'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + window.t('tasks.completed_label') + '</option></select>'
      + (dl ? '<div style="color:' + (overdue ? 'var(--red);font-weight:600' : 'var(--text-tertiary)') + '">📅 ' + dl + (overdue ? ' (' + _overdueLabel + ')' : '') + '</div>' : '')
      + (t.creator_name ? '<div style="color:var(--text-tertiary)">' + _createdByLabel + ' ' + t.creator_name + '</div>' : '')
      + (t.created_by === currentUser.id ? '<button class="btn-delete-small" onclick="deleteStudentTask(' + t.id + ')" style="margin-left:auto">✕</button>' : '')
      + '</div></div>';
  }

  c.innerHTML = '<div class="page-header"><div><div class="page-title">' + t('student.tasks_title') + '</div><div class="page-subtitle">' + pending.length + ' ' + t('student.pending_count') + ' · ' + completed.length + ' ' + t('student.completed_count') + '</div></div>'
    + '<div class="header-actions"><button class="btn btn-primary" onclick="showStudentTaskForm()">' + t('student.add_task') + '</button></div></div>'
    + '<div id="student-task-form-wrap"></div>'
    + '<div class="panel" style="padding:20px;margin-bottom:16px">'
    + '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">' + t('student.todo_section') + '</h3>'
    + (pending.length === 0 ? emptyStateHTML('clipboard', t('student.no_task'), '+ Créer une tâche', 'showStudentTaskForm()') : '<div style="display:grid;gap:10px">' + pending.map(card).join('') + '</div>')
    + '</div>'
    + (completed.length > 0 ? '<div class="panel" style="padding:20px"><h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--text-secondary)">' + t('student.done_section') + '</h3><div style="display:grid;gap:10px">' + completed.map(card).join('') + '</div></div>' : '');
}

function showStudentTaskForm() {
  const wrap = document.getElementById('student-task-form-wrap');
  if (!wrap) return;
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="panel" style="padding:16px;margin-bottom:16px;background:var(--bg2)">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('student.task_title_label') + '</label><input type="text" id="st-title" class="form-input" placeholder="' + t('student.task_title_placeholder') + '"></div>'
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('student.description_label') + '</label><input type="text" id="st-desc" class="form-input" placeholder="' + t('student.description_placeholder') + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('student.priority_label') + '</label><select id="st-priority" class="form-input"><option value="normal">' + t('student.priority_normal') + '</option><option value="urgent">' + t('student.priority_urgent') + '</option></select></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('student.deadline_label') + '</label><input type="date" id="st-deadline" class="form-input"></div>'
    + '</div>'
    + '<div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-primary" onclick="addStudentTask()">' + t('common.add') + '</button><button class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById(\'student-task-form-wrap\').innerHTML=\'\'">' + t('common.cancel') + '</button></div>'
    + '</div>';
}

async function addStudentTask() {
  const title = document.getElementById('st-title').value.trim();
  if (!title) { showToast(t('student.title_required'), 'error'); return; }
  const description = document.getElementById('st-desc').value.trim();
  const priority = document.getElementById('st-priority').value;
  const deadline = document.getElementById('st-deadline').value || null;
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description, priority, deadline })
  });
  if (res.ok) {
    showToast(t('student.task_added'), 'success');
    document.getElementById('student-task-form-wrap').innerHTML = '';
    renderStudentTasks();
  }
}

async function updateStudentTaskStatus(id, status) {
  await fetch('/api/tasks/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) });
  renderStudentTasks();
}

async function deleteStudentTask(id) {
  if (!(await confirmDelete(t('confirm.delete_task')))) return;
  await fetch('/api/tasks/' + id, { method: 'DELETE', credentials: 'include' });
  renderStudentTasks();
}

// ========== INIT STUDENT SECTIONS ==========
async function initStudentSections() {
  if (currentUser.role !== 'student' && !isAdmin()) return;
  if (currentUser.role === 'student') {
    await renderStudentHome();
    // Make first student section active
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-student-home')?.classList.add('active');
    document.querySelectorAll('[data-section]').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-section="student-home"]')?.classList.add('active');
  }
}

// ========== STUDENT ANALYTICS ==========
var _studentAnalyticsDays = 30;

async function renderStudentAnalytics() {
  var c = document.getElementById('section-student-analytics');
  if (!c) return;

  c.innerHTML = '<div class="page-header"><div><div class="page-title">' + t('student.analytics_title') + '</div><div class="page-subtitle">' + t('student.analytics_subtitle') + '</div></div></div>'
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('common.today') + '</h3>'
    + '<div id="sa-today-stats"><div style="color:var(--text-tertiary);font-size:13px">' + t('common.loading') + '</div></div>'
    + '</div>'
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('student.leads_dms_daily') + '</h3>'
    + '<div style="display:flex;gap:4px" id="student-daily-btns">'
    + '<button class="filter-chip" onclick="loadStudentDailyChart(1,this)">1j</button>'
    + '<button class="filter-chip" onclick="loadStudentDailyChart(2,this)">2j</button>'
    + '<button class="filter-chip" onclick="loadStudentDailyChart(7,this)">7j</button>'
    + '<button class="filter-chip" onclick="loadStudentDailyChart(14,this)">14j</button>'
    + '<button class="filter-chip active" onclick="loadStudentDailyChart(30,this)">30j</button>'
    + '<button class="filter-chip" onclick="loadStudentDailyChart(60,this)">60j</button>'
    + '</div></div>'
    + '<div style="position:relative;height:280px"><canvas id="chart-sa-daily"></canvas></div>'
    + '</div>'
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('student.hourly_chart') + '</h3>'
    + '<div style="position:relative;height:220px"><canvas id="chart-sa-hourly"></canvas></div>'
    + '</div>'
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('student.by_person') + '</h3>'
    + '<div id="sa-by-person"></div>'
    + '</div>';

  loadStudentDailyChart(30);
}

async function loadStudentDailyChart(days, btn) {
  _studentAnalyticsDays = days;
  if (btn) {
    document.querySelectorAll('#student-daily-btns .filter-chip').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  try {
    var res = await fetch('/api/analytics/daily?days=' + days, { credentials: 'include' });
    var data = await res.json();
    var daily = data.daily || [];
    var hourlyData = data.hourly || [];
    var byPerson = data.byPerson || [];
    var todayByPerson = data.todayByPerson || [];

    // Today stats
    var todayDiv = document.getElementById('sa-today-stats');
    if (todayDiv) {
      var todayLeads = todayByPerson.reduce(function(s, p) { return s + parseInt(p.leads); }, 0);
      var todayDms = todayByPerson.reduce(function(s, p) { return s + parseInt(p.dms); }, 0);
      todayDiv.innerHTML = '<div class="stats-grid" style="margin-bottom:12px">'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">' + todayLeads + '</div><div class="stat-label">' + t('student.leads_today') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + todayDms + '</div><div class="stat-label">' + t('student.dms_today') + '</div></div>'
        + '</div>'
        + (todayByPerson.length > 0 ? '<table class="table mobile-cards"><thead><tr><th>Nom</th><th>Leads</th><th>DMs</th></tr></thead><tbody>'
        + todayByPerson.map(function(p) {
          return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || t('student.unknown')) + '</strong></td>'
            + '<td data-label="Leads" class="mc-half" style="color:var(--accent)">' + p.leads + '</td>'
            + '<td data-label="DMs" class="mc-half" style="color:var(--blue)">' + p.dms + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div style="color:var(--text-tertiary);font-size:13px;text-align:center">' + t('student.no_activity_today') + '</div>');
    }

    // Daily chart
    if (window._saDaily) window._saDaily.destroy();
    var ctx = document.getElementById('chart-sa-daily');
    if (ctx && daily.length > 0) {
      window._saDaily = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: daily.map(function(d) { var dt = new Date(d.day); return dt.getDate() + '/' + (dt.getMonth()+1); }),
          datasets: [
            { label: 'Leads', data: daily.map(function(d) { return parseInt(d.leads); }), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 },
            { label: 'DMs', data: daily.map(function(d) { return parseInt(d.dms); }), backgroundColor: 'rgba(34,211,238,0.6)', borderRadius: 4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' }, grid: { color: 'rgba(59,130,246,0.06)' } }, x: { ticks: { color: '#A1A1AA', maxRotation: 45 }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 16 } } } }
      });
    }

    // Hourly chart
    if (window._saHourly) window._saHourly.destroy();
    var hCtx = document.getElementById('chart-sa-hourly');
    if (hCtx) {
      var hours = Array.from({length: 24}, function(_, i) { return i; });
      var hLeads = hours.map(function(h) { var f = hourlyData.find(function(x) { return parseInt(x.hour) === h; }); return f ? parseInt(f.leads) : 0; });
      var hDms = hours.map(function(h) { var f = hourlyData.find(function(x) { return parseInt(x.hour) === h; }); return f ? parseInt(f.dms) : 0; });
      window._saHourly = new Chart(hCtx, {
        type: 'bar',
        data: {
          labels: hours.map(function(h) { return h + 'h'; }),
          datasets: [
            { label: 'Leads', data: hLeads, backgroundColor: 'rgba(59,130,246,0.5)', borderRadius: 3 },
            { label: 'DMs', data: hDms, backgroundColor: 'rgba(34,211,238,0.5)', borderRadius: 3 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' }, grid: { color: 'rgba(59,130,246,0.06)' } }, x: { ticks: { color: '#A1A1AA', font: { size: 10 } }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 12 } } } }
      });
    }

    // By person
    var personDiv = document.getElementById('sa-by-person');
    if (personDiv) {
      if (byPerson.length === 0) {
        personDiv.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:16px">' + t('student.no_data_chart') + '</div>';
      } else {
        var totalLeads = byPerson.reduce(function(s, p) { return s + parseInt(p.leads); }, 0);
        personDiv.innerHTML = '<table class="table mobile-cards"><thead><tr><th>Nom</th><th>Leads</th><th>DMs</th><th>%</th></tr></thead><tbody>'
          + byPerson.map(function(p) {
            var pct = totalLeads > 0 ? ((parseInt(p.leads) / totalLeads) * 100).toFixed(1) : '0';
            return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || t('student.unknown')) + '</strong></td>'
              + '<td data-label="Leads" class="mc-half">' + p.leads + '</td>'
              + '<td data-label="DMs" class="mc-half" style="color:var(--blue)">' + p.dms + '</td>'
              + '<td data-label="%" class="mc-half" style="color:var(--accent)">' + pct + '%</td></tr>';
          }).join('') + '</tbody></table>';
      }
    }
  } catch(e) {}
}
