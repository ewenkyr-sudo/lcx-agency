// PERFORMANCES MODULE
// Extracted from dashboard.html

let chartRevenue = null;
let chartLeads = null;
const chartColors = ['#A855F7','#F0ABFC','#22D3EE','#A78BFA','#FBBF24','#FB7185','#34D399','#84cc16'];

function renderPerformances() {
  loadPerformances(7);
}

async function loadPerformances(days, btn) {
  // Update active button
  if (btn) {
    document.querySelectorAll('.perf-period').forEach(b => {
      b.style.background = 'var(--bg3)';
      b.style.color = 'var(--text2)';
    });
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';
  }

  const [followersRes, revenueRes, leadsRes] = await Promise.all([
    fetch('/api/charts/followers?days=' + days, { credentials: 'include' }).then(r => r.json()),
    fetch('/api/charts/revenue?days=' + days, { credentials: 'include' }).then(r => r.json()),
    fetch('/api/charts/leads?days=' + days, { credentials: 'include' }).then(r => r.json())
  ]);

  renderFollowersChart(followersRes, days);
  renderRevenueChart(revenueRes, days);
  renderLeadsChart(leadsRes, days);
}

function renderFollowersChart(data, days) {
  if (chartFollowers) chartFollowers.destroy();

  // Grouper par modèle et cumuler les followers par jour
  const models = {};
  data.forEach(d => {
    if (!models[d.model_name]) models[d.model_name] = {};
    if (!models[d.model_name][d.date]) models[d.model_name][d.date] = 0;
    models[d.model_name][d.date] += parseInt(d.new_followers);
  });

  const dates = [...new Set(data.map(d => d.date))].sort();
  const datasets = Object.entries(models).map(([name, dateMap], i) => {
    let cumulative = 0;
    return {
      label: name,
      data: dates.map(date => { cumulative += (dateMap[date] || 0); return cumulative; }),
      borderColor: chartColors[i % chartColors.length],
      backgroundColor: chartColors[i % chartColors.length] + '20',
      tension: 0.3,
      fill: true
    };
  });

  const ctx = document.getElementById('chart-followers');
  chartFollowers = new Chart(ctx, {
    type: 'line',
    data: { labels: dates.map(d => formatChartDate(d, days)), datasets },
    options: chartOptions('Nouveaux followers cumulés')
  });
}

function renderRevenueChart(data, days) {
  if (chartRevenue) chartRevenue.destroy();
  const dates = data.map(d => formatChartDate(d.date, days));

  const ctx = document.getElementById('chart-revenue');
  chartRevenue = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'PPV',
          data: data.map(d => parseFloat(d.ppv)),
          backgroundColor: '#A855F7cc',
          borderRadius: 4
        },
        {
          label: 'Tips',
          data: data.map(d => parseFloat(d.tips)),
          backgroundColor: '#f59e0bcc',
          borderRadius: 4
        }
      ]
    },
    options: {
      ...chartOptions('Montant ($)'),
      plugins: {
        ...chartOptions('').plugins,
        tooltip: {
          callbacks: { label: (ctx) => ctx.dataset.label + ': $' + ctx.parsed.y.toFixed(2) }
        }
      }
    }
  });
}

function renderLeadsChart(data, days) {
  if (chartLeads) chartLeads.destroy();
  const dates = data.map(d => formatChartDate(d.date, days));

  const ctx = document.getElementById('chart-leads');
  chartLeads = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'DMs envoyés',
          data: data.map(d => parseInt(d.dm_sent)),
          backgroundColor: '#3b82f6cc',
          borderRadius: 4
        },
        {
          label: 'Réponses',
          data: data.map(d => parseInt(d.replies)),
          backgroundColor: '#A855F7cc',
          borderRadius: 4
        }
      ]
    },
    options: chartOptions('Nombre de leads')
  });
}

function chartOptions(yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#6B5A84', maxTicksLimit: 15 }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#6B5A84' },
        title: { display: !!yTitle, text: yTitle, color: '#9585B0' },
        beginAtZero: true
      }
    },
    plugins: {
      legend: { labels: { color: '#EDE4FF', usePointStyle: true, padding: 16 } }
    }
  };
}

