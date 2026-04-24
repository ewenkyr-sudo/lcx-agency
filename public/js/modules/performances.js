// PERFORMANCES MODULE
// Extracted from dashboard.html

let chartRevenue = null;
let chartLeads = null;
const chartColors = ['#3B82F6','#8B5CF6','#22D3EE','#A78BFA','#FBBF24','#EF4444','#22C55E','#84cc16'];
var _perfDays = 7;

function renderPerformances() {
  loadPerformances(7);
}

async function loadPerformances(days, btn) {
  _perfDays = days;
  // Update active button
  if (btn) {
    document.querySelectorAll('.perf-period').forEach(b => {
      b.style.background = 'var(--bg-elevated)';
      b.style.color = 'var(--text-secondary)';
    });
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';
  }

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : null); };

  const [followersRes, revenueRes, leadsRes, kpis, top, heatmap, models] = await Promise.all([
    f('/api/charts/followers?days=' + days),
    f('/api/charts/revenue?days=' + days),
    f('/api/charts/leads?days=' + days),
    f('/api/performance/kpis?days=' + days),
    f('/api/performance/top?days=' + days),
    f('/api/performance/heatmap?days=' + days),
    f('/api/performance/models?days=' + days)
  ]);

  renderPerfKPIs(kpis);
  renderFollowersChart(followersRes || [], days);
  renderRevenueChart(revenueRes || [], days);
  renderLeadsChart(leadsRes || [], days);
  renderPerfTopPerformers(top);
  renderPerfHeatmap(heatmap);
  renderPerfModelComparison(models);
}

function renderPerfKPIs(kpis) {
  var el = document.getElementById('perf-kpis');
  if (!el || !kpis) return;
  var varColor = kpis.variation >= 0 ? 'var(--green)' : 'var(--red)';
  var varIcon = kpis.variation >= 0 ? '↑' : '↓';
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green);font-size:24px">$' + kpis.revenue.toLocaleString(undefined,{maximumFractionDigits:0}) + '</div><div class="stat-label" style="display:flex;gap:6px;align-items:center;justify-content:center">' + t('finance.revenue_total') + ' <span style="color:' + varColor + ';font-size:12px;font-weight:700">' + varIcon + Math.abs(kpis.variation) + '%</span></div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:20px">$' + kpis.ppv.toLocaleString(undefined,{maximumFractionDigits:0}) + '</div><div class="stat-label">PPV</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow);font-size:20px">$' + kpis.tips.toLocaleString(undefined,{maximumFractionDigits:0}) + '</div><div class="stat-label">Tips</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:20px">' + kpis.ppvSent + ' → ' + kpis.ppvSold + '</div><div class="stat-label">PPV ' + t('perf.conversion') + ' ' + kpis.ppvConversion + '%</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--accent);font-size:20px">' + kpis.newFans + '</div><div class="stat-label">' + t('perf.new_fans') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="font-size:20px">' + kpis.totalFans + '</div><div class="stat-label">' + t('perf.total_fans') + '</div></div>'
    + '</div>';
}

