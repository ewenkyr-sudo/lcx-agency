// SHIFT TIMER MODULE
// Real-time shift tracking for chatters with countdown timer

var _activeShift = null;
var _shiftTimerInterval = null;
var _shiftAutoSaveInterval = null;
var _shiftDirty = false;

// ============ CHATTER VIEW ============

async function initShiftTimer() {
  try {
    var res = await fetch('/api/chatter-shifts/mine/current', { credentials: 'include' });
    if (res.ok) _activeShift = await res.json();
  } catch(e) {}
  renderShiftWidget();
}

function renderShiftWidget() {
  // Render in the chatters section header area
  var container = document.getElementById('shift-timer-widget');
  if (!container) return;

  if (!_activeShift) {
    // No active shift — show start button
    container.innerHTML = '<div style="text-align:center;padding:40px">'
      + '<button class="btn btn-primary" style="font-size:18px;padding:16px 40px;border-radius:14px;cursor:pointer" onclick="showStartShiftModal()">'
      + '🟢 ' + t('shift.start_shift') + '</button>'
      + '<div style="color:var(--text-tertiary);font-size:13px;margin-top:12px">' + t('shift.start_desc') + '</div>'
      + '</div>';
    clearInterval(_shiftTimerInterval);
    clearInterval(_shiftAutoSaveInterval);
    return;
  }

  // Active shift — show timer + revenue inputs
  var models = _activeShift.model_name || '-';
  container.innerHTML = ''
    // Sticky banner with timer
    + '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(6,182,212,0.06));border:1px solid var(--border-accent);border-radius:var(--radius-xl);padding:20px;margin-bottom:20px;position:relative;overflow:hidden">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">'
    + '<div><div style="font-size:var(--text-micro);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">' + t('shift.active_shift') + '</div>'
    + '<div style="font-size:13px;color:var(--accent-blue-light);font-weight:600">' + models + '</div></div>'
    + '<div style="text-align:center"><div style="font-size:var(--text-micro);color:var(--text-muted);margin-bottom:4px">' + t('shift.time_remaining') + '</div>'
    + '<div id="shift-timer-display" style="font-size:32px;font-weight:700;font-family:var(--font-mono);font-feature-settings:\'tnum\' 1;letter-spacing:1px;background:linear-gradient(180deg,#FFFFFF,#A1A1AA);-webkit-background-clip:text;-webkit-text-fill-color:transparent"></div></div>'
    + '<button class="btn btn-danger" style="padding:10px 20px;cursor:pointer;font-weight:700" onclick="showEndShiftModal()">'
    + t('shift.end_shift') + '</button>'
    + '</div></div>'

    // Revenue inputs
    + '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:16px">' + t('shift.shift_revenue') + '</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">PPV ' + t('shift.sent') + '</label>'
    + '<input type="number" id="shift-ppv-count" class="form-input" value="' + (_activeShift.ppv_count || 0) + '" min="0" onchange="onShiftFieldChange()" style="font-size:16px;font-weight:700;text-align:center"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">PPV ' + t('shift.sold') + '</label>'
    + '<input type="number" id="shift-ppv-sold" class="form-input" value="' + (_activeShift.ppv_sold || 0) + '" min="0" onchange="onShiftFieldChange()" style="font-size:16px;font-weight:700;text-align:center"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('shift.ppv_revenue') + ' ($)</label>'
    + '<input type="number" id="shift-ppv-total" class="form-input" value="' + (parseFloat(_activeShift.ppv_total) || 0) + '" min="0" step="0.01" onchange="onShiftFieldChange()" style="font-size:16px;font-weight:700;text-align:center;color:var(--green)"></div>'
    + '<div><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('shift.tips_revenue') + ' ($)</label>'
    + '<input type="number" id="shift-tips-total" class="form-input" value="' + (parseFloat(_activeShift.tips_total) || 0) + '" min="0" step="0.01" onchange="onShiftFieldChange()" style="font-size:16px;font-weight:700;text-align:center;color:var(--yellow)"></div>'
    + '</div>'
    + '<div style="margin-top:12px"><label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px">' + t('common.notes') + '</label>'
    + '<textarea id="shift-notes-input" class="form-input" rows="2" onchange="onShiftFieldChange()" style="font-size:13px">' + (_activeShift.shift_notes || '') + '</textarea></div>'
    + '<div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">💾 ' + t('shift.auto_save') + '</div>'
    + '</div>';

  startShiftTimer();
  startShiftAutoSave();
}

