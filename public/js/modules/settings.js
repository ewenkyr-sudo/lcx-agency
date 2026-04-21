// SETTINGS MODULE
// Extracted from dashboard.html

// ========== SETTINGS (Admin Only) ==========
let allUsers = [];
let agencySettings = {};

async function loadSettings() {
  if (!isAdmin()) return;
  try {
    const [usersRes, settingsRes] = await Promise.all([
      fetch('/api/users', { credentials: 'include' }),
      fetch('/api/settings', { credentials: 'include' })
    ]);
    if (usersRes.ok) allUsers = await usersRes.json();
    if (settingsRes.ok) agencySettings = await settingsRes.json();
  } catch (e) { console.error('Settings load error:', e); }
}

function renderSettings() {
  if (!isAdmin()) return;

  // Load user email
  fetch('/api/me/email', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : {}; }).then(function(data) {
    var el = document.getElementById('setting-user-email');
    if (el && data.email) el.value = data.email;
  }).catch(function() {});

  // Email stats badge
  var withEmail = allUsers.filter(function(u) { return u.email; }).length;
  var withoutEmail = allUsers.length - withEmail;
  var badge = document.getElementById('email-stats-badge');
  if (badge) {
    badge.innerHTML = '<span style="color:var(--green)">' + withEmail + ' avec email</span> · '
      + (withoutEmail > 0 ? '<span style="color:var(--red)">' + withoutEmail + ' sans email</span>' : '<span style="color:var(--green)">tous ont un email</span>');
  }

  // Agency settings
  const agName = agencySettings.agency_name || 'Fuzion Pilot';
  document.getElementById('setting-agency-name').value = agName;
  document.getElementById('logo-agency-name').textContent = agName;
  // Subtitle and logo are always Fuzion Pilot branded
  document.getElementById('logo-agency-subtitle').textContent = 'Fuzion Pilot';

  // Users table
  const tbody = document.getElementById('settings-users-table');
  const roleLabels = { platform_admin: 'Platform', super_admin: 'Super Admin', admin: 'Admin', chatter: 'Chatter', outreach: 'Outreach', va: 'VA', model: 'Modèle', student: 'Élève' };
  const roleColors = { admin: 'var(--pink)', chatter: 'var(--blue)', outreach: 'var(--green)', va: 'var(--yellow)', model: 'var(--accent)', student: 'var(--text3)' };

  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td data-label="" class="mc-title" style="gap:10px">
        <div style="position:relative;width:40px;height:40px;cursor:pointer;flex-shrink:0" onclick="document.getElementById('avatar-input-${u.id}').click()">
          ${u.avatar_url
            ? `<img src="${u.avatar_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover">`
            : `<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--pink));display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:white">${u.display_name.charAt(0)}</div>`
          }
          <div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;border:2px solid var(--bg2)">+</div>
          <input type="file" id="avatar-input-${u.id}" accept="image/*" style="display:none" onchange="uploadAvatar(${u.id}, this)">
        </div>
        <strong>${u.display_name}</strong> <span style="color:var(--text3);font-size:12px">@${u.username}</span>
      </td>
      <td data-label="Mdp actuel" class="mc-half">
        <code style="background:var(--bg3);padding:4px 8px;border-radius:4px;font-size:12px;color:var(--text3)">••••••</code>
      </td>
      <td data-label="Rôle" class="mc-half">
        <select onchange="changeUserRole(${u.id}, this.value)" class="form-input" style="padding:6px 10px;font-size:12px;width:100%;background:var(--bg3)" ${u.id === currentUser.id ? 'disabled' : ''}>
          ${Object.entries(roleLabels).map(([k,v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </td>
      <td data-label="Email" class="mc-half">
        <div style="display:flex;gap:4px;align-items:center;width:100%">
          <input type="email" id="email-user-${u.id}" class="form-input" style="padding:5px 8px;font-size:11px;flex:1" placeholder="email@..." value="${u.email || ''}">
          <button class="btn btn-primary" style="padding:5px 8px;font-size:10px" onclick="saveUserEmailAdmin(${u.id})">OK</button>
        </div>
        ${!u.email ? '<span style="font-size:10px;color:var(--red);display:block;margin-top:2px">Email manquant</span>' : ''}
      </td>
      <td data-label="Nouveau mdp" class="mc-half">
        <div style="display:flex;gap:6px;align-items:center;width:100%">
          <input type="text" id="pwd-user-${u.id}" class="form-input" style="padding:6px 10px;font-size:12px;flex:1" placeholder="Changer le mdp">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:11px" onclick="changeUserPassword(${u.id})">OK</button>
        </div>
      </td>
      <td data-label="" class="mc-actions">
        ${u.id !== currentUser.id ? `<button class="btn-delete-small" onclick="deleteUser(${u.id})" title="Supprimer">✕</button>` : '<span style="color:var(--text3);font-size:11px">Toi</span>'}
      </td>
    </tr>
  `).join('');

  // Models management
  const modelsDiv = document.getElementById('settings-models-content');
  modelsDiv.innerHTML = allModels.map(m => {
    const platforms = Array.isArray(m.platforms) ? m.platforms : JSON.parse(m.platforms || '[]');
    const modelAccounts = allAccounts.filter(a => a.model_id === m.id);
    return `
    <div class="panel" style="padding:16px;margin-bottom:12px;background:var(--bg3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <strong style="font-size:15px">${m.name}</strong>
          <span style="font-size:11px;padding:3px 8px;border-radius:6px;background:${m.status === 'active' ? 'var(--green-bg)' : 'var(--yellow-bg)'};color:${m.status === 'active' ? 'var(--green)' : 'var(--yellow)'}">${m.status}</span>
        </div>
        <button class="btn-delete-small" onclick="deleteModel(${m.id})">✕</button>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">Plateformes: ${platforms.join(', ') || 'Aucune'}</div>
      <div style="font-size:12px;color:var(--text3)">Comptes: ${modelAccounts.map(a => a.platform + ' (' + a.handle + ' — ' + a.current_followers + ' followers)').join(', ') || 'Aucun compte'}</div>
    </div>`;
  }).join('') || '<p style="color:var(--text3)">Aucun modèle</p>';

  // Outreach status preview
  var statusPreview = document.getElementById('outreach-status-preview');
  if (statusPreview) {
    statusPreview.innerHTML = Object.entries(leadStatusColors).map(function(e) {
      return '<span style="padding:6px 14px;border-radius:8px;background:' + e[1].bg + ';color:' + e[1].color + ';font-size:13px;font-weight:600">' + e[1].label + '</span>';
    }).join('');
  }

  // Coaching steps preview
  var stepsPreview = document.getElementById('coaching-steps-preview');
  if (stepsPreview) {
    stepsPreview.innerHTML = STEPS.map(function(s, i) {
      return '<div style="display:flex;align-items:center;gap:6px">'
        + '<span style="padding:6px 14px;border-radius:8px;background:var(--bg3);font-size:13px;font-weight:600">' + s.icon + ' ' + s.label + '</span>'
        + (i < STEPS.length - 1 ? '<span style="color:var(--text3)">→</span>' : '')
        + '</div>';
    }).join('');
  }
}

function switchSettingsTab(tabName) {
  // Panes
  document.querySelectorAll('.settings-pane').forEach(function(p) { p.classList.remove('active'); });
  var pane = document.getElementById('settings-pane-' + tabName);
  if (pane) pane.classList.add('active');
  // Sidebar buttons
  document.querySelectorAll('.settings-tab').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.querySelector('.settings-tab[data-tab="' + tabName + '"]');
  if (btn) btn.classList.add('active');
  // Mobile dropdown
  var mobile = document.getElementById('settings-tab-mobile');
  if (mobile) mobile.value = tabName;
  // Load sub-section data
  if (tabName === 'mon-agence') loadAgencyInfo();
  if (tabName === 'notifications') loadWhatsAppSettings();
  if (tabName === 'securite') renderAccessControl();
}

async function loadAgencyInfo() {
  try {
    const res = await fetch('/api/agency', { credentials: 'include' });
    if (!res.ok) return;
    const agency = await res.json();
    document.getElementById('agency-info-loading').style.display = 'none';
    document.getElementById('agency-info-content').style.display = 'block';
    document.getElementById('agency-edit-name').value = agency.name || '';
    document.getElementById('agency-edit-color').value = agency.primary_color || '#A855F7';
    document.getElementById('agency-color-label').textContent = agency.primary_color || '#A855F7';
    document.getElementById('agency-stat-members').textContent = agency.user_count || 0;
    document.getElementById('agency-stat-models').textContent = agency.model_count || 0;
    document.getElementById('agency-stat-leads').textContent = agency.lead_count || 0;
    // Update color label on input change
    document.getElementById('agency-edit-color').oninput = function() {
      document.getElementById('agency-color-label').textContent = this.value;
    };
  } catch(e) { console.error('Agency load error:', e); }
}

async function saveAgencyInfo() {
  const name = document.getElementById('agency-edit-name').value;
  const primary_color = document.getElementById('agency-edit-color').value;
  const res = await fetch('/api/agency', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, primary_color })
  });
  if (res.ok) {
    showToast(t('settings.agency_updated_toast'), 'success');
    // Apply color override
    if (primary_color) {
      document.documentElement.style.setProperty('--accent', primary_color);
    }
  } else {
    const err = await res.json();
    showToast(err.error || t('common.error'), 'error');
  }
}

async function saveAgencySettings() {
  const name = document.getElementById('setting-agency-name').value;
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ agency_name: name })
  });
  if (res.ok) {
    showToast(t('settings.settings_saved_toast'), 'success');
    agencySettings.agency_name = name;
    document.getElementById('logo-agency-name').textContent = name;
  }
}

async function saveUserEmail() {
  var email = document.getElementById('setting-user-email').value.trim();
  if (!email) return showToast(t('settings.email_required'), 'error');
  var res = await fetch('/api/me/email', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: email })
  });
  if (res.ok) showToast(t('settings.email_saved_toast'), 'success');
  else showToast(t('common.error'), 'error');
}

async function resetPasswords(role, inputId) {
  const input = document.getElementById(inputId);
  const pwd = input.value.trim();
  if (!pwd || pwd.length < 4) { showToast(t('settings.password_too_short'), 'error'); return; }
  if (!(await confirmDelete(`Réinitialiser le mot de passe de tous les ${role}s ? Cette action est irréversible.`))) return;
  const res = await fetch('/api/admin/reset-passwords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role, new_password: pwd })
  });
  if (res.ok) {
    const data = await res.json();
    showToast(`${data.updated} utilisateur(s) mis à jour !`, 'success');
    input.value = '';
  }
}

async function addUser() {
  const form = document.getElementById('form-add-user');
  const data = Object.fromEntries(new FormData(form));
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (res.ok) {
    closeModal('add-user');
    form.reset();
    await loadSettings();
    renderSettings();
  } else {
    const err = await res.json();
    showToast(err.error || t('common.error'), 'error');
  }
}

async function uploadAvatar(userId, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return showToast(t('settings.image_too_large'), 'error');

  const reader = new FileReader();
  reader.onload = async () => {
    // Redimensionner l'image avant upload
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Crop carré centré
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      const base64 = canvas.toDataURL('image/jpeg', 0.8);

      const res = await fetch('/api/users/' + userId + '/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ avatar_url: base64 })
      });
      if (res.ok) {
        showToast(t('settings.avatar_updated_toast'), 'success');
        await loadSettings();
        renderSettings();
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function changeUserRole(userId, newRole) {
  await fetch(`/api/users/${userId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role: newRole })
  });
}