function renderPerfTopPerformers(top) {
  var el = document.getElementById('perf-top-performers');
  if (!el || !top) return;

  function tableRows(items, nameKey, showPpvTips) {
    return items.map(function(r, i) {
      var rev = parseFloat(r.revenue || r.total_spent || 0);
      return '<tr><td style="color:var(--text-tertiary);width:30px">' + (i + 1) + '</td><td><strong>' + (r[nameKey] || r.display_name || r.username || '-') + '</strong>' + (r.model_name && nameKey !== 'model_name' ? ' <span style="color:var(--text-tertiary);font-size:11px">' + r.model_name + '</span>' : '') + '</td>'
        + (showPpvTips ? '<td style="font-size:12px">$' + parseFloat(r.ppv||0).toFixed(0) + ' / $' + parseFloat(r.tips||0).toFixed(0) + '</td>' : '')
        + '<td style="color:var(--green);font-weight:700;text-align:right">$' + rev.toLocaleString(undefined,{maximumFractionDigits:0}) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);padding:12px">' + t('analytics.no_data') + '</td></tr>';
  }

  el.innerHTML = '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light);margin-bottom:12px">🏆 ' + t('perf.top_performers') + '</h3>'
    + '<div style="margin-bottom:16px"><h4 style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;text-transform:uppercase">' + t('perf.top_models') + '</h4>'
    + '<table class="table" style="font-size:13px"><tbody>' + tableRows(top.models || [], 'model_name', true) + '</tbody></table></div>'
    + '<div style="margin-bottom:16px"><h4 style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;text-transform:uppercase">' + t('perf.top_chatters') + '</h4>'
    + '<table class="table" style="font-size:13px"><tbody>' + tableRows(top.chatters || [], 'display_name', true) + '</tbody></table></div>'
    + '<div><h4 style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;text-transform:uppercase">' + t('perf.top_whales') + '</h4>'
    + '<table class="table" style="font-size:13px"><tbody>' + tableRows(top.fans || [], 'username', false) + '</tbody></table></div>'
    + '</div>';
}

function renderPerfHeatmap(data) {
  var el = document.getElementById('perf-heatmap');
  if (!el || !data) return;

  var dayLabels = [t('days.sun'), t('days.mon'), t('days.tue'), t('days.wed'), t('days.thu'), t('days.fri'), t('days.sat')];
  var grid = {};
  var maxRev = 0;
  (data || []).forEach(function(r) {
    var key = r.dow + '-' + r.hour;
    var rev = parseFloat(r.revenue || 0);
    grid[key] = rev;
    if (rev > maxRev) maxRev = rev;
  });

  var hours = [];
  for (var h = 0; h < 24; h += 2) hours.push(h);

  var cells = '';
  for (var d = 0; d < 7; d++) {
    for (var hi = 0; hi < hours.length; hi++) {
      var rev = (grid[d + '-' + hours[hi]] || 0) + (grid[d + '-' + (hours[hi]+1)] || 0);
      var intensity = maxRev > 0 ? Math.min(1, rev / maxRev) : 0;
      var bg = intensity > 0 ? 'rgba(59,130,246,' + (0.1 + intensity * 0.8).toFixed(2) + ')' : 'var(--bg-elevated)';
      cells += '<div style="background:' + bg + ';border-radius:3px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:8px;color:' + (intensity > 0.5 ? 'white' : 'var(--text-tertiary)') + '"' + (rev > 0 ? ' title="$' + rev.toFixed(0) + '"' : '') + '>' + (rev > 0 ? '$' + rev.toFixed(0) : '') + '</div>';
    }
  }

  el.innerHTML = '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light);margin-bottom:12px">🔥 ' + t('perf.activity_heatmap') + '</h3>'
    + '<div style="display:grid;grid-template-columns:40px repeat(' + hours.length + ',1fr);gap:2px;font-size:10px">'
    + '<div></div>' + hours.map(function(h) { return '<div style="text-align:center;color:var(--text-tertiary)">' + h + 'h</div>'; }).join('')
    + [0,1,2,3,4,5,6].map(function(d) {
      return '<div style="display:flex;align-items:center;color:var(--text-tertiary);font-size:10px">' + dayLabels[d] + '</div>'
        + hours.map(function(h) {
          var rev = (grid[d + '-' + h] || 0) + (grid[d + '-' + (h+1)] || 0);
          var intensity = maxRev > 0 ? Math.min(1, rev / maxRev) : 0;
          var bg = intensity > 0 ? 'rgba(59,130,246,' + (0.1 + intensity * 0.8).toFixed(2) + ')' : 'var(--bg-elevated)';
          return '<div style="background:' + bg + ';border-radius:3px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:8px;color:' + (intensity > 0.5 ? 'white' : 'transparent') + '"' + (rev > 0 ? ' title="$' + rev.toFixed(0) + '"' : '') + '></div>';
        }).join('');
    }).join('')
    + '</div></div>';
}

function renderPerfModelComparison(models) {
  var el = document.getElementById('perf-model-comparison');
  if (!el || !models || models.length === 0) return;

  el.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light);margin-bottom:16px">📊 ' + t('perf.model_comparison') + '</h3>'
    + '<table class="table mobile-cards"><thead><tr><th>' + t('finance.model_col') + '</th><th>' + t('finance.revenue_total') + '</th><th>' + t('perf.variation') + '</th><th>Shifts</th><th>Fans</th></tr></thead><tbody>'
    + models.map(function(m) {
      var varColor = m.variation >= 0 ? 'var(--green)' : 'var(--red)';
      var varIcon = m.variation >= 0 ? '↑' : '↓';
      return '<tr><td data-label="" class="mc-title"><strong>' + m.name + '</strong></td>'
        + '<td data-label="Revenue" class="mc-half" style="color:var(--green);font-weight:700">$' + m.revenue.toLocaleString(undefined,{maximumFractionDigits:0}) + '</td>'
        + '<td data-label="' + t('perf.variation') + '" class="mc-half" style="color:' + varColor + '">' + varIcon + ' ' + Math.abs(m.variation) + '%</td>'
        + '<td data-label="Shifts" class="mc-half">' + m.shifts + '</td>'
        + '<td data-label="Fans" class="mc-half">' + m.fans + '</td></tr>';
    }).join('')
    + '</tbody></table></div>';
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
    options: chartOptions(t('perf.new_followers_cumul'))
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
          backgroundColor: '#3B82F6cc',
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
      ...chartOptions(t('perf.amount_label')),
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
          label: t('perf.dms_sent_label'),
          data: data.map(d => parseInt(d.dm_sent)),
          backgroundColor: '#3b82f6cc',
          borderRadius: 4
        },
        {
          label: t('perf.replies_label'),
          data: data.map(d => parseInt(d.replies)),
          backgroundColor: '#3B82F6cc',
          borderRadius: 4
        }
      ]
    },
    options: chartOptions(t('perf.leads_count_label'))
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
        ticks: Object.assign({}, chartDarkTicks, { maxTicksLimit: 15 })
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: chartDarkTicks,
        title: { display: !!yTitle, text: yTitle, color: '#A1A1AA' },
        beginAtZero: true
      }
    },
    plugins: {
      legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 16 } }
    }
  };
}