function startShiftTimer() {
  clearInterval(_shiftTimerInterval);
  updateShiftTimerDisplay();
  _shiftTimerInterval = setInterval(updateShiftTimerDisplay, 1000);
}

function updateShiftTimerDisplay() {
  var el = document.getElementById('shift-timer-display');
  if (!el || !_activeShift) return;

  var now = Date.now();
  var end = new Date(_activeShift.planned_end_time).getTime();
  var diff = end - now;
  var isOvertime = diff < 0;
  var absDiff = Math.abs(diff);

  var hours = Math.floor(absDiff / 3600000);
  var mins = Math.floor((absDiff % 3600000) / 60000);
  var secs = Math.floor((absDiff % 60000) / 1000);

  var text, color;
  if (isOvertime) {
    text = '+' + (hours > 0 ? hours + 'h ' : '') + mins + 'min';
    color = 'var(--red)';
  } else if (diff < 300000) { // < 5 min
    text = mins + 'min ' + secs + 's';
    color = '#f59e0b';
  } else if (diff < 3600000) { // < 1h
    text = mins + 'min ' + secs + 's';
    color = 'var(--text)';
  } else {
    text = hours + 'h ' + String(mins).padStart(2, '0') + 'min';
    color = 'var(--text)';
  }

  el.textContent = text;
  el.style.color = color;
}

function onShiftFieldChange() {
  _shiftDirty = true;
}

function startShiftAutoSave() {
  clearInterval(_shiftAutoSaveInterval);
  _shiftAutoSaveInterval = setInterval(autoSaveShift, 10000);
}

async function autoSaveShift() {
  if (!_shiftDirty || !_activeShift) return;
  _shiftDirty = false;

  var data = {
    ppv_count: parseInt(document.getElementById('shift-ppv-count').value) || 0,
    ppv_sold: parseInt(document.getElementById('shift-ppv-sold').value) || 0,
    ppv_total: parseFloat(document.getElementById('shift-ppv-total').value) || 0,
    tips_total: parseFloat(document.getElementById('shift-tips-total').value) || 0,
    shift_notes: document.getElementById('shift-notes-input').value.trim()
  };

  await fetch('/api/chatter-shifts/' + _activeShift.id + '/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify(data)
  });
}

// ============ MODALS ============

