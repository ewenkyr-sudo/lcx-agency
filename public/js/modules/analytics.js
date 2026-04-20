// ANALYTICS MODULE
// Extracted from dashboard.html

// ============ ANALYTICS SECTION ============
let analyticsCharts = {};

async function loadDailyChart(days, btn) {
  if (btn) {
    document.querySelectorAll('#daily-period-btns .filter-chip').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  try {
    var res = await fetch('/api/analytics/daily?days=' + days, { credentials: 'include' });
    var data = await res.json();
    var daily = data.daily || [];
    var hourlyData = data.hourly || [];
    var todayByPerson = data.todayByPerson || [];

    // Today stats panel
    var todayDiv = document.getElementById('analytics-today-stats');
    if (todayDiv) {
      var todayLeads = todayByPerson.reduce(function(s, p) { return s + parseInt(p.leads); }, 0);
      var todayDms = todayByPerson.reduce(function(s, p) { return s + parseInt(p.dms); }, 0);
      todayDiv.innerHTML = '<div class="stats-grid" style="margin-bottom:12px">'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + todayLeads + '</div><div class="stat-label">Leads aujourd\'hui</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + todayDms + '</div><div class="stat-label">DMs aujourd\'hui</div></div>'
        + '</div>'
        + (todayByPerson.length > 0 ? '<table class="table mobile-cards"><thead><tr><th>Nom</th><th>Leads</th><th>DMs</th></tr></thead><tbody>'
        + todayByPerson.map(function(p) {
          return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || 'Inconnu') + '</strong></td>'
            + '<td data-label="Leads" class="mc-half" style="color:var(--accent)">' + p.leads + '</td>'
            + '<td data-label="DMs" class="mc-half" style="color:var(--blue)">' + p.dms + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div style="color:var(--text3);font-size:13px;text-align:center">Aucune activité aujourd\'hui</div>');
    }
    var byPerson = data.byPerson || [];

    // Daily chart
    if (analyticsCharts.daily) analyticsCharts.daily.destroy();
    var dailyCtx = document.getElementById('chart-daily-leads-dms');
    if (dailyCtx && daily.length > 0) {
      analyticsCharts.daily = new Chart(dailyCtx, {
        type: 'bar',
        data: {
          labels: daily.map(function(d) { var dt = new Date(d.day); return dt.getDate() + '/' + (dt.getMonth()+1); }),
          datasets: [
            { label: 'Leads', data: daily.map(function(d) { return parseInt(d.leads); }), backgroundColor: 'rgba(168,85,247,0.6)', borderRadius: 4 },
            { label: 'DMs', data: daily.map(function(d) { return parseInt(d.dms); }), backgroundColor: 'rgba(34,211,238,0.6)', borderRadius: 4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#9585B0' }, grid: { color: 'rgba(168,85,247,0.06)' } }, x: { ticks: { color: '#9585B0', maxRotation: 45 }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#EDE4FF', usePointStyle: true, padding: 16 } } } }
      });
    }

    // Hourly chart
    if (analyticsCharts.myHourly) analyticsCharts.myHourly.destroy();
    var hCtx = document.getElementById('chart-my-hourly');
    if (hCtx) {
      var hours = Array.from({length: 24}, function(_, i) { return i; });
      var hLeads = hours.map(function(h) { var f2 = hourlyData.find(function(x) { return parseInt(x.hour) === h; }); return f2 ? parseInt(f2.leads) : 0; });
      var hDms = hours.map(function(h) { var f2 = hourlyData.find(function(x) { return parseInt(x.hour) === h; }); return f2 ? parseInt(f2.dms) : 0; });
      analyticsCharts.myHourly = new Chart(hCtx, {
        type: 'bar',
        data: {
          labels: hours.map(function(h) { return h + 'h'; }),
          datasets: [
            { label: 'Leads', data: hLeads, backgroundColor: 'rgba(168,85,247,0.5)', borderRadius: 3 },
            { label: 'DMs', data: hDms, backgroundColor: 'rgba(34,211,238,0.5)', borderRadius: 3 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#9585B0' }, grid: { color: 'rgba(168,85,247,0.06)' } }, x: { ticks: { color: '#9585B0', font: { size: 10 } }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#EDE4FF', usePointStyle: true, padding: 12 } } } }
      });
    }

    // By person table
    var personDiv = document.getElementById('daily-by-person');
    if (personDiv) {
      if (byPerson.length === 0) {
        personDiv.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px">Aucune donnée</div>';
      } else {
        var totalLeads = byPerson.reduce(function(s, p) { return s + parseInt(p.leads); }, 0);
        personDiv.innerHTML = '<table class="table mobile-cards"><thead><tr><th>Nom</th><th>Leads</th><th>DMs</th><th>%</th></tr></thead><tbody>'
          + byPerson.map(function(p) {
            var pct = totalLeads > 0 ? ((parseInt(p.leads) / totalLeads) * 100).toFixed(1) : '0';
            return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || 'Inconnu') + '</strong></td>'
              + '<td data-label="Leads" class="mc-half">' + p.leads + '</td>'
              + '<td data-label="DMs" class="mc-half" style="color:var(--blue)">' + p.dms + '</td>'
              + '<td data-label="%" class="mc-half" style="color:var(--accent)">' + pct + '%</td></tr>';
          }).join('') + '</tbody></table>';
      }
    }
  } catch(e) {}
}

async function renderAnalytics() {
  if (!isAdmin()) return;
  var container = document.getElementById('analytics-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Chargement...</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [replyRate, ranking, hourly, frVsUs] = await Promise.all([
    f('/api/analytics/reply-rate-weekly'), f('/api/analytics/assistant-ranking'),
    f('/api/analytics/hourly'), f('/api/analytics/fr-vs-us')
  ]);

  container.innerHTML = ''
    // Today stats
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Aujourd\'hui</h3>'
    + '<div id="analytics-today-stats"><div style="color:var(--text3);font-size:13px">Chargement...</div></div>'
    + '</div>'

    // Daily leads & DMs chart with period selector
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2)">Mon outreach — Leads & DMs</h3>'
    + '<div style="display:flex;gap:4px" id="daily-period-btns">'
    + '<button class="filter-chip" onclick="loadDailyChart(1,this)">1j</button>'
    + '<button class="filter-chip" onclick="loadDailyChart(2,this)">2j</button>'
    + '<button class="filter-chip" onclick="loadDailyChart(7,this)">7j</button>'
    + '<button class="filter-chip" onclick="loadDailyChart(14,this)">14j</button>'
    + '<button class="filter-chip active" onclick="loadDailyChart(30,this)">30j</button>'
    + '<button class="filter-chip" onclick="loadDailyChart(60,this)">60j</button>'
    + '</div></div>'
    + '<div style="position:relative;height:280px"><canvas id="chart-daily-leads-dms"></canvas></div>'
    + '</div>'

    // Hourly breakdown
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Activité par heure</h3>'
    + '<div style="position:relative;height:220px"><canvas id="chart-my-hourly"></canvas></div>'
    + '</div>'

    // By person
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Qui a ajouté les leads</h3>'
    + '<div id="daily-by-person"></div>'
    + '</div>'

    // FR vs US
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Comparaison FR vs US</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'
    + frVsUs.map(function(m) {
      var rate = parseInt(m.dm_sent) > 0 ? ((parseInt(m.replies) / parseInt(m.dm_sent)) * 100).toFixed(1) : '0';
      return '<div style="background:var(--bg3);padding:16px;border-radius:10px;text-align:center">'
        + '<div style="font-size:20px;font-weight:800;color:var(--accent)">' + m.market.toUpperCase() + '</div>'
        + '<div class="stats-grid" style="margin-top:12px">'
        + '<div class="stat-card"><div class="stat-value">' + m.total + '</div><div class="stat-label">Leads</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + m.dm_sent + '</div><div class="stat-label">DMs</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">' + m.replies + '</div><div class="stat-label">Réponses</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--green)">' + m.signed + '</div><div class="stat-label">Signés</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + rate + '%</div><div class="stat-label">Taux réponse</div></div>'
        + '</div></div>';
    }).join('')
    + '</div></div>'

    // Classement assistantes
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Classement Assistantes</h3>'
    + '<table class="table mobile-cards"><thead><tr><th>#</th><th>Nom</th><th>Leads</th><th>DMs</th><th>Réponses</th><th>Signés</th><th>ROI</th></tr></thead><tbody>'
    + ranking.map(function(a, i) {
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
      var roi = parseInt(a.total_leads) > 0 ? ((parseInt(a.signed) / parseInt(a.total_leads)) * 100).toFixed(1) : '0';
      return '<tr><td data-label="#" class="mc-half" style="font-size:18px">' + medal + '</td>'
        + '<td data-label="" class="mc-title"><strong>' + a.name + '</strong></td>'
        + '<td data-label="Leads" class="mc-half">' + a.total_leads + '</td>'
        + '<td data-label="DMs" class="mc-half" style="color:var(--blue)">' + a.dms_sent + '</td>'
        + '<td data-label="Réponses" class="mc-half" style="color:var(--yellow)">' + a.replies + '</td>'
        + '<td data-label="Signés" class="mc-half" style="color:var(--green)">' + a.signed + '</td>'
        + '<td data-label="ROI" class="mc-half" style="color:var(--accent)">' + roi + '%</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">Aucune donnée</td></tr>'
    + '</tbody></table></div>'

    // Taux de réponse hebdo
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Taux de réponse par semaine</h3>'
    + '<div style="position:relative;height:300px"><canvas id="chart-reply-rate"></canvas></div>'
    + '</div>'

    // Meilleurs créneaux
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Meilleurs créneaux horaires pour DMs</h3>'
    + '<div style="position:relative;height:300px"><canvas id="chart-hourly"></canvas></div>'
    + '</div>';

  // Charts
  setTimeout(function() {
    // Load daily chart (default 30 days)
    loadDailyChart(30);

    // Reply rate chart
    if (analyticsCharts.replyRate) analyticsCharts.replyRate.destroy();
    var rrCtx = document.getElementById('chart-reply-rate');
    if (rrCtx && replyRate.length > 0) {
      analyticsCharts.replyRate = new Chart(rrCtx, {
        type: 'line',
        data: {
          labels: replyRate.map(function(r) { return r.week; }),
          datasets: [{
            label: 'Taux de réponse (%)',
            data: replyRate.map(function(r) { return parseInt(r.dm_sent) > 0 ? ((parseInt(r.replies) / parseInt(r.dm_sent)) * 100).toFixed(1) : 0; }),
            borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.3
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#9585B0' } }, x: { ticks: { color: '#9585B0' } } }, plugins: { legend: { labels: { color: '#EDE4FF' } } } }
      });
    }
    // Hourly chart
    if (analyticsCharts.hourly) analyticsCharts.hourly.destroy();
    var hCtx = document.getElementById('chart-hourly');
    if (hCtx && hourly.length > 0) {
      var hours = Array.from({length: 24}, function(_, i) { return i; });
      var hourData = hours.map(function(h) { var found = hourly.find(function(x) { return parseInt(x.hour) === h; }); return found ? parseInt(found.count) : 0; });
      analyticsCharts.hourly = new Chart(hCtx, {
        type: 'bar',
        data: {
          labels: hours.map(function(h) { return h + 'h'; }),
          datasets: [{ label: 'DMs envoyés', data: hourData, backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#9585B0' } }, x: { ticks: { color: '#9585B0' } } }, plugins: { legend: { labels: { color: '#EDE4FF' } } } }
      });
    }
  }, 100);
}
