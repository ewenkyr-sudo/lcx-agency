// ========================================
// FUZION PILOT — AGENCY SWITCHER
// Multi-agency context switching
// ========================================

var _agencySwitcherOpen = false;

function renderAgencySwitcher() {
  var container = document.getElementById('agency-switcher');
  if (!container) return;

  var agencies = currentUser.agencies || [];

  // If user has only 1 agency, show simple name (no switcher)
  if (agencies.length <= 1) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  var current = agencies.find(function(a) { return a.agency_id === currentUser.agency_id; }) || agencies[0];

  container.innerHTML = ''
    + '<button onclick="toggleAgencySwitcher()" id="agency-switcher-btn" style="'
    + 'width:100%;display:flex;align-items:center;gap:10px;padding:8px 12px;'
    + 'background:var(--bg-base);border:1px solid var(--border-default);'
    + 'border-radius:var(--radius-md);cursor:pointer;transition:all var(--duration-normal);'
    + 'font-family:inherit;color:var(--text-primary);font-size:13px;text-align:left">'
    + '<div style="width:28px;height:28px;border-radius:var(--radius-sm);'
    + 'background:linear-gradient(135deg,#2563EB,#3B82F6);display:flex;'
    + 'align-items:center;justify-content:center;font-size:11px;font-weight:700;'
    + 'color:white;flex-shrink:0">' + (current.agency_name || 'A').charAt(0).toUpperCase() + '</div>'
    + '<div style="flex:1;min-width:0">'
    + '<div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (current.agency_name || 'Agency') + '</div>'
    + '<div style="font-size:10px;color:var(--text-muted);text-transform:capitalize">' + (current.role || '').replace('_', ' ') + '</div>'
    + '</div>'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>'
    + '</button>'
    + '<div id="agency-switcher-dropdown" style="display:none;position:absolute;left:12px;right:12px;'
    + 'background:var(--bg-elevated);border:1px solid var(--border-default);'
    + 'border-radius:var(--radius-lg);box-shadow:var(--shadow-xl);z-index:200;'
    + 'margin-top:4px;overflow:hidden;animation:ds-fade-in 0.15s ease">'
    + '<div style="padding:8px 12px;border-bottom:1px solid var(--border-default);'
    + 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;'
    + 'color:var(--text-muted)">' + (t('agency.switch_label') || 'Agences') + '</div>'
    + '<div style="padding:4px">'
    + agencies.map(function(a) {
      var isCurrent = a.agency_id === currentUser.agency_id;
      var typeLabel = a.agency_type === 'student_owned' ? '(Élève)' : '';
      var colors = ['#3B82F6','#8B5CF6','#22C55E','#F59E0B','#06B6D4','#EC4899'];
      var color = colors[agencies.indexOf(a) % colors.length];
      return '<button onclick="switchAgency(' + a.agency_id + ')" style="'
        + 'width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;'
        + 'border:none;background:' + (isCurrent ? 'var(--accent-blue-subtle)' : 'transparent') + ';'
        + 'border-radius:var(--radius-md);cursor:pointer;transition:background var(--duration-fast);'
        + 'font-family:inherit;color:var(--text-primary);font-size:13px;text-align:left"'
        + ' onmouseenter="this.style.background=\'' + (isCurrent ? 'var(--accent-blue-subtle)' : 'var(--bg-subtle)') + '\'"'
        + ' onmouseleave="this.style.background=\'' + (isCurrent ? 'var(--accent-blue-subtle)' : 'transparent') + '\'">'
        + '<div style="width:24px;height:24px;border-radius:6px;'
        + 'background:' + color + ';display:flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:700;color:white;flex-shrink:0">'
        + (a.agency_name || 'A').charAt(0).toUpperCase() + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-weight:' + (isCurrent ? '600' : '500') + ';font-size:12px;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
        + 'color:' + (isCurrent ? 'var(--accent-blue-light)' : 'var(--text-primary)') + '">'
        + (a.agency_name || 'Agency') + ' ' + typeLabel + '</div>'
        + '<div style="font-size:10px;color:var(--text-muted);text-transform:capitalize">'
        + (a.role || '').replace('_', ' ') + '</div>'
        + '</div>'
        + (isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '')
        + '</button>';
    }).join('')
    + '</div></div>';
}

function toggleAgencySwitcher() {
  _agencySwitcherOpen = !_agencySwitcherOpen;
  var dd = document.getElementById('agency-switcher-dropdown');
  if (dd) dd.style.display = _agencySwitcherOpen ? 'block' : 'none';
}

async function switchAgency(agencyId) {
  if (agencyId === currentUser.agency_id) {
    toggleAgencySwitcher();
    return;
  }
  try {
    var res = await fetch('/api/agency-context/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ agency_id: agencyId })
    });
    if (!res.ok) {
      var err = await res.json();
      showToast(err.error || 'Erreur', 'error');
      return;
    }
    // Reload the entire app to reflect new agency context
    showToast(t('agency.switching') || 'Changement d\'agence...', 'info');
    setTimeout(function() { window.location.reload(); }, 500);
  } catch(e) {
    showToast('Erreur réseau', 'error');
  }
}

// Close switcher when clicking outside
document.addEventListener('click', function(e) {
  if (_agencySwitcherOpen && !e.target.closest('#agency-switcher')) {
    _agencySwitcherOpen = false;
    var dd = document.getElementById('agency-switcher-dropdown');
    if (dd) dd.style.display = 'none';
  }
});