function showStartShiftModal() {
  var modelCheckboxes = (allModels || []).map(function(m) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-elevated);border-radius:8px;cursor:pointer;font-size:13px"><input type="checkbox" class="shift-model-cb" value="' + m.id + '" style="width:18px;height:18px;cursor:pointer"> ' + m.name + '</label>';
  }).join('');

  var html = '<div class="modal-overlay show" id="shift-start-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">' + t('shift.start_shift') + '</div><button class="modal-close" onclick="document.getElementById(\'shift-start-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('shift.select_models') + '</label>'
    + '<div style="display:grid;gap:6px;max-height:200px;overflow-y:auto">' + (modelCheckboxes || '<div style="color:var(--text-tertiary)">' + t('student.no_model') + '</div>') + '</div></div>'
    + '<div class="form-group"><label class="form-label">' + t('shift.planned_duration') + '</label>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn shift-dur-btn" onclick="document.getElementById(\'shift-duration\').value=2;document.querySelectorAll(\'.shift-dur-btn\').forEach(function(b){b.style.background=\'var(--bg-elevated)\'});this.style.background=\'var(--accent)\'" style="background:var(--bg-elevated);color:var(--text);border:none;padding:8px 16px;border-radius:8px;cursor:pointer">2h</button>'
    + '<button class="btn shift-dur-btn" onclick="document.getElementById(\'shift-duration\').value=4;document.querySelectorAll(\'.shift-dur-btn\').forEach(function(b){b.style.background=\'var(--bg-elevated)\'});this.style.background=\'var(--accent)\'" style="background:var(--accent);color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer">4h</button>'
    + '<button class="btn shift-dur-btn" onclick="document.getElementById(\'shift-duration\').value=6;document.querySelectorAll(\'.shift-dur-btn\').forEach(function(b){b.style.background=\'var(--bg-elevated)\'});this.style.background=\'var(--accent)\'" style="background:var(--bg-elevated);color:var(--text);border:none;padding:8px 16px;border-radius:8px;cursor:pointer">6h</button>'
    + '<button class="btn shift-dur-btn" onclick="document.getElementById(\'shift-duration\').value=8;document.querySelectorAll(\'.shift-dur-btn\').forEach(function(b){b.style.background=\'var(--bg-elevated)\'});this.style.background=\'var(--accent)\'" style="background:var(--bg-elevated);color:var(--text);border:none;padding:8px 16px;border-radius:8px;cursor:pointer">8h</button>'
    + '<input type="number" id="shift-duration" class="form-input" value="4" min="1" max="12" step="0.5" style="width:70px;text-align:center">'
    + '</div></div>'
    + '</div><div class="modal-footer">'
    + '<button class="btn btn-secondary" onclick="document.getElementById(\'shift-start-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn btn-primary" onclick="startShift()">' + t('shift.start_shift') + '</button>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function startShift() {
  var modelIds = [];
  document.querySelectorAll('.shift-model-cb:checked').forEach(function(cb) { modelIds.push(parseInt(cb.value)); });
  var duration = parseFloat(document.getElementById('shift-duration').value) || 4;

  var res = await fetch('/api/chatter-shifts/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ model_ids: modelIds, planned_duration_hours: duration })
  });

  if (res.ok) {
    _activeShift = await res.json();
    document.getElementById('shift-start-modal').remove();
    showToast(t('shift.shift_started'), 'success');
    renderShiftWidget();
  } else {
    var err = await res.json();
    showToast(err.error || t('common.error'), 'error');
  }
}

