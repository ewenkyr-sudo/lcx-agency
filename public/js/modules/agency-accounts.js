// AGENCY ACCOUNTS MODULE
// Instagram/TikTok accounts managed by the agency team

var ACCOUNT_CATEGORIES = [
  { key: 'personal_brand', labelKey: 'acc.cat_personal', icon: '👤', color: '#3B82F6' },
  { key: 'fake_models', labelKey: 'acc.cat_fake', icon: '🎭', color: '#8B5CF6' },
  { key: 'assistantes', labelKey: 'acc.cat_assistants', icon: '💬', color: '#22D3EE' },
  { key: 'agency', labelKey: 'acc.cat_agency', icon: '🏢', color: '#10B981' }
];

function getAccCatLabel(cat) { return t(cat.labelKey); }

var agencyAccounts = [];

async function renderAgencyAccounts() {
  var container = document.getElementById('accounts-content');
  var actions = document.getElementById('accounts-actions');
  if (!container) return;
  if (isAdmin()) {
    actions.innerHTML = '<button class="btn btn-primary" onclick="openAddAccountModal()">' + t('acc.add_btn') + '</button>';
  }

  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">' + t('common.loading') + '</div>';
  var res = await fetch('/api/agency-accounts', { credentials: 'include' });
  agencyAccounts = await res.json();

  // KPIs
  var total = agencyAccounts.length;
  var byCat = {};
  ACCOUNT_CATEGORIES.forEach(function(c) { byCat[c.key] = agencyAccounts.filter(function(a) { return a.category === c.key; }).length; });
  var growing = agencyAccounts.filter(function(a) { return a.current_followers > a.previous_followers; }).length;
  var declining = agencyAccounts.filter(function(a) { return a.current_followers < a.previous_followers && a.previous_followers > 0; }).length;

  var html = '<div class="coaching-kpi-bar" style="grid-template-columns:repeat(auto-fit,minmax(90px,1fr));margin-bottom:20px">'
    + '<div class="coaching-kpi"><div class="coaching-kpi-value">' + total + '</div><div class="coaching-kpi-label">' + t('acc.total') + '</div></div>'
    + ACCOUNT_CATEGORIES.map(function(c) {
      return '<div class="coaching-kpi"><div class="coaching-kpi-value" style="color:' + c.color + '">' + (byCat[c.key] || 0) + '</div><div class="coaching-kpi-label">' + c.icon + ' ' + getAccCatLabel(c) + '</div></div>';
    }).join('')
    + '</div>';

  // Tabs by category
  html += '<div class="tabs" style="margin-bottom:16px">'
    + '<button class="tab active" onclick="filterAccountsCat(null,this)">' + t('acc.all_tab', { count: total }) + '</button>'
    + ACCOUNT_CATEGORIES.map(function(c) { return '<button class="tab" onclick="filterAccountsCat(\'' + c.key + '\',this)">' + c.icon + ' ' + getAccCatLabel(c) + ' (' + (byCat[c.key]||0) + ')</button>'; }).join('')
    + '</div>';

  html += '<div id="accounts-list"></div>';
  container.innerHTML = html;
  renderAccountsList(agencyAccounts);
}

var currentAccountCat = null;

