// VA DASHBOARD MODULE v2
// Complete VA dashboard with planning, recurring tasks, content library, messages, compensation

var _vaWeekOffset = 0;

async function renderVA() {
  var container = document.getElementById('va-content');
  if (!container) return;
  if (currentUser.role === 'va') renderVADashboard(container);
  else if (isAdmin()) renderVAAdmin(container);
}

// ============ VA USER DASHBOARD ============

async function renderVADashboard(container) {
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">' + t('common.loading') + '</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }); };
  var [tasks, shiftStatus, recurringTasks, conversations, compensation, payments] = await Promise.all([
    f('/api/tasks'), f('/api/shift-clock/status'), f('/api/recurring-tasks'),
    f('/api/conversations'), f('/api/va/compensation'), f('/api/va/payments')
  ]);

  tasks = tasks || [];
  recurringTasks = recurringTasks || [];
  conversations = conversations || [];
  compensation = compensation || { config: { comp_type: 'hourly', hourly_rate: 0 }, hoursWorked: 0, amountDue: 0 };
  payments = payments || [];

  var myTasks = tasks.filter(function(tk) { return tk.assigned_to_id === currentUser.id && tk.status !== 'completed'; });
  var completedTasks = tasks.filter(function(tk) { return tk.assigned_to_id === currentUser.id && tk.status === 'completed'; });
  var todayStr = new Date().toISOString().slice(0, 10);
  var todayTasks = myTasks.filter(function(tk) { return tk.deadline === todayStr || !tk.deadline; });
  var dailyTasks = recurringTasks.filter(function(rt) { return rt.frequency === 'daily'; });
  var periodicTasks = recurringTasks.filter(function(rt) { return rt.frequency !== 'daily'; });
  var unreadTotal = conversations.reduce ? conversations.reduce(function(s, c) { return s + parseInt(c.unread || 0); }, 0) : 0;

  // Clock
  var clockedIn = shiftStatus && shiftStatus.clocked_in;
  var loc = window.currentLang === 'en' ? 'en-US' : 'fr-FR';
  var clockHTML = '';
  if (clockedIn) {
    var since = new Date(shiftStatus.since).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    clockHTML = '<div style="display:flex;align-items:center;gap:12px;padding:14px 20px;background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(34,211,238,0.05));border:1px solid var(--green);border-radius:12px">'
      + '<div style="width:12px;height:12px;border-radius:50%;background:var(--green);animation:pulse 2s infinite"></div>'
      + '<span style="font-size:14px;font-weight:600;color:var(--green)">' + t('va.on_shift_since') + ' ' + since + '</span>'
      + '<button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer;font-size:11px;padding:4px 14px;border-radius:8px;margin-left:auto" onclick="clockOut();setTimeout(renderVA,500)">' + t('misc.clock_out') + '</button></div>';
  } else {
    clockHTML = '<button class="btn btn-primary" style="font-size:14px;padding:12px 28px;border-radius:12px" onclick="clockIn();setTimeout(renderVA,500)">🟢 ' + t('va.start_working') + '</button>';
  }

  container.innerHTML = ''
    // Clock
    + '<div style="margin-bottom:20px">' + clockHTML + '</div>'
    // KPIs
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--accent);font-size:24px">' + todayTasks.length + '</div><div class="stat-label">' + t('va.tasks_today') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:18px">' + myTasks.length + '</div><div class="stat-label">' + t('va.tasks_pending') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green);font-size:18px">' + completedTasks.length + '</div><div class="stat-label">' + t('va.tasks_completed') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:18px">' + compensation.hoursWorked + 'h</div><div class="stat-label">' + t('va.hours_this_month') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green);font-size:18px">$' + compensation.amountDue.toFixed(0) + '</div><div class="stat-label">' + t('va.due_this_month') + '</div></div>'
    + (unreadTotal > 0 ? '<div class="stat-card"><div class="stat-value" style="color:var(--yellow);font-size:18px">' + unreadTotal + '</div><div class="stat-label">' + t('va.unread_messages') + '</div></div>' : '')
    + '</div>'

    // Two columns: tasks + recurring
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">'

    // Today's tasks
    + '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">📋 ' + t('va.tasks_today') + '</h3>'
    + (todayTasks.length > 0 ? '<div style="display:grid;gap:8px">' + todayTasks.map(function(tk) {
      var pc = tk.priority === 'urgent' ? 'var(--red)' : 'var(--accent)';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg3);border-radius:10px;border-left:3px solid ' + pc + '">'
        + '<div style="flex:1"><strong style="font-size:13px">' + tk.title + '</strong>'
        + (tk.description ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + tk.description + '</div>' : '') + '</div>'
        + '<select onchange="updateTaskStatus(' + tk.id + ',this.value);setTimeout(renderVA,300)" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit">'
        + '<option value="pending"' + (tk.status === 'pending' ? ' selected' : '') + '>' + t('tasks.pending_label') + '</option>'
        + '<option value="in_progress"' + (tk.status === 'in_progress' ? ' selected' : '') + '>' + t('tasks.in_progress_label') + '</option>'
        + '<option value="completed">' + t('tasks.completed_label') + '</option></select></div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:20px">' + t('va.no_tasks_today') + '</div>')
    + '</div>'

    // Recurring tasks (daily checklist)
    + '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">🔄 ' + t('va.daily_checklist') + '</h3>'
    + (dailyTasks.length > 0 ? '<div style="display:grid;gap:6px">' + dailyTasks.map(function(rt) {
      var done = rt.completed_today;
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:' + (done ? 'rgba(16,185,129,0.1)' : 'var(--bg3)') + ';border-radius:8px;cursor:pointer;transition:all 0.15s" onclick="toggleRecurringTask(' + rt.id + ',' + (done ? 'false' : 'true') + ')">'
        + '<div style="width:20px;height:20px;border-radius:6px;border:2px solid ' + (done ? 'var(--green)' : 'var(--border)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + (done ? 'var(--green)' : 'transparent') + '">' + (done ? '<span style="color:white;font-size:12px">✓</span>' : '') + '</div>'
        + '<span style="font-size:13px;' + (done ? 'text-decoration:line-through;opacity:0.5' : '') + '">' + rt.title + '</span>'
        + '</div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:20px">' + t('va.no_recurring') + '</div>')
    + (periodicTasks.length > 0 ? '<div style="margin-top:16px"><h4 style="font-size:12px;color:var(--text3);text-transform:uppercase;margin-bottom:8px">' + t('va.periodic_tasks') + '</h4>'
      + '<div style="display:grid;gap:6px">' + periodicTasks.map(function(rt) {
        var done = rt.completed_today;
        var freq = rt.frequency === 'weekly' ? t('va.weekly') : rt.frequency === 'monthly' ? t('va.monthly') : rt.frequency;
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:' + (done ? 'rgba(16,185,129,0.1)' : 'var(--bg3)') + ';border-radius:8px;cursor:pointer" onclick="toggleRecurringTask(' + rt.id + ',' + (done ? 'false' : 'true') + ')">'
          + '<div style="width:20px;height:20px;border-radius:6px;border:2px solid ' + (done ? 'var(--green)' : 'var(--border)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + (done ? 'var(--green)' : 'transparent') + '">' + (done ? '<span style="color:white;font-size:12px">✓</span>' : '') + '</div>'
          + '<span style="font-size:13px;' + (done ? 'text-decoration:line-through;opacity:0.5' : '') + '">' + rt.title + '</span>'
          + '<span style="font-size:10px;color:var(--text3);margin-left:auto;background:var(--bg);padding:2px 8px;border-radius:10px">' + freq + '</span></div>';
      }).join('') + '</div></div>' : '')
    + '</div>'
    + '</div>'

    // Content library + Messages row
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">'
    // Content library widget
    + '<div class="panel" style="padding:20px"><h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">📁 ' + t('va.content_library') + '</h3><div id="va-content-library">' + t('common.loading') + '</div></div>'
    // Messages widget
    + '<div class="panel" style="padding:20px"><h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">💬 ' + t('va.messages') + (unreadTotal > 0 ? ' <span style="background:var(--red);color:white;font-size:10px;padding:2px 8px;border-radius:10px">' + unreadTotal + '</span>' : '') + '</h3><div id="va-messages-widget"></div></div>'
    + '</div>'

    // Compensation widget
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">💰 ' + t('va.my_compensation') + '</h3>'
    + renderVACompensation(compensation, payments)
    + '</div>'

    // All pending tasks
    + '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:16px">📝 ' + t('va.all_tasks') + ' (' + myTasks.length + ')</h3>'
    + (myTasks.length > 0 ? '<div style="display:grid;gap:6px">' + myTasks.map(function(tk) {
      var badge = tk.priority === 'urgent' ? '<span style="background:var(--red);color:white;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:6px">URGENT</span>' : '';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:' + (tk.status === 'in_progress' ? 'var(--yellow-bg)' : 'var(--bg3)') + ';border-radius:8px;font-size:13px">'
        + '<span>' + tk.title + badge + '</span>'
        + (tk.deadline ? '<span style="color:var(--text3);font-size:11px;margin-left:auto">📅 ' + tk.deadline + '</span>' : '')
        + '</div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:12px">' + t('tasks.no_tasks') + '</div>')
    + '</div>';

  // Load async widgets
  loadVAContentLibrary();
  loadVAMessages();
}

function renderVACompensation(comp, payments) {
  var cfg = comp.config || {};
  var typeLabel = cfg.comp_type === 'hourly' ? t('va.type_hourly') : cfg.comp_type === 'fixed_monthly' ? t('va.type_fixed') : cfg.comp_type === 'hourly_plus_bonus' ? t('va.type_hourly_bonus') : cfg.comp_type || '-';
  var rateInfo = '';
  if (cfg.comp_type === 'hourly' || cfg.comp_type === 'hourly_plus_bonus') rateInfo = '$' + parseFloat(cfg.hourly_rate || 0).toFixed(2) + '/h';
  else if (cfg.comp_type === 'fixed_monthly') rateInfo = '$' + parseFloat(cfg.fixed_monthly || 0).toFixed(0) + '/mo';

  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">'
    + '<div style="background:var(--bg3);padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:var(--text3)">' + t('va.pay_type') + '</div><div style="font-size:14px;font-weight:700;margin-top:4px">' + typeLabel + '</div></div>'
    + '<div style="background:var(--bg3);padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:var(--text3)">' + t('va.rate') + '</div><div style="font-size:14px;font-weight:700;margin-top:4px">' + rateInfo + '</div></div>'
    + '<div style="background:var(--bg3);padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:var(--text3)">' + t('va.hours_this_month') + '</div><div style="font-size:14px;font-weight:700;margin-top:4px">' + comp.hoursWorked + 'h</div></div>'
    + '<div style="background:var(--bg3);padding:14px;border-radius:10px;text-align:center"><div style="font-size:12px;color:var(--text3)">' + t('va.due_this_month') + '</div><div style="font-size:20px;font-weight:800;color:var(--green);margin-top:4px">$' + comp.amountDue.toFixed(2) + '</div></div>'
    + '</div>'
    + (payments.length > 0 ? '<h4 style="font-size:12px;color:var(--text3);text-transform:uppercase;margin-bottom:8px">' + t('va.payment_history') + '</h4>'
      + '<div style="display:grid;gap:4px">' + payments.slice(0, 5).map(function(p) {
        var stColor = p.status === 'paid' ? 'var(--green)' : 'var(--yellow)';
        return '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg3);border-radius:6px;font-size:12px">'
          + '<span>' + p.month + '</span><span style="color:var(--text3)">' + p.hours_worked + 'h</span>'
          + '<span style="color:' + stColor + ';font-weight:700">$' + parseFloat(p.amount).toFixed(2) + '</span>'
          + '<span style="color:' + stColor + ';font-size:11px">' + (p.status === 'paid' ? '✅' : '⏳') + '</span></div>';
      }).join('') + '</div>' : '<div style="color:var(--text3);font-size:12px">' + t('va.no_payments') + '</div>');
}

// ============ RECURRING TASKS ============

async function toggleRecurringTask(taskId, complete) {
  if (complete) {
    await fetch('/api/recurring-tasks/' + taskId + '/complete', { method: 'POST', credentials: 'include' });
  } else {
    await fetch('/api/recurring-tasks/' + taskId + '/complete', { method: 'DELETE', credentials: 'include' });
  }
  renderVA();
}

// ============ CONTENT LIBRARY WIDGET ============

async function loadVAContentLibrary() {
  var el = document.getElementById('va-content-library');
  if (!el) return;
  try {
    var res = await fetch('/api/content-library', { credentials: 'include' });
    var items = res.ok ? await res.json() : [];
    if (items.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:20px"><div style="color:var(--text3);margin-bottom:12px">' + t('va.no_content') + '</div>'
        + '<button class="btn btn-primary" style="font-size:12px" onclick="showAddContentModal()">+ ' + t('va.add_content') + '</button></div>';
      return;
    }
    el.innerHTML = '<div style="margin-bottom:12px"><button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="showAddContentModal()">+ ' + t('va.add_content') + '</button></div>'
      + '<div style="display:grid;gap:6px;max-height:300px;overflow-y:auto">' + items.slice(0, 20).map(function(item) {
        var statusBg = item.status === 'ready' ? 'var(--green-bg)' : item.status === 'published' ? 'var(--accent)' : 'var(--bg)';
        var statusColor = item.status === 'ready' ? 'var(--green)' : item.status === 'published' ? 'white' : 'var(--text3)';
        var icon = item.content_type === 'video' ? '🎬' : '📸';
        return '<a href="' + item.external_url + '" target="_blank" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border-radius:8px;text-decoration:none;color:var(--text);transition:background 0.15s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'var(--bg3)\'">'
          + '<span style="font-size:16px">' + icon + '</span>'
          + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + item.title + '</div>'
          + '<div style="font-size:11px;color:var(--text3)">' + (item.model_name || '-') + '</div></div>'
          + '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:' + statusBg + ';color:' + statusColor + '">' + item.status + '</span></a>';
      }).join('') + '</div>';
  } catch(e) { el.innerHTML = '<div style="color:var(--text3)">' + t('common.error') + '</div>'; }
}

function showAddContentModal() {
  var modelOpts = (allModels || []).map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
  var html = '<div class="modal-overlay show" id="content-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">' + t('va.add_content') + '</div><button class="modal-close" onclick="document.getElementById(\'content-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('common.title_label') + ' *</label><input class="form-input" id="cl-title" placeholder="' + t('va.content_title_placeholder') + '"></div>'
    + '<div class="form-group"><label class="form-label">URL *</label><input class="form-input" id="cl-url" placeholder="https://drive.google.com/..."></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div class="form-group"><label class="form-label">' + t('finance.model_col') + '</label><select class="form-input" id="cl-model"><option value="">—</option>' + modelOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.type') + '</label><select class="form-input" id="cl-type"><option value="image">📸 Image</option><option value="video">🎬 Video</option><option value="document">📄 Document</option></select></div></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.status') + '</label><select class="form-input" id="cl-status"><option value="to_sort">' + t('va.status_to_sort') + '</option><option value="ready">' + t('va.status_ready') + '</option><option value="published">' + t('va.status_published') + '</option></select></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.notes') + '</label><input class="form-input" id="cl-caption" placeholder="' + t('student.notes_placeholder') + '"></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'content-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="addContentItem()">' + t('common.add') + '</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function addContentItem() {
  var title = document.getElementById('cl-title').value.trim();
  var url = document.getElementById('cl-url').value.trim();
  if (!title || !url) return showToast(t('va.title_url_required'), 'error');
  var res = await fetch('/api/content-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ title: title, external_url: url, model_id: document.getElementById('cl-model').value || null, content_type: document.getElementById('cl-type').value, status: document.getElementById('cl-status').value, caption: document.getElementById('cl-caption').value.trim() })
  });
  if (res.ok) { document.getElementById('content-modal').remove(); showToast(t('va.content_added'), 'success'); loadVAContentLibrary(); }
  else showToast(t('common.error'), 'error');
}

// ============ MESSAGES WIDGET ============

async function loadVAMessages() {
  var el = document.getElementById('va-messages-widget');
  if (!el) return;
  try {
    var res = await fetch('/api/conversations', { credentials: 'include' });
    var convs = res.ok ? await res.json() : [];
    if (convs.length === 0) { el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px">' + t('student.no_message') + '</div>'; return; }
    el.innerHTML = '<div style="display:grid;gap:6px;max-height:300px;overflow-y:auto">' + convs.map(function(c) {
      var unread = parseInt(c.unread || 0);
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + (unread > 0 ? 'rgba(168,85,247,0.05)' : 'var(--bg3)') + ';border-radius:8px;cursor:pointer" onclick="openVAChat(' + c.user_id + ',\'' + (c.display_name || '').replace(/'/g, "\\'") + '\')">'
        + '<div style="flex:1"><strong style="font-size:13px">' + (c.display_name || 'User #' + c.user_id) + '</strong>'
        + (c.last_message ? '<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">' + c.last_message + '</div>' : '') + '</div>'
        + (unread > 0 ? '<span style="background:var(--accent);color:white;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700">' + unread + '</span>' : '')
        + '</div>';
    }).join('') + '</div>';
  } catch(e) { el.innerHTML = '<div style="color:var(--text3)">' + t('common.error') + '</div>'; }
}

function openVAChat(userId, userName) {
  // Use the existing messaging system — switch to student-messages or open inline
  if (typeof openAdminChat === 'function') { openAdminChat(userId); return; }
  // Fallback: open in-page chat
  showVAChatModal(userId, userName);
}

async function showVAChatModal(userId, userName) {
  var res = await fetch('/api/messages/' + userId, { credentials: 'include' });
  var messages = res.ok ? await res.json() : [];

  var html = '<div class="modal-overlay show" id="va-chat-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:500px;max-height:80vh"><div class="modal-header"><div class="modal-title">💬 ' + userName + '</div><button class="modal-close" onclick="document.getElementById(\'va-chat-modal\').remove()">✕</button></div>'
    + '<div class="modal-body" style="padding:0">'
    + '<div id="va-chat-messages" style="height:400px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px">'
    + messages.map(function(m) {
      var isMine = m.from_user_id === currentUser.id;
      return '<div style="display:flex;justify-content:' + (isMine ? 'flex-end' : 'flex-start') + '">'
        + '<div style="max-width:75%;padding:8px 14px;border-radius:12px;font-size:13px;background:' + (isMine ? 'var(--accent)' : 'var(--bg3)') + ';color:' + (isMine ? 'white' : 'var(--text)') + '">' + m.content + '</div></div>';
    }).join('')
    + '</div>'
    + '<div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border)">'
    + '<input type="text" id="va-chat-input" class="form-input" placeholder="' + t('common.reply') + '" style="flex:1" onkeypress="if(event.key===\'Enter\')sendVAMessage(' + userId + ')">'
    + '<button class="btn btn-primary" onclick="sendVAMessage(' + userId + ')">' + t('common.send') + '</button>'
    + '</div></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  var chatDiv = document.getElementById('va-chat-messages');
  if (chatDiv) chatDiv.scrollTop = chatDiv.scrollHeight;
}

async function sendVAMessage(userId) {
  var input = document.getElementById('va-chat-input');
  var content = input.value.trim();
  if (!content) return;
  await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ to_user_id: userId, content: content }) });
  input.value = '';
  // Refresh chat
  document.getElementById('va-chat-modal').remove();
  showVAChatModal(userId, '');
  loadVAMessages();
}

// ============ ADMIN VIEW ============

async function renderVAAdmin(container) {
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">' + t('common.loading') + '</div>';

  var vas = (allTeam || []).filter(function(m) { return m.role === 'va'; });
  var vaUsers = (allUsers || []).filter(function(u) { return u.role === 'va'; });

  // Load compensation data for each VA
  var compData = {};
  for (var i = 0; i < vaUsers.length; i++) {
    try {
      var res = await fetch('/api/va/compensation?user_id=' + vaUsers[i].id, { credentials: 'include' });
      if (res.ok) compData[vaUsers[i].id] = await res.json();
    } catch(e) {}
  }

  container.innerHTML = ''
    // Header
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
    + '<h3 style="font-size:16px;font-weight:700;color:var(--accent2)">' + t('va.team_title') + ' (' + vas.length + ')</h3>'
    + '</div>'

    // VA cards
    + (vas.length > 0 ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-bottom:20px">' + vas.map(function(v) {
      var online = isUserOnline(v.user_id);
      var av = avatarHTML({ avatar_url: v.avatar_url, display_name: v.name }, 44);
      var comp = compData[v.user_id] || { hoursWorked: 0, amountDue: 0, config: {} };
      var rateLabel = '';
      if (comp.config.comp_type === 'hourly') rateLabel = '$' + parseFloat(comp.config.hourly_rate || 0).toFixed(0) + '/h';
      else if (comp.config.comp_type === 'fixed_monthly') rateLabel = '$' + parseFloat(comp.config.fixed_monthly || 0).toFixed(0) + '/mo';

      return '<div class="panel" style="padding:16px;border-left:3px solid ' + (online ? 'var(--green)' : 'var(--text3)') + '">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
        + '<div style="position:relative">' + av + (online ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span>' : '') + '</div>'
        + '<div style="flex:1"><strong style="font-size:14px">' + v.name + '</strong><div style="font-size:11px;color:' + (online ? 'var(--green)' : 'var(--text3)') + '">' + (online ? t('status.online') : t('status.offline')) + '</div></div>'
        + '<button class="btn-delete-small" onclick="deleteTeamMember(' + v.id + ')">✕</button></div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px">'
        + '<div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-weight:700">' + comp.hoursWorked + 'h</div><div style="color:var(--text3);font-size:10px">' + t('va.hours_this_month') + '</div></div>'
        + '<div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-weight:700;color:var(--green)">$' + comp.amountDue.toFixed(0) + '</div><div style="color:var(--text3);font-size:10px">' + t('va.due_this_month') + '</div></div>'
        + '<div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-weight:700">' + (rateLabel || '-') + '</div><div style="color:var(--text3);font-size:10px">' + t('va.rate') + '</div></div>'
        + '</div>'
        + '<div style="margin-top:10px;display:flex;gap:6px">'
        + '<button class="btn btn-secondary" style="font-size:11px;flex:1" onclick="showVACompConfig(' + v.user_id + ',\'' + v.name.replace(/'/g, "\\'") + '\')">' + t('va.configure_pay') + '</button>'
        + '</div></div>';
    }).join('') + '</div>' : '<div style="color:var(--text3);text-align:center;padding:40px">' + t('va.no_va') + '</div>')

    // Content library admin view
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--accent2)">📁 ' + t('va.content_library') + '</h3>'
    + '<button class="btn btn-primary" style="font-size:11px" onclick="showAddContentModal()">+ ' + t('va.add_content') + '</button></div>'
    + '<div id="va-content-library">' + t('common.loading') + '</div></div>'

    // Recurring tasks admin
    + '<div class="panel" style="padding:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--accent2)">🔄 ' + t('va.recurring_tasks_admin') + '</h3>'
    + '<button class="btn btn-primary" style="font-size:11px" onclick="showAddRecurringTaskModal()">+ ' + t('common.add') + '</button></div>'
    + '<div id="va-recurring-admin">' + t('common.loading') + '</div></div>';

  loadVAContentLibrary();
  loadVARecurringAdmin();
}

// Admin: compensation config modal
function showVACompConfig(userId, userName) {
  var html = '<div class="modal-overlay show" id="comp-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:400px"><div class="modal-header"><div class="modal-title">💰 ' + userName + '</div><button class="modal-close" onclick="document.getElementById(\'comp-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('va.pay_type') + '</label><select class="form-input" id="comp-type" onchange="toggleCompFields()">'
    + '<option value="hourly">' + t('va.type_hourly') + '</option><option value="fixed_monthly">' + t('va.type_fixed') + '</option><option value="hourly_plus_bonus">' + t('va.type_hourly_bonus') + '</option></select></div>'
    + '<div id="comp-hourly-fields"><div class="form-group"><label class="form-label">' + t('va.hourly_rate') + ' ($)</label><input type="number" class="form-input" id="comp-rate" value="0" min="0" step="0.5"></div></div>'
    + '<div id="comp-fixed-fields" style="display:none"><div class="form-group"><label class="form-label">' + t('va.monthly_amount') + ' ($)</label><input type="number" class="form-input" id="comp-fixed" value="0" min="0"></div></div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'comp-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="saveVAComp(' + userId + ')">' + t('common.save') + '</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function toggleCompFields() {
  var typ = document.getElementById('comp-type').value;
  document.getElementById('comp-hourly-fields').style.display = (typ === 'hourly' || typ === 'hourly_plus_bonus') ? '' : 'none';
  document.getElementById('comp-fixed-fields').style.display = typ === 'fixed_monthly' ? '' : 'none';
}

async function saveVAComp(userId) {
  var data = { comp_type: document.getElementById('comp-type').value, hourly_rate: parseFloat(document.getElementById('comp-rate').value) || 0, fixed_monthly: parseFloat(document.getElementById('comp-fixed').value) || 0 };
  var res = await fetch('/api/va/compensation/' + userId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) { document.getElementById('comp-modal').remove(); showToast(t('toast.saved'), 'success'); renderVA(); }
}

// Admin: recurring tasks management
async function loadVARecurringAdmin() {
  var el = document.getElementById('va-recurring-admin');
  if (!el) return;
  try {
    var res = await fetch('/api/recurring-tasks', { credentials: 'include' });
    var tasks = res.ok ? await res.json() : [];
    if (tasks.length === 0) { el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px">' + t('va.no_recurring') + '</div>'; return; }
    el.innerHTML = '<div style="display:grid;gap:6px">' + tasks.map(function(rt) {
      var freq = rt.frequency === 'daily' ? '📅 ' + t('va.daily') : rt.frequency === 'weekly' ? '📆 ' + t('va.weekly') : '🗓️ ' + t('va.monthly');
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border-radius:8px">'
        + '<span style="font-size:13px;font-weight:600;flex:1">' + rt.title + '</span>'
        + '<span style="font-size:10px;color:var(--text3);background:var(--bg);padding:2px 8px;border-radius:10px">' + freq + '</span>'
        + (rt.assigned_name ? '<span style="font-size:11px;color:var(--accent)">' + rt.assigned_name + '</span>' : '')
        + '<button class="btn-delete-small" onclick="deleteRecurringTask(' + rt.id + ')">✕</button></div>';
    }).join('') + '</div>';
  } catch(e) {}
}

async function deleteRecurringTask(id) {
  if (!(await confirmDelete())) return;
  await fetch('/api/recurring-tasks/' + id, { method: 'DELETE', credentials: 'include' });
  loadVARecurringAdmin();
}

function showAddRecurringTaskModal() {
  var vaOpts = (allUsers || []).filter(function(u) { return u.role === 'va'; }).map(function(u) { return '<option value="' + u.id + '">' + u.display_name + '</option>'; }).join('');
  var html = '<div class="modal-overlay show" id="rt-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:400px"><div class="modal-header"><div class="modal-title">🔄 ' + t('va.add_recurring') + '</div><button class="modal-close" onclick="document.getElementById(\'rt-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('common.title_label') + ' *</label><input class="form-input" id="rt-title" placeholder="' + t('va.task_title_placeholder') + '"></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.description') + '</label><input class="form-input" id="rt-desc"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div class="form-group"><label class="form-label">' + t('va.frequency') + '</label><select class="form-input" id="rt-freq"><option value="daily">' + t('va.daily') + '</option><option value="weekly">' + t('va.weekly') + '</option><option value="monthly">' + t('va.monthly') + '</option></select></div>'
    + '<div class="form-group"><label class="form-label">' + t('va.assign_to') + '</label><select class="form-input" id="rt-assign"><option value="">' + t('va.all_vas') + '</option>' + vaOpts + '</select></div>'
    + '</div>'
    + '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'rt-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="addRecurringTask()">' + t('common.add') + '</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function addRecurringTask() {
  var title = document.getElementById('rt-title').value.trim();
  if (!title) return showToast(t('toast.title_required'), 'error');
  var res = await fetch('/api/recurring-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ title: title, description: document.getElementById('rt-desc').value.trim(), frequency: document.getElementById('rt-freq').value, assigned_to_id: document.getElementById('rt-assign').value || null })
  });
  if (res.ok) { document.getElementById('rt-modal').remove(); showToast(t('toast.saved'), 'success'); loadVARecurringAdmin(); }
}
