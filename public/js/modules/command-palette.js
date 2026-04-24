// ========================================
// FUZION PILOT — COMMAND PALETTE (Cmd+K)
// Fast navigation & quick actions
// ========================================

var _cmdPaletteOpen = false;
var _cmdSelectedIndex = 0;

// Register Cmd+K / Ctrl+K shortcut
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    toggleCommandPalette();
  }
  if (e.key === 'Escape' && _cmdPaletteOpen) {
    closeCommandPalette();
  }
});

function toggleCommandPalette() {
  if (_cmdPaletteOpen) closeCommandPalette();
  else openCommandPalette();
}

function openCommandPalette() {
  if (document.getElementById('cmd-palette')) return;
  _cmdPaletteOpen = true;
  _cmdSelectedIndex = 0;

  var overlay = document.createElement('div');
  overlay.id = 'cmd-palette';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding-top:min(20vh,160px);background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);animation:ds-fade-in 0.15s ease';
  overlay.onclick = function(e) { if (e.target === overlay) closeCommandPalette(); };

  var palette = document.createElement('div');
  palette.style.cssText = 'width:560px;max-width:calc(100vw - 24px);background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-2xl);box-shadow:var(--shadow-xl),0 0 80px rgba(59,130,246,0.06);overflow:hidden;animation:ds-fade-in-up 0.2s var(--ease-out)';

  // Search input
  var inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border-default)';
  inputWrap.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = t('cmd.placeholder') || 'Rechercher une page, un modèle, une action...';
  input.style.cssText = 'flex:1;background:none;border:none;outline:none;color:var(--text-primary);font-size:15px;font-family:var(--font-sans)';
  input.oninput = function() { renderCmdResults(this.value); };
  input.onkeydown = handleCmdKeyboard;

  var badge = document.createElement('span');
  badge.style.cssText = 'font-size:11px;color:var(--text-muted);background:var(--bg-base);padding:3px 8px;border-radius:var(--radius-sm);font-family:var(--font-mono);border:1px solid var(--border-default)';
  badge.textContent = 'ESC';

  inputWrap.appendChild(input);
  inputWrap.appendChild(badge);
  palette.appendChild(inputWrap);

  // Results container
  var results = document.createElement('div');
  results.id = 'cmd-results';
  results.style.cssText = 'max-height:400px;overflow-y:auto;padding:8px;scrollbar-width:thin';
  palette.appendChild(results);

  overlay.appendChild(palette);
  document.body.appendChild(overlay);
  input.focus();
  renderCmdResults('');
}

function closeCommandPalette() {
  var el = document.getElementById('cmd-palette');
  if (el) el.remove();
  _cmdPaletteOpen = false;
}