async function saveUserEmailAdmin(userId) {
  var email = document.getElementById('email-user-' + userId).value.trim();
  if (!email) return showToast('Email requis', 'error');
  var res = await fetch('/api/users/' + userId + '/email', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify({ email: email })
  });
  if (res.ok) { showToast('Email sauvegardé !', 'success'); loadAllData(); }
  else { var d = await res.json(); showToast(d.error || t('common.error'), 'error'); }
}

async function changeUserPassword(userId) {
  const input = document.getElementById(`pwd-user-${userId}`);
  const pwd = input.value.trim();
  if (!pwd || pwd.length < 4) { showToast('Mot de passe trop court (min 4 caractères)', 'error'); return; }
  const res = await fetch(`/api/users/${userId}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password: pwd })
  });
  if (res.ok) {
    showToast(t('settings.password_changed_toast'), 'success');
    input.value = '';
  }
}

async function deleteUser(userId) {
  if (!(await confirmDelete('Supprimer cet utilisateur ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/users/${userId}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadSettings();
    renderSettings();
  }
}

// ============ WHATSAPP & NOTIFICATION SETTINGS ============
async function saveWhatsAppSettings() {
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({
      whatsapp_provider: document.getElementById('setting-wa-provider').value,
      whatsapp_number: document.getElementById('setting-wa-number').value.trim(),
      whatsapp_api_key: document.getElementById('setting-wa-apikey').value.trim()
    })
  });
  showToast(t('settings.whatsapp_saved_toast'), 'success');
}

async function testWhatsApp() {
  showToast(t('settings.test_sending'), 'info');
  await fetch('/api/admin/test-whatsapp', { method: 'POST', credentials: 'include' });
  showToast(t('settings.test_sent'), 'success');
}

async function testDailyReport() {
  showToast(t('settings.daily_sending'), 'info');
  await fetch('/api/admin/test-daily-report', { method: 'POST', credentials: 'include' });
  showToast(t('settings.daily_sent'), 'success');
}

async function testWeeklyReport() {
  showToast(t('settings.weekly_sending'), 'info');
  await fetch('/api/admin/test-weekly-report', { method: 'POST', credentials: 'include' });
  showToast(t('settings.weekly_sent'), 'success');
}

async function saveNotifSettings() {
  const extra = document.getElementById('setting-wa-extra').value.trim().split('\n').map(s => s.trim()).filter(Boolean).join(',');
  const res = await fetch('/api/admin/save-notif-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({
      notif_daily_report: document.getElementById('setting-notif-daily').checked ? 'true' : 'false',
      notif_weekly_report: document.getElementById('setting-notif-weekly').checked ? 'true' : 'false',
      notif_alert_lead_signed: document.getElementById('setting-notif-lead-signed').checked ? 'true' : 'false',
      notif_alert_lead_warm: document.getElementById('setting-notif-lead-warm').checked ? 'true' : 'false',
      notif_alert_revenue_objective: document.getElementById('setting-notif-revenue-obj').checked ? 'true' : 'false',
      notif_alert_inactive_chatter: document.getElementById('setting-notif-inactive-chatter').checked ? 'true' : 'false',
      notif_daily_hour: document.getElementById('setting-notif-daily-hour').value || '20:00',
      whatsapp_extra_recipients: extra
    })
  });
  if (res.ok) showToast(t('settings.notif_saved_toast'), 'success');
  else showToast(t('settings.save_error'), 'error');
}

function loadWhatsAppSettings() {
  if (agencySettings.whatsapp_provider) document.getElementById('setting-wa-provider').value = agencySettings.whatsapp_provider;
  if (agencySettings.whatsapp_number) document.getElementById('setting-wa-number').value = agencySettings.whatsapp_number;
  if (agencySettings.whatsapp_api_key) document.getElementById('setting-wa-apikey').value = agencySettings.whatsapp_api_key;
  // Notification toggles
  document.getElementById('setting-notif-daily').checked = agencySettings.notif_daily_report !== 'false';
  document.getElementById('setting-notif-weekly').checked = agencySettings.notif_weekly_report !== 'false';
  document.getElementById('setting-notif-lead-signed').checked = agencySettings.notif_alert_lead_signed !== 'false';
  document.getElementById('setting-notif-lead-warm').checked = agencySettings.notif_alert_lead_warm !== 'false';
  document.getElementById('setting-notif-revenue-obj').checked = agencySettings.notif_alert_revenue_objective !== 'false';
  document.getElementById('setting-notif-inactive-chatter').checked = agencySettings.notif_alert_inactive_chatter !== 'false';
  if (agencySettings.notif_daily_hour) document.getElementById('setting-notif-daily-hour').value = agencySettings.notif_daily_hour;
  if (agencySettings.whatsapp_extra_recipients) document.getElementById('setting-wa-extra').value = agencySettings.whatsapp_extra_recipients.split(',').join('\n');
}

async function loadDbSize() {
  var res = await fetch('/api/admin/db-size', { credentials: 'include' });
  if (!res.ok) return;
  var data = await res.json();
  var sizeMB = (data.total_bytes / 1024 / 1024).toFixed(2);
  var html = '<strong>Espace total : ' + sizeMB + ' Mo</strong><br>';
  html += '<div style="margin-top:8px;display:grid;gap:4px">';
  (data.tables || []).forEach(function(t) {
    html += '<div style="font-size:12px"><span style="color:var(--text)">' + t.table_name + '</span> — <span style="color:var(--accent)">' + t.row_count + ' lignes</span></div>';
  });
  html += '</div>';
  document.getElementById('db-size-info').innerHTML = html;
}
