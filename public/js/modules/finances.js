// FINANCES MODULE v2
// Complete financial dashboard with charts, KPIs, and detailed tracking

var financeChartMonthly = null;
var financeChartByModel = null;
var financeChartBySource = null;
var financePaymentFilter = { model: '', month: '', status: '' };

async function renderFinance() {
  if (!isAdmin()) return;
  var container = document.getElementById('finance-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">' + t('common.loading') + '</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }); };
  var [summary, monthly, breakdown, payments, objectives, due, commissions] = await Promise.all([
    f('/api/finance/summary'),
    f('/api/finance/monthly'),
    f('/api/finance/breakdown'),
    f('/api/payments'),
    f('/api/model-revenue-objectives'),
    f('/api/finance/due'),
    f('/api/finance/commissions')
  ]);

  if (!summary) summary = { currentMonth: { revenue: 0, ppv: 0, tips: 0, month: '' }, previousMonth: { revenue: 0 }, variation: 0, objective: { target: 0, current: 0 }, due: { count: 0, total: 0 } };
  if (!monthly) monthly = [];
  if (!breakdown) breakdown = { byModel: [], bySource: { ppv: 0, tips: 0 } };
  if (!payments) payments = [];
  if (!objectives) objectives = [];
  if (!due) due = [];
  if (!commissions) commissions = { monthlyCommission: 0, yearlyCommission: 0, byModel: [] };

  var curMonth = new Date().toISOString().slice(0, 7);
  var variationColor = summary.variation >= 0 ? 'var(--green)' : 'var(--red)';
  var variationIcon = summary.variation >= 0 ? '↑' : '↓';
  var objPct = summary.objective.target > 0 ? Math.min(100, Math.round(summary.objective.current / summary.objective.target * 100)) : 0;

  container.innerHTML = ''
    // === KPIs ===
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green);font-size:28px">$' + summary.currentMonth.revenue.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div><div class="stat-label">' + t('finance.revenue_total') + ' — ' + summary.currentMonth.month + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--text-secondary);font-size:20px">$' + summary.previousMonth.revenue.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div><div class="stat-label" style="display:flex;align-items:center;gap:6px;justify-content:center">' + t('finance.prev_month') + ' <span style="color:' + variationColor + ';font-weight:700;font-size:14px">' + variationIcon + ' ' + Math.abs(summary.variation) + '%</span></div></div>'
    + '<div class="stat-card"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-secondary)">' + t('finance.objective') + '</span><span style="color:var(--accent);font-weight:700">' + objPct + '%</span></div>'
    + '<div style="height:8px;background:var(--bg-base);border-radius:4px;overflow:hidden;margin-bottom:6px"><div style="height:100%;width:' + objPct + '%;background:' + (objPct >= 100 ? 'var(--green)' : 'var(--accent)') + ';border-radius:4px;transition:width 0.5s"></div></div>'
    + '<div style="font-size:12px;color:var(--text-tertiary);text-align:center">$' + summary.objective.current.toLocaleString(undefined, {maximumFractionDigits:0}) + ' / $' + summary.objective.target.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow);font-size:22px">' + summary.due.count + '</div><div class="stat-label">' + t('finance.pending_payments') + ' — $' + summary.due.total.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div></div>'
    + '</div>'

    // === Revenue chart 12 months + Pie charts ===
    + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px">'
    + '<div class="panel" style="padding:20px"><h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light);margin-bottom:16px">' + t('finance.monthly_revenue') + '</h3><div style="position:relative;height:200px;max-height:200px;overflow:hidden"><canvas id="finance-chart-monthly" style="max-height:200px"></canvas></div></div>'
    + '<div style="display:grid;gap:16px">'
    + '<div class="panel" style="padding:20px"><h3 style="font-size:13px;font-weight:700;color:var(--accent-blue-light);margin-bottom:12px">' + t('finance.by_model') + '</h3><div style="position:relative;height:130px;max-height:130px;overflow:hidden"><canvas id="finance-chart-model" style="max-height:130px"></canvas></div></div>'
    + '<div class="panel" style="padding:20px"><h3 style="font-size:13px;font-weight:700;color:var(--accent-blue-light);margin-bottom:12px">' + t('finance.by_source') + '</h3><div style="position:relative;height:130px;max-height:130px;overflow:hidden"><canvas id="finance-chart-source" style="max-height:130px"></canvas></div></div>'
    + '</div></div>'

    // === Due this month ===
    + (due.length > 0 ? '<div class="panel" style="padding:20px;margin-bottom:20px;border-left:3px solid var(--yellow)">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--yellow)">' + t('finance.due_this_month') + '</h3><span style="font-size:18px;font-weight:800;color:var(--yellow)">$' + due.reduce(function(s, d) { return s + parseFloat(d.amount || 0); }, 0).toLocaleString(undefined, {maximumFractionDigits:0}) + '</span></div>'
    + '<div style="display:grid;gap:8px">' + due.map(function(d) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-elevated);border-radius:8px">'
        + '<strong>' + d.model_name + '</strong>'
        + '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:16px;font-weight:700;color:var(--yellow)">$' + parseFloat(d.amount).toFixed(2) + '</span>'
        + '<button class="btn" style="font-size:11px;padding:4px 12px;background:var(--green-bg);color:var(--green);border:none;cursor:pointer;border-radius:6px" onclick="markPaymentPaid(' + d.id + ')">' + t('finance.mark_paid') + '</button></div></div>';
    }).join('') + '</div></div>' : '')

    // === Commission recap ===
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light);margin-bottom:16px">' + t('finance.agency_commissions') + '</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
    + '<div style="background:var(--bg-elevated);padding:14px;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--accent)">$' + commissions.monthlyCommission.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div><div style="font-size:12px;color:var(--text-tertiary)">' + t('finance.this_month_commission') + '</div></div>'
    + '<div style="background:var(--bg-elevated);padding:14px;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--green)">$' + commissions.yearlyCommission.toLocaleString(undefined, {maximumFractionDigits:0}) + '</div><div style="font-size:12px;color:var(--text-tertiary)">' + t('finance.yearly_commission') + '</div></div>'
    + '</div>'
    + (commissions.byModel.length > 0 ? '<div style="display:grid;gap:6px">' + commissions.byModel.map(function(cm) {
      return '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-elevated);border-radius:6px;font-size:13px"><span>' + cm.model_name + '</span><div><span style="color:var(--text-tertiary);margin-right:12px">$' + parseFloat(cm.revenue).toLocaleString(undefined, {maximumFractionDigits:0}) + ' rev</span><span style="color:var(--accent);font-weight:700">$' + parseFloat(cm.commission).toLocaleString(undefined, {maximumFractionDigits:0}) + ' comm</span></div></div>';
    }).join('') + '</div>' : '')
    + '</div>'

    // === Payments table with filters ===
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('finance.payments') + '</h3>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '<select id="fin-filter-model" onchange="financePaymentFilter.model=this.value;renderFinancePayments()" class="form-input" style="font-size:11px;padding:4px 8px;width:auto"><option value="">' + t('finance.all_models') + '</option>' + (allModels||[]).map(function(m) { return '<option value="' + m.name + '">' + m.name + '</option>'; }).join('') + '</select>'
    + '<select id="fin-filter-status" onchange="financePaymentFilter.status=this.value;renderFinancePayments()" class="form-input" style="font-size:11px;padding:4px 8px;width:auto"><option value="">' + t('finance.all_statuses') + '</option><option value="pending">' + t('finance.pending') + '</option><option value="paid">' + t('finance.paid') + '</option></select>'
    + '<button class="btn" style="font-size:11px;padding:4px 12px;background:var(--bg-elevated);color:var(--accent);border:none;cursor:pointer;border-radius:6px" onclick="exportPaymentsCSV()">📥 CSV</button>'
    + '<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="showPaymentForm()">+ ' + t('common.add') + '</button>'
    + '</div></div>'
    + '<div id="payment-form-wrap"></div>'
    + '<div id="finance-payments-table"></div>'
    + '</div>'

    // === Revenue objectives ===
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent-blue-light)">' + t('finances.revenue_objectives') + ' — ' + curMonth + '</h3>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="showRevenueObjForm()">+ ' + t('common.add') + '</button>'
    + '</div>'
    + '<div id="revenue-obj-form-wrap"></div>'
    + '<div style="display:grid;gap:10px">'
    + objectives.filter(function(o) { return o.month === curMonth; }).map(function(o) {
      var pct = parseFloat(o.target) > 0 ? Math.min(100, Math.round((parseFloat(o.current) / parseFloat(o.target)) * 100)) : 0;
      return '<div style="background:var(--bg-elevated);padding:12px;border-radius:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong>' + o.model_name + '</strong>'
        + '<div style="display:flex;align-items:center;gap:8px"><input type="number" value="' + o.current + '" onchange="updateRevenueObj(' + o.id + ',{current:this.value})" style="width:80px;background:var(--bg-base);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;font-family:inherit;text-align:right">'
        + '<span style="font-size:13px;color:var(--text-tertiary)">/ $' + parseFloat(o.target).toFixed(0) + '</span><span style="font-size:12px;font-weight:700;color:' + (pct >= 100 ? 'var(--green)' : 'var(--accent)') + '">' + pct + '%</span></div></div>'
        + '<div style="height:6px;background:var(--bg-base);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + (pct >= 100 ? 'var(--green)' : 'var(--accent)') + ';border-radius:3px"></div></div></div>';
    }).join('') || '<div style="color:var(--text-tertiary);text-align:center;padding:16px">' + t('finances.no_objective') + '</div>'
    + '</div></div>';

  // Store data for filtering
  window._financePayments = payments;
  renderFinancePayments();

  // Render charts
  renderFinanceCharts(monthly, breakdown);
}

