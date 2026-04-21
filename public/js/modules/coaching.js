// COACHING MODULE
// Extracted from dashboard.html

var _coachingData = {};
var _selectedStudentId = null;
var _coachingTab = 'overview';
var _coachingFilter = '';
var _coachingProgFilter = '';

async function renderCoaching() {
  if (!isAdmin()) return;
  const container = document.getElementById('coaching-content');
  if (!container) return;

  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [callRequests, recruits, allStudentModels, allRevenue, objectives, assignments, pairs, convos] = await Promise.all([
    f('/api/call-requests'), f('/api/student-recruits'), f('/api/student-models'), f('/api/student-revenue'),
    f('/api/objectives'), f('/api/student-outreach-assignments'), f('/api/student-outreach-pairs'), f('/api/conversations')
  ]);

  const students = allStudents.filter(s => s.user_id);
  const pendingCalls = callRequests.filter(c => c.status === 'pending');
  const thisWeek = getWeekStart();
  const outreachUsers = allUsers.filter(u => u.role === 'outreach');
  const totalRevMonth = allRevenue.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);

  _coachingData = { students, callRequests, pendingCalls, recruits, allStudentModels, allRevenue, objectives, assignments, pairs, outreachUsers, convos, thisWeek };

  // KPI bar
  container.innerHTML = `
    <div class="coaching-kpi-bar">
      <div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--accent2)">${students.length}</div><div class="coaching-kpi-label">${t('coaching.students_active')}</div></div>
      <div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--green)">$${totalRevMonth.toFixed(0)}</div><div class="coaching-kpi-label">${t('coaching.revenue_month')}</div></div>
      <div class="coaching-kpi"><div class="coaching-kpi-value" style="color:${pendingCalls.length > 0 ? 'var(--red)' : 'var(--text3)'}">${pendingCalls.length}</div><div class="coaching-kpi-label">${t('coaching.calls_pending')}</div></div>
      <div class="coaching-kpi"><div class="coaching-kpi-value" style="color:var(--yellow)">${objectives.filter(o => o.week_start === thisWeek).length}</div><div class="coaching-kpi-label">${t('coaching.objectives_week')}</div></div>
    </div>

    <div class="coaching-layout">
      <!-- LEFT: Student list -->
      <div class="coaching-sidebar">
        <div class="coaching-sidebar-header">
          <input type="text" id="coaching-search" placeholder="${t('common.search')}" oninput="filterCoachingStudents()">
        </div>
        <div class="coaching-sidebar-filters">
          <button class="coaching-filter-chip active" onclick="setCoachingProgFilter('',this)">${t('common.all')}</button>
          <button class="coaching-filter-chip" onclick="setCoachingProgFilter('starter',this)">Starter</button>
          <button class="coaching-filter-chip" onclick="setCoachingProgFilter('pro',this)">Pro</button>
          <button class="coaching-filter-chip" onclick="setCoachingProgFilter('vip',this)">VIP</button>
          <button class="coaching-filter-chip" onclick="setCoachingProgFilter('elite',this)">Elite</button>
        </div>
        <div class="coaching-student-list" id="coaching-student-list"></div>
      </div>

      <!-- RIGHT: Detail -->
      <div class="coaching-detail" id="coaching-detail">
        <div class="coaching-detail-placeholder">${t('coaching.select_student')}</div>
      </div>
    </div>
  `;

  renderCoachingStudentList();
  if (_selectedStudentId && students.some(s => s.user_id === _selectedStudentId)) {
    selectCoachingStudent(_selectedStudentId);
  }
}

function renderCoachingStudentList() {
  var list = document.getElementById('coaching-student-list');
  if (!list) return;
  var students = _coachingData.students || [];
  var search = (document.getElementById('coaching-search')?.value || '').toLowerCase();
  var filtered = students.filter(function(s) {
    if (search && !s.name.toLowerCase().includes(search)) return false;
    if (_coachingProgFilter && (s.program || 'starter').toLowerCase() !== _coachingProgFilter) return false;
    return true;
  });
  var pendingCallIds = new Set((_coachingData.pendingCalls || []).map(function(c) { return c.student_user_id; }));
  list.innerHTML = filtered.map(function(s) {
    var step = s.progression_step || 'onboarding';
    var stepObj = STEPS.find(function(st) { return st.key === step; }) || STEPS[0];
    var prog = (s.program || 'starter').toLowerCase();
    var rev = (_coachingData.allRevenue || []).filter(function(r) { return r.student_user_id === s.user_id; }).reduce(function(sum, r) { return sum + parseFloat(r.revenue || 0); }, 0);
    var hasCall = pendingCallIds.has(s.user_id);
    return '<div class="coaching-student-card' + (_selectedStudentId === s.user_id ? ' selected' : '') + '" onclick="selectCoachingStudent(' + s.user_id + ')">'
      + '<div class="coaching-student-avatar">' + (s.name || 'U').charAt(0) + '</div>'
      + '<div class="coaching-student-info">'
      + '<div class="coaching-student-name">' + s.name + (hasCall ? ' <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);vertical-align:middle;margin-left:4px"></span>' : '') + '</div>'
      + '<div class="coaching-student-meta"><span class="coaching-badge coaching-badge-' + prog + '">' + prog.toUpperCase() + '</span> <span style="color:' + (stepObj.key === 'traffic' ? 'var(--green)' : 'var(--accent2)') + '">' + stepObj.icon + ' ' + stepObj.label + '</span></div>'
      + '</div>'
      + (rev > 0 ? '<span style="font-size:11px;font-weight:700;color:var(--green)">$' + rev.toFixed(0) + '</span>' : '')
      + '</div>';
  }).join('') || '<div style="color:var(--text3);text-align:center;padding:24px">' + t('coaching.no_students') + '</div>';
}