function getCmdItems(query) {
  var items = [];
  var q = (query || '').toLowerCase().trim();

  // --- Navigation sections ---
  var navItems = [
    { id: 'dashboard', label: t('nav.dashboard') || 'Dashboard', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>', group: 'nav' },
    { id: 'planning', label: t('nav.planning') || 'Planning', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', group: 'nav' },
    { id: 'tasks', label: t('nav.tasks') || 'Tâches', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>', group: 'nav' },
    { id: 'models', label: t('nav.models') || 'Modèles', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', group: 'nav' },
    { id: 'chatters', label: t('nav.chatters') || 'Chatters', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>', group: 'nav' },
    { id: 'outreach', label: t('nav.outreach') || 'Outreach', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>', group: 'nav' },
    { id: 'finance', label: t('nav.finances') || 'Finances', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>', group: 'nav' },
    { id: 'performances', label: t('nav.performances') || 'Performances', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', group: 'nav' },
    { id: 'analytics', label: t('nav.analytics') || 'Analytics', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>', group: 'nav' },
    { id: 'stats', label: t('nav.stats') || 'Stats & Subs', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>', group: 'nav' },
    { id: 'coaching', label: t('nav.coaching') || 'Coaching', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>', group: 'nav' },
    { id: 'va', label: t('nav.va') || 'VA', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>', group: 'nav' },
    { id: 'activity-log', label: t('nav.journal') || 'Journal', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', group: 'nav' },
    { id: 'accounts', label: 'Accounts', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>', group: 'nav' }
  ];

  // Admin-only sections
  if (isAdmin()) {
    navItems.push({ id: 'settings', label: t('nav.settings') || 'Paramètres', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>', group: 'nav' });
  }

  // Filter nav by query
  navItems.forEach(function(item) {
    if (!q || item.label.toLowerCase().indexOf(q) !== -1 || item.id.indexOf(q) !== -1) {
      items.push(item);
    }
  });

  // --- Models ---
  if (typeof allModels !== 'undefined' && allModels.length > 0) {
    allModels.forEach(function(model) {
      if (!q || model.name.toLowerCase().indexOf(q) !== -1) {
        items.push({
          id: 'model-' + model.id,
          label: model.name,
          sub: (model.platforms || []).join(', '),
          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
          group: 'models',
          action: function() { openModelCockpit(model.id); }
        });
      }
    });
  }

  // --- Quick actions ---
  if (isAdmin()) {
    var actions = [
      { id: 'action-add-member', label: t('common.add_member') || 'Ajouter un membre', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>', action: function() { openModal('add-member'); } },
      { id: 'action-add-model', label: t('models.add_model') || 'Ajouter un modèle', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>', action: function() { openModal('add-model'); } },
      { id: 'action-add-task', label: t('tasks.add_task') || 'Ajouter une tâche', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>', action: function() { openModal('add-task'); } }
    ];
    actions.forEach(function(a) {
      if (!q || a.label.toLowerCase().indexOf(q) !== -1) {
        a.group = 'actions';
        items.push(a);
      }
    });
  }

  return items;
}

function renderCmdResults(query) {
  var container = document.getElementById('cmd-results');
  if (!container) return;

  var items = getCmdItems(query);
  _cmdSelectedIndex = 0;

  if (items.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">' + (t('cmd.no_results') || 'Aucun résultat') + '</div>';
    return;
  }

  // Group items
  var groups = {};
  var groupLabels = {
    nav: t('cmd.navigation') || 'Navigation',
    models: t('cmd.models') || 'Modèles',
    actions: t('cmd.actions') || 'Actions rapides'
  };

  items.forEach(function(item) {
    var g = item.group || 'nav';
    if (!groups[g]) groups[g] = [];
    groups[g].push(item);
  });

  var html = '';
  var globalIndex = 0;

  Object.keys(groups).forEach(function(groupKey) {
    html += '<div style="padding:6px 12px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted)">' + (groupLabels[groupKey] || groupKey) + '</div>';

    groups[groupKey].forEach(function(item) {
      var isSelected = globalIndex === _cmdSelectedIndex;
      html += '<div class="cmd-item" data-index="' + globalIndex + '" data-id="' + item.id + '" '
        + 'style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;transition:background 0.1s;'
        + (isSelected ? 'background:var(--accent-blue-subtle);' : '')
        + '" onmouseenter="selectCmdItem(' + globalIndex + ')" onclick="executeCmdItem(\'' + item.id + '\')">'
        + '<span style="display:flex;color:' + (isSelected ? 'var(--accent-blue-light)' : 'var(--text-muted)') + '">' + item.icon + '</span>'
        + '<span style="flex:1;font-size:14px;font-weight:500;color:' + (isSelected ? 'var(--text-primary)' : 'var(--text-secondary)') + '">' + item.label + '</span>'
        + (item.sub ? '<span style="font-size:11px;color:var(--text-muted)">' + item.sub + '</span>' : '')
        + (isSelected ? '<span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">↵</span>' : '')
        + '</div>';
      globalIndex++;
    });
  });

  container.innerHTML = html;
}

function selectCmdItem(index) {
  _cmdSelectedIndex = index;
  // Update visual selection
  document.querySelectorAll('.cmd-item').forEach(function(el, i) {
    if (i === index) {
      el.style.background = 'var(--accent-blue-subtle)';
      el.querySelector('span').style.color = 'var(--accent-blue-light)';
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.style.background = '';
      el.querySelector('span').style.color = 'var(--text-muted)';
    }
  });
}

function handleCmdKeyboard(e) {
  var items = document.querySelectorAll('.cmd-item');
  var total = items.length;
  if (total === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cmdSelectedIndex = (_cmdSelectedIndex + 1) % total;
    selectCmdItem(_cmdSelectedIndex);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cmdSelectedIndex = (_cmdSelectedIndex - 1 + total) % total;
    selectCmdItem(_cmdSelectedIndex);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var selected = items[_cmdSelectedIndex];
    if (selected) executeCmdItem(selected.getAttribute('data-id'));
  }
}

function executeCmdItem(id) {
  closeCommandPalette();

  // Check if it's a model
  if (id.startsWith('model-')) {
    var modelId = parseInt(id.replace('model-', ''));
    if (typeof openModelCockpit === 'function') openModelCockpit(modelId);
    return;
  }

  // Check if it's an action
  if (id.startsWith('action-')) {
    var items = getCmdItems('');
    var action = items.find(function(item) { return item.id === id; });
    if (action && action.action) action.action();
    return;
  }

  // It's a navigation section
  var navItem = document.querySelector('[data-section="' + id + '"]');
  if (navItem) {
    navItem.click();
  }
}

// openModelCockpit is defined in models.js — reused here via executeCmdItem
