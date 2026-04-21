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
  'night':     { labelKey: 'planning.night', time: '22h-06h', start: '22:00', end: '06:00', color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  'off':       { labelKey: null, label: 'Off', time: '', start: null, end: null, color: '#6B5A84', bg: 'rgba(107,107,128,0.12)' },
  'custom':    { labelKey: null, label: 'Custom', time: '', start: null, end: null, color: '#A855F7', bg: 'rgba(168,85,247,0.12)' }
};
// Get shift label dynamically (t() not available at load time)
function getShiftLabel(st) { return st.labelKey ? t(st.labelKey) : (st.label || ''); }

var ROLE_COLORS = { chatter: '#3b82f6', outreach: '#10b981', va: '#f59e0b', admin: '#ec4899', student: '#06B6D4', model: '#6B5A84' };
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
    planSelectedUser = currentUser.id;
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

  container.innerHTML = '<div class="panel" style="padding:0;overflow:hidden">'
    + members.map(function(u) {
      var rc = ROLE_COLORS[u.role] || '#6B5A84';
      var rbg = ROLE_BG[u.role] || 'var(--bg3)';
      var selected = planSelectedUser === u.id;
      var online = typeof isUserOnline === 'function' && isUserOnline(u.id);
      var av = u.avatar_url
        ? '<img src="' + u.avatar_url + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">'
        : '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,' + rc + ',var(--pink));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white;flex-shrink:0">' + (u.display_name||'?').charAt(0) + '</div>';
      return '<div onclick="selectPlanMember(' + u.id + ')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-left:3px solid ' + (selected ? rc : 'transparent') + ';background:' + (selected ? rbg : 'transparent') + ';transition:all 0.15s">'
        + '<div style="position:relative">' + av + (online ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span>' : '') + '</div>'
        + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:' + (selected?'700':'500') + ';color:' + (selected?'var(--text)':'var(--text2)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + u.display_name + '</div>'
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

  var mon = getMonday(planDate);
  var sun = new Date(mon); sun.setDate(sun.getDate()+6);
  var start = fmtDate(mon);
  var end = fmtDate(sun);

  var user = allUsers.find(function(u) { return u.id === planSelectedUser; });
  var userName = user ? user.display_name : '';
  var userRole = user ? user.role : '';
  var rc = ROLE_COLORS[userRole] || '#6B5A84';

  document.getElementById('planning-subtitle').textContent = userName + ' — Semaine du ' + fmtDateFR(mon) + ' au ' + fmtDateFR(sun);

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
    + '<button onclick="planNavigate(-1)" style="padding:8px 14px;background:var(--bg3);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">‹</button>'
    + '<div style="text-align:center"><div style="font-size:15px;font-weight:700">' + mon.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{day:'numeric',month:'long'}) + ' — ' + sun.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{day:'numeric',month:'long',year:'numeric'}) + '</div></div>'
    + '<button onclick="planNavigate(1)" style="padding:8px 14px;background:var(--bg3);color:var(--text);border:none;cursor:pointer;border-radius:8px;font-size:16px;font-family:inherit">›</button>'
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

    html += '<div style="background:' + (isToday ? 'rgba(168,85,247,0.08)' : 'var(--bg3)') + ';border-radius:12px;padding:14px 18px;border:1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:' + (dayShifts.length > 0 || isLeave ? '10px' : '0') + '">'
      + '<div style="font-size:14px;font-weight:600;text-transform:capitalize;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + '">' + dayLabel + (isToday ? ' <span style="font-size:11px;background:var(--accent);color:white;padding:2px 8px;border-radius:10px;margin-left:6px">Aujourd\'hui</span>' : '') + '</div>'
      + '<div style="display:flex;gap:6px">'
      + '<button onclick="quickAddShift(' + planSelectedUser + ',\'' + dk + '\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;font-weight:600">+ Shift</button>'
      + (isAdmin() ? '<button onclick="quickAddTask(' + planSelectedUser + ',\'' + dk + '\')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:12px;font-weight:600">+ Tâche</button>' : '')
      + '</div></div>';

    if (isLeave) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--red-bg);border-radius:8px;color:var(--red);font-weight:600;font-size:13px">Congé</div>';
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
            + (modelNames.length > 0 ? '<div style="display:flex;gap:4px;flex-wrap:wrap">' + modelNames.map(function(n) { return '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg3);color:var(--text2)">' + n + '</span>'; }).join('') + '</div>' : '')
            + (s.notes ? '<div style="font-size:11px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.notes + '</div>' : '<div style="flex:1"></div>')
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
            + (s.end_time && s.start_time ? '<div style="font-size:10px;color:var(--text3)">' + s.end_time + '</div>' : '')
            + '</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:13px;font-weight:600;color:var(--text)">' + desc + '</div>'
            + '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">'
            + (isUrgent ? '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--red-bg);color:var(--red);font-weight:600">URGENT</span>' : '')
            + modelNames.map(function(n) { return '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg3);color:var(--text2)">' + n + '</span>'; }).join('')
            + '</div></div>'
            + '<button onclick="deletePlanShift(' + s.id + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:4px;flex-shrink:0">✕</button>'
            + '</div>';
        });
      }

      if (dayShifts.length === 0) {
        html += '<div style="color:var(--text3);font-size:12px;font-style:italic">Aucun shift ou tâche</div>';
      }
    }
    html += '</div>';
  });

  html += '</div>'
    // Weekly summary bar
    + '<div style="margin-top:16px;padding:14px 18px;background:var(--bg3);border-radius:10px;display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:13px;color:var(--text2)">Total semaine</span>'
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
    + '<button id="ps-toggle-shift" onclick="toggleEntryType(\'shift\')" style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;border-radius:8px 0 0 8px;background:' + (entryType==='shift'?'var(--accent)':'var(--bg3)') + ';color:' + (entryType==='shift'?'white':'var(--text2)') + '">Shift (horaire de travail)</button>'
    + '<button id="ps-toggle-task" onclick="toggleEntryType(\'task\')" style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;border-radius:0 8px 8px 0;background:' + (entryType==='task'?'var(--green)':'var(--bg3)') + ';color:' + (entryType==='task'?'white':'var(--text2)') + '">Tâche planifiée</button>'
    + '</div>'
    + '<input type="hidden" id="ps-entry-type" value="' + entryType + '">'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Date</label><input type="date" id="ps-date" class="form-input" style="font-size:12px" value="' + (dateStr || fmtDate(new Date())) + '"></div>'
    // Shift fields
    + '<div id="ps-shift-fields" style="display:' + (entryType==='shift'?'contents':'none') + '">'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Type de shift</label><select id="ps-type" class="form-input" style="font-size:12px" onchange="onShiftTypeChange()">'
    + Object.entries(SHIFT_TYPES).map(function(e) { return '<option value="' + e[0] + '">' + getShiftLabel(e[1]) + (e[1].time ? ' (' + e[1].time + ')' : '') + '</option>'; }).join('')
    + '</select></div></div>'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Début</label><input type="time" id="ps-start" class="form-input" style="font-size:12px" value="' + (entryType==='task'?'18:00':'06:00') + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Fin</label><input type="time" id="ps-end" class="form-input" style="font-size:12px" value="' + (entryType==='task'?'19:00':'14:00') + '"></div>'
    // Task fields
    + '<div id="ps-task-fields" style="display:' + (entryType==='task'?'contents':'none') + '">'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Priorité</label><select id="ps-priority" class="form-input" style="font-size:12px"><option value="normal">Normale</option><option value="urgent">Urgente</option></select></div></div>'
    + '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Modèle(s) / Compte(s)</label><select id="ps-models" class="form-input" style="font-size:12px" multiple size="2"><option value="">Aucun</option>' + modelOpts + '</select></div>'
    // Description (task) or Notes (shift)
    + '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px" id="ps-desc-label">' + (entryType==='task'?t('planning.description_task'):t('common.notes')) + '</label><input type="text" id="ps-description" class="form-input" style="font-size:12px" placeholder="' + (entryType==='task'?'Ex: Envoyer 40 DMs sur @btfavmenace':'Notes...') + '"></div>'
    + '</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary" style="font-size:12px" onclick="addPlanShift()">' + t('common.add') + '</button><button class="btn" style="font-size:12px;background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'plan-shift-form-inline\').remove()">' + t('common.cancel') + '</button></div>'
    + '</div>';

  var detail = document.getElementById('planning-detail');
  if (detail) detail.insertAdjacentHTML('afterbegin', formHtml);
  if (entryType === 'shift') onShiftTypeChange();
}