function setCoachingProgFilter(val, btn) {
  _coachingProgFilter = val;
  document.querySelectorAll('.coaching-filter-chip').forEach(function(c) { c.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderCoachingStudentList();
}

function filterCoachingStudents() { renderCoachingStudentList(); }

function selectCoachingStudent(userId) {
  _selectedStudentId = userId;
  renderCoachingStudentList();
  var detail = document.getElementById('coaching-detail');
  if (!detail) return;
  var s = (_coachingData.students || []).find(function(st) { return st.user_id === userId; });
  if (!s) return;

  detail.innerHTML = '<div class="coaching-tabs" id="coaching-tabs">'
    + '<button class="coaching-tab active" onclick="switchCoachingTab(\'overview\',this)">' + t('coaching.tab_overview') + '</button>'
    + '<button class="coaching-tab" onclick="switchCoachingTab(\'outreach\',this)">' + t('coaching.tab_outreach') + '</button>'
    + '<button class="coaching-tab" onclick="switchCoachingTab(\'planning\',this)">' + t('coaching.tab_planning') + '</button>'
    + '<button class="coaching-tab" onclick="switchCoachingTab(\'tasks\',this)">' + t('coaching.tab_tasks') + '</button>'
    + '<button class="coaching-tab" onclick="switchCoachingTab(\'revenue\',this)">' + t('coaching.tab_revenue') + '</button>'
    + '<button class="coaching-tab" onclick="switchCoachingTab(\'messages\',this)">' + t('coaching.tab_messages') + '</button>'
    + '</div>'
    + '<div class="coaching-tab-body" id="coaching-tab-body"></div>';

  _coachingTab = 'overview';
  renderCoachingTabContent();
}

function switchCoachingTab(tab, btn) {
  _coachingTab = tab;
  document.querySelectorAll('.coaching-tab').forEach(function(t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderCoachingTabContent();
}

function renderCoachingTabContent() {
  var body = document.getElementById('coaching-tab-body');
  if (!body || !_selectedStudentId) return;
  var s = (_coachingData.students || []).find(function(st) { return st.user_id === _selectedStudentId; });
  if (!s) return;

  if (_coachingTab === 'overview') {
    var step = s.progression_step || 'onboarding';
    var stepIdx = STEPS.findIndex(function(st) { return st.key === step; });
    var asgn = (_coachingData.assignments || []).filter(function(a) { return a.student_user_id === s.user_id; });
    var revs = (_coachingData.allRevenue || []).filter(function(r) { return r.student_user_id === s.user_id; });
    var totalRev = revs.reduce(function(sum, r) { return sum + parseFloat(r.revenue || 0); }, 0);
    var models = (_coachingData.allStudentModels || []).filter(function(m) { return m.user_id === s.user_id; });
    var calls = (_coachingData.callRequests || []).filter(function(c) { return c.student_user_id === s.user_id; });
    var pendingCall = calls.find(function(c) { return c.status === 'pending'; });
    var prog = (s.program || 'starter').toLowerCase();

    body.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:20px">'
      + '<div><h3 style="font-size:18px;font-weight:700;margin-bottom:4px">' + s.name + '</h3>'
      + '<span class="coaching-badge coaching-badge-' + prog + '" style="font-size:11px">' + prog.toUpperCase() + '</span></div>'
      + '<select onchange="updateStudentProgression(' + s.id + ',this.value)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer">'
      + STEPS.map(function(st) { return '<option value="' + st.key + '"' + (step === st.key ? ' selected' : '') + '>' + st.icon + ' ' + st.label + '</option>'; }).join('') + '</select></div>'
      // Stepper
      + '<div class="coaching-stepper">'
      + STEPS.map(function(st, i) {
          var cls = i < stepIdx ? 'done' : i === stepIdx ? 'current' : '';
          return (i > 0 ? '<div class="coaching-step-line' + (i <= stepIdx ? ' done' : '') + '"></div>' : '')
            + '<div class="coaching-step ' + cls + '" onclick="updateStudentProgression(' + s.id + ',\'' + st.key + '\')">' + st.icon + ' ' + st.label + '</div>';
        }).join('') + '</div>'
      // KPIs
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0">'
      + '<div style="background:var(--bg3);padding:12px;border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--green)">$' + totalRev.toFixed(0) + '</div><div style="font-size:10px;color:var(--text3)">Revenue total</div></div>'
      + '<div style="background:var(--bg3);padding:12px;border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--accent2)">' + models.length + '</div><div style="font-size:10px;color:var(--text3)">' + t('coaching.models_managed') + '</div></div>'
      + '<div style="background:var(--bg3);padding:12px;border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:800">' + asgn.length + '</div><div style="font-size:10px;color:var(--text3)">' + t('coaching.outreach_assigned') + '</div></div>'
      + '<div style="background:var(--bg3);padding:12px;border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:' + (pendingCall ? 'var(--red)' : 'var(--text3)') + '">' + calls.length + '</div><div style="font-size:10px;color:var(--text3)">' + t('coaching.call_requests') + '</div></div>'
      + '</div>'
      // Call requests
      + (pendingCall ? '<div style="background:var(--red-bg);border:1px solid rgba(251,113,133,0.2);border-radius:10px;padding:12px;margin-bottom:16px"><strong style="color:var(--red)">' + t('coaching.call_pending') + '</strong><div style="font-size:13px;color:var(--text2);margin-top:4px">' + (pendingCall.message || '-') + '</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="handleCallRequest(' + pendingCall.id + ',\'accepted\')">' + t('planning.accept') + '</button><button class="btn" style="font-size:11px;padding:4px 12px;background:var(--red-bg);color:var(--red);border:none;cursor:pointer" onclick="handleCallRequest(' + pendingCall.id + ',\'refused\')">' + t('planning.refuse') + '</button></div></div>' : '')
      // Outreach assignments
      + '<div style="background:var(--bg3);padding:14px;border-radius:10px;margin-bottom:12px">'
      + '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">' + t('coaching.outreach_assigned') + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
      + asgn.map(function(a) { return '<span style="font-size:11px;padding:3px 10px;background:var(--green-bg);color:var(--green);border-radius:10px">' + a.outreach_name + ' <button onclick="removeOutreachAssignment(' + a.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:10px">✕</button></span>'; }).join('')
      + '<select onchange="assignOutreach(' + s.user_id + ',this.value);this.value=\'\'" style="font-size:11px;padding:3px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer"><option value="">+ ' + t('common.add') + '</option>'
      + (_coachingData.outreachUsers || []).filter(function(u) { return !asgn.some(function(a) { return a.outreach_user_id === u.id; }); }).map(function(u) { return '<option value="' + u.id + '">' + u.display_name + '</option>'; }).join('') + '</select>'
      + '</div></div>'
      // Outreach pairs
      + (function() {
        var pairs = (_coachingData.pairs || []).filter(function(p) { return p.student_a_id === s.user_id || p.student_b_id === s.user_id; });
        var students = _coachingData.students || [];
        return '<div style="background:var(--bg3);padding:14px;border-radius:10px;margin-bottom:12px">'
          + '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">' + t('coaching.outreach_shared') + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
          + pairs.map(function(p) { var name = p.student_a_id === s.user_id ? p.student_b_name : p.student_a_name; return '<span style="font-size:11px;padding:3px 10px;background:var(--blue-bg);color:var(--blue);border-radius:10px">' + name + ' <button onclick="removeOutreachPair(' + p.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:10px">✕</button></span>'; }).join('')
          + '<select onchange="addOutreachPair(' + s.user_id + ',this.value);this.value=\'\'" style="font-size:11px;padding:3px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer"><option value="">+ Pairer</option>'
          + students.filter(function(st) { return st.user_id !== s.user_id && !pairs.some(function(p) { return (p.student_a_id === s.user_id && p.student_b_id === st.user_id) || (p.student_b_id === s.user_id && p.student_a_id === st.user_id); }); }).map(function(st) { return '<option value="' + st.user_id + '">' + st.name + '</option>'; }).join('')
          + '</select></div></div>';
      })();
  } else if (_coachingTab === 'outreach') {
    body.innerHTML = '<div id="coaching-outreach-content" style="color:var(--text3);text-align:center;padding:16px">' + t('common.loading') + '</div>';
    loadCoachingStudentOutreach(_selectedStudentId);
  } else if (_coachingTab === 'planning') {
    body.innerHTML = '<div id="coaching-planning-content" style="color:var(--text3);text-align:center;padding:16px">' + t('common.loading') + '</div>';
    loadCoachingStudentPlanning(_selectedStudentId);
  } else if (_coachingTab === 'tasks') {
    body.innerHTML = '<div id="coaching-tasks-content" style="color:var(--text3);text-align:center;padding:16px">' + t('common.loading') + '</div>';
    loadCoachingStudentTasks(_selectedStudentId);
  } else if (_coachingTab === 'revenue') {
    var revs = (_coachingData.allRevenue || []).filter(function(r) { return r.student_user_id === _selectedStudentId; });
    var recruits = (_coachingData.recruits || []).filter(function(r) { return r.student_user_id === _selectedStudentId; });
    body.innerHTML = '<h4 style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--accent2)">' + t('coaching.student_revenue') + '</h4>'
      + '<table class="table mobile-cards"><thead><tr><th>' + t('coaching.model_col') + '</th><th>' + t('coaching.month_col') + '</th><th>Revenue</th><th>' + t('coaching.commission') + '</th></tr></thead><tbody>'
      + (revs.length > 0 ? revs.map(function(r) {
          var comm = (parseFloat(r.revenue) * parseFloat(r.commission_rate) / 100).toFixed(2);
          return '<tr><td>' + r.model_name + '</td><td>' + r.month + '</td><td style="color:var(--green)">$' + parseFloat(r.revenue).toFixed(2) + '</td><td style="color:var(--accent)">$' + comm + '</td></tr>';
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">' + t('coaching.no_revenue') + '</td></tr>')
      + '</tbody></table>'
      + '<h4 style="font-size:14px;font-weight:700;margin:20px 0 12px;color:var(--accent2)">' + t('coaching.recruit_models') + '</h4>'
      + '<table class="table mobile-cards"><thead><tr><th>Instagram</th><th>' + t('common.status') + '</th><th>' + t('common.notes') + '</th></tr></thead><tbody>'
      + (recruits.length > 0 ? recruits.map(function(r) {
          var st = RECRUIT_STATUSES[r.status] || RECRUIT_STATUSES['interested'];
          return '<tr><td>' + (r.ig_link ? '<a href="' + r.ig_link + '" target="_blank" style="color:var(--accent)">' + r.ig_name + '</a>' : r.ig_name) + '</td><td><span style="background:' + st.bg + ';color:' + st.color + ';padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600">' + st.label + '</span></td><td style="color:var(--text2);font-size:12px">' + (r.notes || '-') + '</td></tr>';
        }).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:20px">' + t('coaching.no_recruit') + '</td></tr>')
      + '</tbody></table>';
  } else if (_coachingTab === 'messages') {
    body.innerHTML = '<div style="display:flex;gap:0;height:350px;border-radius:10px;overflow:hidden;border:1px solid var(--border)">'
      + '<div style="flex:1;display:flex;flex-direction:column;background:var(--bg)">'
      + '<div id="admin-chat-header" style="padding:10px 14px;border-bottom:1px solid var(--border);font-weight:600;font-size:13px">' + ((_coachingData.students || []).find(function(st) { return st.user_id === _selectedStudentId; }) || {}).name + '</div>'
      + '<div id="admin-chat-messages" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px"></div>'
      + '<div id="admin-chat-input-wrap" style="padding:8px;border-top:1px solid var(--border)">'
      + '<div style="display:flex;gap:6px"><input type="text" id="admin-chat-input" class="form-input" placeholder="' + t('coaching.reply_placeholder') + '" style="flex:1" onkeydown="if(event.key===\'Enter\')sendAdminMessage()"><button class="btn btn-primary" onclick="sendAdminMessage()" style="padding:6px 12px;font-size:12px">Envoyer</button></div></div></div></div>';
    openAdminChat(_selectedStudentId);
  }
}

let coachingOutreachStudentId = null;
let coachingOutreachMarket = 'fr';
let coachingOutreachFilter = 'all';
let coachingOutreachLeads = [];
let coachingOutreachOptions = { script: [], account: [], type: [] };

async function loadCoachingStudentOutreach(studentUserId, btn) {
  coachingOutreachStudentId = studentUserId;
  coachingOutreachFilter = 'all';
  coachingOutreachMarket = 'fr';
  // Highlight selected button
  document.querySelectorAll('.coaching-student-btn').forEach(b => { b.style.background = 'var(--bg3)'; b.style.color = 'var(--text2)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  await renderCoachingOutreach();
}

async function renderCoachingOutreach() {
  const container = document.getElementById('coaching-outreach-content');
  if (!container || !coachingOutreachStudentId) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Chargement...</div>';

  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [leads, stats, opts] = await Promise.all([
    f('/api/student-leads?student_user_id=' + coachingOutreachStudentId + '&market=' + coachingOutreachMarket),
    f('/api/student-leads/stats?student_user_id=' + coachingOutreachStudentId + '&market=' + coachingOutreachMarket),
    f('/api/user-options?user_id=' + coachingOutreachStudentId)
  ]);
  coachingOutreachLeads = leads;
  coachingOutreachOptions = opts.script ? opts : { script: [], account: [], type: [] };

  // Vérifier si US activé
  const student = allStudents.find(s => s.user_id === coachingOutreachStudentId);
  const usEnabled = student?.outreach_us_enabled;

  container.innerHTML = ''
    // Market toggle
    + (usEnabled ? '<div style="display:flex;gap:8px;margin-bottom:16px">'
      + '<button onclick="coachingOutreachMarket=\'fr\';renderCoachingOutreach()" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:13px;background:' + (coachingOutreachMarket==='fr'?'var(--accent)':'var(--bg3)') + ';color:' + (coachingOutreachMarket==='fr'?'white':'var(--text2)') + '">FR</button>'
      + '<button onclick="coachingOutreachMarket=\'us\';renderCoachingOutreach()" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:13px;background:' + (coachingOutreachMarket==='us'?'var(--accent)':'var(--bg3)') + ';color:' + (coachingOutreachMarket==='us'?'white':'var(--text2)') + '">US</button>'
      + '</div>' : '')
    // Stats
    + '<div class="stats-grid" style="margin-bottom:16px">'
    + '<div class="stat-card"><div class="stat-value">' + (stats.leads_today || 0) + '</div><div class="stat-label">Leads auj.</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + (stats.dm_sent_today || 0) + '</div><div class="stat-label">DMs auj.</div></div>'
    + '<div class="stat-card"><div class="stat-value">' + (stats.dm_sent || 0) + '</div><div class="stat-label">DMs total</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">' + (stats.talking_warm || 0) + '</div><div class="stat-label">Talking Warm</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green)">' + (stats.call_booked || 0) + '</div><div class="stat-label">Call Booked</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + (stats.reply_rate || 0) + '%</div><div class="stat-label">Taux réponse</div></div>'
    + '</div>'
    // Actions
    + '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    + '<button class="btn btn-primary" onclick="showCoachingLeadForm()" style="font-size:12px">+ Nouveau Lead</button>'
    + '</div>'
    + '<div id="coaching-lead-form-wrap"></div>'
    // Filtres
    + '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
    + ['all','to-send','sent','talking-cold','talking-warm','call-booked','signed'].map(function(fi) {
      return '<button class="btn coaching-lead-filter" onclick="coachingOutreachFilter=\'' + fi + '\';renderCoachingLeadTable();document.querySelectorAll(\'.coaching-lead-filter\').forEach(b=>{b.style.background=\'var(--bg3)\';b.style.color=\'var(--text2)\'});this.style.background=\'var(--accent)\';this.style.color=\'white\'" style="font-size:12px;padding:6px 14px;border-radius:20px;background:' + (coachingOutreachFilter===fi?'var(--accent)':'var(--bg3)') + ';color:' + (coachingOutreachFilter===fi?'white':'var(--text2)') + ';border:none;cursor:pointer">' + (fi==='all'?'Tous':(leadStatusColors[fi]?.label||fi)) + '</button>';
    }).join('')
    + '</div>'
    // Recherche
    + '<div style="margin-bottom:12px"><input type="text" id="coaching-lead-search" class="form-input" placeholder="Rechercher un username..." oninput="debouncedRenderCoachingLeadTable()" style="max-width:350px"></div>'
    // Tableau
    + '<div style="overflow-x:auto"><table class="table mobile-cards" id="coaching-leads-table"><thead><tr><th>#</th><th>Username</th><th>Type</th><th>Script</th><th>Compte</th><th>Statut</th><th>Ajouté par</th><th>Notes</th><th>Date</th><th></th></tr></thead><tbody></tbody></table></div>';

  renderCoachingLeadTable();
}

function coachingInlineSelect(leadId, field, currentValue, optType) {
  var opts = coachingOutreachOptions[optType] || [];
  var style = 'background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;min-height:28px;width:100%';
  var html = '<select onchange="updateCoachingLead(' + leadId + ',{' + field + ':this.value})" style="' + style + '"><option value="">-</option>';
  var hasVal = opts.some(function(o) { return o.value === currentValue; });
  if (currentValue && !hasVal) html += '<option value="' + currentValue + '" selected>' + currentValue + '</option>';
  opts.forEach(function(o) { html += '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.value + '</option>'; });
  return html + '</select>';
}

function renderCoachingLeadTable() {
  var search = (document.getElementById('coaching-lead-search')?.value || '').toLowerCase();
  var filtered = coachingOutreachFilter === 'all' ? coachingOutreachLeads : coachingOutreachLeads.filter(function(l) { return l.status === coachingOutreachFilter; });
  if (search) filtered = filtered.filter(function(l) { return l.username.toLowerCase().includes(search); });
  var tbody = document.querySelector('#coaching-leads-table tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map(function(l, idx) {
    var st = leadStatusColors[l.status] || leadStatusColors['sent'];
    var date = new Date(l.created_at).toLocaleDateString('fr-FR');
    var igLink = l.ig_link ? '<a href="' + l.ig_link + '" target="_blank" style="color:var(--accent)">' + l.username + '</a>' : l.username;
    return '<tr><td data-label="#" style="color:var(--text3);font-size:12px">' + (filtered.length - idx) + '</td>'
      + '<td data-label="" class="mc-title"><strong>' + igLink + '</strong></td>'
      + '<td data-label="Type" class="mc-half">' + leadTypeSelect(l.id, l.lead_type, 'updateCoachingLead(' + l.id + ',{lead_type:this.value})') + '</td>'
      + '<td data-label="Script" class="mc-half">' + coachingInlineSelect(l.id, 'script_used', l.script_used, 'script') + '</td>'
      + '<td data-label="Compte" class="mc-half">' + coachingInlineSelect(l.id, 'ig_account_used', l.ig_account_used, 'account') + '</td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="var s=leadStatusColors[this.value]||leadStatusColors[\'sent\'];this.style.background=s.bg;this.style.color=s.color;updateCoachingLead(' + l.id + ',{status:this.value})" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(leadStatusColors).map(function(e) { return '<option value="' + e[0] + '"' + (l.status===e[0]?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + e[1].label + '</option>'; }).join('') + '</select></td>'
      + '<td data-label="Ajouté par" class="mc-half" style="font-size:11px;color:var(--accent2)">' + (l.modified_by_name || l.added_by_name || '-') + '</td>'
      + '<td data-label="Notes" class="mc-full"><input type="text" value="' + (l.notes||'').replace(/"/g,'&quot;') + '" onchange="updateCoachingLead(' + l.id + ',{notes:this.value})" style="background:var(--bg);border:1px solid var(--border);color:var(--text2);padding:4px 8px;border-radius:6px;font-size:12px;width:100%;font-family:inherit"></td>'
      + '<td data-label="Date" class="mc-half" style="font-size:12px;color:var(--text3)">' + date + '</td>'
      + '<td data-label=""><button class="btn-delete-small" onclick="deleteCoachingLead(' + l.id + ')">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="10">' + emptyStateHTML('search', t('outreach.no_lead_found')) + '</td></tr>';
}

function updateCoachingLead(id, data) {
  var lead = coachingOutreachLeads.find(function(l) { return l.id === id; });
  if (lead) Object.assign(lead, data);
  fetch('/api/student-leads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) })
    .catch(function() { showToast(t('toast.error_network'), 'error'); });
}

async function deleteCoachingLead(id) {
  if (!(await confirmDelete('Supprimer ce lead ? Cette action est irréversible.'))) return;
  coachingOutreachLeads = coachingOutreachLeads.filter(function(l) { return l.id !== id; });
  renderCoachingLeadTable();
  fetch('/api/student-leads/' + id, { method: 'DELETE', credentials: 'include' })
    .catch(function() { showToast(t('toast.error_delete'), 'error'); });
}

async function deleteAllCoachingLeads() {
  var label = coachingOutreachMarket === 'us' ? 'US' : 'FR';
  if (!(await confirmDelete('Supprimer TOUS les leads ' + label + ' de cet élève ? Cette action est irréversible.'))) return;
  var res = await fetch('/api/student-leads/all?student_user_id=' + coachingOutreachStudentId + '&market=' + coachingOutreachMarket, { method: 'DELETE', credentials: 'include' });
  if (res.ok) { showToast('Leads supprimés', 'success'); renderCoachingOutreach(); }
}

function showCoachingLeadForm() {
  var wrap = document.getElementById('coaching-lead-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var opts = coachingOutreachOptions;
  var scriptOpts = (opts.script||[]).map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('');
  var accountOpts = (opts.account||[]).map(function(o) { return '<option value="' + o.value + '">' + o.value + '</option>'; }).join('');
  wrap.innerHTML = '<div class="panel" style="padding:16px;margin-bottom:16px;background:var(--bg3);border-radius:10px">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:700px">'
    + '<div><label style="font-size:11px;color:var(--text3)">Username *</label><input type="text" id="cl-username" class="form-input" placeholder="@username"></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">Lien Instagram</label><input type="text" id="cl-iglink" class="form-input" placeholder="https://instagram.com/..." oninput="var m=this.value.match(/instagram\\.com\\/([a-zA-Z0-9_.]+)/);if(m)document.getElementById(\'cl-username\').value=\'@\'+m[1]"></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">Type</label><select id="cl-type" class="form-input"><option value="">-- Type --</option>' + Object.entries(leadTypeColors).map(function(e) { return '<option value="' + e[0] + '">' + e[1].label + '</option>'; }).join('') + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">Script</label><select id="cl-script" class="form-input"><option value="">-- Script --</option>' + scriptOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">Compte</label><select id="cl-account" class="form-input"><option value="">-- Compte --</option>' + accountOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">Notes</label><input type="text" id="cl-notes" class="form-input" placeholder="Notes..."></div>'
    + '</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary" style="font-size:12px" onclick="addCoachingLead()">Ajouter</button><button class="btn" style="font-size:12px;background:var(--bg);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'coaching-lead-form-wrap\').innerHTML=\'\'">Annuler</button></div>'
    + '</div>';
}

async function addCoachingLead() {
  var username = document.getElementById('cl-username').value.trim();
  if (!username) return showToast('Username requis', 'error');
  var res = await fetch('/api/student-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({
    username: username,
    ig_link: document.getElementById('cl-iglink').value.trim(),
    lead_type: document.getElementById('cl-type').value,
    script_used: document.getElementById('cl-script').value,
    ig_account_used: document.getElementById('cl-account').value,
    notes: document.getElementById('cl-notes').value.trim(),
    student_user_id: coachingOutreachStudentId,
    market: coachingOutreachMarket
  })});
  if (res.ok) {
    var newLead = await res.json();
    coachingOutreachLeads.unshift(newLead);
    document.getElementById('coaching-lead-form-wrap').innerHTML = '';
    renderCoachingLeadTable();
    showToast(t('toast.lead_added'), 'success');
  } else {
    try { var e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
    catch(err) { showToast(t('toast.error_server'), 'error'); }
  }
}

function loadCoachingOutreachStats() {
  // plus nécessaire, l'outreach complet est chargé via loadCoachingStudentOutreach
}

// ========== COACHING — PLANNING ÉLÈVES ==========
let coachingPlanningStudentId = null;
let coachingPlanningDate = new Date();

async function loadCoachingStudentPlanning(studentUserId, btn) {
  coachingPlanningStudentId = studentUserId;
  coachingPlanningDate = new Date();
  document.querySelectorAll('.coaching-planning-btn').forEach(b => { b.style.background = 'var(--bg3)'; b.style.color = 'var(--text2)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  await renderCoachingPlanning();
}

function coachingPlanningNavigate(dir) {
  coachingPlanningDate.setDate(coachingPlanningDate.getDate() + (dir * 7));
  renderCoachingPlanning();
}

async function renderCoachingPlanning() {
  const container = document.getElementById('coaching-planning-content');
  if (!container || !coachingPlanningStudentId) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Chargement...</div>';

  const mon = getMonday(coachingPlanningDate);
  const sun = new Date(mon); sun.setDate(sun.getDate()+6);
  const start = fmtDate(mon);
  const end = fmtDate(sun);

  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [shifts, leaves] = await Promise.all([
    f('/api/planning-shifts?start=' + start + '&end=' + end + '&user_id=' + coachingPlanningStudentId),
    f('/api/leave-requests')
  ]);

  const shiftsByDate = {};
  shifts.forEach(s => {
    const dk = s.shift_date.slice(0,10);
    if (!shiftsByDate[dk]) shiftsByDate[dk] = [];
    shiftsByDate[dk].push(s);
  });

  const leaveSet = {};
  leaves.filter(l => l.status === 'accepted' && l.user_id === coachingPlanningStudentId).forEach(l => {
    const sd = new Date(l.start_date); const ed = new Date(l.end_date);
    while (sd <= ed) { leaveSet[fmtDate(sd)] = true; sd.setDate(sd.getDate()+1); }
  });

  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(d.getDate()+i); days.push(d); }

  let totalHours = 0;
  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<button onclick="coachingPlanningNavigate(-1)" style="padding:6px 12px;background:var(--bg3);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:14px;font-family:inherit">‹</button>'
    + '<div style="font-size:13px;font-weight:700">' + mon.toLocaleDateString('fr-FR',{day:'numeric',month:'long'}) + ' — ' + sun.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) + '</div>'
    + '<button onclick="coachingPlanningNavigate(1)" style="padding:6px 12px;background:var(--bg3);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:14px;font-family:inherit">›</button>'
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

    html += '<div style="background:' + (isToday ? 'rgba(168,85,247,0.08)' : 'var(--bg3)') + ';border-radius:10px;padding:12px 16px;border:1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:' + (dayShifts.length > 0 || isLeave ? '8px' : '0') + '">'
      + '<div style="font-size:13px;font-weight:600;text-transform:capitalize;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + '">' + dayLabel + '</div>'
      + '<div style="display:flex;gap:6px">'
      + '<button onclick="coachingQuickAddShift(\'' + dk + '\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;font-weight:600">+ Shift</button>'
      + '<button onclick="coachingQuickAddTask(\'' + dk + '\')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:11px;font-weight:600">+ Tâche</button>'
      + '</div></div>';

    if (isLeave) {
      html += '<div style="padding:8px 12px;background:var(--red-bg);border-radius:6px;color:var(--red);font-weight:600;font-size:12px">Congé</div>';
    } else {
      dayShiftEntries.forEach(s => {
        const st = SHIFT_TYPES[s.shift_type] || SHIFT_TYPES['custom'];
        const timeStr = s.start_time && s.end_time ? s.start_time + ' → ' + s.end_time : '';
        if (s.start_time && s.end_time && s.shift_type !== 'off') {
          const sh = parseInt(s.start_time.split(':')[0]) + parseInt(s.start_time.split(':')[1])/60;
          let eh = parseInt(s.end_time.split(':')[0]) + parseInt(s.end_time.split(':')[1])/60;
          if (eh < sh) eh += 24;
          totalHours += eh - sh;
        }
        html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg);border-radius:6px;margin-bottom:4px">'
          + '<div style="padding:4px 10px;border-radius:6px;background:' + st.bg + ';color:' + st.color + ';font-size:11px;font-weight:700;white-space:nowrap">' + (s.shift_type === 'off' ? 'OFF' : st.label) + '</div>'
          + (timeStr ? '<div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap">' + timeStr + '</div>' : '')
          + (s.notes ? '<div style="font-size:11px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.notes + '</div>' : '<div style="flex:1"></div>')
          + '<button onclick="deletePlanShift(' + s.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:2px">✕</button>'
          + '</div>';
      });
      if (dayTaskEntries.length > 0) {
        if (dayShiftEntries.length > 0) html += '<div style="height:1px;background:var(--border);margin:6px 0"></div>';
        dayTaskEntries.forEach(s => {
          const isUrgent = s.priority === 'urgent';
          const desc = s.description || s.notes || '';
          html += '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:var(--bg);border-radius:6px;margin-bottom:4px;border-left:3px solid ' + (isUrgent ? 'var(--red)' : 'var(--green)') + '">'
            + '<div style="min-width:46px">'
            + (s.start_time ? '<div style="font-size:11px;font-weight:700;color:var(--text)">' + s.start_time + '</div>' : '')
            + (s.end_time ? '<div style="font-size:10px;color:var(--text3)">' + s.end_time + '</div>' : '')
            + '</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:12px;font-weight:600;color:var(--text)">' + desc + '</div>'
            + (isUrgent ? '<span style="font-size:9px;padding:2px 6px;border-radius:5px;background:var(--red-bg);color:var(--red);font-weight:600;display:inline-block;margin-top:3px">URGENT</span>' : '')
            + '</div>'
            + '<button onclick="deletePlanShift(' + s.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:2px;flex-shrink:0">✕</button>'
            + '</div>';
        });
      }
      if (dayShifts.length === 0) {
        html += '<div style="color:var(--text3);font-size:11px;font-style:italic">Aucun shift ou tâche</div>';
      }
    }
    html += '</div>';
  });

  html += '</div>'
    + '<div style="margin-top:12px;padding:12px 16px;background:var(--bg3);border-radius:8px;display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:12px;color:var(--text2)">Total semaine</span>'
    + '<span style="font-size:16px;font-weight:800;color:var(--accent)">' + totalHours.toFixed(0) + 'h</span>'
    + '</div>';

  container.innerHTML = html;
}

async function coachingQuickAddShift(dateStr) {
  const type = prompt('Type de shift (morning / afternoon / night / off / custom) :', 'morning');
  if (!type || !SHIFT_TYPES[type]) return;
  const st = SHIFT_TYPES[type];
  await fetch('/api/planning-shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      user_id: coachingPlanningStudentId,
      shift_date: dateStr,
      shift_type: type,
      start_time: st.start,
      end_time: st.end,
      entry_type: 'shift'
    })
  });
  showToast('Shift ajouté', 'success');
  renderCoachingPlanning();
}

async function coachingQuickAddTask(dateStr) {
  const desc = prompt(t('coaching.task_desc_prompt'));
  if (!desc) return;
  const start = prompt(t('coaching.start_time'), '18:00') || '18:00';
  const end = prompt(t('coaching.end_time'), '19:00') || '19:00';
  const isUrgent = confirm(t('coaching.task_urgent'));
  await fetch('/api/planning-shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      user_id: coachingPlanningStudentId,
      shift_date: dateStr,
      shift_type: 'custom',
      start_time: start,
      end_time: end,
      entry_type: 'task',
      priority: isUrgent ? 'urgent' : 'normal',
      description: desc
    })
  });
  showToast('Tâche ajoutée au planning', 'success');
  renderCoachingPlanning();
}

// ========== COACHING — TÂCHES ÉLÈVES ==========
let coachingTasksStudentId = null;

async function loadCoachingStudentTasks(studentUserId, btn) {
  coachingTasksStudentId = studentUserId;
  document.querySelectorAll('.coaching-tasks-btn').forEach(b => { b.style.background = 'var(--bg3)'; b.style.color = 'var(--text2)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  await renderCoachingTasks();
}

async function renderCoachingTasks() {
  const container = document.getElementById('coaching-tasks-content');
  if (!container || !coachingTasksStudentId) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Chargement...</div>';

  const tasks = await fetch('/api/tasks?student_user_id=' + coachingTasksStudentId, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const statusColors = { pending: { bg: 'var(--blue-bg)', color: 'var(--blue)', label: t('planning.pending') }, in_progress: { bg: 'var(--yellow-bg)', color: 'var(--yellow)', label: t('tasks.in_progress_label') }, completed: { bg: 'var(--green-bg)', color: 'var(--green)', label: 'Terminée' } };

  const pending = tasks.filter(t => t.status !== 'completed');
  const completed = tasks.filter(t => t.status === 'completed');

  function card(t) {
    const isUrgent = t.priority === 'urgent';
    const dl = t.deadline || '';
    const today = new Date().toISOString().slice(0,10);
    const overdue = dl && dl < today && t.status !== 'completed';
    const borderColor = overdue ? 'var(--red)' : isUrgent ? 'var(--red)' : 'var(--accent)';
    const st = statusColors[t.status] || statusColors['pending'];
    return '<div style="background:var(--bg3);padding:12px;border-radius:8px;border-left:4px solid ' + borderColor + ';position:relative">'
      + (isUrgent ? '<span style="position:absolute;top:8px;right:8px;background:var(--red);color:white;font-size:9px;padding:2px 6px;border-radius:8px;font-weight:700">URGENT</span>' : '')
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">'
      + '<strong style="font-size:13px;' + (t.status === 'completed' ? 'text-decoration:line-through;opacity:0.5' : '') + '">' + t.title + '</strong>'
      + '<button class="btn-delete-small" onclick="coachingDeleteTask(' + t.id + ')" style="flex-shrink:0">✕</button>'
      + '</div>'
      + (t.description ? '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">' + t.description + '</div>' : '')
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:11px">'
      + '<select onchange="coachingUpdateTaskStatus(' + t.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:3px 7px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit">'
      + '<option value="pending"' + (t.status==='pending'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">En attente</option>'
      + '<option value="in_progress"' + (t.status==='in_progress'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">En cours</option>'
      + '<option value="completed"' + (t.status==='completed'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">Terminée</option></select>'
      + (dl ? '<div style="color:' + (overdue ? 'var(--red);font-weight:600' : 'var(--text3)') + '">📅 ' + dl + (overdue ? ' (en retard)' : '') + '</div>' : '')
      + '</div></div>';
  }

  container.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary" style="font-size:12px;padding:6px 12px" onclick="coachingShowTaskForm()">+ Nouvelle tâche</button></div>'
    + '<div id="coaching-task-form-wrap"></div>'
    + '<div style="margin-bottom:12px"><h4 style="font-size:12px;font-weight:700;color:var(--accent2);margin-bottom:8px">À faire (' + pending.length + ')</h4>'
    + (pending.length === 0 ? emptyStateHTML('clipboard', t('student.no_task')) : '<div style="display:grid;gap:8px">' + pending.map(card).join('') + '</div>')
    + '</div>'
    + (completed.length > 0 ? '<div><h4 style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">Terminées (' + completed.length + ')</h4><div style="display:grid;gap:8px">' + completed.map(card).join('') + '</div></div>' : '');
}

function coachingShowTaskForm() {
  const wrap = document.getElementById('coaching-task-form-wrap');
  if (!wrap) return;
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="panel" style="padding:14px;margin-bottom:12px;background:var(--bg2)">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Titre *</label><input type="text" id="ct-title" class="form-input" placeholder="Titre de la tâche"></div>'
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Description</label><input type="text" id="ct-desc" class="form-input" placeholder="Description..."></div>'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Priorité</label><select id="ct-priority" class="form-input"><option value="normal">Normale</option><option value="urgent">Urgente</option></select></div>'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Deadline</label><input type="date" id="ct-deadline" class="form-input"></div>'
    + '</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary" style="font-size:12px" onclick="coachingAddTask()">Ajouter</button><button class="btn" style="font-size:12px;background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'coaching-task-form-wrap\').innerHTML=\'\'">Annuler</button></div>'
    + '</div>';
}

async function coachingAddTask() {
  const title = document.getElementById('ct-title').value.trim();
  if (!title) { showToast('Titre requis', 'error'); return; }
  const description = document.getElementById('ct-desc').value.trim();
  const priority = document.getElementById('ct-priority').value;
  const deadline = document.getElementById('ct-deadline').value || null;
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description, assigned_to_id: coachingTasksStudentId, priority, deadline })
  });
  if (res.ok) {
    showToast('Tâche ajoutée', 'success');
    document.getElementById('coaching-task-form-wrap').innerHTML = '';
    renderCoachingTasks();
  }
}

async function coachingUpdateTaskStatus(id, status) {
  await fetch('/api/tasks/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) });
  renderCoachingTasks();
}

async function coachingDeleteTask(id) {
  if (!(await confirmDelete('Supprimer cette tâche ? Cette action est irréversible.'))) return;
  await fetch('/api/tasks/' + id, { method: 'DELETE', credentials: 'include' });
  renderCoachingTasks();
}

async function toggleOutreachUS(studentId, enabled) {
  await fetch('/api/students/' + studentId + '/outreach-us', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ enabled }) });
  showToast(enabled ? t('coaching.us_enabled_toast') : t('coaching.us_disabled_toast'), 'success');
  // Recharger les données students
  allStudents = await fetch('/api/students', { credentials: 'include' }).then(r => r.json());
}

async function updateStudentDrive(studentId, value) {
  await fetch('/api/students/' + studentId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ drive_folder: value || null }) });
  showToast(t('coaching.drive_updated_toast'), 'success');
  allStudents = await fetch('/api/students', { credentials: 'include' }).then(r => r.json());
  renderCoaching();
}

async function addOutreachPair(studentAId, studentBId) {
  if (!studentBId) return;
  const res = await fetch('/api/student-outreach-pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ student_a_id: parseInt(studentAId), student_b_id: parseInt(studentBId) }) });
  if (res.ok) { showToast(t('coaching.paired_toast'), 'success'); renderCoaching(); }
  else { const e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
}

async function removeOutreachPair(id) {
  await fetch('/api/student-outreach-pairs/' + id, { method: 'DELETE', credentials: 'include' });
  showToast(t('coaching.pair_removed_toast'), 'success');
  renderCoaching();
}

async function assignOutreach(studentUserId, outreachUserId) {
  if (!outreachUserId) return;
  const res = await fetch('/api/student-outreach-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ student_user_id: studentUserId, outreach_user_id: parseInt(outreachUserId) }) });
  if (res.ok) { showToast(t('coaching.assistant_assigned_toast'), 'success'); renderCoaching(); }
  else { const e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
}

async function removeOutreachAssignment(id) {
  await fetch('/api/student-outreach-assignments/' + id, { method: 'DELETE', credentials: 'include' });
  showToast(t('coaching.assignment_removed_toast'), 'success');
  renderCoaching();
}

async function updateStudentProgression(studentId, step) {
  await fetch('/api/students/' + studentId + '/progression', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ progression_step: step }) });
  showToast(t('coaching.progression_updated_toast'), 'success');
}

async function handleCallRequest(id, status) {
  let scheduled_at = null;
  if (status === 'accepted') {
    scheduled_at = prompt(t('coaching.date_time_call'));
    if (!scheduled_at) return;
  }
  await fetch('/api/call-requests/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status, scheduled_at }) });
  showToast(status === 'accepted' ? t('coaching.call_accepted') : t('coaching.call_refused'), status === 'accepted' ? 'success' : 'info');
  renderCoaching();
}

async function adminUpdateRecruit(id, status) {
  await fetch('/api/student-recruits/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) });
}

function showAddObjectiveForm() {
  const wrap = document.getElementById('admin-obj-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  const studentOpts = allStudents.filter(s => s.user_id).map(s => '<option value="' + s.user_id + '">' + s.name + '</option>').join('');
  wrap.innerHTML = `<div style="background:var(--bg3);padding:14px;border-radius:10px;margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">
    <div><label style="font-size:11px;color:var(--text3)">Élève</label><select id="obj-student" class="form-input" style="font-size:12px">${studentOpts}</select></div>
    <div><label style="font-size:11px;color:var(--text3)">Type</label><select id="obj-type" class="form-input" style="font-size:12px"><option value="leads">Leads</option><option value="dms">DMs</option><option value="calls">Calls modèles</option><option value="custom">Autre</option></select></div>
    <div><label style="font-size:11px;color:var(--text3)">Description</label><input type="text" id="obj-desc" class="form-input" style="font-size:12px" placeholder="Ex: 100 leads"></div>
    <div><label style="font-size:11px;color:var(--text3)">Objectif</label><input type="number" id="obj-target" class="form-input" style="font-size:12px;width:80px" placeholder="100"></div>
    <button class="btn btn-primary" style="font-size:12px;padding:8px 14px" onclick="addAdminObjective()">Ajouter</button>
  </div>`;
}

async function addAdminObjective() {
  const user_id = document.getElementById('obj-student').value;
  const obj_type = document.getElementById('obj-type').value;
  const description = document.getElementById('obj-desc').value.trim();
  const target = parseInt(document.getElementById('obj-target').value) || 0;
  await fetch('/api/objectives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ user_id, week_start: getWeekStart(), obj_type, description, target }) });
  showToast(t('coaching.objective_added_toast'), 'success'); renderCoaching();
}

async function deleteAdminObjective(id) {
  await fetch('/api/objectives/' + id, { method: 'DELETE', credentials: 'include' });
  renderCoaching();
}

let adminChatUserId = null;
async function openAdminChat(userId) {
  adminChatUserId = userId;
  currentChatUserId = userId;
  const convos = await fetch('/api/conversations', { credentials: 'include' }).then(r => r.json());
  const contact = convos.find(c => c.id === userId);
  document.getElementById('admin-chat-header').textContent = contact?.display_name || 'Chat';
  document.getElementById('admin-chat-input-wrap').style.display = 'block';
  const res = await fetch('/api/messages/' + userId, { credentials: 'include' });
  if (res.ok) {
    const msgs = await res.json();
    const container = document.getElementById('admin-chat-messages');
    container.innerHTML = msgs.map(m => {
      const isMe = m.from_user_id === currentUser.id;
      return '<div style="display:flex;justify-content:' + (isMe ? 'flex-end' : 'flex-start') + '"><div style="max-width:70%;padding:8px 12px;border-radius:' + (isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px') + ';background:' + (isMe ? 'var(--accent)' : 'var(--bg3)') + ';color:' + (isMe ? 'white' : 'var(--text)') + ';font-size:13px">' + m.content + '<div style="font-size:10px;margin-top:3px;opacity:0.6">' + new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) + '</div></div></div>';
    }).join('');
    container.scrollTop = container.scrollHeight;
  }
}

async function sendAdminMessage() {
  const input = document.getElementById('admin-chat-input');
  const content = input.value.trim();
  if (!content || !adminChatUserId) return;
  input.value = '';
  await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ to_user_id: adminChatUserId, content }) });
  openAdminChat(adminChatUserId);
}

let chartFollowers = null;