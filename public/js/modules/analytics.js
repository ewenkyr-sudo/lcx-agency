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
        + '<div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">' + todayLeads + '</div><div class="stat-label">' + t('analytics.leads_today_label') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + todayDms + '</div><div class="stat-label">' + t('analytics.dms_today_label') + '</div></div>'
        + '</div>'
        + (todayByPerson.length > 0 ? '<table class="table mobile-cards"><thead><tr><th>' + t('analytics.name') + '</th><th>' + t('analytics.leads') + '</th><th>' + t('analytics.dms') + '</th></tr></thead><tbody>'
        + todayByPerson.map(function(p) {
          return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || t('student.unknown')) + '</strong></td>'
            + '<td data-label="' + t('analytics.leads') + '" class="mc-half" style="color:var(--accent)">' + p.leads + '</td>'
            + '<td data-label="' + t('analytics.dms') + '" class="mc-half" style="color:var(--blue)">' + p.dms + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div style="color:var(--text-tertiary);font-size:13px;text-align:center">' + t('analytics.no_activity_today') + '</div>');
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
            { label: t('analytics.leads'), data: daily.map(function(d) { return parseInt(d.leads); }), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 },
            { label: t('analytics.dms'), data: daily.map(function(d) { return parseInt(d.dms); }), backgroundColor: 'rgba(34,211,238,0.6)', borderRadius: 4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' }, grid: { color: 'rgba(59,130,246,0.06)' } }, x: { ticks: { color: '#A1A1AA', maxRotation: 45 }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 16 } } } }
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
            { label: t('analytics.leads'), data: hLeads, backgroundColor: 'rgba(59,130,246,0.5)', borderRadius: 3 },
            { label: t('analytics.dms'), data: hDms, backgroundColor: 'rgba(34,211,238,0.5)', borderRadius: 3 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' }, grid: { color: 'rgba(59,130,246,0.06)' } }, x: { ticks: { color: '#A1A1AA', font: { size: 10 } }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#FAFAFA', usePointStyle: true, padding: 12 } } } }
      });
    }

    // By person table
    var personDiv = document.getElementById('daily-by-person');
    if (personDiv) {
      if (byPerson.length === 0) {
        personDiv.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:16px">' + t('analytics.no_data') + '</div>';
      } else {
        var totalLeads = byPerson.reduce(function(s, p) { return s + parseInt(p.leads); }, 0);
        personDiv.innerHTML = '<table class="table mobile-cards"><thead><tr><th>' + t('analytics.name') + '</th><th>' + t('analytics.leads') + '</th><th>' + t('analytics.dms') + '</th><th>%</th></tr></thead><tbody>'
          + byPerson.map(function(p) {
            var pct = totalLeads > 0 ? ((parseInt(p.leads) / totalLeads) * 100).toFixed(1) : '0';
            return '<tr><td data-label="" class="mc-title"><strong>' + (p.name || t('student.unknown')) + '</strong></td>'
              + '<td data-label="' + t('analytics.leads') + '" class="mc-half">' + p.leads + '</td>'
              + '<td data-label="' + t('analytics.dms') + '" class="mc-half" style="color:var(--blue)">' + p.dms + '</td>'
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
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">' + t('common.loading') + '</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [replyRate, ranking, hourly, frVsUs] = await Promise.all([
    f('/api/analytics/reply-rate-weekly'), f('/api/analytics/assistant-ranking'),
    f('/api/analytics/hourly'), f('/api/analytics/fr-vs-us')
  ]);

  container.innerHTML = ''
    // Today stats
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('analytics.today_label') + '</h3>'
    + '<div id="analytics-today-stats"><div style="color:var(--text-tertiary);font-size:13px">' + t('common.loading') + '</div></div>'
    + '</div>'

    // Daily leads & DMs chart with period selector
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('analytics.my_outreach') + '</h3>'
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
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('student.hourly_chart') + '</h3>'
    + '<div style="position:relative;height:220px"><canvas id="chart-my-hourly"></canvas></div>'
    + '</div>'

    // By person
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('student.by_person') + '</h3>'
    + '<div id="daily-by-person"></div>'
    + '</div>'

    // FR vs US
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('analytics.fr_vs_us') + '</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'
    + frVsUs.map(function(m) {
      var rate = parseInt(m.dm_sent) > 0 ? ((parseInt(m.replies) / parseInt(m.dm_sent)) * 100).toFixed(1) : '0';
      return '<div style="background:var(--bg-base);padding:16px;border-radius:10px;text-align:center">'
        + '<div style="font-size:20px;font-weight:800;color:var(--accent)">' + m.market.toUpperCase() + '</div>'
        + '<div class="stats-grid" style="margin-top:12px">'
        + '<div class="stat-card"><div class="stat-value">' + m.total + '</div><div class="stat-label">' + t('analytics.leads') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">' + m.dm_sent + '</div><div class="stat-label">' + t('analytics.dms') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">' + m.replies + '</div><div class="stat-label">' + t('analytics.replies') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--green)">' + m.signed + '</div><div class="stat-label">' + t('analytics.signed') + '</div></div>'
        + '<div class="stat-card"><div class="stat-value" style="color:var(--accent-blue-light)">' + rate + '%</div><div class="stat-label">' + t('analytics.reply_rate') + '</div></div>'
        + '</div></div>';
    }).join('')
    + '</div></div>'

    // Classement assistantes
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('analytics.assistant_ranking') + '</h3>'
    + '<table class="table mobile-cards"><thead><tr><th>#</th><th>' + t('analytics.name') + '</th><th>' + t('analytics.leads') + '</th><th>' + t('analytics.dms') + '</th><th>' + t('analytics.replies') + '</th><th>' + t('analytics.signed') + '</th><th>ROI</th></tr></thead><tbody>'
    + ranking.map(function(a, i) {
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
      var roi = parseInt(a.total_leads) > 0 ? ((parseInt(a.signed) / parseInt(a.total_leads)) * 100).toFixed(1) : '0';
      return '<tr><td data-label="#" class="mc-half" style="font-size:18px">' + medal + '</td>'
        + '<td data-label="" class="mc-title"><strong>' + a.name + '</strong></td>'
        + '<td data-label="' + t('analytics.leads') + '" class="mc-half">' + a.total_leads + '</td>'
        + '<td data-label="' + t('analytics.dms') + '" class="mc-half" style="color:var(--blue)">' + a.dms_sent + '</td>'
        + '<td data-label="' + t('analytics.replies') + '" class="mc-half" style="color:var(--yellow)">' + a.replies + '</td>'
        + '<td data-label="' + t('analytics.signed') + '" class="mc-half" style="color:var(--green)">' + a.signed + '</td>'
        + '<td data-label="ROI" class="mc-half" style="color:var(--accent)">' + roi + '%</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:20px">' + t('analytics.no_data') + '</td></tr>'
    + '</tbody></table></div>'

    // Taux de réponse hebdo
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('analytics.reply_rate_weekly') + '</h3>'
    + '<div style="position:relative;height:300px"><canvas id="chart-reply-rate"></canvas></div>'
    + '</div>'

    // Meilleurs créneaux
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent-blue-light)">' + t('analytics.best_hours') + '</h3>'
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
            label: t('analytics.reply_rate_pct'),
            data: replyRate.map(function(r) { return parseInt(r.dm_sent) > 0 ? ((parseInt(r.replies) / parseInt(r.dm_sent)) * 100).toFixed(1) : 0; }),
            borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' } }, x: { ticks: { color: '#A1A1AA' } } }, plugins: { legend: { labels: { color: '#FAFAFA' } } } }
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
          datasets: [{ label: t('analytics.dms_sent_chart'), data: hourData, backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#A1A1AA' } }, x: { ticks: { color: '#A1A1AA' } } }, plugins: { legend: { labels: { color: '#FAFAFA' } } } }
      });
    }
  }, 100);
}
