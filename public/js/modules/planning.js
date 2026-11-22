// PLANNING MODULE
// Extracted from dashboard.html

var planView = 'week';
var planDate = new Date();
var planShifts = [];
var planLeaves = [];
var planSelectedUser = null;

var SHIFT_TYPES = {
  'morning':   { labelKey: 'planning.morning', time: '6h-14h', start: '06:00', end: '14:00', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  'afternoon': { labelKey: 'planning.afternoon', time: '14h-22h', start: '14:00', end: '22:00', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'night':     { labelKey: 'planning.night', time: '22h-06h', start: '22:00', end: '06:00', color: '#8B5CF6', bg: 'rgba(236,72,153,0.12)' },
  'off':       { labelKey: null, label: 'Off', time: '', start: null, end: null, color: '#52525B', bg: 'rgba(107,107,128,0.12)' },
  'custom':    { labelKey: null, label: 'Custom', time: '', start: null, end: null, color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' }
};
// Get shift label dynamically (t() not available at load time)
function getShiftLabel(st) { return st.labelKey ? t(st.labelKey) : (st.label || ''); }

var ROLE_COLORS = { chatter: '#3b82f6', outreach: '#10b981', va: '#f59e0b', admin: '#8B5CF6', student: '#06B6D4', model: '#52525B' };
var ROLE_BG = { chatter: 'rgba(59,130,246,0.12)', outreach: 'rgba(16,185,129,0.12)', va: 'rgba(245,158,11,0.12)', admin: 'rgba(236,72,153,0.12)', student: 'rgba(6,182,212,0.12)', model: 'rgba(107,107,128,0.12)' };

function getMonday(d) { var dt = new Date(d); var day = dt.getDay(); var diff = dt.getDate() - day + (day === 0 ? -6 : 1); dt.setDate(diff); dt.setHours(0,0,0,0); return dt; }
function fmtDate(d) { return d.toISOString().slice(0,10); }
function fmtDateFR(d) { return d.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR', { day:'numeric', month:'short' }); }
function fmtDayFR(d) { return d.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR', { weekday:'long', day:'numeric', month:'long' }); }

function planNavigate(dir) { planDate.setDate(planDate.getDate()+7*dir); renderPlanDetail(); }
function planNavigateToday() { planDate = new Date(); renderPlanDetail(); }

async function renderPlanning() {
  renderPlanMemberList();
  // Auto-select first member or self
  if (!planSelectedUser) {
    planSelectedUser = isAdmin() ? 'all' : currentUser.id;
  }
  await renderPlanDetail();
  if (isAdmin()) renderPlanLeaves();
}

function renderPlanMemberList() {
  var container = document.getElementById('planning-members');
  if (!container) return;

  var members;
  if (isAdmin()) {
    // Admin en premier, puis le reste
    members = [allUsers.find(function(u) { return u.id === currentUser.id; })].concat(
      allUsers.filter(function(u) { return u.id !== currentUser.id; })
    ).filter(Boolean);
  } else {
    members = [currentUser];
  }

  var allSel = planSelectedUser === 'all';
  container.innerHTML = '<div class="panel" style="padding:0;overflow:hidden">'
    + (isAdmin() ? '<div onclick="selectPlanMember(\'all\')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-left:3px solid ' + (allSel ? 'var(--accent)' : 'transparent') + ';background:' + (allSel ? 'rgba(59,130,246,0.12)' : 'transparent') + ';border-bottom:1px solid var(--border)">'
      + '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">👥</div>'
      + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:' + (allSel ? '700' : '600') + ';color:var(--text)">Tout le monde</div>'
      + '<div style="font-size:11px;color:var(--text-tertiary)">Équipe + modèles</div></div></div>' : '')
    + members.map(function(u) {
      var rc = ROLE_COLORS[u.role] || '#52525B';
      var rbg = ROLE_BG[u.role] || 'var(--bg-elevated)';
      var selected = planSelectedUser === u.id;
      var online = typeof isUserOnline === 'function' && isUserOnline(u.id);
      var av = u.avatar_url
        ? '<img src="' + u.avatar_url + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">'
        : '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,' + rc + ',var(--pink));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white;flex-shrink:0">' + (u.display_name||'?').charAt(0) + '</div>';
      return '<div onclick="selectPlanMember(' + u.id + ')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-left:3px solid ' + (selected ? rc : 'transparent') + ';background:' + (selected ? rbg : 'transparent') + ';transition:all 0.15s">'
        + '<div style="position:relative">' + av + (online ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span>' : '') + '</div>'
        + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:' + (selected?'700':'500') + ';color:' + (selected?'var(--text)':'var(--text-secondary)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + u.display_name + '</div>'
        + '<div style="font-size:11px;color:' + rc + ';font-weight:600">' + u.role + '</div></div>'
        + '</div>';
    }).join('')
    + '</div>';
}

function selectPlanMember(userId) {
  planSelectedUser = userId;
  planDate = new Date();
  renderPlanMemberList();
  renderPlanDetail();
}

async function renderPlanDetail() {
  var container = document.getElementById('planning-detail');
  if (!container || !planSelectedUser) { if (container) container.innerHTML = ''; return; }
  var side = document.getElementById('planning-members');
  if (side) side.style.width = planSelectedUser === 'all' ? '190px' : '240px';
  if (planSelectedUser === 'all') return renderPlanAll(container);

  var mon = getMonday(planDate);
  var sun = new Date(mon); sun.setDate(sun.getDate()+6);
  var start = fmtDate(mon);
  var end = fmtDate(sun);

  var user = allUsers.find(function(u) { return u.id === planSelectedUser; });
  var userName = user ? user.display_name : '';
  var userRole = user ? user.role : '';
  var rc = ROLE_COLORS[userRole] || '#52525B';

  document.getElementById('planning-subtitle').textContent = userName + ' — ' + t('cp.week_of_label') + ' ' + fmtDateFR(mon) + ' au ' + fmtDateFR(sun);

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [shifts, leaves] = await Promise.all([
    f('/api/planning-shifts?start=' + start + '&end=' + end + '&user_id=' + planSelectedUser),
    f('/api/leave-requests')
  ]);
  planShifts = shifts;
  planLeaves = leaves;

  // Map shifts by date
  var shiftsByDate = {};
  shifts.forEach(function(s) {
    var dk = s.shift_date.slice(0,10);
    if (!shiftsByDate[dk]) shiftsByDate[dk] = [];
    shiftsByDate[dk].push(s);
  });

  // Leave set
  var leaveSet = {};
  leaves.filter(function(l) { return l.status === 'accepted' && l.user_id === planSelectedUser; }).forEach(function(l) {
    var sd = new Date(l.start_date); var ed = new Date(l.end_date);
    while (sd <= ed) { leaveSet[fmtDate(sd)] = true; sd.setDate(sd.getDate()+1); }
  });

  var days = [];
  for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(d.getDate()+i); days.push(d); }

  var totalHours = 0;

  var html = '<div class="panel" style="padding:20px">'
    // Nav semaine
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
    + '<button onclick="planNavigate(-1)" style="padding:8px 14px;background:var(--bg-base);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">‹</button>'
    + '<div style="text-align:center"><div style="font-size:15px;font-weight:700">' + mon.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{day:'numeric',month:'long'}) + ' — ' + sun.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{day:'numeric',month:'long',year:'numeric'}) + '</div></div>'
    + '<button onclick="planNavigate(1)" style="padding:8px 14px;background:var(--bg-base);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">›</button>'
    + '</div>'
    // Jours
    + '<div style="display:grid;gap:8px">';

  days.forEach(function(d) {
    var dk = fmtDate(d);
    var isToday = dk === fmtDate(new Date());
    var dayShifts = shiftsByDate[dk] || [];
    var isLeave = leaveSet[dk];
    var dayLabel = d.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR', { weekday:'long', day:'numeric', month:'short' });

    var dayShiftEntries = dayShifts.filter(function(s) { return s.entry_type !== 'task'; });
    var dayTaskEntries = dayShifts.filter(function(s) { return s.entry_type === 'task'; });

    html += '<div style="background:' + (isToday ? 'rgba(59,130,246,0.08)' : 'var(--bg-elevated)') + ';border-radius:12px;padding:14px 18px;border:1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:' + (dayShifts.length > 0 || isLeave ? '10px' : '0') + '">'
      + '<div style="font-size:14px;font-weight:600;text-transform:capitalize;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + '">' + dayLabel + (isToday ? ' <span style="font-size:11px;background:var(--accent);color:white;padding:2px 8px;border-radius:10px;margin-left:6px">' + t('planning.today_label') + '</span>' : '') + '</div>'
      + '<div style="display:flex;gap:6px">'
      + '<button onclick="quickAddShift(' + planSelectedUser + ',\'' + dk + '\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;font-weight:600">+ Shift</button>'
      + (isAdmin() ? '<button onclick="quickAddTask(' + planSelectedUser + ',\'' + dk + '\')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:12px;font-weight:600">+ Tâche</button>' : '')
      + '</div></div>';

    if (isLeave) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--red-bg);border-radius:8px;color:var(--red);font-weight:600;font-size:13px">' + t('planning.leave') + '</div>';
    } else {
      // --- Shifts ---
      if (dayShiftEntries.length > 0) {
        dayShiftEntries.forEach(function(s) {
          var st = SHIFT_TYPES[s.shift_type] || SHIFT_TYPES['custom'];
          var timeStr = s.start_time && s.end_time ? s.start_time + ' → ' + s.end_time : '';
          var models = []; try { models = JSON.parse(s.model_ids || '[]'); } catch(e) {}
          var modelNames = models.map(function(mid) { var m = allModels.find(function(mm) { return mm.id === parseInt(mid); }); return m ? m.name : ''; }).filter(Boolean);
          if (s.start_time && s.end_time && s.shift_type !== 'off') {
            var sh = parseInt(s.start_time.split(':')[0]) + parseInt(s.start_time.split(':')[1])/60;
            var eh = parseInt(s.end_time.split(':')[0]) + parseInt(s.end_time.split(':')[1])/60;
            if (eh < sh) eh += 24;
            totalHours += eh - sh;
          }
          html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg);border-radius:8px;margin-bottom:4px">'
            + '<div style="padding:6px 12px;border-radius:8px;background:' + st.bg + ';color:' + st.color + ';font-size:12px;font-weight:700;white-space:nowrap">' + (s.shift_type === 'off' ? 'OFF' : getShiftLabel(st)) + '</div>'
            + (timeStr ? '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap">' + timeStr + '</div>' : '')
            + (modelNames.length > 0 ? '<div style="display:flex;gap:4px;flex-wrap:wrap">' + modelNames.map(function(n) { return '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg-base);color:var(--text-secondary)">' + n + '</span>'; }).join('') + '</div>' : '')
            + (s.notes ? '<div style="font-size:11px;color:var(--text-tertiary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.notes + '</div>' : '<div style="flex:1"></div>')
            + '<div style="display:flex;gap:4px;flex-shrink:0">'
            + '<button onclick="deletePlanShift(' + s.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:4px">✕</button>'
            + '</div></div>';
        });
      }

      // --- Tâches planifiées ---
      if (dayTaskEntries.length > 0) {
        if (dayShiftEntries.length > 0) html += '<div style="height:1px;background:var(--border);margin:8px 0"></div>';
        dayTaskEntries.forEach(function(s) {
          var isUrgent = s.priority === 'urgent';
          var timeStr = s.start_time && s.end_time ? s.start_time + ' → ' + s.end_time : (s.start_time || '');
          var models = []; try { models = JSON.parse(s.model_ids || '[]'); } catch(e) {}
          var modelNames = models.map(function(mid) { var m = allModels.find(function(mm) { return mm.id === parseInt(mid); }); return m ? m.name : ''; }).filter(Boolean);
          var desc = s.description || s.notes || '';

          html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg);border-radius:8px;margin-bottom:4px;border-left:3px solid ' + (isUrgent ? 'var(--red)' : 'var(--green)') + '">'
            + '<div style="min-width:50px">'
            + (timeStr ? '<div style="font-size:12px;font-weight:700;color:var(--text)">' + (s.start_time || '') + '</div>' : '')
            + (s.end_time && s.start_time ? '<div style="font-size:10px;color:var(--text-tertiary)">' + s.end_time + '</div>' : '')
            + '</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:13px;font-weight:600;color:var(--text)">' + desc + '</div>'
            + '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">'
            + (isUrgent ? '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--red-bg);color:var(--red);font-weight:600">URGENT</span>' : '')
            + modelNames.map(function(n) { return '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg-base);color:var(--text-secondary)">' + n + '</span>'; }).join('')
            + '</div></div>'
            + '<button onclick="deletePlanShift(' + s.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:4px;flex-shrink:0">✕</button>'
            + '</div>';
        });
      }

      if (dayShifts.length === 0) {
        html += '<div style="color:var(--text-tertiary);font-size:12px;font-style:italic">' + t('planning.no_shift') + '</div>';
      }
    }
    html += '</div>';
  });

  html += '</div>'
    // Weekly summary bar
    + '<div style="margin-top:16px;padding:14px 18px;background:var(--bg-base);border-radius:10px;display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:13px;color:var(--text-secondary)">' + t('planning.week_total') + '</span>'
    + '<span style="font-size:18px;font-weight:800;color:' + rc + '">' + totalHours.toFixed(0) + 'h</span>'
    + '</div>'
    + '</div>';

  container.innerHTML = html;

  // Stats for admin
  renderPlanStats(start, end);
}

