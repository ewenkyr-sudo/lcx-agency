// ========================================
// FUZION PILOT — DASHBOARD UTILITIES
// Shared helper functions used across all modules
// ========================================

// Debounce
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Empty state SVGs
const emptyStateSVG = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
};

function emptyStateHTML(iconKey, title, ctaText, ctaAction) {
  return '<div class="empty-state">'
    + '<div class="empty-state-icon">' + (emptyStateSVG[iconKey] || emptyStateSVG.search) + '</div>'
    + '<div class="empty-state-title">' + title + '</div>'
    + (ctaText ? '<button class="btn btn-primary" onclick="' + ctaAction + '">' + ctaText + '</button>' : '')
    + '</div>';
}

// Confirm delete modal
let _confirmDeleteResolve = null;
function confirmDelete(message) {
  return new Promise(function(resolve) {
    _confirmDeleteResolve = resolve;
    document.getElementById('confirm-delete-message').textContent = message || t('common.confirm_delete');
    document.getElementById('modal-confirm-delete').classList.add('show');
  });
}
function confirmDeleteYes() {
  document.getElementById('modal-confirm-delete').classList.remove('show');
  if (_confirmDeleteResolve) _confirmDeleteResolve(true);
  _confirmDeleteResolve = null;
}
function confirmDeleteNo() {
  document.getElementById('modal-confirm-delete').classList.remove('show');
  if (_confirmDeleteResolve) _confirmDeleteResolve(false);
  _confirmDeleteResolve = null;
}

// Pagination
function paginationHTML(page, totalPages, onPageFn) {
  if (totalPages <= 1) return '';
  return '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 0">'
    + '<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="' + onPageFn + '(' + (page - 1) + ')" ' + (page <= 1 ? 'disabled style="opacity:0.4;pointer-events:none;font-size:12px;padding:6px 14px"' : '') + '>← Précédent</button>'
    + '<span style="font-size:13px;color:var(--text-secondary)">Page ' + page + ' sur ' + totalPages + '</span>'
    + '<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="' + onPageFn + '(' + (page + 1) + ')" ' + (page >= totalPages ? 'disabled style="opacity:0.4;pointer-events:none;font-size:12px;padding:6px 14px"' : '') + '>Suivant →</button>'
    + '</div>';
}

// Toast notifications
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const colors = {
    error: { bg: 'var(--bg-elevated)', border: 'rgba(239,68,68,0.3)', accent: 'var(--accent-red)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' },
    success: { bg: 'var(--bg-elevated)', border: 'rgba(34,197,94,0.3)', accent: 'var(--accent-green)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
    info: { bg: 'var(--bg-elevated)', border: 'rgba(59,130,246,0.3)', accent: 'var(--accent-blue)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' },
    warning: { bg: 'var(--bg-elevated)', border: 'rgba(245,158,11,0.3)', accent: 'var(--accent-yellow)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  toast.style.cssText = 'background:' + c.bg + ';color:var(--text-primary);padding:12px 16px;border-radius:var(--radius-lg);font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:var(--shadow-xl);animation:ds-fade-in-up 0.3s var(--ease-out);max-width:380px;border:1px solid ' + c.border + ';backdrop-filter:blur(16px)';
  toast.innerHTML = '<span style="color:' + c.accent + ';display:flex;flex-shrink:0">' + c.icon + '</span><span style="flex:1">' + message + '</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  container.appendChild(toast);
  // Auto-dismiss progress
  var progress = document.createElement('div');
  progress.style.cssText = 'position:absolute;bottom:0;left:0;height:2px;background:' + c.accent + ';border-radius:0 0 var(--radius-lg) var(--radius-lg);width:100%;transform-origin:left;animation:ds-toast-progress 4s linear forwards;opacity:0.5';
  toast.style.position = 'relative';
  toast.style.overflow = 'hidden';
  toast.appendChild(progress);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    toast.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Prompt modal
function showPromptModal(title, placeholder) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;animation:ds-fade-in 0.2s ease';
    overlay.innerHTML = '<div style="background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-2xl);padding:28px;width:400px;max-width:90vw;box-shadow:var(--shadow-xl)">'
      + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">' + title + '</h3>'
      + '<input type="text" id="prompt-modal-input" class="form-input" placeholder="' + (placeholder || '') + '" style="margin-bottom:16px" autofocus>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end">'
      + '<button id="prompt-modal-cancel" class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer">Annuler</button>'
      + '<button id="prompt-modal-ok" class="btn btn-primary">Ajouter</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    var input = document.getElementById('prompt-modal-input');
    input.focus();
    function close(val) { overlay.remove(); resolve(val); }
    document.getElementById('prompt-modal-cancel').onclick = function() { close(null); };
    document.getElementById('prompt-modal-ok').onclick = function() { close(input.value.trim() || null); };
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') close(input.value.trim() || null); if (e.key === 'Escape') close(null); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
  });
}

// Time since helper
function timeSince(dateStr) {
  var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return t('common.just_now');
  if (diff < 60) return diff + ' min';
  var hours = Math.floor(diff / 60);
  return hours + 'h' + (diff % 60 > 0 ? (diff % 60) + 'min' : '');
}

// Online check
function isUserOnline(userId) {
  return (window.onlineUsers || []).some(u => u.user_id === userId);
}

// Auto-fill username from Instagram URL
function autoFillUsername(url) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (match) {
    document.getElementById('lead-username').value = '@' + match[1];
  }
}

function extractUsernameFromUrl(url) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  return match ? '@' + match[1] : url;
}

// Account avatar helper
function accountAvatarHTML(accountId, handle, platform, size) {
  size = size || 36;
  var platColors = { instagram: '#E4405F', tiktok: '#00f2ea', onlyfans: '#0080FF', fansly: '#E040FB', fanvue: '#10B981', mym: '#F97316' };
  var platIcons = { instagram: '📸', tiktok: '🎵', onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥' };
  var color = platColors[platform] || '#3B82F6';
  var initial = (handle || '?').replace(/^@/, '').charAt(0).toUpperCase();
  var avatarUrl = (platform === 'instagram' || platform === 'tiktok') ? 'https://unavatar.io/' + platform + '/' + (handle||'').replace(/^@/,'') : '/api/accounts/' + accountId + '/avatar';
  return '<div style="display:flex;align-items:center;gap:8px">'
    + '<img src="' + avatarUrl + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;border:2px solid ' + color + '30;background:' + color + '20" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
    + '<div style="display:none;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';align-items:center;justify-content:center;font-size:' + Math.round(size*0.4) + 'px;font-weight:700;color:white;flex-shrink:0">' + initial + '</div>'
    + '<div style="min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (handle || '') + '</div>'
    + '<div style="font-size:10px;color:var(--text-tertiary)">' + (platIcons[platform] || '') + ' ' + (platform || '') + '</div></div></div>';
}
