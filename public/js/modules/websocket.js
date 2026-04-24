// WEBSOCKET MODULE
// Extracted from dashboard.html

function playNotifSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;

    if (type === 'success') {
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      // Second note
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = 1174;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.06, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.4);
    } else if (type === 'alert') {
      osc.frequency.value = 660;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.frequency.value = 520;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch(e) {}
}

// Envoyer une notification navigateur + son
function sendNotification(title, body, type) {
  playNotifSound(type || 'info');
  if (Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body: body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' });
  }
}

// ========== WEBSOCKET TEMPS RÉEL ==========
let onlineUsers = [];
let wsRef = null;
let pingInterval = null;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);
  wsRef = ws;

  ws.addEventListener('open', () => {
    // S'authentifier via le cookie JWT
    const token = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('token='));
    if (token) {
      ws.send(JSON.stringify({ type: 'auth', token: token.split('=')[1] }));
    }
    // Ping toutes les 2 minutes pour maintenir la présence
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
    }, 120000);
  });

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);

    // Présence en ligne
    if (msg.event === 'user-online') {
      if (!onlineUsers.find(u => u.user_id === msg.data.user_id)) {
        onlineUsers.push(msg.data);
      }
      updateOnlineUI();
    }
    if (msg.event === 'user-offline') {
      onlineUsers = onlineUsers.filter(u => u.user_id !== msg.data.user_id);
      updateOnlineUI();
    }

    if (msg.event === 'lead-added' || msg.event === 'lead-updated' || msg.event === 'lead-deleted' || msg.event === 'leads-bulk-updated') {
      // Ignorer les events venant de soi-même (déjà traités localement)
      if (msg.data && msg.data.by && msg.data.by == currentUser.id) {
        // Notre propre action — rien à faire, déjà à jour
      } else {
        // Action d'un collègue — recharger en arrière-plan sans bloquer
        loadLeads().then(function() { renderLeads(); }).catch(function() {});
        loadOutreachKPIs().catch(function() {});
        if (isAdmin()) try { loadDashboardOutreachStats(); } catch(e) {}
      }
      // Notifications pour événements leads importants
      if (msg.event === 'lead-updated' && msg.data) {
        if (msg.data.status === 'call-booked') {
          showToast(t('ws.call_booked') + ' ' + (msg.data.username || ''), 'success');
          sendNotification('Call Booked !', (msg.data.username || 'Un lead') + ' a un call de prévu', 'success');
        }
        if (msg.data.status === 'signed') {
          showToast(t('ws.lead_signed') + ' ' + (msg.data.username || ''), 'success');
          sendNotification('Lead Signé !', (msg.data.username || 'Un lead') + ' vient de signer !', 'success');
        }
        if (msg.data.status === 'talking-warm') {
          sendNotification('Lead Warm', (msg.data.username || 'Un lead') + ' est passé en discussion chaude', 'alert');
        }
      }
    }
    if (msg.event === 'shift-added' || msg.event === 'shift-deleted') {
      await loadShifts();
      renderShifts();
      await loadChatterKPIs();
      if (isAdmin()) loadDashboardChatterStats();
    }
    if (msg.event === 'shift-started' || msg.event === 'shift-ended' || msg.event === 'shift-updated') {
      if (isAdmin()) {
        renderActiveShiftsWidget();
        if (typeof loadDashActiveShifts === 'function') loadDashActiveShifts();
      }
      if (msg.event === 'shift-started' && isAdmin()) {
        showToast('🟢 ' + (msg.data.user_name || '') + ' — shift started', 'info');
      }
      if (msg.event === 'shift-ended' && isAdmin()) {
        showToast('🔴 ' + (msg.data.user_name || '') + ' — shift ended ($' + (parseFloat(msg.data.shift.ppv_total) + parseFloat(msg.data.shift.tips_total)).toFixed(2) + ')', 'info');
      }
    }
    if (msg.event === 'followers-updated') {
      await reloadAccounts();
      showToast(t('ws.followers_updated_count') + ' (' + msg.data.updated + ' ' + t('ws.accounts_count') + ')', 'success');
      playNotifSound('info');
    }
    if (msg.event === 'task-new' || msg.event === 'task-updated' || msg.event === 'task-deleted') {
      allTasks = await fetch('/api/tasks', { credentials: 'include' }).then(r => r.json());
      renderTasks();
      if (msg.event === 'task-new' && msg.data) {
        sendNotification(t('tasks.new_task_title'), msg.data.title || 'Une tâche a été créée', 'info');
      }
    }
    if (msg.event === 'new-message') {
      if (msg.data.to_user_id === currentUser.id) {
        showToast(t('ws.new_message') + ' ' + (msg.data.from_name || t('ws.someone')), 'info');
        sendNotification(t('ws.message_title') + ' ' + (msg.data.from_name || t('ws.someone')), (msg.data.content || '').substring(0, 80), 'alert');
        if (currentChatUserId === msg.data.from_user_id) {
          const res = await fetch('/api/messages/' + currentChatUserId, { credentials: 'include' });
          if (res.ok) { studentData.messages = await res.json(); renderChatMessages(); }
        }
        if (adminChatUserId === msg.data.from_user_id && isAdmin()) {
          openAdminChat(adminChatUserId);
        }
        updateUnreadBadges();
      }
    }
    if (msg.event === 'call-request-new' || msg.event === 'call-request-updated') {
      if (currentUser.role === 'student') renderStudentHome();
      if (msg.event === 'call-request-new') {
        sendNotification('Demande de call', t('coaching.call_pending_label'), 'alert');
      }
    }
    if (msg.event === 'planning-updated' || msg.event === 'leave-request-new' || msg.event === 'leave-request-updated') {
      renderPlanning();
      if (msg.event === 'leave-request-new') {
        sendNotification('Demande de congé', t('planning.leave_request_title'), 'info');
      }
    }
  });

  ws.addEventListener('close', () => {
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connectWebSocket, 2000);
  });
}