function showPlanShiftForm(userId, dateStr, defaultEntryType) {
  var existing = document.getElementById('plan-shift-form-inline');
  if (existing) { existing.remove(); if (!dateStr) return; }

  var targetUser = userId || planSelectedUser;
  var entryType = defaultEntryType || 'shift';
  var modelOpts = allModels.map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');

  var formHtml = '<div id="plan-shift-form-inline" style="padding:16px;background:var(--bg2);border:1px solid var(--accent);border-radius:12px;margin-bottom:16px">'
    + '<input type="hidden" id="ps-user" value="' + targetUser + '">'
    // Toggle shift / tâche
    + '<div style="display:flex;gap:0;margin-bottom:14px">'
    + '<button id="ps-toggle-shift" onclick="toggleEntryType(\'shift\')" style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;border-radius:8px 0 0 8px;background:' + (entryType==='shift'?'var(--accent)':'var(--bg-elevated)') + ';color:' + (entryType==='shift'?'white':'var(--text-secondary)') + '">' + t('planning.shift_type') + '</button>'
    + '<button id="ps-toggle-task" onclick="toggleEntryType(\'task\')" style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;border-radius:0 8px 8px 0;background:' + (entryType==='task'?'var(--green)':'var(--bg-elevated)') + ';color:' + (entryType==='task'?'white':'var(--text-secondary)') + '">' + t('planning.planned_task') + '</button>'
    + '</div>'
    + '<input type="hidden" id="ps-entry-type" value="' + entryType + '">'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">Date</label><input type="date" id="ps-date" class="form-input" style="font-size:12px" value="' + (dateStr || fmtDate(new Date())) + '"></div>'
    // Shift fields
    + '<div id="ps-shift-fields" style="display:' + (entryType==='shift'?'contents':'none') + '">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.shift_select') + '</label><select id="ps-type" class="form-input" style="font-size:12px" onchange="onShiftTypeChange()">'
    + Object.entries(SHIFT_TYPES).map(function(e) { return '<option value="' + e[0] + '">' + getShiftLabel(e[1]) + (e[1].time ? ' (' + e[1].time + ')' : '') + '</option>'; }).join('')
    + '</select></div></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.start') + '</label><input type="time" id="ps-start" class="form-input" style="font-size:12px" value="' + (entryType==='task'?'18:00':'06:00') + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.end') + '</label><input type="time" id="ps-end" class="form-input" style="font-size:12px" value="' + (entryType==='task'?'19:00':'14:00') + '"></div>'
    // Task fields
    + '<div id="ps-task-fields" style="display:' + (entryType==='task'?'contents':'none') + '">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.priority') + '</label><select id="ps-priority" class="form-input" style="font-size:12px"><option value="normal">' + t('planning.normal') + '</option><option value="urgent">' + t('planning.urgent') + '</option></select></div></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.models_accounts') + '</label><select id="ps-models" class="form-input" style="font-size:12px" multiple size="2"><option value="">' + t('common.none') + '</option>' + modelOpts + '</select></div>'
    // Description (task) or Notes (shift)
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px" id="ps-desc-label">' + (entryType==='task'?t('planning.description_task'):t('common.notes')) + '</label><input type="text" id="ps-description" class="form-input" style="font-size:12px" placeholder="' + (entryType==='task'?t('planning.task_placeholder'):t('planning.notes_placeholder')) + '"></div>'
    + '</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary" style="font-size:12px" onclick="addPlanShift()">' + t('common.add') + '</button><button class="btn" style="font-size:12px;background:var(--bg-base);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById(\'plan-shift-form-inline\').remove()">' + t('common.cancel') + '</button></div>'
    + '</div>';

  var detail = document.getElementById('planning-detail');
  if (detail) detail.insertAdjacentHTML('afterbegin', formHtml);
  if (entryType === 'shift') onShiftTypeChange();
}

