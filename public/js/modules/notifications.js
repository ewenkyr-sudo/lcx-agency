// NOTIFICATIONS MODULE
// Bell icon, panel, polling

var _notifOpen = false;

function toggleNotifPanel(e) {
  if (e) e.stopPropagation();
  _notifOpen = !_notifOpen;
  var panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = _notifOpen ? 'block' : 'none';
  if (_notifOpen) loadNotifications();
}

// Close panel when clicking outside
document.addEventListener('click', function(e) {
  if (_notifOpen && !e.target.closest('#notif-bell') && !e.target.closest('#notif-panel')) {
    _notifOpen = false;
    var panel = document.getElementById('notif-panel');
    if (panel) panel.style.display = 'none';
  }
});

async function loadNotifications() {
  var list = document.getElementById('notif-list');
  if (!list) return;
  try {
    var res = await fetch('/api/notifications?limit=20', { credentials: 'include' });
    var notifs = await res.json();
    if (notifs.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px" data-i18n="notifications.empty">Aucune notification</div>';
      return;
    }
    list.innerHTML = notifs.map(function(n) {
      var icon = getNotifIcon(n.type);
      var timeAgo = notifTimeAgo(n.created_at);
      var unread = !n.read_at;
      return '<div onclick="clickNotif(' + n.id + ',\'' + (n.link || '').replace(/'/g, "\\'") + '\')" style="display:flex;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;' + (unread ? 'background:rgba(168,85,247,0.04);' : '') + '" onmouseover="this.style.background=\'rgba(168,85,247,0.08)\'" onmouseout="this.style.background=\'' + (unread ? 'rgba(168,85,247,0.04)' : 'transparent') + '\'">'
        + '<div style="font-size:16px;flex-shrink:0;width:24px;text-align:center;padding-top:2px">' + icon + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:12px;font-weight:' + (unread ? '700' : '500') + ';color:' + (unread ? 'var(--text)' : 'var(--text2)') + '">' + n.title + '</div>'
        + '<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (n.description || '') + '</div>'
        + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + timeAgo + '</div>'
        + '</div>'
        + (unread ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:6px"></div>' : '')
        + '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Erreur de chargement</div>';
  }
}

function getNotifIcon(type) {
  var icons = {
    'call_request': '📞',
    'leave_request': '🏖️',
    'new_lead': '🎯',
    'task_assigned': '✅',
    'goal_reached': '🎉',
    'team_added': '👤',
    'payment_added': '💰',
    'alert': '⚠️',
    'new_message': '💬'
  };
  return icons[type] || '🔔';
}

function notifTimeAgo(dateStr) {
  var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return "à l'instant";
  if (diff < 60) return diff + ' min';
  var hours = Math.floor(diff / 60);
  if (hours < 24) return hours + 'h';
  var days = Math.floor(hours / 24);
  return days + 'j';
}

async function clickNotif(id, link) {
  // Mark as read
  await fetch('/api/notifications/' + id + '/read', { method: 'PATCH', credentials: 'include' }).catch(function() {});
  // Close panel
  _notifOpen = false;
  var panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  // Navigate to link
  if (link) {
    // Map links to sections
    var sectionMap = {
      '/coaching': 'coaching',
      '/planning': 'planning',
      '/tasks': 'tasks',
      '/outreach': 'outreach',
      '/finance': 'finance',
      '/chatters': 'chatters',
      '/settings': 'settings',
      '/recruitment': 'coaching'
    };
    var section = sectionMap[link];
    if (section) {
      var navItem = document.querySelector('[data-section="' + section + '"]');
      if (navItem) navItem.click();
    }
  }
  // Refresh badge
  updateNotifBadge();
}

async function markAllNotifRead() {
  await fetch('/api/notifications/mark-all-read', { method: 'PATCH', credentials: 'include' }).catch(function() {});
  updateNotifBadge();
  loadNotifications();
}

async function updateNotifBadge() {
  try {
    var res = await fetch('/api/notifications/unread-count', { credentials: 'include' });
    var data = await res.json();
    var badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = data.count;
      badge.style.display = data.count > 0 ? '' : 'none';
    }
  } catch(e) {}
}

// Poll badge every 60 seconds
setInterval(updateNotifBadge, 60000);

// Initial load
setTimeout(updateNotifBadge, 2000);
