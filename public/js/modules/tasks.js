let taskFilter = 'all';
let taskView = 'list';

function getTaskDeadlineState(deadline) {
  if (!deadline) return 'none';
  const now = new Date();
  const dl = new Date(deadline + 'T23:59:59');
  const diff = dl - now;
  if (diff < 0) return 'overdue';
  if (diff < 24 * 60 * 60 * 1000) return 'soon';
  return 'ok';
}

function renderTasks() {
  const container = document.getElementById('tasks-content');
  if (!container) return;

  // Badge nav
  const urgentOrOverdue = allTasks.filter(tk => tk.status !== 'completed' && (tk.priority === 'urgent' || getTaskDeadlineState(tk.deadline) === 'overdue'));
  const badge = document.getElementById('tasks-badge');
  if (badge) {
    if (urgentOrOverdue.length > 0) { badge.style.display = ''; badge.textContent = urgentOrOverdue.length; }
    else { badge.style.display = 'none'; }
  }

  // Filtrer
  let filtered = allTasks;
  if (taskFilter === 'mine') filtered = allTasks.filter(tk => tk.assigned_to_id === currentUser.id || tk.created_by === currentUser.id);
  else if (taskFilter === 'pending') filtered = allTasks.filter(tk => tk.status === 'pending');
  else if (taskFilter === 'in_progress') filtered = allTasks.filter(tk => tk.status === 'in_progress');
  else if (taskFilter === 'completed') filtered = allTasks.filter(tk => tk.status === 'completed');
  else if (taskFilter === 'urgent') filtered = allTasks.filter(tk => tk.priority === 'urgent' || getTaskDeadlineState(tk.deadline) === 'overdue');

  if (taskView === 'week') { renderTaskWeek(container, filtered); return; }

  // Vue liste
  container.innerHTML = filtered.length === 0 ? '<div class="panel">' + emptyStateHTML('clipboard', t('tasks.no_tasks'), t('common.new_task'), 'showTaskForm()') + '</div>' :
    '<div style="display:grid;gap:10px">' + filtered.map(function(tk) { return renderTaskCard(tk); }).join('') + '</div>';
}