function toggleEntryType(type) {
  document.getElementById('ps-entry-type').value = type;
  document.getElementById('ps-toggle-shift').style.background = type==='shift' ? 'var(--accent)' : 'var(--bg-elevated)';
  document.getElementById('ps-toggle-shift').style.color = type==='shift' ? 'white' : 'var(--text-secondary)';
  document.getElementById('ps-toggle-task').style.background = type==='task' ? 'var(--green)' : 'var(--bg-elevated)';
  document.getElementById('ps-toggle-task').style.color = type==='task' ? 'white' : 'var(--text-secondary)';
  document.getElementById('ps-shift-fields').style.display = type==='shift' ? 'contents' : 'none';
  document.getElementById('ps-task-fields').style.display = type==='task' ? 'contents' : 'none';
  document.getElementById('ps-desc-label').textContent = type==='task' ? t('planning.description_task') : t('common.notes');
  document.getElementById('ps-description').placeholder = type==='task' ? t('planning.task_placeholder') : t('planning.notes_placeholder');
  if (type === 'task') { document.getElementById('ps-start').value = '18:00'; document.getElementById('ps-end').value = '19:00'; }
  else onShiftTypeChange();
}

function onShiftTypeChange() {
  var type = document.getElementById('ps-type')?.value;
  var st = SHIFT_TYPES[type];
  if (st && st.start) { document.getElementById('ps-start').value = st.start; document.getElementById('ps-end').value = st.end; }
}