function formatChartDate(dateStr, days) {
  const d = new Date(dateStr);
  const locale = window.currentLang === 'en' ? 'en-US' : 'fr-FR';
  if (days <= 7) return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
  if (days <= 60) return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

// ========== DELETE OPERATIONS ==========
async function deleteStudent(id) {
  if (!(await confirmDelete(t('confirm.delete_student')))) return;
  const res = await fetch(`/api/students/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteTeamMember(id) {
  if (!(await confirmDelete(t('confirm.delete_member')))) return;
  const res = await fetch(`/api/team/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteTask(id) {
  if (!(await confirmDelete(t('confirm.delete_task')))) return;
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteModel(id) {
  if (!(await confirmDelete(t('confirm.delete_model')))) return;
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
  showToast(t('toast.link_updated'), 'success');
  await loadAllData();
  renderModels();
  // Recharger les plannings
  allModels.forEach(m => loadModelPlanning(m.id));
}

function showPlanningForm(modelId) {
  var wrap = document.getElementById('planning-form-' + modelId);
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:6px">'
    + '<input type="text" id="plan-label-' + modelId + '" placeholder="' + t('perf.planning_placeholder') + '" style="flex:1;background:var(--bg-base);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:11px;font-family:inherit">'
    + '<input type="text" id="plan-link-' + modelId + '" placeholder="' + t('perf.drive_placeholder') + '" style="flex:1;background:var(--bg-base);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:11px;font-family:inherit">'
    + '<button onclick="addPlanning(' + modelId + ')" style="background:var(--accent);color:white;border:none;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600">OK</button>'
    + '</div>';
}

async function addPlanning(modelId) {
  var label = document.getElementById('plan-label-' + modelId).value.trim();
  var link = document.getElementById('plan-link-' + modelId).value.trim();
  if (!label || !link) return showToast(t('toast.label_link_required'), 'error');
  var res = await fetch('/api/models/' + modelId + '/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ label: label, drive_link: link }) });
  if (res.ok) { showToast(t('toast.planning_added'), 'success'); document.getElementById('planning-form-' + modelId).innerHTML = ''; loadModelPlanning(modelId); }
  else { var e = await res.json(); showToast(e.error || t('common.error'), 'error'); }
}

async function loadModelPlanning(modelId) {
  var container = document.getElementById('planning-list-' + modelId);
  if (!container) return;
  var res = await fetch('/api/models/' + modelId + '/planning', { credentials: 'include' });
  if (!res.ok) return;
  var items = await res.json();
  container.innerHTML = items.map(function(p) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-base);border-radius:6px;font-size:11px">'
      + '<span style="flex:1;font-weight:600">' + p.label + '</span>'
      + '<a href="' + p.drive_link + '" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600">' + t('perf.open_link') + '</a>'
      + '<button onclick="deletePlanning(' + p.id + ',' + modelId + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:10px">✕</button>'
      + '</div>';
  }).join('') || '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-tertiary)">' + emptyStateSVG.calendar.replace('width="28"','width="20"') + ' ' + t('perf.no_planning') + '</div>';
}

async function deletePlanning(id, modelId) {
  await fetch('/api/model-planning/' + id, { method: 'DELETE', credentials: 'include' });
  loadModelPlanning(modelId);
}

async function deleteAccount(id) {
  if (!(await confirmDelete(t('confirm.delete_account')))) return;
  const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) {
    await loadAllData();
    renderAllSections();
  }
}

async function deleteCall(id) {
  if (!(await confirmDelete(t('confirm.delete_call')))) return;
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
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${s.today.revenue.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_today')}</div></div>
          <div class="stat-card"><div class="stat-value">$${s.today.ppv.toFixed(2)}</div><div class="stat-label">${t('chatters.ppv_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">$${s.today.tips.toFixed(2)}</div><div class="stat-label">${t('chatters.tips_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${s.week.revenue.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_week')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">$${s.total.revenue.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_total')}</div></div>
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
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${todayRev.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_today')}</div></div>
          <div class="stat-card"><div class="stat-value">$${totals.today_ppv.toFixed(2)}</div><div class="stat-label">${t('chatters.ppv_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">$${totals.today_tips.toFixed(2)}</div><div class="stat-label">${t('chatters.tips_today')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${weekRev.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_week')}</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">$${totals.total_revenue.toFixed(2)}</div><div class="stat-label">${t('chatters.revenue_total')}</div></div>
          <div class="stat-card"><div class="stat-value">${totals.total_shifts}</div><div class="stat-label">Total shifts</div></div>
        `;

        const adminDiv = document.getElementById('chatter-admin-stats');
        adminDiv.style.display = 'block';
        const tbody = document.querySelector('#chatter-agents-table tbody');
        tbody.innerHTML = chatters.map(c => {
          return `<tr>
            <td data-label="" class="mc-title"><strong>${c.chatter_name}</strong></td>
            <td data-label="${t('chatters.ppv_short')}" class="mc-half">$${parseFloat(c.today_ppv).toFixed(2)}</td>
            <td data-label="${t('chatters.tips_short')}" class="mc-half" style="color:var(--yellow)">$${parseFloat(c.today_tips).toFixed(2)}</td>
            <td data-label="${t('chatters.ppv_week')}" class="mc-half">$${parseFloat(c.week_ppv).toFixed(2)}</td>
            <td data-label="${t('chatters.tips_week')}" class="mc-half" style="color:var(--yellow)">$${parseFloat(c.week_tips).toFixed(2)}</td>
            <td data-label="${t('chatters.revenue_total')}" class="mc-half" style="color:var(--green)"><strong>$${parseFloat(c.total_revenue).toFixed(2)}</strong></td>
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
      <td data-label="#" style="color:var(--text-tertiary);font-size:12px">${allShifts.length - idx}</td>
      <td data-label="" class="mc-title"><strong>${s.model_name}</strong> — ${s.date}</td>
      <td data-label="PPV" class="mc-half">$${parseFloat(s.ppv_total).toFixed(2)}</td>
      <td data-label="Tips" class="mc-half" style="color:var(--yellow)">$${parseFloat(s.tips_total).toFixed(2)}</td>
      <td data-label="Revenue" class="mc-half" style="color:var(--green)"><strong>$${revenue}</strong></td>
      ${userIsAdmin ? `<td data-label="Chatter" class="mc-half" style="color:var(--accent-blue-light)">${s.chatter_name || '-'}</td>` : `<td data-label="" class="mc-half"></td>`}
      <td data-label="Notes" class="mc-full" style="color:var(--text-secondary);font-size:12px">${s.shift_notes || '-'}</td>
      <td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteShift(${s.id})" title="${t('common.delete')}">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9">' + emptyStateHTML('clock', t('chatters.no_shift_report')) + '</td></tr>';
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
  select.innerHTML = '<option value="">' + t('chatters.choose_model') + '</option>' +
    allModels.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  // Date du jour par défaut
  document.getElementById('shift-date').value = new Date().toISOString().split('T')[0];
  const form = document.getElementById('add-shift-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function addShift() {
  const model = document.getElementById('shift-model').value;
  if (!model) return showToast(t('toast.choose_model'), 'error');
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
    showToast(t('toast.shift_report_sent'), 'success');
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
  if (!(await confirmDelete(t('confirm.delete_shift_report')))) return;
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