function renderFinancePayments() {
  var payments = window._financePayments || [];
  var filtered = payments;
  if (financePaymentFilter.model) filtered = filtered.filter(function(p) { return p.model_name === financePaymentFilter.model; });
  if (financePaymentFilter.status) filtered = filtered.filter(function(p) { return p.status === financePaymentFilter.status; });

  var el = document.getElementById('finance-payments-table');
  if (!el) return;
  el.innerHTML = '<table class="table mobile-cards"><thead><tr><th>' + t('finance.model_col') + '</th><th>' + t('finance.month_col') + '</th><th>' + t('finance.amount') + '</th><th>' + t('common.status') + '</th><th>' + t('common.notes') + '</th><th></th></tr></thead><tbody>'
    + filtered.map(function(p) {
      var stColor = p.status === 'paid' ? 'var(--green)' : p.status === 'pending' ? 'var(--yellow)' : 'var(--red)';
      var stBg = p.status === 'paid' ? 'var(--green-bg)' : p.status === 'pending' ? 'var(--yellow-bg)' : 'var(--red-bg)';
      return '<tr><td data-label="" class="mc-title"><strong>' + p.model_name + '</strong></td>'
        + '<td data-label="' + t('finance.month_col') + '" class="mc-half">' + p.month + '</td>'
        + '<td data-label="' + t('finance.amount') + '" class="mc-half" style="color:var(--green);font-weight:700">$' + parseFloat(p.amount).toFixed(2) + '</td>'
        + '<td data-label="' + t('common.status') + '" class="mc-half"><select onchange="updatePayment(' + p.id + ',{status:this.value})" style="background:' + stBg + ';color:' + stColor + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><option value="pending"' + (p.status === 'pending' ? ' selected' : '') + '>' + t('finance.pending') + '</option><option value="paid"' + (p.status === 'paid' ? ' selected' : '') + '>' + t('finance.paid') + '</option><option value="cancelled"' + (p.status === 'cancelled' ? ' selected' : '') + '>' + t('cp.status_cancelled') + '</option></select></td>'
        + '<td data-label="' + t('common.notes') + '" class="mc-full" style="font-size:12px;color:var(--text-secondary)">' + (p.notes || '-') + '</td>'
        + '<td data-label=""><button class="btn-delete-small" onclick="deletePayment(' + p.id + ')">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="6">' + emptyStateHTML('dollar', t('finances.no_payment')) + '</td></tr>'
    + '</tbody></table>';
}

function renderFinanceCharts(monthly, breakdown) {
  // === Monthly revenue bar chart (stacked by model) ===
  var chartColors = ['#3B82F6', '#22D3EE', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#6366F1', '#84CC16'];
  var months = [];
  var modelSet = {};
  monthly.forEach(function(r) {
    if (months.indexOf(r.month) === -1) months.push(r.month);
    modelSet[r.model_name] = true;
  });
  var modelNames = Object.keys(modelSet).slice(0, 8);
  if (modelNames.length > 5) {
    var topModels = {};
    monthly.forEach(function(r) { topModels[r.model_name] = (topModels[r.model_name] || 0) + parseFloat(r.revenue); });
    modelNames = Object.keys(topModels).sort(function(a, b) { return topModels[b] - topModels[a]; }).slice(0, 5);
  }

  var datasets = modelNames.map(function(name, i) {
    return {
      label: name,
      data: months.map(function(m) {
        var row = monthly.find(function(r) { return r.month === m && r.model_name === name; });
        return row ? parseFloat(row.revenue) : 0;
      }),
      backgroundColor: chartColors[i % chartColors.length] + 'CC',
      borderRadius: 4
    };
  });

  var ctx1 = document.getElementById('finance-chart-monthly');
  if (ctx1) {
    if (financeChartMonthly) financeChartMonthly.destroy();
    financeChartMonthly = new Chart(ctx1.getContext('2d'), {
      type: 'bar',
      data: { labels: months.map(function(m) { return m.slice(5); + '/' + m.slice(2, 4) }), datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#6b7280', font: { size: 10 } } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7280', callback: function(v) { return '$' + v; } } }
        }
      }
    });
  }

  // === Pie chart by model ===
  var ctx2 = document.getElementById('finance-chart-model');
  if (ctx2 && breakdown.byModel.length > 0) {
    var topByModel = breakdown.byModel.slice(0, 6);
    if (financeChartByModel) financeChartByModel.destroy();
    financeChartByModel = new Chart(ctx2.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: topByModel.map(function(r) { return r.model_name; }),
        datasets: [{ data: topByModel.map(function(r) { return parseFloat(r.revenue); }), backgroundColor: chartColors.slice(0, topByModel.length), borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } } } }
    });
  }

  // === Pie chart by source ===
  var ctx3 = document.getElementById('finance-chart-source');
  if (ctx3) {
    var ppv = parseFloat(breakdown.bySource.ppv || 0);
    var tips = parseFloat(breakdown.bySource.tips || 0);
    if (ppv + tips > 0) {
      if (financeChartBySource) financeChartBySource.destroy();
      financeChartBySource = new Chart(ctx3.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['PPV', 'Tips'],
          datasets: [{ data: [ppv, tips], backgroundColor: ['#3B82F6', '#22D3EE'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } } } }
      });
    }
  }
}