function quickAddShift(userId, dateStr) { showPlanShiftForm(userId, dateStr); }
function quickAddTask(userId, dateStr) { showPlanShiftForm(userId, dateStr, 'task'); }

async function addPlanShift() {
  var userId = document.getElementById('ps-user')?.value;
  var entryType = document.getElementById('ps-entry-type')?.value || 'shift';
  var modelSel = document.getElementById('ps-models');
  var modelIds = modelSel ? Array.from(modelSel.selectedOptions).map(function(o) { return o.value; }).filter(Boolean) : [];
  var desc = document.getElementById('ps-description')?.value?.trim() || '';

  var res = await fetch('/api/planning-shifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({
      shift_date: document.getElementById('ps-date').value,
      shift_type: entryType === 'task' ? 'custom' : document.getElementById('ps-type').value,
      start_time: document.getElementById('ps-start').value,
      end_time: document.getElementById('ps-end').value,
      model_ids: modelIds,
      notes: entryType === 'shift' ? desc : null,
      description: entryType === 'task' ? desc : null,
      entry_type: entryType,
      priority: document.getElementById('ps-priority')?.value || 'normal',
      user_id: userId ? parseInt(userId) : undefined
    })
  });
  if (res.ok) { showToast(entryType === 'task' ? t('planning.task_added_planning') : t('planning.shift_added'), 'success'); var f = document.getElementById('plan-shift-form-inline'); if (f) f.remove(); renderPlanDetail(); }
  else { var e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
}

