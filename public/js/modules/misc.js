// MISC MODULE
// Extracted from dashboard.html

// ============ ACTIVITY LOG SECTION ============
let activityLogPage = 1;
let activityLogTotalPages = 1;

async function renderActivityLog(page) {
  if (!isAdmin()) return;
  var container = document.getElementById('activity-log-content');
  if (!container) return;
  if (page) activityLogPage = page;

  var res = await fetch('/api/activity-log?page=' + activityLogPage + '&limit=25', { credentials: 'include' });
  var result = res.ok ? await res.json() : { data: [], page: 1, totalPages: 1 };
  var logs = result.data;
  activityLogPage = result.page;
  activityLogTotalPages = result.totalPages;

  var actionLabels = {
    'lead-talking-warm': { label: 'Lead discussion chaude', color: 'var(--yellow)', icon: '🔥' },
    'lead-call-booked': { label: 'Lead call prévu', color: 'var(--accent)', icon: '📞' },
    'lead-signed': { label: 'Lead signé', color: 'var(--green)', icon: '✅' },
    'call-request': { label: 'Demande de call', color: 'var(--blue)', icon: '📞' },
    'clock-in': { label: 'Pointage entrée', color: 'var(--green)', icon: '🟢' },
    'clock-out': { label: 'Pointage sortie', color: 'var(--red)', icon: '🔴' },
    'inactive-chatter-alert': { label: 'Alerte chatter inactif', color: 'var(--yellow)', icon: '⚠️' }
  };

  container.innerHTML = '<div class="panel" style="padding:20px">'
    + '<div style="display:grid;gap:6px">'
    + logs.map(function(l) {
      var info = actionLabels[l.action] || { label: l.action, color: 'var(--text2)', icon: '📝' };
      var date = new Date(l.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border-radius:8px;font-size:13px">'
        + '<span style="font-size:16px">' + info.icon + '</span>'
        + '<span style="color:var(--text3);font-size:11px;min-width:80px">' + date + '</span>'
        + '<strong style="color:' + info.color + '">' + info.label + '</strong>'
        + '<span style="color:var(--text2)">' + (l.user_name || '?') + '</span>'
        + (l.details ? '<span style="color:var(--text3);font-size:12px">' + l.details + '</span>' : '')
        + '</div>';
    }).join('') || emptyStateHTML('clipboard', t('misc.no_activity'))
    + '</div>'
    + paginationHTML(activityLogPage, activityLogTotalPages, 'renderActivityLog')
    + '</div>';
}

// ============ SHIFT CLOCK (pour outreach/chatters) ============
async function renderShiftClock() {
  var statusRes = await fetch('/api/shift-clock/status', { credentials: 'include' });
  var status = statusRes.ok ? await statusRes.json() : { clocked_in: false };
  var clockBtn = document.getElementById('shift-clock-btn');
  if (!clockBtn) return;
  if (status.clocked_in) {
    var since = new Date(status.since).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    clockBtn.innerHTML = '<span style="color:var(--green);font-weight:700">En shift depuis ' + since + '</span> <button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer;font-size:11px;padding:4px 12px" onclick="clockOut()">Fin du shift</button>';
  } else {
    clockBtn.innerHTML = '<button class="btn btn-primary" style="font-size:12px;padding:6px 16px" onclick="clockIn()">Commencer mon shift</button>';
  }
}

async function clockIn() {
  var res = await fetch('/api/shift-clock/in', { method: 'POST', credentials: 'include' });
  if (res.ok) { showToast('Shift commencé !', 'success'); renderShiftClock(); }
  else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

async function clockOut() {
  var res = await fetch('/api/shift-clock/out', { method: 'POST', credentials: 'include' });
  if (res.ok) { var data = await res.json(); showToast('Shift terminé (' + data.duration + ' min)', 'success'); renderShiftClock(); }
  else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

// ============ ACCESS CONTROL ============
async function renderAccessControl() {
  var container = document.getElementById('access-control-content');
  if (!container) return;
  container.innerHTML = '<table class="table mobile-cards"><thead><tr><th>Nom</th><th>Rôle</th><th>Lecture seule</th><th>Expire le</th><th></th></tr></thead><tbody>'
    + allUsers.filter(function(u) { return u.role !== 'admin' && u.role !== 'super_admin' && u.role !== 'platform_admin'; }).map(function(u) {
      return '<tr><td data-label="" class="mc-title"><strong>' + u.display_name + '</strong></td>'
        + '<td data-label="Rôle" class="mc-half">' + u.role + '</td>'
        + '<td data-label="Lecture seule" class="mc-half"><input type="checkbox" ' + (u.read_only ? 'checked' : '') + ' onchange="updateUserAccess(' + u.id + ',{read_only:this.checked})" style="width:18px;height:18px;cursor:pointer"></td>'
        + '<td data-label="Expire le" class="mc-half"><input type="date" value="' + (u.expires_at ? u.expires_at.slice(0,10) : '') + '" onchange="updateUserAccess(' + u.id + ',{expires_at:this.value||null})" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;font-family:inherit"></td>'
        + '<td data-label=""></td></tr>';
    }).join('')
    + '</tbody></table>';
}

async function updateUserAccess(userId, data) {
  await fetch('/api/users/' + userId + '/access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  showToast('Accès mis à jour', 'success');
  await loadSettings();
}

// ============ SECTION SWITCHING ============