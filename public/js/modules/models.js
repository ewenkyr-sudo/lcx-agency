// MODELS MODULE
// Extracted from dashboard.html

function switchCockpitTab(tab, btn, modelId) {
  document.querySelectorAll('#cockpit-content .tab').forEach(function(t2) { t2.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  ['dashboard','profile','schedule','tracklinks','fans'].forEach(function(tb) {
    var el = document.getElementById('cockpit-' + tb + '-content');
    if (el) el.style.display = tb === tab ? '' : 'none';
  });
  if (tab === 'profile') renderModelProfile(modelId);
  else if (tab === 'schedule') renderModelSchedule(modelId);
  else if (tab === 'tracklinks') renderModelTracklinks(modelId);
  else if (tab === 'fans') renderFanCRM(modelId);
}

function switchModelsTab(tab, btn) {
  document.querySelectorAll('#section-models .tab').forEach(function(t2) { t2.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.getElementById('models-content').style.display = tab === 'models' ? '' : 'none';
  document.getElementById('content-planner-content').style.display = tab === 'planner' ? '' : 'none';
  var fansEl = document.getElementById('fans-global-content');
  if (fansEl) fansEl.style.display = tab === 'fans' ? '' : 'none';
  if (tab === 'planner') renderContentPlanner();
  if (tab === 'fans') renderFanCRM();
}

function renderModels() {
  const container = document.getElementById('models-content');
  const actions = document.getElementById('models-actions');

  if (isAdmin()) {
    actions.innerHTML = `<button class="btn btn-primary" onclick="openModal('add-model')">${t('common.new_model')}</button>`;
  }

  container.innerHTML = `
    <div class="panel">
      <div class="models-grid">
        ${allModels.map(m => `
          <div class="model-card">
            <div class="model-header">
              <div class="model-avatar">${m.name.charAt(0)}</div>
              <div>
                <div class="model-name">${m.name}</div>
                <div class="model-platform">${(m.platforms || []).join(' + ')}</div>
              </div>
              <select onchange="updateModelDrive(${m.id},'lifecycle_status',this.value);this.style.background=this.options[this.selectedIndex].getAttribute('data-bg')" style="margin-left:auto;font-size:10px;padding:3px 8px;border-radius:8px;border:none;font-weight:600;cursor:pointer;font-family:inherit;background:${m.lifecycle_status==='recruited'?'var(--blue-bg)':m.lifecycle_status==='onboarding'?'var(--yellow-bg)':m.lifecycle_status==='revenue'?'var(--green-bg)':'var(--green-bg)'};color:${m.lifecycle_status==='recruited'?'var(--blue)':m.lifecycle_status==='onboarding'?'var(--yellow)':m.lifecycle_status==='revenue'?'var(--accent)':'var(--green)'}">
                <option value="recruited" ${m.lifecycle_status==='recruited'?'selected':''} data-bg="var(--blue-bg)">${t('models.recruited')}</option>
                <option value="onboarding" ${m.lifecycle_status==='onboarding'?'selected':''} data-bg="var(--yellow-bg)">${t('models.onboarding')}</option>
                <option value="active" ${(m.lifecycle_status==='active'||!m.lifecycle_status)?'selected':''} data-bg="var(--green-bg)">${t('models.active_status')}</option>
                <option value="revenue" ${m.lifecycle_status==='revenue'?'selected':''} data-bg="var(--green-bg)">${t('models.revenue_label')}</option>
              </select>
            </div>
            <div class="model-stats">
              <div class="model-stat">
                <div class="model-stat-label">${t('models.accounts')}</div>
                <div class="model-stat-value">${allAccounts.filter(a => a.model_id === m.id).length}</div>
              </div>
              <div class="model-stat">
                <div class="model-stat-label">${t('models.followers_total')}</div>
                <div class="model-stat-value">${allAccounts.filter(a => a.model_id === m.id).reduce((s, a) => s + a.current_followers, 0)}</div>
              </div>
            </div>
            <button class="btn btn-primary" onclick="event.stopPropagation();openModelCockpit(${m.id})" style="width:100%;margin-top:12px;justify-content:center;font-size:12px">${t('models.view_cockpit')}</button>
            ${isAdmin() ? `
            <!-- Drive & Contrat -->
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:grid;gap:8px">
              <div style="display:flex;gap:6px;align-items:center">
                <input type="text" placeholder="${t('models.drive_folder_placeholder')}" value="${m.drive_folder||''}" onchange="updateModelDrive(${m.id},'drive_folder',this.value)" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:11px;font-family:inherit">
                ${m.drive_folder ? '<a href="' + m.drive_folder + '" target="_blank" style="padding:6px 10px;background:var(--green-bg);color:var(--green);border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap">' + t('models.drive_folder') + '</a>' : ''}
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="text" placeholder="${t('models.contract_placeholder')}" value="${m.drive_contract||''}" onchange="updateModelDrive(${m.id},'drive_contract',this.value)" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:11px;font-family:inherit">
                ${m.drive_contract ? '<a href="' + m.drive_contract + '" target="_blank" style="padding:6px 10px;background:var(--accent-glow);color:var(--accent);border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap">' + t('models.drive_contract') + '</a>' : ''}
              </div>
            </div>
            <button class="btn-delete-small" onclick="deleteModel(${m.id})" style="margin-top:10px;width:100%">${t('common.delete')}</button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ========== MODEL COCKPIT ==========
let cockpitCharts = {};
let currentCockpitModelId = null;

function openModelCockpit(modelId) {
  currentCockpitModelId = modelId;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-model-cockpit').classList.add('active');
  renderModelCockpit(modelId);
}

function navigateCockpit(direction) {
  const idx = allModels.findIndex(m => m.id === currentCockpitModelId);
  if (idx === -1) return;
  const newIdx = direction === 'prev' ? (idx - 1 + allModels.length) % allModels.length : (idx + 1) % allModels.length;
  openModelCockpit(allModels[newIdx].id);
}

function closeCockpit() {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-models').classList.add('active');
  // Destroy charts
  Object.values(cockpitCharts).forEach(c => c.destroy());
  cockpitCharts = {};
}

async function renderModelCockpit(modelId) {
  const container = document.getElementById('cockpit-content');
  container.innerHTML = '<div style="text-align:center;padding:60px"><div class="spinner"></div><div style="color:var(--text3);margin-top:12px">' + t('models.cockpit_loading') + '</div></div>';

  // Destroy old charts
  Object.values(cockpitCharts).forEach(c => c.destroy());
  cockpitCharts = {};

  try {
    const res = await fetch('/api/model-cockpit/' + modelId, { credentials: 'include' });
    if (!res.ok) throw new Error('API error');
    const d = await res.json();
    const model = d.model;
    if (typeof model.platforms === 'string') { try { model.platforms = JSON.parse(model.platforms); } catch(e2) { model.platforms = []; } }
    const modelIdx = allModels.findIndex(m => m.id === modelId);
    const objPct = d.objective.target > 0 ? Math.min(100, (d.revenueMonth / d.objective.target * 100)).toFixed(0) : 0;
    const objColor = objPct >= 100 ? 'var(--green)' : objPct >= 60 ? 'var(--yellow)' : 'var(--red)';

    container.innerHTML = `
      <!-- Navigation -->
      <div class="cockpit-nav">
        <button class="cockpit-nav-btn" onclick="closeCockpit()" title="Retour">←</button>
        <button class="cockpit-nav-btn" onclick="navigateCockpit('prev')" title="Modèle précédent">‹</button>
        <button class="cockpit-nav-btn" onclick="navigateCockpit('next')" title="Modèle suivant">›</button>
        <div style="flex:1">
          <div style="font-size:22px;font-weight:800">${model.name}</div>
          <div style="font-size:13px;color:var(--text3)">${(model.platforms||[]).join(' · ')} · ${d.accounts.length} compte${d.accounts.length>1?'s':''}</div>
        </div>
        <div style="font-size:12px;color:var(--text3)">${modelIdx+1} / ${allModels.length}</div>
      </div>

      <!-- Cockpit Tabs -->
      <div class="tabs" style="margin-bottom:16px">
        <button class="tab active" onclick="switchCockpitTab('dashboard',this,${modelId})">${t('models.tab_dashboard')}</button>
        <button class="tab" onclick="switchCockpitTab('profile',this,${modelId})">${t('models.tab_profile')}</button>
        <button class="tab" onclick="switchCockpitTab('schedule',this,${modelId})">${t('models.tab_schedule')}</button>
        <button class="tab" onclick="switchCockpitTab('tracklinks',this,${modelId})">${t('models.tab_tracklinks')}</button>
        <button class="tab" onclick="switchCockpitTab('fans',this,${modelId})">${t('models.tab_fans')}</button>
      </div>

      <div id="cockpit-dashboard-content">
      <!-- KPIs -->
      <div class="cockpit-kpis">
        <div class="cockpit-kpi">
          <div class="cockpit-kpi-label">${t('models.revenue_today')}</div>
          <div class="cockpit-kpi-value" style="color:var(--green)">$${d.revenueToday.toFixed(2)}</div>
          <div class="cockpit-kpi-sub">PPV $${d.ppvToday.toFixed(2)} · Tips $${d.tipsToday.toFixed(2)}</div>
        </div>
        <div class="cockpit-kpi">
          <div class="cockpit-kpi-label">${t('models.revenue_month')}</div>
          <div class="cockpit-kpi-value">$${d.revenueMonth.toFixed(2)}</div>
          <div class="cockpit-kpi-sub">${d.objective.target > 0 ? t('models.objective_prefix') + ' $' + d.objective.target.toFixed(0) + ' (' + objPct + '%)' : t('models.no_objective')}</div>
          ${d.objective.target > 0 ? '<div class="cockpit-progress"><div class="cockpit-progress-bar" style="width:'+objPct+'%;background:'+objColor+'"></div></div>' : ''}
        </div>
        <div class="cockpit-kpi">
          <div class="cockpit-kpi-label">${t('models.followers')}</div>
          <div class="cockpit-kpi-value">${d.totalFollowers.toLocaleString('fr-FR')}</div>
          <div class="cockpit-kpi-sub">${d.accounts.map(a => a.platform + ': ' + (a.current_followers||0).toLocaleString('fr-FR')).join(' · ')}</div>
        </div>
        <div class="cockpit-kpi">
          <div class="cockpit-kpi-label">${t('models.chatters_assigned')}</div>
          <div class="cockpit-kpi-value">${d.assignedTeam.length}</div>
          <div class="cockpit-kpi-sub">${d.assignedTeam.filter(t2 => t2.online).length} ${t('models.online_label')}</div>
        </div>
      </div>

      <!-- Charts -->
      <div class="cockpit-charts">
        <div class="cockpit-panel">
          <div class="cockpit-panel-title">${t('models.revenue_30d')}</div>
          <canvas id="cockpit-chart-revenue" height="200"></canvas>
        </div>
        <div class="cockpit-panel">
          <div class="cockpit-panel-title">${t('models.revenue_breakdown')}</div>
          <canvas id="cockpit-chart-donut" height="200"></canvas>
        </div>
      </div>
      <div class="cockpit-panel">
        <div class="cockpit-panel-title">${t('models.revenue_weekly')}</div>
        <canvas id="cockpit-chart-weekly" height="160"></canvas>
      </div>

      <!-- Team + Activity -->
      <div class="two-col" style="margin-bottom:16px">
        <div class="cockpit-panel" style="margin-bottom:0">
          <div class="cockpit-panel-title">${t('models.assigned_team')}</div>
          <div id="cockpit-team"></div>
        </div>
        <div class="cockpit-panel" style="margin-bottom:0">
          <div class="cockpit-panel-title">${t('models.recent_activity')}</div>
          <div id="cockpit-activity" style="max-height:340px;overflow-y:auto"></div>
        </div>
      </div>

      <!-- Objectives -->
      <div class="cockpit-panel">
        <div class="cockpit-panel-title">${t('models.monthly_objectives')}</div>
        <div id="cockpit-objectives"></div>
      </div>
      </div><!-- /cockpit-dashboard-content -->
    `;

    // Render team
    var teamHtml = d.assignedTeam.length === 0 ? emptyStateHTML('users', t('models.no_chatter_assigned')) : '';
    d.assignedTeam.forEach(function(tm) {
      var clockInfo = '';
      if (tm.todayClocks.length > 0) {
        var last = tm.todayClocks[tm.todayClocks.length - 1];
        var loc = window.currentLang === 'en' ? 'en-US' : 'fr-FR';
        var inTime = new Date(last.clock_in).toLocaleTimeString(loc, {hour:'2-digit',minute:'2-digit'});
        clockInfo = last.clock_out ? inTime + ' - ' + new Date(last.clock_out).toLocaleTimeString(loc,{hour:'2-digit',minute:'2-digit'}) : t('models.since').replace('{time}', inTime);
      }
      teamHtml += '<div class="cockpit-team-row">'
        + '<div class="cockpit-online-dot" style="background:' + (tm.online ? 'var(--green)' : 'var(--text3)') + '"></div>'
        + '<div style="flex:1"><strong style="font-size:13px">' + tm.name + '</strong>'
        + (clockInfo ? '<div style="font-size:11px;color:var(--text3)">' + clockInfo + '</div>' : '')
        + '</div>'
        + '<div style="text-align:right"><div style="font-size:14px;font-weight:700;color:var(--green)">$' + tm.monthRevenue.toFixed(2) + '</div>'
        + '<div style="font-size:10px;color:var(--text3)">' + tm.monthShifts + ' ' + t('models.shifts_month') + '</div></div>'
        + '</div>';
    });
    document.getElementById('cockpit-team').innerHTML = teamHtml;

    // Render activity feed
    var feedItems = [];
    d.recentShifts.forEach(function(s) {
      feedItems.push({ time: new Date(s.created_at), html: '<strong>' + s.chatter_name + '</strong> ' + t('models.recorded_revenue') + ' $' + (parseFloat(s.ppv_total)+parseFloat(s.tips_total)).toFixed(2) + ' ' + t('models.ppv_tips_suffix'), icon: '💰' });
    });
    d.activity.forEach(function(a) {
      var icons = {'lead-signed':'🎉','lead-call-booked':'📞','lead-talking-warm':'🔥','clock-in':'🟢','clock-out':'🔴'};
      feedItems.push({ time: new Date(a.created_at), html: '<strong>' + (a.user_name||'Système') + '</strong> ' + a.action + (a.details ? ' — ' + a.details : ''), icon: icons[a.action] || '📋' });
    });
    feedItems.sort(function(a, b) { return b.time - a.time; });
    var feedHtml = feedItems.length === 0 ? emptyStateHTML('clipboard', t('models.no_activity')) : '';
    feedItems.slice(0, 20).forEach(function(item) {
      var timeStr = item.time.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) + ' ' + item.time.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
      feedHtml += '<div class="cockpit-feed-item"><span style="font-size:16px">' + item.icon + '</span><div style="flex:1">' + item.html + '</div><span class="cockpit-feed-time">' + timeStr + '</span></div>';
    });
    document.getElementById('cockpit-activity').innerHTML = feedHtml;

    // Render objectives
    var objHtml = '';
    if (d.objective.target > 0) {
      var pct = Math.min(100, d.revenueMonth / d.objective.target * 100).toFixed(0);
      var status = pct >= 100 ? t('models.reached') : pct >= 60 ? t('models.in_progress') : t('models.behind');
      var statusColor = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';
      objHtml += '<div style="display:flex;align-items:center;gap:16px;padding:14px;background:var(--bg3);border-radius:10px;margin-bottom:8px">'
        + '<div style="flex:1"><div style="font-size:14px;font-weight:600">' + t('models.revenue_monthly_label') + '</div>'
        + '<div style="font-size:12px;color:var(--text3);margin-top:2px">$' + d.revenueMonth.toFixed(2) + ' / $' + d.objective.target.toFixed(0) + '</div>'
        + '<div class="cockpit-progress" style="margin-top:8px"><div class="cockpit-progress-bar" style="width:' + pct + '%;background:' + statusColor + '"></div></div></div>'
        + '<div style="text-align:right"><div style="font-size:20px;font-weight:800">' + pct + '%</div><div style="font-size:11px;color:' + statusColor + ';font-weight:600">' + status + '</div></div></div>';
    } else {
      objHtml = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px">' + t('models.no_objective_month') + '</div>';
    }
    document.getElementById('cockpit-objectives').innerHTML = objHtml;

    // Close dashboard content div
    document.getElementById('cockpit-dashboard-content').insertAdjacentHTML('afterend',
      '<div id="cockpit-profile-content" style="display:none"></div>'
      + '<div id="cockpit-schedule-content" style="display:none"></div>'
      + '<div id="cockpit-tracklinks-content" style="display:none"></div>'
      + '<div id="cockpit-fans-content" style="display:none"></div>');

    // Render charts
    renderCockpitCharts(d);

  } catch(e) {
    console.error('Cockpit render error:', e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red)">' + t('models.cockpit_error') + '</div>';
  }
}

function renderCockpitCharts(d) {
  var chartDefaults = { color: '#9585B0', borderColor: '#1C1333' };

  // Revenue 30 days line chart
  var ctx1 = document.getElementById('cockpit-chart-revenue');
  if (ctx1) {
    cockpitCharts.revenue = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: d.rev30.map(function(r) { return new Date(r.date).toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit'}); }),
        datasets: [{
          label: 'PPV',
          data: d.rev30.map(function(r) { return parseFloat(r.ppv); }),
          borderColor: '#A855F7',
          backgroundColor: 'rgba(168,85,247,0.1)',
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2
        }, {
          label: 'Tips',
          data: d.rev30.map(function(r) { return parseFloat(r.tips); }),
          borderColor: '#ec4899',
          backgroundColor: 'rgba(236,72,153,0.1)',
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9585B0', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#6B5A84', font: { size: 10 } }, grid: { color: '#1C1333' } },
          y: { ticks: { color: '#6B5A84', font: { size: 10 }, callback: function(v) { return '$' + v; } }, grid: { color: '#1C1333' } }
        }
      }
    });
  }

  // Donut chart
  var ctx2 = document.getElementById('cockpit-chart-donut');
  if (ctx2) {
    var msgRevenue = Math.max(0, d.revenueMonth - d.ppvMonth - d.tipsMonth);
    cockpitCharts.donut = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['PPV', 'Tips', 'Autres'],
        datasets: [{
          data: [d.ppvMonth, d.tipsMonth, msgRevenue],
          backgroundColor: ['#A855F7', '#F0ABFC', '#22D3EE'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9585B0', font: { size: 11 }, padding: 16 } }
        }
      }
    });
  }

  // Weekly bar chart
  var ctx3 = document.getElementById('cockpit-chart-weekly');
  if (ctx3) {
    cockpitCharts.weekly = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: d.revWeekly.map(function(r) { return 'S' + getWeekNumber(new Date(r.week)); }),
        datasets: [{
          label: 'PPV',
          data: d.revWeekly.map(function(r) { return parseFloat(r.ppv); }),
          backgroundColor: 'rgba(168,85,247,0.7)', borderRadius: 4
        }, {
          label: 'Tips',
          data: d.revWeekly.map(function(r) { return parseFloat(r.tips); }),
          backgroundColor: 'rgba(236,72,153,0.7)', borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9585B0', font: { size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { color: '#6B5A84', font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, ticks: { color: '#6B5A84', font: { size: 10 }, callback: function(v) { return '$' + v; } }, grid: { color: '#1C1333' } }
        }
      }
    });
  }
}

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ========== CHATTERS ==========
async function renderChatters() {
  await loadShifts();
  renderShifts();
  await loadChatterKPIs();
}

async function renderOutreach() {
  await Promise.all([loadOutreachOptions(), loadLeads(), loadOutreachKPIs()]);
  renderLeads();
  const importBtn = document.getElementById('btn-import-csv');
  if (importBtn) importBtn.style.display = isAdmin() ? '' : 'none';
}