async function editPlanShift(id) {
  var s = planShifts.find(function(x) { return x.id === id; });
  if (!s) return;
  if (!isAdmin() && s.user_id !== currentUser.id) return showToast(t('toast.cannot_edit_others_shifts'), 'error');

  var newType = prompt(t('planning.edit_shift_prompt'), s.shift_type);
  if (newType === null) return;
  var newStart = s.start_time, newEnd = s.end_time;
  if (newType === 'custom') {
    newStart = prompt(t('planning.start_time_prompt'), s.start_time || '');
    newEnd = prompt(t('planning.end_time_prompt'), s.end_time || '');
  } else {
    var st = SHIFT_TYPES[newType];
    if (st) { newStart = st.start; newEnd = st.end; }
  }

  await fetch('/api/planning-shifts/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ shift_type: newType, start_time: newStart, end_time: newEnd })
  });
  showToast(t('planning.shift_modified'), 'success');
  renderPlanning();
}

async function deletePlanShift(id) {
  if (!(await confirmDelete(t('confirm.delete_shift')))) return;
  await fetch('/api/planning-shifts/' + id, { method: 'DELETE', credentials: 'include' });
  showToast(t('planning.shift_deleted'), 'success');
  renderPlanning();
}

// ---- Leave requests ----
function showLeaveRequestForm() {
  var wrap = document.getElementById('plan-leave-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:16px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--yellow)">' + t('planning.leave_request_title') + '</h3>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">'
    + '<div><label style="font-size:12px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.from') + '</label><input type="date" id="lr-start" class="form-input" style="font-size:12px"></div>'
    + '<div><label style="font-size:12px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.to') + '</label><input type="date" id="lr-end" class="form-input" style="font-size:12px"></div>'
    + '<div style="flex:1"><label style="font-size:12px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('planning.reason') + '</label><input type="text" id="lr-reason" class="form-input" style="font-size:12px"></div>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="submitLeaveRequest()">' + t('common.send') + '</button>'
    + '</div></div>';
}

async function submitLeaveRequest() {
  var res = await fetch('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ start_date: document.getElementById('lr-start').value, end_date: document.getElementById('lr-end').value, reason: document.getElementById('lr-reason').value.trim() })
  });
  if (res.ok) { showToast(t('planning.request_sent'), 'success'); document.getElementById('plan-leave-form-wrap').innerHTML = ''; renderPlanning(); }
  else { var e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
}

function renderPlanLeaves() {
  var container = document.getElementById('planning-leaves');
  if (!container) return;
  var pending = planLeaves.filter(function(l) { return l.status === 'pending'; });
  if (pending.length === 0 && !isAdmin()) { container.innerHTML = ''; return; }

  container.innerHTML = '<div class="panel" style="padding:20px;margin-top:16px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--yellow)">' + t('planning.leave_requests') + (pending.length > 0 ? ' <span style="background:var(--red);color:white;font-size:10px;padding:2px 8px;border-radius:10px">' + pending.length + '</span>' : '') + '</h3>'
    + '<div style="display:grid;gap:8px">'
    + planLeaves.map(function(l) {
      var stColor = l.status === 'pending' ? 'var(--yellow)' : l.status === 'accepted' ? 'var(--green)' : 'var(--red)';
      var stLabel = l.status === 'pending' ? t('planning.pending') : l.status === 'accepted' ? t('planning.accepted') : t('planning.refused');
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-base);border-radius:8px;border-left:3px solid ' + stColor + '">'
        + '<strong style="font-size:13px;min-width:100px">' + l.user_name + '</strong>'
        + '<span style="font-size:12px;color:var(--text-secondary)">' + l.start_date.slice(0,10) + ' → ' + l.end_date.slice(0,10) + '</span>'
        + (l.reason ? '<span style="font-size:11px;color:var(--text-tertiary);flex:1">' + l.reason + '</span>' : '<span style="flex:1"></span>')
        + (isAdmin() && l.status === 'pending'
          ? '<button class="btn" style="font-size:11px;padding:4px 10px;background:var(--green-bg);color:var(--green);border:none;cursor:pointer;border-radius:6px" onclick="handleLeave(' + l.id + ',\'accepted\')">' + t('planning.accept') + '</button>'
            + '<button class="btn" style="font-size:11px;padding:4px 10px;background:var(--red-bg);color:var(--red);border:none;cursor:pointer;border-radius:6px" onclick="handleLeave(' + l.id + ',\'refused\')">' + t('planning.refuse') + '</button>'
          : '<span style="font-size:11px;font-weight:600;color:' + stColor + '">' + stLabel + '</span>')
        + '</div>';
    }).join('')
    + '</div></div>';
}

