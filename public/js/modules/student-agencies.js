// ========================================
// FUZION PILOT — STUDENT AGENCIES ADMIN
// Manage student-owned agencies
// ========================================

// Show tab only for super_admin / platform_admin
function initStudentAgenciesTab() {
  if (!currentUser || (currentUser.role !== 'super_admin' && currentUser.role !== 'platform_admin')) return;
  var tab = document.getElementById('tab-student-agencies');
  if (tab) tab.style.display = 'block';
}

async function loadStudentAgencies() {
  var container = document.getElementById('student-agencies-list');
  if (!container) return;

  try {
    var res = await fetch('/api/admin/student-agencies', { credentials: 'include' });
    if (!res.ok) { container.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:20px">' + t('settings.no_student_agencies') + '</div>'; return; }
    var agencies = await res.json();

    if (agencies.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-tertiary)">'
        + '<div style="font-size:2rem;margin-bottom:12px">🏢</div>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px">' + (t('settings.no_student_agencies') || 'Aucune agence élève') + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted)">' + (t('settings.no_student_agencies_desc') || 'Créez une agence pour vos élèves afin qu\'ils puissent gérer leur propre activité.') + '</div>'
        + '</div>';
      return;
    }

    container.innerHTML = '<div style="display:grid;gap:12px">' + agencies.map(function(a) {
      var members = (a.members || []).map(function(m) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:var(--accent-blue-subtle);border-radius:var(--radius-sm);font-size:11px;color:var(--accent-blue-light);font-weight:600">'
          + m.display_name + ' <span style="color:var(--text-muted);font-weight:400">(' + (m.role || '').replace('_',' ') + ')</span></span>';
      }).join(' ');

      var date = new Date(a.created_at).toLocaleDateString(window.currentLang === 'en' ? 'en-US' : 'fr-FR');

      return '<div style="background:var(--bg-base);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:16px">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
        + '<div><div style="font-size:14px;font-weight:700">' + a.name + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + (t('settings.created') || 'Créée le') + ' ' + date + ' · '
        + '<span style="color:var(--accent-green)">' + a.billing_status + '</span></div></div>'
        + '<span class="badge badge-blue" style="font-size:9px">' + a.agency_type + '</span></div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + (members || '<span style="color:var(--text-muted);font-size:12px">Aucun membre</span>') + '</div>'
        + '</div>';
    }).join('') + '</div>';
  } catch(e) {
    container.innerHTML = '<div style="color:var(--accent-red);padding:20px;text-align:center">Erreur: ' + e.message + '</div>';
  }
}

function showCreateStudentAgencyModal() {
  // Fetch only users with role='student' in current agency
  fetch('/api/users', { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(users) {
    var students = (users || []).filter(function(u) { return u.role === 'student'; });
    _showCreateModal(students.map(function(u) { return { user_id: u.id, display_name: u.display_name, name: u.display_name }; }));
  }).catch(function() { _showCreateModal([]); });
}

function _showCreateModal(students) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.id = 'create-student-agency-modal';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = '<div class="modal" style="width:500px">'
    + '<div class="modal-header"><div class="modal-title">' + (t('settings.create_student_agency') || 'Créer une agence élève') + '</div>'
    + '<button class="modal-close" onclick="document.getElementById(\'create-student-agency-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + (t('settings.agency_name') || 'Nom de l\'agence') + '</label>'
    + '<input type="text" id="new-student-agency-name" class="form-input" placeholder="Ex: Gaby Agency"></div>'
    + '<div class="form-group"><label class="form-label">' + (t('settings.select_students') || 'Élèves') + '</label>'
    + '<div id="student-checkboxes" style="display:grid;gap:6px;max-height:200px;overflow-y:auto">'
    + students.map(function(s) {
      return '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-base);border-radius:var(--radius-md);cursor:pointer;font-size:13px">'
        + '<input type="checkbox" value="' + s.user_id + '" class="student-agency-cb" style="accent-color:var(--accent-blue);width:16px;height:16px">'
        + '<span style="font-weight:600">' + (s.display_name || s.name || 'Student') + '</span>'
        + '</label>';
    }).join('')
    + '</div></div>'
    + '<div class="form-group"><label class="form-label">' + (t('settings.transfer_data') || 'Transférer les données') + '</label>'
    + '<div style="display:grid;gap:6px">'
    + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="transfer-outreach" style="accent-color:var(--accent-blue);width:16px;height:16px"> Outreach leads</label>'
    + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="transfer-student-leads" style="accent-color:var(--accent-blue);width:16px;height:16px"> Student leads</label>'
    + '</div></div>'
    + '</div>'
    + '<div class="modal-footer">'
    + '<button class="btn btn-secondary" onclick="document.getElementById(\'create-student-agency-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="createStudentAgency()">' + (t('settings.create') || 'Créer') + '</button>'
    + '</div></div>';

  document.body.appendChild(overlay);
}

async function createStudentAgency() {
  var name = document.getElementById('new-student-agency-name').value.trim();
  if (!name) { showToast(t('settings.name_required') || 'Nom requis', 'error'); return; }

  var selectedIds = [];
  document.querySelectorAll('.student-agency-cb:checked').forEach(function(cb) { selectedIds.push(parseInt(cb.value)); });
  if (selectedIds.length === 0) { showToast(t('settings.select_at_least_one') || 'Sélectionnez au moins un élève', 'error'); return; }

  var transferData = {
    outreach: document.getElementById('transfer-outreach').checked,
    student_leads: document.getElementById('transfer-student-leads').checked
  };

  try {
    var res = await fetch('/api/admin/student-agencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ agency_name: name, student_user_ids: selectedIds, transfer_data: transferData })
    });

    var data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erreur', 'error'); return; }

    showToast((t('settings.agency_created') || 'Agence créée !') + ' — ' + name, 'success');
    document.getElementById('create-student-agency-modal').remove();
    loadStudentAgencies();
  } catch(e) {
    showToast('Erreur réseau', 'error');
  }
}
