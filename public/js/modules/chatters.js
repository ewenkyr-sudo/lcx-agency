// CHATTERS MODULE
// Extracted from dashboard.html

function renderVA() {
  const vas = allTeam.filter(m => m.role === 'va');
  renderTeamTable('va-table', vas);
}

function renderTeamTable(tableId, members) {
  const table = document.getElementById(tableId);
  table.classList.add('mobile-cards');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = members.map(m => {
    const av = m.avatar_url ? avatarHTML({ avatar_url: m.avatar_url, display_name: m.name }, 32) : avatarHTML({ display_name: m.name }, 32);
    var online = isUserOnline(m.user_id);
    return `
    <tr>
      <td data-label="" class="mc-title" data-user-id="${m.user_id || 0}">
        <div class="member-info" style="gap:10px">
          <div style="position:relative">${av}${online ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--bg2)"></span>' : ''}</div>
          <div><div class="member-name">${m.name}${online ? '<span class="online-dot" style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:50%;margin-left:6px"></span>' : ''}</div></div>
        </div>
      </td>
      <td data-label="Rôle" class="mc-half">${m.role}</td>
      <td data-label="Shift" class="mc-half">${m.shift || 'N/A'}</td>
      <td data-label="Plateformes" class="mc-half">${m.platform || 'N/A'}</td>
      <td data-label="Status" class="mc-half"><span class="badge badge-${online ? 'online' : m.status}">${online ? 'En ligne' : m.status}</span></td>
      <td data-label="" class="mc-actions">${isAdmin() ? `<button class="btn-delete-small" onclick="deleteTeamMember(${m.id})">✕</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderStats() {
  const platformIcons = { instagram: '📸', tiktok: '🎵', onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥', telegram: '✈️' };
  const platformColors = { instagram: '#E4405F', tiktok: '#00f2ea', onlyfans: '#00AFF0', fansly: '#E040FB', fanvue: '#10B981', mym: '#F97316', telegram: '#229ED9' };

  // KPIs globaux
  const totalFollowers = allAccounts.reduce((sum, a) => sum + (a.current_followers || 0), 0);
  const igTotal = allAccounts.filter(a => a.platform === 'instagram').reduce((sum, a) => sum + (a.current_followers || 0), 0);
  const tkTotal = allAccounts.filter(a => a.platform === 'tiktok').reduce((sum, a) => sum + (a.current_followers || 0), 0);
  const ofTotal = allAccounts.filter(a => a.platform === 'onlyfans').reduce((sum, a) => sum + (a.current_followers || 0), 0);

  const kpisDiv = document.getElementById('followers-kpis');
  kpisDiv.innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalFollowers.toLocaleString()}</div><div class="stat-label">Total followers</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#E4405F">${igTotal.toLocaleString()}</div><div class="stat-label">Instagram</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#00f2ea">${tkTotal.toLocaleString()}</div><div class="stat-label">TikTok</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#00AFF0">${ofTotal.toLocaleString()}</div><div class="stat-label">OnlyFans</div></div>
  `;

  // Cartes par modèle
  const cardsDiv = document.getElementById('followers-cards');
  const modelGroups = {};
  allAccounts.forEach(a => {
    if (!modelGroups[a.model_name]) modelGroups[a.model_name] = [];
    modelGroups[a.model_name].push(a);
  });

  cardsDiv.innerHTML = Object.entries(modelGroups).map(([modelName, accounts]) => {
    const modelTotal = accounts.reduce((sum, a) => sum + (a.current_followers || 0), 0);
    return `
    <div class="panel" style="padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <strong style="font-size:16px">${modelName}</strong>
          <span style="color:var(--text3);font-size:13px;margin-left:10px">${modelTotal.toLocaleString()} followers total</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:12px">
        ${accounts.map(acc => {
          const prev = acc.previous_followers || acc.current_followers || 0;
          const curr = acc.current_followers || 0;
          const diff = curr - prev;
          const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : '0.0';
          const isUp = diff > 0;
          const isDown = diff < 0;
          const color = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--text3)';
          const arrow = isUp ? '↑' : isDown ? '↓' : '—';
          const sign = isUp ? '+' : '';
          const autoUpdated = acc.platform === 'instagram' || acc.platform === 'tiktok';
          const lastUpdate = acc.last_scraped ? new Date(acc.last_scraped).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
          let bottomHTML = '';
          if (autoUpdated) {
            bottomHTML = '<div style="font-size:9px;color:var(--text3);margin-top:4px">Auto-refresh' + (lastUpdate ? ' — màj ' + lastUpdate : '') + '</div>';
          } else {
            bottomHTML = '<div style="display:flex;align-items:center;gap:6px;margin-top:6px"><input type="number" id="manual-followers-' + acc.id + '" class="form-input" style="padding:4px 8px;font-size:12px;width:100px" placeholder="' + curr + '" min="0"><button class="btn btn-primary" style="padding:4px 10px;font-size:11px" onclick="updateManualFollowers(' + acc.id + ')">OK</button></div>';
          }

          return '<div style="background:var(--bg3);border-radius:10px;padding:14px;border-left:3px solid ' + (platformColors[acc.platform] || 'var(--accent)') + '">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
            + '<span style="font-size:13px;font-weight:600">' + (platformIcons[acc.platform] || '📱') + ' ' + acc.platform + '</span>'
            + '<span style="font-size:11px;color:var(--text3)">' + acc.handle + '</span>'
            + '</div>'
            + '<div style="font-size:24px;font-weight:800;margin-bottom:4px">' + curr.toLocaleString() + '</div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center">'
            + '<span style="font-size:13px;font-weight:600;color:' + color + '">' + arrow + ' ' + sign + diff.toLocaleString() + ' (' + sign + pct + '%)</span>'
            + '</div>'
            + bottomHTML
            + '</div>';
        }).join('')}
      </div>
    </div>`;
  }).join('');

  cardsDiv.innerHTML += isAdmin() ? `<button class="btn btn-primary" onclick="openModal('add-account')" style="margin-top:8px">+ Ajouter un compte</button>` : '';

  // Populate model select in add-account modal
  const select = document.getElementById('account-model-select');
  if (select) select.innerHTML = allModels.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

async function updateManualFollowers(accId) {
  const input = document.getElementById('manual-followers-' + accId);
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) return showToast('Nombre invalide', 'error');
  const res = await fetch('/api/accounts/' + accId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ current_followers: val })
  });
  if (res.ok) {
    showToast('Followers mis à jour !', 'success');
    await reloadAccounts();
  }
}

async function refreshFollowers() {
  showToast('Mise à jour des followers lancée...', 'info');
  await fetch('/api/admin/refresh-followers', { method: 'POST', credentials: 'include' });
}

async function reloadAccounts() {
  try {
    const res = await fetch('/api/accounts', { credentials: 'include' });
    if (res.ok) allAccounts = await res.json();
    renderStats();
  } catch (e) {}
}