async function markPaymentPaid(id) {
  await fetch('/api/payments/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'paid' }) });
  showToast(t('finance.marked_paid'), 'success');
  renderFinance();
}

function exportPaymentsCSV() {
  window.open('/api/export/payments', '_blank');
}

function showPaymentForm() {
  var wrap = document.getElementById('payment-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var modelOpts = (allModels || []).map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
  wrap.innerHTML = '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:var(--bg-elevated);padding:14px;border-radius:10px">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('finance.model_col') + '</label><select id="pay-model" class="form-input" style="font-size:12px">' + modelOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('finance.month_col') + '</label><input type="month" id="pay-month" class="form-input" style="font-size:12px" value="' + new Date().toISOString().slice(0, 7) + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('finances.amount_label') + '</label><input type="number" id="pay-amount" class="form-input" style="font-size:12px;width:100px" placeholder="0"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('common.notes') + '</label><input type="text" id="pay-notes" class="form-input" style="font-size:12px" placeholder="' + t('student.notes_placeholder') + '"></div>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="addPayment()">' + t('common.add') + '</button>'
    + '</div>';
}

async function addPayment() {
  var res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ model_id: document.getElementById('pay-model').value, month: document.getElementById('pay-month').value, amount: document.getElementById('pay-amount').value, notes: document.getElementById('pay-notes').value.trim() })
  });
  if (res.ok) { showToast(t('finances.payment_added_toast'), 'success'); renderFinance(); }
}

