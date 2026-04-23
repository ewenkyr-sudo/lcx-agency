// VA DASHBOARD MODULE
// Complete VA (Virtual Assistant) dashboard with tasks, planning, stats

async function renderVA() {
  var container = document.getElementById('va-content');
  if (!container) return;

  var isVA = currentUser.role === 'va';
  var isAdm = isAdmin();

  if (isVA) {
    renderVADashboard(container);
  } else if (isAdm) {
    renderVAAdmin(container);
  }
}

async function renderVADashboard(container) {
  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [tasks, shiftStatus, conversations] = await Promise.all([
    f('/api/tasks'),
    f('/api/shift-clock/status'),
    f('/api/conversations')
  ]);

  var myTasks = tasks.filter(function(tk) { return tk.assigned_to_id === currentUser.id && tk.status !== 'completed'; });
  var completedTasks = tasks.filter(function(tk) { return tk.assigned_to_id === currentUser.id && tk.status === 'completed'; });
  var todayStr = new Date().toISOString().slice(0, 10);
  var todayTasks = myTasks.filter(function(tk) { return tk.deadline === todayStr || !tk.deadline; });

  // Clock status
  var clockedIn = shiftStatus && shiftStatus.clocked_in;
  var clockHTML = '';
  if (clockedIn) {
    var since = new Date(shiftStatus.since).toLocaleTimeString(window.currentLang === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
    clockHTML = '<div style="display:flex;align-items:center;gap:12px;padding:14px 20px;background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(34,211,238,0.05));border:1px solid var(--green);border-radius:12px">'
      + '<div style="width:12px;height:12px;border-radius:50%;background:var(--green);animation:pulse 2s infinite"></div>'
      + '<span style="font-size:14px;font-weight:600;color:var(--green)">' + t('va.on_shift_since') + ' ' + since + '</span>'
      + '<button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer;font-size:11px;padding:4px 14px;border-radius:8px;margin-left:auto" onclick="clockOut()">' + t('misc.clock_out') + '</button>'
      + '</div>';
  } else {
    clockHTML = '<button class="btn btn-primary" style="font-size:14px;padding:12px 28px;border-radius:12px" onclick="clockIn()">🟢 ' + t('va.start_working') + '</button>';
  }

  container.innerHTML = ''
    // Clock in/out
    + '<div style="margin-bottom:20px">' + clockHTML + '</div>'

    // KPIs
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--accent);font-size:28px">' + todayTasks.length + '</div><div class="stat-label">' + t('va.tasks_today') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:20px">' + myTasks.length + '</div><div class="stat-label">' + t('va.tasks_pending') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green);font-size:20px">' + completedTasks.length + '</div><div class="stat-label">' + t('va.tasks_completed') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:20px">' + (conversations.length || 0) + '</div><div class="stat-label">' + t('va.messages') + '</div></div>'
    + '</div>'

    // Today's tasks
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">📋 ' + t('va.tasks_today') + '</h3>'
    + (todayTasks.length > 0 ? '<div style="display:grid;gap:8px">' + todayTasks.map(function(tk) {
      var priorityColor = tk.priority === 'urgent' ? 'var(--red)' : 'var(--accent)';
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg3);border-radius:10px;border-left:3px solid ' + priorityColor + '">'
        + '<div style="flex:1"><strong style="font-size:13px">' + tk.title + '</strong>'
        + (tk.description ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + tk.description + '</div>' : '')
        + (tk.deadline ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">📅 ' + tk.deadline + '</div>' : '') + '</div>'
        + '<select onchange="updateTaskStatus(' + tk.id + ',this.value)" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit">'
        + '<option value="pending"' + (tk.status === 'pending' ? ' selected' : '') + '>' + t('tasks.pending_label') + '</option>'
        + '<option value="in_progress"' + (tk.status === 'in_progress' ? ' selected' : '') + '>' + t('tasks.in_progress_label') + '</option>'
        + '<option value="completed">' + t('tasks.completed_label') + '</option></select>'
        + '</div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:20px">' + t('va.no_tasks_today') + '</div>')
    + '</div>'

    // All pending tasks
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">📝 ' + t('va.all_tasks') + ' (' + myTasks.length + ')</h3>'
    + (myTasks.length > 0 ? '<div style="display:grid;gap:6px">' + myTasks.map(function(tk) {
      var priorityBadge = tk.priority === 'urgent' ? '<span style="background:var(--red);color:white;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:6px">URGENT</span>' : '';
      var statusBg = tk.status === 'in_progress' ? 'var(--yellow-bg)' : 'var(--bg3)';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:' + statusBg + ';border-radius:8px;font-size:13px">'
        + '<span>' + tk.title + priorityBadge + '</span>'
        + (tk.deadline ? '<span style="color:var(--text3);font-size:11px;margin-left:auto">📅 ' + tk.deadline + '</span>' : '')
        + '</div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:12px">' + t('tasks.no_tasks') + '</div>')
    + '</div>';
}

function renderVAAdmin(container) {
  var vas = (allTeam || []).filter(function(m) { return m.role === 'va'; });

  container.innerHTML = ''
    // VA list
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">' + t('va.team_title') + ' (' + vas.length + ')</h3>'
    + (vas.length > 0 ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + vas.map(function(v) {
      var online = isUserOnline(v.user_id);
      var av = v.avatar_url ? avatarHTML({ avatar_url: v.avatar_url, display_name: v.name }, 40) : avatarHTML({ display_name: v.name }, 40);
      return '<div style="background:var(--bg3);border-radius:12px;padding:16px;border-left:3px solid ' + (online ? 'var(--green)' : 'var(--text3)') + '">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
        + '<div style="position:relative">' + av + (online ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span>' : '') + '</div>'
        + '<div><strong style="font-size:14px">' + v.name + '</strong>'
        + '<div style="font-size:11px;color:' + (online ? 'var(--green)' : 'var(--text3)') + '">' + (online ? t('status.online') : t('status.offline')) + '</div></div>'
        + '<div style="margin-left:auto">' + (isAdmin() ? '<button class="btn-delete-small" onclick="deleteTeamMember(' + v.id + ')">✕</button>' : '') + '</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">'
        + '<div style="color:var(--text3)">' + t('team.shift_label') + ': <span style="color:var(--text)">' + (v.shift || 'N/A') + '</span></div>'
        + '<div style="color:var(--text3)">' + t('team.contact_label') + ': <span style="color:var(--text)">' + (v.contact || 'N/A') + '</span></div>'
        + '</div></div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:20px">' + t('va.no_va') + '</div>')
    + '</div>';
}