function toggleEntryType(type) {
  document.getElementById('ps-entry-type').value = type;
  document.getElementById('ps-toggle-shift').style.background = type==='shift' ? 'var(--accent)' : 'var(--bg3)';
  document.getElementById('ps-toggle-shift').style.color = type==='shift' ? 'white' : 'var(--text2)';
  document.getElementById('ps-toggle-task').style.background = type==='task' ? 'var(--green)' : 'var(--bg3)';
  document.getElementById('ps-toggle-task').style.color = type==='task' ? 'white' : 'var(--text2)';
  document.getElementById('ps-shift-fields').style.display = type==='shift' ? 'contents' : 'none';
  document.getElementById('ps-task-fields').style.display = type==='task' ? 'contents' : 'none';
  document.getElementById('ps-desc-label').textContent = type==='task' ? t('planning.description_task') : t('common.notes');
  document.getElementById('ps-description').placeholder = type==='task' ? 'Ex: Envoyer 40 DMs sur @btfavmenace' : 'Notes...';
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
  else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

async function editPlanShift(id) {
  var s = planShifts.find(function(x) { return x.id === id; });
  if (!s) return;
  if (!isAdmin() && s.user_id !== currentUser.id) return showToast(t('toast.cannot_edit_others_shifts'), 'error');

  var newType = prompt('Type de shift (morning/afternoon/night/off/custom) :', s.shift_type);
  if (newType === null) return;
  var newStart = s.start_time, newEnd = s.end_time;
  if (newType === 'custom') {
    newStart = prompt('Heure début (HH:MM) :', s.start_time || '');
    newEnd = prompt('Heure fin (HH:MM) :', s.end_time || '');
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
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--yellow)">Demande de congé</h3>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">'
    + '<div><label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Du</label><input type="date" id="lr-start" class="form-input" style="font-size:12px"></div>'
    + '<div><label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Au</label><input type="date" id="lr-end" class="form-input" style="font-size:12px"></div>'
    + '<div style="flex:1"><label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Motif</label><input type="text" id="lr-reason" class="form-input" style="font-size:12px" placeholder="Raison..."></div>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="submitLeaveRequest()">Envoyer</button>'
    + '</div></div>';
}

async function submitLeaveRequest() {
  var res = await fetch('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ start_date: document.getElementById('lr-start').value, end_date: document.getElementById('lr-end').value, reason: document.getElementById('lr-reason').value.trim() })
  });
  if (res.ok) { showToast(t('planning.request_sent'), 'success'); document.getElementById('plan-leave-form-wrap').innerHTML = ''; renderPlanning(); }
  else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

function renderPlanLeaves() {
  var container = document.getElementById('planning-leaves');
  if (!container) return;
  var pending = planLeaves.filter(function(l) { return l.status === 'pending'; });
  if (pending.length === 0 && !isAdmin()) { container.innerHTML = ''; return; }

  container.innerHTML = '<div class="panel" style="padding:20px;margin-top:16px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--yellow)">Demandes de congé' + (pending.length > 0 ? ' <span style="background:var(--red);color:white;font-size:10px;padding:2px 8px;border-radius:10px">' + pending.length + '</span>' : '') + '</h3>'
    + '<div style="display:grid;gap:8px">'
    + planLeaves.map(function(l) {
      var stColor = l.status === 'pending' ? 'var(--yellow)' : l.status === 'accepted' ? 'var(--green)' : 'var(--red)';
      var stLabel = l.status === 'pending' ? t('planning.pending') : l.status === 'accepted' ? t('planning.accepted') : t('planning.refused');
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg3);border-radius:8px;border-left:3px solid ' + stColor + '">'
        + '<strong style="font-size:13px;min-width:100px">' + l.user_name + '</strong>'
        + '<span style="font-size:12px;color:var(--text2)">' + l.start_date.slice(0,10) + ' → ' + l.end_date.slice(0,10) + '</span>'
        + (l.reason ? '<span style="font-size:11px;color:var(--text3);flex:1">' + l.reason + '</span>' : '<span style="flex:1"></span>')
        + (isAdmin() && l.status === 'pending'
          ? '<button class="btn" style="font-size:11px;padding:4px 10px;background:var(--green-bg);color:var(--green);border:none;cursor:pointer;border-radius:6px" onclick="handleLeave(' + l.id + ',\'accepted\')">Accepter</button>'
            + '<button class="btn" style="font-size:11px;padding:4px 10px;background:var(--red-bg);color:var(--red);border:none;cursor:pointer;border-radius:6px" onclick="handleLeave(' + l.id + ',\'refused\')">Refuser</button>'
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
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Récapitulatif heures</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'
    // Semaine
    + '<div><h4 style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:10px">Cette semaine</h4>'
    + '<table class="table mobile-cards" style="margin:0"><thead><tr><th>Membre</th><th>Planifié</th><th>Réel</th></tr></thead><tbody>'
    + weekStats.map(function(s) {
      var planned = parseFloat(s.planned_hours);
      var actual = parseFloat(s.actual_hours);
      var diffColor = actual >= planned ? 'var(--green)' : 'var(--red)';
      return '<tr><td data-label="" class="mc-title"><strong>' + s.user_name + '</strong></td>'
        + '<td data-label="Planifié" class="mc-half">' + planned.toFixed(0) + 'h</td>'
        + '<td data-label="Réel" class="mc-half" style="color:' + diffColor + '">' + actual.toFixed(1) + 'h</td></tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3)">Aucune donnée</td></tr>'
    + '</tbody></table></div>'
    // Mois
    + '<div><h4 style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:10px">Ce mois (' + planDate.toLocaleDateString(i18n.getLang() === 'en' ? 'en-US' : 'fr-FR',{month:'long'}) + ')</h4>'
    + '<table class="table mobile-cards" style="margin:0"><thead><tr><th>Membre</th><th>Planifié</th><th>Réel</th></tr></thead><tbody>'
    + monthStats.map(function(s) {
      var planned = parseFloat(s.planned_hours);
      var actual = parseFloat(s.actual_hours);
      var diffColor = actual >= planned ? 'var(--green)' : 'var(--red)';
      return '<tr><td data-label="" class="mc-title"><strong>' + s.user_name + '</strong></td>'
        + '<td data-label="Planifié" class="mc-half">' + planned.toFixed(0) + 'h</td>'
        + '<td data-label="Réel" class="mc-half" style="color:' + diffColor + '">' + actual.toFixed(1) + 'h</td></tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3)">Aucune donnée</td></tr>'
    + '</tbody></table></div>'
    + '</div></div>';
}
