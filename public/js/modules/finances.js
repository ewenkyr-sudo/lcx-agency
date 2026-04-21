// FINANCES MODULE
// Extracted from dashboard.html

// ============ FINANCE SECTION ============
async function renderFinance() {
  if (!isAdmin()) return;
  var container = document.getElementById('finance-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">' + t('common.loading') + '</div>';

  var f = function(url) { return fetch(url, { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : []; }); };
  var [payments, objectives, studentRevenue] = await Promise.all([
    f('/api/payments'), f('/api/model-revenue-objectives'), f('/api/student-revenue')
  ]);

  // Calculs
  var totalRevenue = payments.reduce(function(s, p) { return s + parseFloat(p.amount || 0); }, 0);
  var totalPaid = payments.filter(function(p) { return p.status === 'paid'; }).reduce(function(s, p) { return s + parseFloat(p.amount || 0); }, 0);
  var totalPending = payments.filter(function(p) { return p.status === 'pending'; }).reduce(function(s, p) { return s + parseFloat(p.amount || 0); }, 0);

  var currentMonth = new Date().toISOString().slice(0, 7);

  container.innerHTML = ''
    // KPIs
    + '<div class="stats-grid" style="margin-bottom:20px">'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--green)">$' + totalRevenue.toFixed(0) + '</div><div class="stat-label">' + t('finance.revenue_total') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--blue)">$' + totalPaid.toFixed(0) + '</div><div class="stat-label">' + t('finance.paid') + '</div></div>'
    + '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">$' + totalPending.toFixed(0) + '</div><div class="stat-label">' + t('finance.pending') + '</div></div>'
    + '</div>'

    // Ajouter paiement
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2)">' + t('finance.payments') + '</h3>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="showPaymentForm()">+ ' + t('common.add') + '</button>'
    + '</div>'
    + '<div id="payment-form-wrap"></div>'
    + '<table class="table mobile-cards"><thead><tr><th>' + t('finance.model_col') + '</th><th>' + t('finance.month_col') + '</th><th>' + t('finance.amount') + '</th><th>' + t('common.status') + '</th><th>' + t('common.notes') + '</th><th></th></tr></thead><tbody>'
    + payments.map(function(p) {
      var stColor = p.status === 'paid' ? 'var(--green)' : p.status === 'pending' ? 'var(--yellow)' : 'var(--red)';
      var stBg = p.status === 'paid' ? 'var(--green-bg)' : p.status === 'pending' ? 'var(--yellow-bg)' : 'var(--red-bg)';
      return '<tr><td data-label="" class="mc-title"><strong>' + p.model_name + '</strong></td>'
        + '<td data-label="' + t('finance.month_col') + '" class="mc-half">' + p.month + '</td>'
        + '<td data-label="' + t('finance.amount') + '" class="mc-half" style="color:var(--green);font-weight:700">$' + parseFloat(p.amount).toFixed(2) + '</td>'
        + '<td data-label="' + t('common.status') + '" class="mc-half"><select onchange="updatePayment(' + p.id + ',{status:this.value})" style="background:' + stBg + ';color:' + stColor + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><option value="pending"' + (p.status==='pending'?' selected':'') + '>' + t('finance.pending') + '</option><option value="paid"' + (p.status==='paid'?' selected':'') + '>' + t('finance.paid') + '</option><option value="cancelled"' + (p.status==='cancelled'?' selected':'') + '>' + t('cp.status_cancelled') + '</option></select></td>'
        + '<td data-label="' + t('common.notes') + '" class="mc-full" style="font-size:12px;color:var(--text2)">' + (p.notes||'-') + '</td>'
        + '<td data-label=""><button class="btn-delete-small" onclick="deletePayment(' + p.id + ')">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="6">' + emptyStateHTML('dollar', t('finances.no_payment')) + '</td></tr>'
    + '</tbody></table></div>'

    // Objectifs revenus modèles
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--accent2)">' + t('finances.revenue_objectives') + ' — ' + currentMonth + '</h3>'
    + '<button class="btn btn-primary" style="font-size:12px" onclick="showRevenueObjForm()">+ ' + t('common.add') + '</button>'
    + '</div>'
    + '<div id="revenue-obj-form-wrap"></div>'
    + '<div style="display:grid;gap:10px">'
    + objectives.filter(function(o) { return o.month === currentMonth; }).map(function(o) {
      var pct = parseFloat(o.target) > 0 ? Math.min(100, Math.round((parseFloat(o.current) / parseFloat(o.target)) * 100)) : 0;
      var done = pct >= 100;
      return '<div style="background:var(--bg3);padding:12px;border-radius:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
        + '<strong>' + o.model_name + '</strong>'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<input type="number" value="' + o.current + '" onchange="updateRevenueObj(' + o.id + ',{current:this.value})" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;font-family:inherit;text-align:right">'
        + '<span style="font-size:13px;color:var(--text3)">/ $' + parseFloat(o.target).toFixed(0) + '</span>'
        + '</div></div>'
        + '<div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + (done?'var(--green)':'var(--accent)') + ';border-radius:3px"></div></div>'
        + '</div>';
    }).join('') || '<div style="color:var(--text3);text-align:center;padding:16px">' + t('finances.no_objective') + '</div>'
    + '</div></div>'

    // Revenus élèves
    + '<div class="panel" style="padding:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">' + t('finances.student_commissions') + '</h3>'
    + '<table class="table mobile-cards"><thead><tr><th>' + t('coaching.student_col') + '</th><th>' + t('finance.model_col') + '</th><th>' + t('finance.month_col') + '</th><th>Revenue</th><th>' + t('finance.student_commission') + '</th><th>' + t('finance.my_commission') + '</th></tr></thead><tbody>'
    + studentRevenue.map(function(r) {
      var rev = parseFloat(r.revenue);
      var commRate = parseFloat(r.commission_rate);
      var studentComm = (rev * commRate / 100).toFixed(2);
      var myComm = (rev - parseFloat(studentComm)).toFixed(2);
      return '<tr><td data-label="" class="mc-title"><strong>' + r.student_name + '</strong></td>'
        + '<td data-label="' + t('finance.model_col') + '" class="mc-half">' + r.model_name + '</td>'
        + '<td data-label="' + t('finance.month_col') + '" class="mc-half">' + r.month + '</td>'
        + '<td data-label="Revenue" class="mc-half" style="color:var(--green)">$' + rev.toFixed(2) + '</td>'
        + '<td data-label="' + t('finance.student_commission') + '" class="mc-half" style="color:var(--yellow)">$' + studentComm + ' (' + commRate + '%)</td>'
        + '<td data-label="' + t('finance.my_commission') + '" class="mc-half" style="color:var(--accent)">$' + myComm + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px">' + t('finances.no_revenue') + '</td></tr>'
    + '</tbody></table></div>';
}

function showPaymentForm() {
  var wrap = document.getElementById('payment-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  var modelOpts = allModels.map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
  wrap.innerHTML = '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:var(--bg3);padding:14px;border-radius:10px">'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('finance.model_col') + '</label><select id="pay-model" class="form-input" style="font-size:12px">' + modelOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('finance.month_col') + '</label><input type="month" id="pay-month" class="form-input" style="font-size:12px" value="' + new Date().toISOString().slice(0,7) + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('finances.amount_label') + '</label><input type="number" id="pay-amount" class="form-input" style="font-size:12px;width:100px" placeholder="0"></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('common.notes') + '</label><input type="text" id="pay-notes" class="form-input" style="font-size:12px" placeholder="' + t('student.notes_placeholder') + '"></div>'
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
  var modelOpts = allModels.map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
  wrap.innerHTML = '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:var(--bg3);padding:14px;border-radius:10px">'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('finance.model_col') + '</label><select id="robj-model" class="form-input" style="font-size:12px">' + modelOpts + '</select></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('finance.month_col') + '</label><input type="month" id="robj-month" class="form-input" style="font-size:12px" value="' + new Date().toISOString().slice(0,7) + '"></div>'
    + '<div><label style="font-size:11px;color:var(--text3)">' + t('coaching.obj_target') + ' ($)</label><input type="number" id="robj-target" class="form-input" style="font-size:12px;width:100px" placeholder="0"></div>'
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
