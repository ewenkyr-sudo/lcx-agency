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
    document.getElementById('confirm-delete-message').textContent = message || 'Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.';
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
    + '<span style="font-size:13px;color:var(--text2)">Page ' + page + ' sur ' + totalPages + '</span>'
    + '<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="' + onPageFn + '(' + (page + 1) + ')" ' + (page >= totalPages ? 'disabled style="opacity:0.4;pointer-events:none;font-size:12px;padding:6px 14px"' : '') + '>Suivant →</button>'
    + '</div>';
}

// Toast notifications
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px';
    document.body.appendChild(container);
  }
  const colors = {
    error: { bg: '#dc2626', icon: '✕' },
    success: { bg: '#16a34a', icon: '✓' },
    info: { bg: 'var(--accent)', icon: 'ℹ' },
    warning: { bg: '#d97706', icon: '⚠' }
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  toast.style.cssText = `background:${c.bg};color:white;padding:14px 20px;border-radius:10px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,0.4);animation:slideIn 0.3s ease;max-width:400px`;
  toast.innerHTML = `<span style="font-size:16px">${c.icon}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Prompt modal
function showPromptModal(title, placeholder) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';
    overlay.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:28px;width:400px;max-width:90vw;box-shadow:0 24px 80px rgba(0,0,0,0.5)">'
      + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">' + title + '</h3>'
      + '<input type="text" id="prompt-modal-input" class="form-input" placeholder="' + (placeholder || '') + '" style="margin-bottom:16px" autofocus>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end">'
      + '<button id="prompt-modal-cancel" class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer">Annuler</button>'
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
  if (diff < 1) return "à l'instant";
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
  var color = platColors[platform] || '#A855F7';
  var initial = (handle || '?').replace(/^@/, '').charAt(0).toUpperCase();
  return '<div style="display:flex;align-items:center;gap:8px">'
    + '<img src="/api/accounts/' + accountId + '/avatar" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;border:2px solid ' + color + '30;background:' + color + '20" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
    + '<div style="display:none;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';align-items:center;justify-content:center;font-size:' + Math.round(size*0.4) + 'px;font-weight:700;color:white;flex-shrink:0">' + initial + '</div>'
    + '<div style="min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (handle || '') + '</div>'
    + '<div style="font-size:10px;color:var(--text3)">' + (platIcons[platform] || '') + ' ' + (platform || '') + '</div></div></div>';
}