function filterAccountsCat(cat, btn) {
  currentAccountCat = cat;
  document.querySelectorAll('#accounts-content .tab').forEach(function(tb) { tb.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var filtered = cat ? agencyAccounts.filter(function(a) { return a.category === cat; }) : agencyAccounts;
  renderAccountsList(filtered);
}

function renderAccountsList(accounts) {
  var el = document.getElementById('accounts-list');
  if (!el) return;
  if (accounts.length === 0) { el.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px">' + t('acc.no_accounts_cat') + '</div>'; return; }

  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">'
    + accounts.map(function(a) {
      var cat = ACCOUNT_CATEGORIES.find(function(c) { return c.key === a.category; }) || ACCOUNT_CATEGORIES[3];
      var diff = a.current_followers - a.previous_followers;
      var diffSign = diff >= 0 ? '+' : '';
      var diffColor = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text-tertiary)';
      var platIcon = a.platform === 'instagram' ? '📸' : a.platform === 'tiktok' ? '🎵' : '📱';

      return '<div style="background:var(--bg-base);border-radius:14px;padding:16px;border-left:3px solid ' + cat.color + ';transition:all 0.2s" onmouseover="this.style.borderColor=\'' + cat.color + '\'" onmouseout="this.style.borderColor=\'' + cat.color + '\'">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
        + '<img src="https://unavatar.io/' + (a.platform||'instagram') + '/' + (a.handle||'').replace(/^@/,'') + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid ' + cat.color + '40" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
        + '<div style="display:none;width:48px;height:48px;border-radius:50%;background:' + cat.color + ';align-items:center;justify-content:center;font-size:20px;font-weight:700;color:white;flex-shrink:0">' + (a.handle||'?').replace(/^@/,'').charAt(0).toUpperCase() + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + platIcon + ' ' + a.handle + '</div>'
        + '<div style="font-size:11px;color:var(--text-tertiary)">' + cat.icon + ' ' + getAccCatLabel(cat) + (a.assigned_name ? ' · ' + a.assigned_name : '') + '</div>'
        + (a.purpose ? '<div style="font-size:10px;color:var(--text-tertiary);font-style:italic">' + a.purpose + '</div>' : '')
        + '</div>'
        + '</div>'
        // Stats
        + '<div class="grid-2col" style="gap:8px">'
        + '<div style="background:var(--bg2);padding:8px;border-radius:8px;text-align:center"><div style="font-size:16px;font-weight:800">' + (a.current_followers || 0).toLocaleString() + '</div><div style="font-size:10px;color:var(--text-tertiary)">' + t('acc.followers') + '</div></div>'
        + '<div style="background:var(--bg2);padding:8px;border-radius:8px;text-align:center"><div style="font-size:16px;font-weight:800;color:' + diffColor + '">' + diffSign + diff.toLocaleString() + '</div><div style="font-size:10px;color:var(--text-tertiary)">' + t('acc.evolution') + '</div></div>'
        + '</div>'
        // Actions
        + (isAdmin() ? '<div style="display:flex;gap:6px;margin-top:10px">'
          + '<a href="https://instagram.com/' + a.handle.replace(/^@/,'') + '" target="_blank" class="btn btn-secondary" style="font-size:11px;padding:5px 10px;text-decoration:none;flex:1;text-align:center">' + t('acc.view_profile') + '</a>'
          + '<button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" onclick="editAgencyAccount(' + a.id + ')">' + t('acc.edit_btn') + '</button>'
          + '<button class="btn-delete-small" onclick="deleteAgencyAccount(' + a.id + ')">✕</button>'
          + '</div>' : '')
        + '</div>';
    }).join('') + '</div>';
}

function openAddAccountModal(editId) {
  var acc = editId ? agencyAccounts.find(function(a) { return a.id === editId; }) : null;
  var teamOpts = '<option value="">—</option>' + (window.allTeam || []).concat(window.allUsers || []).filter(function(u,i,arr) { return arr.findIndex(function(x) { return x.id === u.id; }) === i; }).map(function(u) { return '<option value="' + u.id + '"' + (acc && acc.assigned_to_id === u.id ? ' selected' : '') + '>' + (u.display_name || u.name) + '</option>'; }).join('');
  var catOpts = ACCOUNT_CATEGORIES.map(function(c) { return '<option value="' + c.key + '"' + (acc && acc.category === c.key ? ' selected' : '') + '>' + c.icon + ' ' + getAccCatLabel(c) + '</option>'; }).join('');

  var html = '<div class="modal-overlay show" id="acc-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">' + (acc ? t('acc.edit_title') : t('acc.add_title')) + '</div><button class="modal-close" onclick="document.getElementById(\'acc-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">@Handle *</label><input class="form-input" id="acc-handle" value="' + (acc ? acc.handle : '') + '" placeholder="@username"></div>'
    + '<div class="grid-2col" style="gap:10px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_platform') + '</label><select class="form-input" id="acc-platform"><option value="instagram"' + (acc && acc.platform==='instagram'?' selected':'') + '>📸 Instagram</option><option value="tiktok"' + (acc && acc.platform==='tiktok'?' selected':'') + '>🎵 TikTok</option></select></div>'
    + '<div class="form-group"><label class="form-label">' + t('student.category_label') + '</label><select class="form-input" id="acc-category">' + catOpts + '</select></div></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_assigned') + '</label><select class="form-input" id="acc-assigned">' + teamOpts + '</select></div>'
    + '<div class="form-group"><label class="form-label">' + t('common.description') + '</label><input class="form-input" id="acc-purpose" value="' + (acc ? (acc.purpose||'') : '') + '" placeholder="' + t('acc.description_placeholder') + '"></div>'
    + '</div><div class="modal-footer">'
    + (acc ? '<button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer" onclick="deleteAgencyAccount(' + acc.id + ');document.getElementById(\'acc-modal\').remove()">' + t('common.delete') + '</button>' : '')
    + '<div style="flex:1"></div><button class="btn btn-secondary" onclick="document.getElementById(\'acc-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="saveAgencyAccount(' + (editId || 'null') + ')">' + (acc ? t('common.save_btn') : t('common.add')) + '</button>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function editAgencyAccount(id) { openAddAccountModal(id); }

async function saveAgencyAccount(editId) {
  var handle = document.getElementById('acc-handle').value.trim();
  if (!handle) return showToast(t('acc.handle_required'), 'error');
  var data = { handle: handle, platform: document.getElementById('acc-platform').value, category: document.getElementById('acc-category').value, assigned_to_id: document.getElementById('acc-assigned').value ? parseInt(document.getElementById('acc-assigned').value) : null, purpose: document.getElementById('acc-purpose').value };
  var url = editId ? '/api/agency-accounts/' + editId : '/api/agency-accounts';
  var method = editId ? 'PUT' : 'POST';
  var res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) { document.getElementById('acc-modal')?.remove(); showToast(editId ? t('acc.account_modified') : t('acc.account_added'), 'success'); renderAgencyAccounts(); }
  else showToast(t('common.error'), 'error');
}

async function deleteAgencyAccount(id) {
  if (!(await confirmDelete(t('acc.delete_confirm')))) return;
  await fetch('/api/agency-accounts/' + id, { method: 'DELETE', credentials: 'include' });
  showToast(t('acc.account_deleted'), 'success');
  renderAgencyAccounts();
}