function showEndShiftModal() {
  if (!_activeShift) return;
  // Force save before showing recap
  autoSaveShift();

  var ppvTotal = parseFloat(document.getElementById('shift-ppv-total').value) || 0;
  var tipsTotal = parseFloat(document.getElementById('shift-tips-total').value) || 0;
  var ppvCount = parseInt(document.getElementById('shift-ppv-count').value) || 0;
  var ppvSold = parseInt(document.getElementById('shift-ppv-sold').value) || 0;
  var totalRev = ppvTotal + tipsTotal;
  var elapsed = Date.now() - new Date(_activeShift.start_time).getTime();
  var elapsedMin = Math.round(elapsed / 60000);
  var elapsedH = Math.floor(elapsedMin / 60);
  var elapsedM = elapsedMin % 60;

  var html = '<div class="modal-overlay show" id="shift-end-modal" onclick="if(event.target===this)this.remove()">'
    + '<div class="modal" style="width:440px"><div class="modal-header"><div class="modal-title">' + t('shift.end_shift') + '</div><button class="modal-close" onclick="document.getElementById(\'shift-end-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div style="background:var(--bg-elevated);border-radius:10px;padding:16px;margin-bottom:16px">'
    + '<div style="font-size:13px;color:var(--text-tertiary);margin-bottom:8px">' + t('shift.recap') + '</div>'
    + '<div class="grid-2col" style="gap:10px">'
    + '<div><div style="font-size:20px;font-weight:800">' + elapsedH + 'h ' + elapsedM + 'min</div><div style="font-size:11px;color:var(--text-tertiary)">' + t('shift.duration') + '</div></div>'
    + '<div><div style="font-size:20px;font-weight:800;color:var(--green)">$' + totalRev.toFixed(2) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + t('shift.total_revenue') + '</div></div>'
    + '<div><div style="font-size:16px;font-weight:700">' + ppvCount + ' → ' + ppvSold + '</div><div style="font-size:11px;color:var(--text-tertiary)">PPV ' + t('shift.sent') + '/' + t('shift.sold') + '</div></div>'
    + '<div><div style="font-size:16px;font-weight:700">$' + ppvTotal.toFixed(2) + ' / $' + tipsTotal.toFixed(2) + '</div><div style="font-size:11px;color:var(--text-tertiary)">PPV / Tips</div></div>'
    + '</div></div>'
    + '<div class="form-group"><label class="form-label">' + t('shift.handover_notes') + '</label>'
    + '<textarea id="shift-handover" class="form-input" rows="3" placeholder="' + t('shift.handover_placeholder') + '"></textarea></div>'
    + '</div><div class="modal-footer">'
    + '<button class="btn btn-secondary" onclick="document.getElementById(\'shift-end-modal\').remove()">' + t('common.cancel') + '</button>'
    + '<button class="btn" style="background:var(--red);color:white;border:none;cursor:pointer;padding:8px 20px;border-radius:8px" onclick="endShift()">🔴 ' + t('shift.confirm_end') + '</button>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function endShift() {
  if (!_activeShift) return;
  var handover = document.getElementById('shift-handover').value.trim();

  var res = await fetch('/api/chatter-shifts/' + _activeShift.id + '/end', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ handover_notes: handover })
  });

  if (res.ok) {
    var data = await res.json();
    _activeShift = null;
    clearInterval(_shiftTimerInterval);
    clearInterval(_shiftAutoSaveInterval);
    document.getElementById('shift-end-modal').remove();
    showToast(t('shift.shift_ended') + ' (' + data.duration + 'min)', 'success');
    renderShiftWidget();
    // Reload shift data
    await loadShifts();
    renderShifts();
    await loadChatterKPIs();
  }
}

// ============ ADMIN: ACTIVE SHIFTS WIDGET ============

async function renderActiveShiftsWidget() {
  var el = document.getElementById('active-shifts-widget');
  if (!el) return;

  try {
    var res = await fetch('/api/chatter-shifts/active', { credentials: 'include' });
    if (!res.ok) return;
    var shifts = await res.json();

    if (shifts.length === 0) {
      el.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:16px">' + t('shift.no_active_shifts') + '</div>';
      return;
    }

    el.innerHTML = '<div style="display:grid;gap:8px">' + shifts.map(function(s) {
      var now = Date.now();
      var end = new Date(s.planned_end_time).getTime();
      var diff = end - now;
      var isOvertime = diff < 0;
      var almostDone = diff > 0 && diff < 1800000; // < 30 min
      var dotColor = isOvertime ? 'var(--red)' : almostDone ? '#f59e0b' : 'var(--green)';
      var revenue = (parseFloat(s.ppv_total) + parseFloat(s.tips_total)).toFixed(2);

      var absDiff = Math.abs(diff);
      var h = Math.floor(absDiff / 3600000);
      var m = Math.floor((absDiff % 3600000) / 60000);
      var timeStr = isOvertime ? '+' + (h > 0 ? h + 'h ' : '') + m + 'min' : (h > 0 ? h + 'h ' : '') + m + 'min';

      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-elevated);border-radius:10px;border-left:3px solid ' + dotColor + '">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;animation:' + (isOvertime ? '' : 'pulse 2s infinite') + '"></div>'
        + '<div style="flex:1;min-width:0"><strong style="font-size:13px">' + s.chatter_name + '</strong><div style="font-size:11px;color:var(--text-tertiary)">' + s.model_name + '</div></div>'
        + '<div style="text-align:right"><div style="font-size:14px;font-weight:700;color:' + dotColor + '">' + timeStr + '</div>'
        + '<div style="font-size:12px;color:var(--green)">$' + revenue + '</div></div>'
        + '</div>';
    }).join('') + '</div>';
  } catch(e) {}
}