// Charger les users en ligne au démarrage
async function loadOnlineUsers() {
  try {
    var res = await fetch('/api/online-users', { credentials: 'include' });
    if (res.ok) onlineUsers = await res.json();
    updateOnlineUI();
  } catch(e) {}
}

// isUserOnline, timeSince → moved to dashboard-utils.js

function updateOnlineUI() {
  // Compteur dans la sidebar
  var badge = document.getElementById('online-count-badge');
  if (badge) {
    badge.textContent = onlineUsers.length;
    badge.style.display = onlineUsers.length > 0 ? '' : 'none';
  }

  // Widget dashboard "Équipe en ligne"
  var widget = document.getElementById('online-team-widget');
  if (widget) {
    widget.innerHTML = onlineUsers.map(function(u) {
      var av = u.avatar_url
        ? '<img src="' + u.avatar_url + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">'
        : '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--pink));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white">' + (u.display_name||'?').charAt(0) + '</div>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
        + '<div style="position:relative">' + av + '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span></div>'
        + '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + u.display_name + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + u.role + '</div></div>'
        + '<span style="font-size:11px;color:var(--green)">' + timeSince(u.connected_at) + '</span>'
        + '</div>';
    }).join('') || '<div style="color:var(--text-tertiary);padding:16px 0;text-align:center;font-size:13px">' + t('dash.nobody_online') + '</div>';
  }

  // Points verts sur les noms dans les tables équipe (chatters, outreach, va)
  document.querySelectorAll('[data-user-id]').forEach(function(el) {
    var uid = parseInt(el.getAttribute('data-user-id'));
    var dot = el.querySelector('.online-dot');
    if (isUserOnline(uid)) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'online-dot';
        dot.style.cssText = 'display:inline-block;width:8px;height:8px;background:var(--green);border-radius:50%;margin-left:6px';
        el.appendChild(dot);
      }
      dot.style.display = '';
    } else if (dot) {
      dot.style.display = 'none';
    }
  });
}

connectWebSocket();

// ========== OUTREACH LEADS ==========