async function handleLeave(id, status) {
  await fetch('/api/leave-requests/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: status }) });
  showToast(status === 'accepted' ? t('planning.leave_accepted_toast') : t('planning.leave_refused_toast'), 'success');
  renderPlanning();
}

// ---- Stats recap ----
async function renderPlanStats(start, end) {
  if (!isAdmin()) return;
  var container = document.getElementById('planning-stats');
  if (!container) return;

  var mon = getMonday(planDate);
  var sun = new Date(mon); sun.setDate(sun.getDate()+6);
  var weekStart = fmtDate(mon);
  var weekEnd = fmtDate(sun);
  var monthStart = new Date(planDate.getFullYear(), planDate.getMonth(), 1);
  var monthEnd = new Date(planDate.getFullYear(), planDate.getMonth()+1, 0);

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [weekStats, monthStats] = await Promise.all([
    f('/api/planning-stats?start=' + weekStart + '&end=' + weekEnd),
    f('/api/planning-stats?start=' + fmtDate(monthStart) + '&end=' + fmtDate(monthEnd))
  ]);

  container.innerHTML = '<div class="panel" style="padding:20px;margin-top:16px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('planning.hours_recap') + '</h3>'
    + '<div class="grid-2col" style="gap:16px">'
    // Semaine
    + '<div><h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">' + t('planning.this_week_label') + '</h4>'
    + '<table class="table mobile-cards" style="margin:0"><thead><tr><th>' + t('common.name') + '</th><th>' + t('planning.planned') + '</th><th>' + t('planning.actual') + '</th></tr></thead><tbody>'
    + weekStats.map(function(s) {
      var planned = parseFloat(s.planned_hours);
      var actual = parseFloat(s.actual_hours);
      var diffColor = actual >= planned ? 'var(--green)' : 'var(--red)';
      return '<tr><td data-label="" class="mc-title"><strong>' + s.user_name + '</strong></td>'
        + '<td data-label="' + t('planning.planned') + '" class="mc-half">' + planned.toFixed(0) + 'h</td>'
        + '<td data-label="' + t('planning.actual') + '" class="mc-half" style="color:' + diffColor + '">' + actual.toFixed(1) + 'h</td></tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary)">' + t('planning.no_data') + '</td></tr>'
    + '</tbody></table></div>'
    // Mois
    + '<div><h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">' + t('planning.this_month_label') + ' (' + planDate.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{month:'long'}) + ')</h4>'
    + '<table class="table mobile-cards" style="margin:0"><thead><tr><th>' + t('planning.member') + '</th><th>' + t('planning.planned') + '</th><th>' + t('planning.actual') + '</th></tr></thead><tbody>'
    + monthStats.map(function(s) {
      var planned = parseFloat(s.planned_hours);
      var actual = parseFloat(s.actual_hours);
      var diffColor = actual >= planned ? 'var(--green)' : 'var(--red)';
      return '<tr><td data-label="" class="mc-title"><strong>' + s.user_name + '</strong></td>'
        + '<td data-label="' + t('planning.planned') + '" class="mc-half">' + planned.toFixed(0) + 'h</td>'
        + '<td data-label="' + t('planning.actual') + '" class="mc-half" style="color:' + diffColor + '">' + actual.toFixed(1) + 'h</td></tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary)">' + t('planning.no_data') + '</td></tr>'
    + '</tbody></table></div>'
    + '</div></div>';
}


// ========== VUE « TOUT LE MONDE » : équipe + modèles dans un seul planning ==========
var planAllHidden = {};        // personnes masquées : 'u12' / 'm3'
var planAllFilter = 'all';     // all | team | models
try { planAllHidden = JSON.parse(localStorage.getItem('planAllHidden') || '{}') || {}; planAllFilter = localStorage.getItem('planAllFilter') || 'all'; } catch (e) {}
function planAllSave() { try { localStorage.setItem('planAllHidden', JSON.stringify(planAllHidden)); localStorage.setItem('planAllFilter', planAllFilter); } catch (e) {} }
function planAllToggle(key) { planAllHidden[key] = !planAllHidden[key]; planAllSave(); renderPlanDetail(); }
function planAllSetFilter(f) { planAllFilter = f; planAllSave(); renderPlanDetail(); }
function planAllEsc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function planLocalDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// ouvre la fiche de la modèle directement sur son onglet Planning
function planOpenModel(id) {
  if (typeof openModelCockpit !== 'function') return;
  openModelCockpit(id);
  var n = 0, iv = setInterval(function() {
    var b = document.querySelector('#cockpit-content .tab[onclick*="\'schedule\'"]');
    if (b) { clearInterval(iv); b.click(); } else if (++n > 40) clearInterval(iv);
  }, 150);
}
function planAllAvatar(name, photo, color, size) {
  size = size || 20;
  return photo
    ? '<img src="' + planAllEsc(photo) + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex-shrink:0">'
    : '<span style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:' + Math.round(size * 0.5) + 'px;font-weight:700;flex-shrink:0">' + planAllEsc((name || '?').charAt(0).toUpperCase()) + '</span>';
}

async function renderPlanAll(container) {
  var mon = getMonday(planDate);
  var sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  var start = planLocalDate(mon), end = planLocalDate(sun);
  var lang = i18n.getLang() === 'en' ? 'en-US' : 'fr-FR';
  document.getElementById('planning-subtitle').textContent = 'Tout le monde — semaine du ' + fmtDateFR(mon) + ' au ' + fmtDateFR(sun);
  container.innerHTML = '<div class="panel" style="padding:20px;color:var(--text-tertiary)">Chargement…</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }); };
  var res = await Promise.all([
    f('/api/planning-shifts?start=' + start + '&end=' + end),
    f('/api/model-schedule-all?start=' + start + '&end=' + end),
    f('/api/leave-requests')
  ]);
  if (planSelectedUser !== 'all') return;
  var shifts = res[0], modelRows = res[1], leaves = res[2];

  // toutes les entrées, au même format
  var items = [];
  shifts.forEach(function(s) {
    var u = allUsers.find(function(x) { return x.id === s.user_id; }) || { display_name: s.user_name, role: s.user_role };
    var isTask = s.entry_type === 'task';
    var st = SHIFT_TYPES[s.shift_type] || SHIFT_TYPES.custom;
    items.push({
      key: 'u' + s.user_id, kind: 'team', day: String(s.shift_date).slice(0, 10), time: s.start_time || '',
      timeLabel: s.start_time ? s.start_time + (s.end_time ? '–' + s.end_time : '') : '',
      who: u.display_name || '?', photo: u.avatar_url, color: ROLE_COLORS[u.role] || '#52525B',
      label: isTask ? (s.description || s.notes || 'Tâche') : (s.shift_type === 'off' ? 'OFF' : getShiftLabel(st)),
      tag: isTask ? (s.priority === 'urgent' ? 'Urgent' : 'Tâche') : 'Shift', tagColor: isTask ? (s.priority === 'urgent' ? 'var(--red)' : 'var(--green)') : st.color,
      onclick: 'selectPlanMember(' + s.user_id + ')'
    });
  });
  modelRows.forEach(function(e) {
    var m = allModels.find(function(x) { return x.id === e.model_id; }) || { name: e.model_name };
    items.push({
      key: 'm' + e.model_id, kind: 'models', day: e.day_date, time: e.time_slot || '',
      timeLabel: e.time_slot || '', who: m.name || e.model_name, photo: typeof modelPhoto === 'function' ? modelPhoto(m) : '',
      color: typeof modelColor === 'function' ? modelColor(e.model_id, m.name) : (e.color || '#22D3EE'),
      label: e.title, tag: 'Modèle', tagColor: e.color || '#22D3EE',
      onclick: 'planOpenModel(' + e.model_id + ')'
    });
  });
  // congés acceptés
  leaves.filter(function(l) { return l.status === 'accepted'; }).forEach(function(l) {
    var u = allUsers.find(function(x) { return x.id === l.user_id; });
    if (!u) return;
    var d = new Date(String(l.start_date).slice(0, 10) + 'T12:00:00'), e = new Date(String(l.end_date).slice(0, 10) + 'T12:00:00');
    for (; d <= e; d.setDate(d.getDate() + 1)) {
      var dk = planLocalDate(d);
      if (dk < start || dk > end) continue;
      items.push({ key: 'u' + u.id, kind: 'team', day: dk, time: '', timeLabel: '', who: u.display_name, photo: u.avatar_url, color: ROLE_COLORS[u.role] || '#52525B',
        label: t('planning.leave'), tag: 'Congé', tagColor: 'var(--red)', onclick: 'selectPlanMember(' + u.id + ')' });
    }
  });

  // personnes présentes cette semaine (pour les filtres)
  var people = {};
  items.forEach(function(it) { if (!people[it.key]) people[it.key] = { key: it.key, kind: it.kind, who: it.who, photo: it.photo, color: it.color, n: 0 }; people[it.key].n++; });
  var plist = Object.keys(people).map(function(k) { return people[k]; }).sort(function(a, b) { return a.kind === b.kind ? a.who.localeCompare(b.who) : a.kind === 'team' ? -1 : 1; });

  var shown = items.filter(function(it) { return !planAllHidden[it.key] && (planAllFilter === 'all' || planAllFilter === it.kind); });
  var byDay = {};
  shown.forEach(function(it) { (byDay[it.day] = byDay[it.day] || []).push(it); });

  var chip = function(f, label) {
    var on = planAllFilter === f;
    return '<button onclick="planAllSetFilter(\'' + f + '\')" style="padding:6px 12px;border-radius:999px;border:1px solid ' + (on ? 'var(--accent)' : 'var(--border)') + ';background:' + (on ? 'rgba(59,130,246,0.15)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text-secondary)') + ';font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">' + label + '</button>';
  };
  var html = '<div class="panel" style="padding:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
    + '<div style="display:flex;gap:6px;align-items:center">'
    + '<button onclick="planNavigate(-1)" style="padding:8px 14px;background:var(--bg-base);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">‹</button>'
    + '<button onclick="planNavigateToday()" style="padding:8px 12px;background:var(--bg-base);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:12px;font-weight:600;font-family:inherit">Aujourd\'hui</button>'
    + '<button onclick="planNavigate(1)" style="padding:8px 14px;background:var(--bg-base);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">›</button>'
    + '<span style="font-size:15px;font-weight:700;margin-left:8px">' + mon.toLocaleDateString(lang, { day: 'numeric', month: 'long' }) + ' — ' + sun.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) + '</span></div>'
    + '<div style="display:flex;gap:6px">' + chip('all', 'Tout') + chip('team', 'Équipe') + chip('models', 'Modèles') + '</div></div>';

  // personnes : clic = masquer / afficher
  if (plist.length) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">' + plist.filter(function(p) { return planAllFilter === 'all' || planAllFilter === p.kind; }).map(function(p) {
      var off = planAllHidden[p.key];
      return '<button onclick="planAllToggle(\'' + p.key + '\')" title="' + (off ? 'Afficher' : 'Masquer') + '" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:999px;border:1px solid ' + (off ? 'var(--border)' : p.color) + ';background:transparent;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit;opacity:' + (off ? '0.4' : '1') + (off ? ';text-decoration:line-through' : '') + '">'
        + planAllAvatar(p.who, p.photo, p.color, 20) + planAllEsc(p.who) + '</button>';
    }).join('') + '</div>';
  }

  // grille : une colonne par jour, entrées triées par heure
  var today = planLocalDate(new Date());
  html += '<div style="overflow-x:auto"><div style="display:grid;grid-template-columns:repeat(7,minmax(108px,1fr));gap:6px;min-width:780px">';
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon); d.setDate(d.getDate() + i);
    var dk = planLocalDate(d), isToday = dk === today;
    var list = (byDay[dk] || []).sort(function(a, b) { return (a.time || '').localeCompare(b.time || '') || a.who.localeCompare(b.who); });
    html += '<div style="background:' + (isToday ? 'rgba(59,130,246,0.08)' : 'var(--bg-elevated)') + ';border:1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + ';border-radius:12px;padding:8px 6px;min-height:160px">'
      + '<div style="text-align:center;margin-bottom:10px"><div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:' + (isToday ? 'var(--accent)' : 'var(--text-tertiary)') + '">' + d.toLocaleDateString(lang, { weekday: 'long' }) + '</div>'
      + '<div style="font-size:13px;font-weight:700;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + '">' + d.toLocaleDateString(lang, { day: 'numeric', month: 'short' }) + '</div></div>';
    if (!list.length) html += '<div style="font-size:11px;color:var(--text-tertiary);text-align:center;font-style:italic">Rien de prévu</div>';
    list.forEach(function(it) {
      html += '<div ' + (it.onclick ? 'onclick="' + it.onclick + '" ' : '') + 'style="padding:6px 7px;margin-bottom:6px;border-radius:8px;background:var(--bg);border-left:3px solid ' + it.color + ';cursor:' + (it.onclick ? 'pointer' : 'default') + '">'
        + '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;min-width:0">' + planAllAvatar(it.who, it.photo, it.color, 18)
        + '<span style="font-size:11px;font-weight:700;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + planAllEsc(it.who) + '</span></div>'
        + (it.timeLabel ? '<div style="font-size:11px;font-weight:700;color:' + it.color + ';margin-bottom:1px">' + planAllEsc(it.timeLabel) + '</div>' : '')
        + '<div style="font-size:12px;color:var(--text);line-height:1.3;word-break:break-word">' + planAllEsc(it.label) + '</div>'
        + '<span style="display:inline-block;margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:5px;color:' + it.tagColor + ';border:1px solid ' + it.tagColor + '">' + it.tag + '</span>'
        + '</div>';
    });
    html += '</div>';
  }
  html += '</div></div>'
    + '<div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">' + shown.length + ' élément' + (shown.length > 1 ? 's' : '') + ' cette semaine · clique sur une personne pour la masquer, sur un créneau pour ouvrir son planning</div>'
    + '</div>';
  container.innerHTML = html;
}