async function updatePayment(id, data) {
  await fetch('/api/payments/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
}

async function deletePayment(id) {
  if (!(await confirmDelete(t('confirm.delete_payment')))) return;
  await fetch('/api/payments/' + id, { method: 'DELETE', credentials: 'include' });
  renderFinance();
}

function showRevenueObjForm() {
  var wrap = document.getElementById('revenue-obj-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var modelOpts = (allModels || []).map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
  wrap.innerHTML = '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:var(--bg-elevated);padding:14px;border-radius:10px">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('finance.model_col') + '</label><select id="robj-model" class="form-input" style="font-size:12px">' + modelOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('finance.month_col') + '</label><input type="month" id="robj-month" class="form-input" style="font-size:12px" value="' + new Date().toISOString().slice(0, 7) + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary)">' + t('coaching.obj_target') + ' ($)</label><input type="number" id="robj-target" class="form-input" style="font-size:12px;width:100px" placeholder="0"></div>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="addRevenueObj()">' + t('common.add') + '</button>'
    + '</div>';
}

async function addRevenueObj() {
  var res = await fetch('/api/model-revenue-objectives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ model_id: document.getElementById('robj-model').value, month: document.getElementById('robj-month').value, target: document.getElementById('robj-target').value })
  });
  if (res.ok) { showToast(t('finances.objective_added'), 'success'); renderFinance(); }
}

async function updateRevenueObj(id, data) {
  await fetch('/api/model-revenue-objectives/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
}