function renderTaskCard(tk) {
  const dlState = getTaskDeadlineState(tk.deadline);
  const isUrgent = tk.priority === 'urgent';
  const borderColor = dlState === 'overdue' ? 'var(--red)' : dlState === 'soon' ? '#f59e0b' : isUrgent ? 'var(--red)' : 'var(--accent)';
  const statusColors = { pending: { bg: 'var(--blue-bg)', color: 'var(--blue)', label: t('tasks.pending_label') }, in_progress: { bg: 'var(--yellow-bg)', color: 'var(--yellow)', label: t('tasks.in_progress_label') }, completed: { bg: 'var(--green-bg)', color: 'var(--green)', label: t('tasks.completed_label') } };
  const st = statusColors[tk.status] || statusColors['pending'];
  const dl = tk.deadline || '';
  const dlLabel = dlState === 'overdue' ? '<span style="color:var(--red);font-weight:600">' + t('tasks.overdue') + '</span>' : dlState === 'soon' ? '<span style="color:#f59e0b;font-weight:600">' + t('tasks.soon') + '</span>' : dl ? '<span style="color:var(--text-tertiary)">' + dl + '</span>' : '<span style="color:var(--text-tertiary)">' + t('tasks.no_deadline') + '</span>';

  return '<div style="background:var(--bg-base);padding:14px;border-radius:10px;border-left:4px solid ' + borderColor + ';position:relative">'
    + (isUrgent ? '<span style="position:absolute;top:10px;right:40px;background:var(--red);color:white;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700">URGENT</span>' : '')
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">'
    + '<strong style="font-size:14px;' + (tk.status === 'completed' ? 'text-decoration:line-through;opacity:0.5' : '') + '">' + tk.title + '</strong>'
    + '<button class="btn-delete-small" onclick="deleteTask(' + tk.id + ')" style="flex-shrink:0">✕</button>'
    + '</div>'
    + (tk.description ? '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">' + tk.description + '</div>' : '')
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px">'
    + '<select onchange="updateTaskStatus(' + tk.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;min-height:28px">'
    + '<option value="pending"' + (tk.status==='pending'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + t('tasks.pending_label') + '</option>'
    + '<option value="in_progress"' + (tk.status==='in_progress'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + t('tasks.in_progress_label') + '</option>'
    + '<option value="completed"' + (tk.status==='completed'?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + t('tasks.completed_label') + '</option></select>'
    + '<div>📅 ' + dlLabel + '</div>'
    + (tk.assigned_name ? '<div>👤 <span style="color:var(--accent-blue-light)">' + tk.assigned_name + '</span></div>' : '')
    + (tk.notes ? '<div style="color:var(--text-tertiary)">' + tk.notes + '</div>' : '')
    + '</div></div>';
}

function renderTaskWeek(container, tasks) {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + 1);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  const dayNames = [t('days.mon'), t('days.tue'), t('days.wed'), t('days.thu'), t('days.fri'), t('days.sat'), t('days.sun')];
  const todayStr = today.toISOString().split('T')[0];

  const noDeadline = tasks.filter(function(tk) { return !tk.deadline; });
  const otherWeek = tasks.filter(function(tk) { return tk.deadline && !days.includes(tk.deadline); });

  container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:16px">'
    + days.map(function(day, i) {
      const isToday = day === todayStr;
      const dayTasks = tasks.filter(function(tk) { return tk.deadline === day; });
      return '<div style="background:var(--bg-base);border-radius:10px;padding:10px;min-height:120px;border:' + (isToday ? '2px solid var(--accent)' : '1px solid var(--border)') + '">'
        + '<div style="font-size:11px;font-weight:700;color:' + (isToday ? 'var(--accent)' : 'var(--text-tertiary)') + ';margin-bottom:8px;text-align:center">' + dayNames[i] + ' ' + day.substring(8) + '</div>'
        + (dayTasks.length === 0 ? '' : dayTasks.map(function(tk) {
          var isUrgent = tk.priority === 'urgent';
          var dlState = getTaskDeadlineState(tk.deadline);
          var bg = dlState === 'overdue' ? 'rgba(239,68,68,0.15)' : isUrgent ? 'rgba(239,68,68,0.1)' : 'var(--bg)';
          var color = dlState === 'overdue' ? 'var(--red)' : isUrgent ? 'var(--red)' : 'var(--text)';
          return '<div style="background:' + bg + ';padding:6px 8px;border-radius:6px;margin-bottom:4px;font-size:11px;cursor:pointer;color:' + color + ';' + (tk.status==='completed'?'text-decoration:line-through;opacity:0.4':'') + '" onclick="updateTaskStatus(' + tk.id + ',\'' + (tk.status==='completed'?'pending':'completed') + '\')" title="' + (tk.assigned_name||'') + '">'
            + (isUrgent ? '🔴 ' : '') + tk.title + '</div>';
        }).join(''))
        + '</div>';
    }).join('')
    + '</div>'
    + (noDeadline.length > 0 ? '<div class="panel" style="padding:14px;margin-bottom:10px"><strong style="font-size:12px;color:var(--text-tertiary);display:block;margin-bottom:8px">' + t('tasks.without_deadline') + '</strong><div style="display:grid;gap:6px">' + noDeadline.map(function(tk) { return renderTaskCard(tk); }).join('') + '</div></div>' : '')
    + (otherWeek.length > 0 ? '<div class="panel" style="padding:14px"><strong style="font-size:12px;color:var(--text-tertiary);display:block;margin-bottom:8px">' + t('tasks.other_weeks') + '</strong><div style="display:grid;gap:6px">' + otherWeek.map(function(tk) { return renderTaskCard(tk); }).join('') + '</div></div>' : '');
}

function filterTasks(filter, btn) {
  taskFilter = filter;
  document.querySelectorAll('.task-filter').forEach(function(b) { b.style.background = 'var(--bg-elevated)'; b.style.color = 'var(--text-secondary)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  renderTasks();
}

function setTaskView(view) {
  taskView = view;
  document.getElementById('btn-task-list').style.background = view === 'list' ? 'var(--accent)' : 'var(--bg-elevated)';
  document.getElementById('btn-task-list').style.color = view === 'list' ? 'white' : 'var(--text-secondary)';
  document.getElementById('btn-task-week').style.background = view === 'week' ? 'var(--accent)' : 'var(--bg-elevated)';
  document.getElementById('btn-task-week').style.color = view === 'week' ? 'white' : 'var(--text-secondary)';
  renderTasks();
}

function showTaskForm() {
  var wrap = document.getElementById('task-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var assignSelect = '';
  if (isAdmin()) {
    assignSelect = '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('cp.form_assigned') + '</label>'
      + '<select id="tf-assign" class="form-input"><option value="">—</option>'
      + allUsers.map(function(u) { return '<option value="' + u.id + '">' + u.display_name + ' (' + u.role + ')</option>'; }).join('')
      + '</select></div>';
  }
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent-blue-light)">' + t('tasks.new_task') + '</h3>'
    + '<div class="grid-2col" style="gap:12px;max-width:700px">'
    + '<div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('tasks.title_required') + '</label><input type="text" id="tf-title" class="form-input" placeholder="' + t('student.task_title_placeholder') + '"></div>'
    + '<div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('tasks.description') + '</label><textarea id="tf-desc" class="form-input" rows="2" placeholder="' + t('student.description_placeholder') + '"></textarea></div>'
    + assignSelect
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('common.priority') + '</label><select id="tf-priority" class="form-input"><option value="normal">' + t('common.normal') + '</option><option value="urgent">' + t('common.urgent') + '</option></select></div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('tasks.deadline') + '</label><input type="date" id="tf-deadline" class="form-input"></div>'
    + '<div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">' + t('common.notes') + '</label><input type="text" id="tf-notes" class="form-input" placeholder="' + t('student.notes_placeholder') + '"></div>'
    + '</div>'
    + '<div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addTask()">' + t('tasks.create') + '</button><button class="btn" style="background:var(--bg-base);color:var(--text-secondary);border:none;cursor:pointer" onclick="document.getElementById(\'task-form-wrap\').innerHTML=\'\'">' + t('common.cancel') + '</button></div>'
    + '</div>';
}

async function addTask() {
  var title = document.getElementById('tf-title').value.trim();
  if (!title) return showToast(t('tasks.title_required_toast'), 'error');
  var body = {
    title: title,
    description: document.getElementById('tf-desc').value.trim(),
    priority: document.getElementById('tf-priority').value,
    deadline: document.getElementById('tf-deadline').value || null,
    notes: document.getElementById('tf-notes').value.trim()
  };
  var assignEl = document.getElementById('tf-assign');
  if (assignEl && assignEl.value) body.assigned_to_id = parseInt(assignEl.value);
  var res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  if (res.ok) {
    showToast(t('tasks.task_created_toast'), 'success');
    document.getElementById('task-form-wrap').innerHTML = '';
    allTasks = await fetch('/api/tasks', { credentials: 'include' }).then(function(r) { return r.json(); });
    renderTasks();
  }
}

async function updateTaskStatus(id, status) {
  await fetch('/api/tasks/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: status }) });
  allTasks = await fetch('/api/tasks', { credentials: 'include' }).then(function(r) { return r.json(); });
  renderTasks();
}

async function deleteTask(id) {
  if (!(await confirmDelete(t('confirm.delete_task')))) return;
  await fetch('/api/tasks/' + id, { method: 'DELETE', credentials: 'include' });
  allTasks = await fetch('/api/tasks', { credentials: 'include' }).then(function(r) { return r.json(); });
  renderTasks();
}
