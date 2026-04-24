// RECRUITMENT MODULE
// Extracted from dashboard.html

// ============ RECRUITMENT MODULE ============
var _recruitmentEnabled = false;

function switchCoachingMainTab(tab, btn) {
  document.querySelectorAll('#coaching-main-tabs .tab').forEach(function(t2) { t2.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.getElementById('coaching-content').style.display = tab === 'coaching' ? '' : 'none';
  document.getElementById('recruitment-content').style.display = tab === 'recruitment' ? '' : 'none';
  if (tab === 'recruitment') renderRecruitment();
}

async function checkRecruitmentEnabled() {
  try {
    var res = await fetch('/api/recruitment/settings', { credentials: 'include' });
    if (!res.ok) return;
    var data = await res.json();
    _recruitmentEnabled = data.enabled;
    var tabs = document.getElementById('coaching-main-tabs');
    if (tabs) tabs.style.display = _recruitmentEnabled ? 'block' : 'none';
  } catch(e) {}
}

var _recruitStats = {};
var _recruiters = [];
var _recruitLeads = [];

var RECRUIT_STATUSES_MAP = {
  'prospect_chaud': { label: function() { return t('recruit.status_prospect_chaud'); }, cls: 'prospect_chaud' },
  '1er_dm_envoye': { label: function() { return t('recruit.status_1er_dm'); }, cls: '1er_dm_envoye' },
  'en_discussion': { label: function() { return t('recruit.status_en_discussion'); }, cls: 'en_discussion' },
  'relance_a_faire': { label: function() { return t('recruit.status_relance'); }, cls: 'relance_a_faire' },
  'call_1_1_fait': { label: function() { return t('recruit.status_call_fait'); }, cls: 'call_1_1_fait' },
  'paye': { label: function() { return t('recruit.status_paye'); }, cls: 'paye' },
  'abandonne': { label: function() { return t('recruit.status_abandonne'); }, cls: 'abandonne' }
};

var PLATFORM_ICONS = {
  'instagram': '<span class="recruit-platform recruit-platform-instagram"><i class="fas fa-camera"></i></span>',
  'whop': '<span class="recruit-platform recruit-platform-whop">W</span>',
  'discord': '<span class="recruit-platform recruit-platform-discord"><i class="fab fa-discord"></i></span>',
  'tiktok': '<span class="recruit-platform recruit-platform-tiktok"><i class="fab fa-tiktok"></i></span>',
  'whatsapp': '<span class="recruit-platform recruit-platform-whatsapp"><i class="fab fa-whatsapp"></i></span>'
};

async function renderRecruitment() {
  var container = document.getElementById('recruitment-content');
  if (!container) return;
  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var isOwner = currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'platform_admin';

  var results = await Promise.all([f('/api/recruitment/stats'), f('/api/recruitment/recruiters'), f('/api/recruitment/leads')]);
  _recruitStats = results[0]; _recruiters = results[1]; _recruitLeads = results[2];

  var stats = _recruitStats;
  var bs = stats.byStatus || {};

  if (isOwner) {
    container.innerHTML = ''
      // KPIs
      + '<div class="coaching-kpi-bar" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value">' + (stats.total || 0) + '</div><div class="coaching-kpi-label">' + t('recruit.total_leads') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#7c3aed">' + (bs.prospect_chaud || 0) + '</div><div class="coaching-kpi-label">' + t('recruit.hot_prospects') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:#16a34a">' + (bs.en_discussion || 0) + '</div><div class="coaching-kpi-label">' + t('recruit.in_discussion') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--green)">' + (stats.paid || 0) + '</div><div class="coaching-kpi-label">' + t('recruit.paid') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--green)">$' + (stats.revenue || 0).toFixed(0) + '</div><div class="coaching-kpi-label">' + t('recruit.revenue') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--yellow)">$' + (stats.commissions || 0).toFixed(0) + '</div><div class="coaching-kpi-label">' + t('recruit.commissions_due') + '</div></div>'
      + '</div>'
      // Recruiters panel
      + '<div class="panel" style="padding:20px;margin-bottom:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('recruit.recruiters') + '</h3><button class="btn btn-primary" style="font-size:12px" onclick="showAddRecruiterForm()">' + t('recruit.add_recruiter') + '</button></div>'
      + '<div id="add-recruiter-form-wrap"></div>'
      + '<table class="table mobile-cards"><thead><tr><th>' + t('common.name') + '</th><th>' + t('recruit.leads') + '</th><th>' + t('recruit.signed') + '</th><th>' + t('recruit.conversion') + '</th><th>' + t('recruit.commission_pct') + '</th><th>' + t('recruit.gains') + '</th><th>' + t('common.status') + '</th></tr></thead><tbody>'
      + (_recruiters.length > 0 ? _recruiters.map(function(r) {
          var conv = parseInt(r.lead_count) > 0 ? ((parseInt(r.paid_count) / parseInt(r.lead_count)) * 100).toFixed(1) : '0';
          var gains = (parseInt(r.paid_count) * parseFloat(stats.coaching_price) * parseFloat(r.commission_percentage) / 100).toFixed(0);
          return '<tr><td data-label="" class="mc-title"><strong>' + r.display_name + '</strong></td>'
            + '<td data-label="Leads" class="mc-half">' + r.lead_count + '</td>'
            + '<td data-label="' + t('recruit.signed') + '" class="mc-half" style="color:var(--green)">' + r.paid_count + '</td>'
            + '<td data-label="Conv." class="mc-half">' + conv + '%</td>'
            + '<td data-label="%" class="mc-half">' + r.commission_percentage + '%</td>'
            + '<td data-label="' + t('recruit.gains') + '" class="mc-half" style="color:var(--green)">$' + gains + '</td>'
            + '<td data-label="" class="mc-half"><span style="color:' + (r.is_active ? 'var(--green)' : 'var(--red)') + ';font-size:11px;font-weight:600">' + (r.is_active ? t('status.active') : t('status.inactive')) + '</span></td></tr>';
        }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:20px">' + t('recruit.no_recruiters') + '</td></tr>')
      + '</tbody></table></div>'
      // All leads panel
      + '<div class="panel" style="padding:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('recruit.all_leads') + '</h3><button class="btn btn-primary" style="font-size:12px" onclick="showAddRecruitLeadForm()">' + t('recruit.add_lead') + '</button></div>'
      + '<div id="add-recruit-lead-form-wrap"></div>'
      + '<div id="recruit-leads-table">' + renderRecruitLeadsTable(true) + '</div>'
      + '</div>';
  } else {
    // Recruiter view — their own leads
    var myRecruiterId = _recruiters.find(function(r) { return r.user_id === currentUser.id; });
    var myLeads = _recruitLeads;
    var myPaid = myLeads.filter(function(l) { return l.status === 'paye'; }).length;
    var myGains = myRecruiterId ? (myPaid * parseFloat(stats.coaching_price) * parseFloat(myRecruiterId.commission_percentage) / 100).toFixed(0) : '0';

    container.innerHTML = ''
      + '<div class="coaching-kpi-bar" style="grid-template-columns:repeat(3,1fr)">'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value">' + myLeads.length + '</div><div class="coaching-kpi-label">' + t('recruit.my_leads') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--green)">' + myPaid + '</div><div class="coaching-kpi-label">' + t('recruit.signed') + '</div></div>'
      + '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--green)">$' + myGains + '</div><div class="coaching-kpi-label">' + t('recruit.commission_earned') + '</div></div>'
      + '</div>'
      + '<div class="panel" style="padding:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('recruit.my_leads') + '</h3><button class="btn btn-primary" style="font-size:12px" onclick="showAddRecruitLeadForm()">' + t('recruit.add_lead') + '</button></div>'
      + '<div id="add-recruit-lead-form-wrap"></div>'
      + '<div id="recruit-leads-table">' + renderRecruitLeadsTable(false) + '</div>'
      + '</div>';
  }
}

function renderRecruitLeadsTable(isOwner) {
  var leads = _recruitLeads;
  if (leads.length === 0) return '<div style="text-align:center;color:var(--text-tertiary);padding:24px">' + t('recruit.no_leads') + '</div>';
  var statusOpts = Object.entries(RECRUIT_STATUSES_MAP).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label() + '</option>'; }).join('');
  return '<table class="table mobile-cards"><thead><tr><th>' + t('recruit.platform') + '</th><th>' + t('recruit.prospect_pseudo') + '</th>'
    + (isOwner ? '<th>' + t('recruit.recruiter') + '</th>' : '')
    + '<th>' + t('recruit.call_recruiter') + '</th>'
    + (isOwner ? '<th>' + t('recruit.call_owner') + '</th>' : '')
    + '<th>' + t('recruit.status') + '</th><th>' + t('common.notes') + '</th><th></th></tr></thead><tbody>'
    + leads.map(function(l) {
        var stObj = RECRUIT_STATUSES_MAP[l.status] || RECRUIT_STATUSES_MAP['prospect_chaud'];
        return '<tr>'
          + '<td data-label="" class="mc-half">' + (PLATFORM_ICONS[l.platform] || l.platform) + '</td>'
          + '<td data-label="" class="mc-title"><strong>' + (l.prospect_pseudo || '') + '</strong>' + (l.prospect_name ? '<div style="font-size:11px;color:var(--text-tertiary)">' + l.prospect_name + '</div>' : '') + '</td>'
          + (isOwner ? '<td data-label="' + t('recruit.recruiter') + '" class="mc-half" style="font-size:12px">' + (l.recruiter_name || '-') + '</td>' : '')
          + '<td data-label="Call R" class="mc-half"><input type="checkbox" ' + (l.call_recruiter ? 'checked' : '') + ' onchange="updateRecruitLead(' + l.id + ',{call_recruiter:this.checked})" style="width:18px;height:18px;cursor:pointer"></td>'
          + (isOwner ? '<td data-label="Call 1:1" class="mc-half"><input type="checkbox" ' + (l.call_owner ? 'checked' : '') + ' onchange="updateRecruitLead(' + l.id + ',{call_owner:this.checked})" style="width:18px;height:18px;cursor:pointer"></td>' : '')
          + '<td data-label="' + t('recruit.status') + '" class="mc-half"><select onchange="updateRecruitLead(' + l.id + ',{status:this.value})" style="background:var(--bg-base);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit">' + Object.entries(RECRUIT_STATUSES_MAP).map(function(e) { return '<option value="' + e[0] + '"' + (l.status === e[0] ? ' selected' : '') + '>' + e[1].label() + '</option>'; }).join('') + '</select></td>'
          + '<td data-label="Notes" class="mc-full" style="font-size:12px;color:var(--text-secondary)">' + (l.notes || '-') + '</td>'
          + '<td data-label="" class="mc-half"><button class="btn-delete-small" onclick="deleteRecruitLead(' + l.id + ')">✕</button></td>'
          + '</tr>';
      }).join('') + '</tbody></table>';
}

function showAddRecruiterForm() {
  var wrap = document.getElementById('add-recruiter-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var memberOpts = allUsers.filter(function(u) { return u.role !== 'platform_admin' && !_recruiters.some(function(r) { return r.user_id === u.id; }); }).map(function(u) { return '<option value="' + u.id + '">' + u.display_name + ' (' + u.role + ')</option>'; }).join('');
  wrap.innerHTML = '<div style="background:var(--bg-base);padding:14px;border-radius:10px;margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
    + '<select id="recruit-member-select" class="form-input" style="max-width:200px;font-size:12px;padding:6px 8px"><option value="">' + t('recruit.select_member') + '</option>' + memberOpts + '</select>'
    + '<input type="number" id="recruit-commission" class="form-input" style="max-width:100px;font-size:12px;padding:6px 8px" placeholder="10" value="10" min="0" max="100">'
    + '<span style="font-size:12px;color:var(--text-tertiary)">%</span>'
    + '<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="addRecruiter()">' + t('common.add') + '</button>'
    + '</div>';
}

async function addRecruiter() {
  var userId = document.getElementById('recruit-member-select').value;
  var comm = parseFloat(document.getElementById('recruit-commission').value) || 10;
  if (!userId) return;
  await fetch('/api/recruitment/recruiters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ user_id: parseInt(userId), commission_percentage: comm }) });
  showToast(t('recruit.recruiter_added'), 'success');
  renderRecruitment();
}

function showAddRecruitLeadForm() {
  var wrap = document.getElementById('add-recruit-lead-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var isOwner = currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'platform_admin';
  var recruiterSelect = '';
  if (isOwner && _recruiters.length > 0) {
    recruiterSelect = '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('recruit.recruiter') + '</label><select id="recruit-lead-recruiter" class="form-input" style="font-size:12px;padding:6px 8px">' + _recruiters.filter(function(r) { return r.is_active; }).map(function(r) { return '<option value="' + r.id + '">' + r.display_name + '</option>'; }).join('') + '</select></div>';
  }
  wrap.innerHTML = '<div style="background:var(--bg-base);padding:14px;border-radius:10px;margin-bottom:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;align-items:end">'
    + recruiterSelect
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('recruit.platform') + '</label><select id="recruit-lead-platform" class="form-input" style="font-size:12px;padding:6px 8px"><option value="instagram">Instagram</option><option value="whop">Whop</option><option value="discord">Discord</option><option value="tiktok">TikTok</option><option value="whatsapp">WhatsApp</option></select></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('recruit.prospect_pseudo') + '</label><input type="text" id="recruit-lead-pseudo" class="form-input" style="font-size:12px;padding:6px 8px" placeholder="@pseudo"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('recruit.prospect_name') + '</label><input type="text" id="recruit-lead-name" class="form-input" style="font-size:12px;padding:6px 8px" placeholder="Nom"></div>'
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('common.notes') + '</label><input type="text" id="recruit-lead-notes" class="form-input" style="font-size:12px;padding:6px 8px" placeholder="Notes..."></div>'
    + '<button class="btn btn-primary" style="font-size:12px;padding:8px 14px" onclick="addRecruitLead()">' + t('recruit.add_lead') + '</button>'
    + '</div>';
}

async function addRecruitLead() {
  var pseudo = document.getElementById('recruit-lead-pseudo').value.trim();
  if (!pseudo) return showToast(t('recruit.pseudo_required'), 'error');
  var body = {
    prospect_pseudo: pseudo,
    prospect_name: document.getElementById('recruit-lead-name').value.trim(),
    platform: document.getElementById('recruit-lead-platform').value,
    notes: document.getElementById('recruit-lead-notes').value.trim()
  };
  var recruiterSel = document.getElementById('recruit-lead-recruiter');
  if (recruiterSel && recruiterSel.value) body.recruiter_id = parseInt(recruiterSel.value);
  await fetch('/api/recruitment/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  showToast(t('recruit.lead_added'), 'success');
  renderRecruitment();
}

async function updateRecruitLead(id, data) {
  await fetch('/api/recruitment/leads/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  renderRecruitment();
}

async function deleteRecruitLead(id) {
  await fetch('/api/recruitment/leads/' + id, { method: 'DELETE', credentials: 'include' });
  renderRecruitment();
}