function formatChartDate(dateStr, days) {
  const d = new Date(dateStr);
  if (days <= 7) return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  if (days <= 60) return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

// ========== DELETE OPERATIONS ==========
async function deleteStudent(id) {
  if (!(await confirmDelete('Supprimer cet élève ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/students/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteTeamMember(id) {
  if (!(await confirmDelete('Supprimer ce membre ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/team/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteTask(id) {
  if (!(await confirmDelete('Supprimer cette tâche ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteModel(id) {
  if (!(await confirmDelete('Supprimer ce modèle ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/models/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function updateModelDrive(modelId, field, value) {
  const body = {};
  body[field] = value || null;
  await fetch('/api/models/' + modelId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  showToast('Lien mis à jour', 'success');
  await loadAllData();
  renderModels();
  // Recharger les plannings
  allModels.forEach(m => loadModelPlanning(m.id));
}

function showPlanningForm(modelId) {
  var wrap = document.getElementById('planning-form-' + modelId);
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:6px">'
    + '<input type="text" id="plan-label-' + modelId + '" placeholder="Ex: Semaine 14, Mars 2026..." style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:11px;font-family:inherit">'
    + '<input type="text" id="plan-link-' + modelId + '" placeholder="Lien Drive..." style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:11px;font-family:inherit">'
    + '<button onclick="addPlanning(' + modelId + ')" style="background:var(--accent);color:white;border:none;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600">OK</button>'
    + '</div>';
}

async function addPlanning(modelId) {
  var label = document.getElementById('plan-label-' + modelId).value.trim();
  var link = document.getElementById('plan-link-' + modelId).value.trim();
  if (!label || !link) return showToast('Label et lien requis', 'error');
  var res = await fetch('/api/models/' + modelId + '/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ label: label, drive_link: link }) });
  if (res.ok) { showToast('Planning ajouté', 'success'); document.getElementById('planning-form-' + modelId).innerHTML = ''; loadModelPlanning(modelId); }
  else { var e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

async function loadModelPlanning(modelId) {
  var container = document.getElementById('planning-list-' + modelId);
  if (!container) return;
  var res = await fetch('/api/models/' + modelId + '/planning', { credentials: 'include' });
  if (!res.ok) return;
  var items = await res.json();
  container.innerHTML = items.map(function(p) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg);border-radius:6px;font-size:11px">'
      + '<span style="flex:1;font-weight:600">' + p.label + '</span>'
      + '<a href="' + p.drive_link + '" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600">Ouvrir</a>'
      + '<button onclick="deletePlanning(' + p.id + ',' + modelId + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:10px">✕</button>'
      + '</div>';
  }).join('') || '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text3)">' + emptyStateSVG.calendar.replace('width="28"','width="20"') + ' Aucun planning</div>';
}

async function deletePlanning(id, modelId) {
  await fetch('/api/model-planning/' + id, { method: 'DELETE', credentials: 'include' });
  loadModelPlanning(modelId);
}

async function deleteAccount(id) {
  if (!(await confirmDelete('Supprimer ce compte ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteCall(id) {
  if (!(await confirmDelete('Supprimer cet appel ? Cette action est irréversible.'))) return;
  const res = await fetch(`/api/calls/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

// ========== CHATTER SHIFTS ==========
let allShifts = [];
let shiftsPage = 1;
let shiftsTotalPages = 1;

async function loadShifts() {
  if (currentUser.role !== 'chatter' && !isAdmin()) return;
  try {
    const res = await fetch('/api/shifts?page=' + shiftsPage + '&limit=25', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      allShifts = data.data;
      shiftsPage = data.page;
      shiftsTotalPages = data.totalPages;
    }
  } catch (e) { console.error('Shifts load error:', e); }
}

async function loadShiftsPage(p) {
  shiftsPage = Math.max(1, Math.min(p, shiftsTotalPages));
  await loadShifts();
  renderShifts();
}

async function loadChatterKPIs() {
  const kpisDiv = document.getElementById('chatter-kpis');
  if (!kpisDiv) return;

  if (currentUser.role === 'chatter') {
    try {
      const res = await fetch('/api/shifts/my-stats', { credentials: 'include' });
      if (res.ok) {
        const s = await res.json();
        kpisDiv.innerHTML = `
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${s.today.revenue.toFixed(2)}</div><div class="stat-label">Revenue aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value">$${s.today.ppv.toFixed(2)}</div><div class="stat-label">PPV aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">$${s.today.tips.toFixed(2)}</div><div class="stat-label">Tips aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${s.week.revenue.toFixed(2)}</div><div class="stat-label">Revenue semaine</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">$${s.total.revenue.toFixed(2)}</div><div class="stat-label">Revenue totale</div></div>
          <div class="stat-card"><div class="stat-value">${s.total.shifts}</div><div class="stat-label">Total shifts</div></div>
        `;
      }
    } catch (e) {}
  }

  if (isAdmin()) {
    try {
      const res = await fetch('/api/shifts/admin-stats', { credentials: 'include' });
      if (res.ok) {
        const chatters = await res.json();
        const totals = chatters.reduce((acc, c) => ({
          today_ppv: acc.today_ppv + parseFloat(c.today_ppv),
          today_tips: acc.today_tips + parseFloat(c.today_tips),
          week_ppv: acc.week_ppv + parseFloat(c.week_ppv),
          week_tips: acc.week_tips + parseFloat(c.week_tips),
          total_revenue: acc.total_revenue + parseFloat(c.total_revenue),
          total_shifts: acc.total_shifts + parseInt(c.total_shifts)
        }), { today_ppv: 0, today_tips: 0, week_ppv: 0, week_tips: 0, total_revenue: 0, total_shifts: 0 });

        const todayRev = totals.today_ppv + totals.today_tips;
        const weekRev = totals.week_ppv + totals.week_tips;
        kpisDiv.innerHTML = `
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${todayRev.toFixed(2)}</div><div class="stat-label">Revenue aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value">$${totals.today_ppv.toFixed(2)}</div><div class="stat-label">PPV aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">$${totals.today_tips.toFixed(2)}</div><div class="stat-label">Tips aujourd'hui</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${weekRev.toFixed(2)}</div><div class="stat-label">Revenue semaine</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">$${totals.total_revenue.toFixed(2)}</div><div class="stat-label">Revenue totale</div></div>
          <div class="stat-card"><div class="stat-value">${totals.total_shifts}</div><div class="stat-label">Total shifts</div></div>
        `;

        const adminDiv = document.getElementById('chatter-admin-stats');
        adminDiv.style.display = 'block';
        const tbody = document.querySelector('#chatter-agents-table tbody');
        tbody.innerHTML = chatters.map(c => {
          return `<tr>
            <td data-label="" class="mc-title"><strong>${c.chatter_name}</strong></td>
            <td data-label="PPV auj." class="mc-half">$${parseFloat(c.today_ppv).toFixed(2)}</td>
            <td data-label="Tips auj." class="mc-half" style="color:var(--yellow)">$${parseFloat(c.today_tips).toFixed(2)}</td>
            <td data-label="PPV sem." class="mc-half">$${parseFloat(c.week_ppv).toFixed(2)}</td>
            <td data-label="Tips sem." class="mc-half" style="color:var(--yellow)">$${parseFloat(c.week_tips).toFixed(2)}</td>
            <td data-label="Revenue totale" class="mc-half" style="color:var(--green)"><strong>$${parseFloat(c.total_revenue).toFixed(2)}</strong></td>
            <td data-label="Shifts" class="mc-half">${c.total_shifts}</td>
          </tr>`;
        }).join('');
      }
    } catch (e) {}
  }
}

function renderShifts() {
  if (currentUser.role !== 'chatter' && !isAdmin()) return;
  const userIsAdmin = isAdmin();
  const chatterCol = document.getElementById('shift-col-chatter');
  if (chatterCol) chatterCol.style.display = userIsAdmin ? '' : 'none';

  const table = document.getElementById('shifts-table');
  table.classList.add('mobile-cards');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = allShifts.map((s, idx) => {
    const revenue = (parseFloat(s.ppv_total) + parseFloat(s.tips_total)).toFixed(2);
    return `<tr>
      <td data-label="#" style="color:var(--text3);font-size:12px">${allShifts.length - idx}</td>
      <td data-label="" class="mc-title"><strong>${s.model_name}</strong> — ${s.date}</td>
      <td data-label="PPV" class="mc-half">$${parseFloat(s.ppv_total).toFixed(2)}</td>
      <td data-label="Tips" class="mc-half" style="color:var(--yellow)">$${parseFloat(s.tips_total).toFixed(2)}</td>
      <td data-label="Revenue" class="mc-half" style="color:var(--green)"><strong>$${revenue}</strong></td>
      ${userIsAdmin ? `<td data-label="Chatter" class="mc-half" style="color:var(--accent2)">${s.chatter_name || '-'}</td>` : `<td data-label="" class="mc-half"></td>`}
      <td data-label="Notes" class="mc-full" style="color:var(--text2);font-size:12px">${s.shift_notes || '-'}</td>
      <td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteShift(${s.id})" title="Supprimer">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9">' + emptyStateHTML('clock', 'Aucun rapport de shift') + '</td></tr>';
  // Pagination
  var paginEl = document.getElementById('shifts-pagination');
  if (!paginEl) {
    paginEl = document.createElement('div');
    paginEl.id = 'shifts-pagination';
    document.getElementById('shifts-table').parentNode.after(paginEl);
  }
  paginEl.innerHTML = paginationHTML(shiftsPage, shiftsTotalPages, 'loadShiftsPage');
}

function showAddShiftForm() {
  // Remplir le select des modèles
  const select = document.getElementById('shift-model');
  select.innerHTML = '<option value="">-- Choisir un modèle --</option>' +
    allModels.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  // Date du jour par défaut
  document.getElementById('shift-date').value = new Date().toISOString().split('T')[0];
  const form = document.getElementById('add-shift-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function addShift() {
  const model = document.getElementById('shift-model').value;
  if (!model) return showToast('Choisis un modèle', 'error');
  const res = await fetch('/api/shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      date: document.getElementById('shift-date').value,
      model_name: model,
      ppv_total: parseFloat(document.getElementById('shift-ppv').value) || 0,
      tips_total: parseFloat(document.getElementById('shift-tips').value) || 0,
      shift_notes: document.getElementById('shift-notes').value.trim()
    })
  });
  if (res.ok) {
    showToast('Rapport de shift envoyé !', 'success');
    document.getElementById('shift-ppv').value = '';
    document.getElementById('shift-tips').value = '';
    document.getElementById('shift-notes').value = '';
    document.getElementById('add-shift-form').style.display = 'none';
    await loadShifts();
    renderShifts();
    await loadChatterKPIs();
  }
}

async function deleteShift(id) {
  if (!(await confirmDelete('Supprimer ce rapport ? Cette action est irréversible.'))) return;
  await fetch('/api/shifts/' + id, { method: 'DELETE', credentials: 'include' });
  await loadShifts();
  renderShifts();
  await loadChatterKPIs();
}

// ========== MESSAGE BADGES ==========
async function updateUnreadBadges() {
  try {
    const res = await fetch('/api/messages-unread', { credentials: 'include' });
    if (!res.ok) return;
    const unread = await res.json();
    const total = unread.reduce(function(s, u) { return s + parseInt(u.unread); }, 0);

    // Badge élève
    const studentBadge = document.getElementById('msg-badge');
    if (studentBadge) {
      if (total > 0) { studentBadge.style.display = ''; studentBadge.textContent = total; }
      else { studentBadge.style.display = 'none'; }
    }

    // Badge admin (coaching)
    const adminBadge = document.getElementById('admin-msg-badge');
    if (adminBadge) {
      if (total > 0) { adminBadge.style.display = ''; adminBadge.textContent = total; }
      else { adminBadge.style.display = 'none'; }
    }
  } catch(e) {}
}

// ========== NOTIFICATIONS TEMPS RÉEL ==========

// Demander la permission au chargement
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => Notification.requestPermission(), 3000);
}

// Son de notification via Web Audio API (pas de fichier externe)