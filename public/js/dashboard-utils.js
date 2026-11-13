// ========================================
// FUZION PILOT — DASHBOARD UTILITIES
// Shared helper functions used across all modules
// ========================================

// ========== THÈME DES GRAPHIQUES (Chart.js) ==========
// Palette catégorielle validée (daltonisme + contraste sur fond sombre), toujours dans le même ordre
var CHART_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
var CHART_SURFACE = '#131316';
// Style « Reveal » : une couleur vive pour la série principale, un gris pour la série de comparaison
var CHART_ACCENT = '#1449E6', CHART_SECOND = '#5B5B63';
var CHART_TEXT = '#A1A1AA', CHART_MUTED = '#71717A';

var chartDarkTooltip = {
  backgroundColor: 'rgba(24,24,27,0.96)',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  titleColor: '#FAFAFA',
  bodyColor: '#D4D4D8',
  padding: 12,
  titleFont: { size: 12, weight: '600' },
  bodyFont: { size: 12 },
  cornerRadius: 10,
  caretSize: 0,
  displayColors: true,
  usePointStyle: true,
  boxWidth: 8, boxHeight: 8,
  boxPadding: 6
};
var chartDarkGrid = { color: 'rgba(255,255,255,0.05)' };
var chartDarkTicks = { color: CHART_MUTED, font: { size: 11 } };
var chartDarkLegend = { color: CHART_TEXT, font: { size: 12 }, boxWidth: 8, boxHeight: 8, padding: 16, usePointStyle: true, pointStyle: 'circle' };

function chartHexA(hex, a) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(function(c) { return c + c; }).join('');
  if (h.length !== 6) return hex;
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
}
// mélange une couleur hex avec du blanc (t > 0) ou du noir (t < 0)
function chartShade(hex, t) {
  var h = String(hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  var f = function(i) { var v = parseInt(h.slice(i, i + 2), 16); v = t > 0 ? v + (255 - v) * t : v * (1 + t); return Math.round(v).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(2) + f(4);
}
// dégradé vertical pour une barre : un peu plus clair en haut, plus profond en bas
function chartBarGradient(base) {
  var light = chartShade(base, 0.12), deep = chartShade(base, -0.82);
  return function(ctx) {
    var ch = ctx.chart, area = ch.chartArea;
    if (!area || ctx.type !== 'data') return base;
    // dégradé sur la barre elle-même (du haut de la barre vers sa base) : marche aussi pour les barres empilées
    var ys = ch.scales.y, v = ctx.parsed && ctx.parsed.y;
    if (!ys || v == null || !isFinite(v)) return base;
    var start = 0;
    if (ys.options && ys.options.stacked) {
      for (var k = 0; k < ctx.datasetIndex; k++) {
        if (!ch.isDatasetVisible(k)) continue;
        var pv = Number(ch.data.datasets[k].data[ctx.dataIndex]); if (isFinite(pv)) start += pv;
      }
    }
    var top = ys.getPixelForValue(start + v), bottom = ys.getPixelForValue(start);
    if (!(bottom - top > 1)) return base;
    var g = ch.ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, light);
    g.addColorStop(0.3, base);
    g.addColorStop(1, deep);
    return g;
  };
}

// 14000 -> « 14 k », 1500.5 -> « 1 501 »
function chartShortNumber(v) {
  var n = Number(v);
  if (!isFinite(n)) return v;
  if (Math.abs(n) >= 10000) return (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(n) < 10 && n % 1 ? 1 : 0 });
}

(function setupChartTheme() {
  if (typeof Chart === 'undefined') return;
  var d = Chart.defaults;
  d.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  d.font.size = 12;
  d.color = CHART_TEXT;
  d.borderColor = 'rgba(255,255,255,0.05)';
  d.animation.duration = 500;
  Object.assign(d.plugins.legend.labels, chartDarkLegend);
  d.plugins.legend.position = 'top';
  d.plugins.legend.align = 'end';
  Object.assign(d.plugins.tooltip, chartDarkTooltip);
  d.layout.padding = { top: 18, right: 8, bottom: 0, left: 0 };

  function isRound(type) { return type === 'doughnut' || type === 'pie' || type === 'polarArea'; }
  function dsColor(ds, i, n) {
    if (n <= 2) return [CHART_ACCENT, CHART_SECOND][i];
    return CHART_PALETTE[i % CHART_PALETTE.length];
  }

  function styleDatasets(chart) {
    var type = chart.config.type;
    var opts = chart.config.options || {};
    var stacked = opts.scales && opts.scales.y && opts.scales.y.stacked;
    var sets = (chart.config.data && chart.config.data.datasets) || [];
    sets.forEach(function(ds, i) {
      // barres : couleur en dégradé (aussi pour les couleurs imposées par un module)
      var applyGradient = function() {
        if ((ds.type || type) !== 'bar' || ds._grad || typeof ds.backgroundColor !== 'string' || ds.backgroundColor.charAt(0) !== '#') return;
        ds._grad = true;
        var base = ds.backgroundColor;
        ds.backgroundColor = chartBarGradient(base);
        ds.hoverBackgroundColor = chartShade(base, 0.25);
      };
      if (ds._themed || ds.keepColor) { applyGradient(); return; }
      ds._themed = true;
      var t = ds.type || type;
      var c = dsColor(ds, i, sets.length);
      if (isRound(t)) {
        var n = (chart.config.data.labels || []).length || (ds.data || []).length;
        ds.backgroundColor = n === 2 ? [CHART_ACCENT, CHART_SECOND] : CHART_PALETTE.slice(0, Math.max(n, 1)).concat(CHART_PALETTE).slice(0, n);
        ds.borderColor = CHART_SURFACE;
        ds.borderWidth = 3;
        ds.hoverOffset = 4;
        ds.borderRadius = 4;
      } else if (t === 'line') {
        ds.borderColor = c;
        ds.borderWidth = 2;
        ds.tension = 0.35;
        ds.pointRadius = (ds.data || []).length <= 1 ? 3 : 0;
        ds.pointHoverRadius = 5;
        ds.pointBackgroundColor = c;
        ds.pointBorderColor = CHART_SURFACE;
        ds.pointHoverBorderColor = CHART_SURFACE;
        ds.pointHoverBorderWidth = 2;
        if (ds.fill) {
          ds.fill = sets.length > 1 ? 'origin' : true;
          ds.backgroundColor = function(ctx) {
            var area = ctx.chart.chartArea;
            if (!area) return chartHexA(c, 0.12);
            var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, chartHexA(c, sets.length > 1 ? 0.10 : 0.16));
            g.addColorStop(1, chartHexA(c, 0));
            return g;
          };
        } else {
          ds.backgroundColor = c;
        }
      } else if (t === 'bar') {
        // couleurs par barre voulues par le module (ex. rouge / vert) : on les garde
        if (!Array.isArray(ds.backgroundColor)) ds.backgroundColor = c;
        ds.hoverBackgroundColor = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : chartHexA(c, 0.85);
        ds.borderWidth = 0;
        // barres fines façon « aiguilles »
        var nPts = (chart.config.data.labels || ds.data || []).length;
        ds.maxBarThickness = nPts <= 8 ? (stacked ? 26 : 16) : (stacked ? 10 : 7);
        ds.categoryPercentage = 0.8;
        ds.barPercentage = 0.9;
        // empilé : seul le segment du haut est arrondi, avec un fin espace entre segments
        if (stacked) {
          ds.borderRadius = i === sets.length - 1 ? { topLeft: 5, topRight: 5 } : 0;
          ds.borderSkipped = false;
          ds.borderColor = CHART_SURFACE;
          ds.borderWidth = i === 0 ? 0 : { top: 2, right: 0, bottom: 0, left: 0 };
        } else {
          ds.borderRadius = 4;
          ds.borderSkipped = false;
        }
        applyGradient();
      }
    });
  }

  function styleScales(chart) {
    var opts = chart.config.options = chart.config.options || {};
    if (isRound(chart.config.type)) {
      if (chart.config.type === 'doughnut') opts.cutout = '76%';
      opts.plugins = opts.plugins || {};
      opts.plugins.legend = opts.plugins.legend || {};
      if (!opts.plugins.legend.position) opts.plugins.legend.position = 'bottom';
      opts.plugins.legend.align = 'center';
      return;
    }
    opts.interaction = opts.interaction || { mode: 'index', intersect: false };
    opts.scales = opts.scales || {};
    var horizontal = opts.indexAxis === 'y';
    Object.keys(opts.scales).concat(opts.scales.x ? [] : ['x']).concat(opts.scales.y ? [] : ['y']).forEach(function(k) {
      var sc = opts.scales[k] = opts.scales[k] || {};
      if (sc.display === false) return;
      var isValue = horizontal ? k.charAt(0) === 'x' : k.charAt(0) === 'y';
      sc.border = Object.assign({}, sc.border, { display: false });
      sc.grid = Object.assign({}, sc.grid, isValue ? { color: 'rgba(255,255,255,0.05)', drawTicks: false } : { display: false });
      var tk = sc.ticks = Object.assign({}, sc.ticks);
      tk.color = CHART_MUTED;
      tk.font = Object.assign({ size: 11 }, tk.font);
      tk.padding = 8;
      if (isValue) {
        if (sc.min === undefined) sc.beginAtZero = true;
        // pas de titre d'axe vertical : le titre du graphique suffit
        if (sc.title) sc.title = Object.assign({}, sc.title, { display: false });
        tk.maxTicksLimit = tk.maxTicksLimit || 5;
        var orig = tk.callback;
        tk.callback = function(v, i, all) {
          var out = orig ? orig.call(this, v, i, all) : v;
          if (typeof out === 'number') return chartShortNumber(out);
          // « $14000 » / « €14000 » -> « 14 k € »
          var m = String(out).match(/^([^\d-]*)(-?\d+(?:\.\d+)?)([^\d]*)$/);
          if (!m) return out;
          var unit = (m[1] + m[3]).trim();
          return chartShortNumber(m[2]) + (unit ? ' ' + unit : '');
        };
      } else {
        tk.maxRotation = 0;
        tk.autoSkip = true;
        tk.maxTicksLimit = tk.maxTicksLimit || 8;
      }
    });
  }

  function isEmpty(chart) {
    var sets = (chart.data && chart.data.datasets) || [];
    return !sets.some(function(ds) {
      return (ds.data || []).some(function(v) { var n = v && typeof v === 'object' ? (v.y != null ? v.y : v.r) : v; return Number(n) > 0 || Number(n) < 0; });
    });
  }

  // valeur la plus haute affichée au-dessus (ex. « 327 € »), comme sur Reveal
  function drawPeak(chart) {
    var opts = chart.options || {};
    if (chart.config.options && chart.config.options.noPeak) return;
    if (isRound(chart.config.type) || opts.indexAxis === 'y') return;
    var y = chart.scales.y; if (!y || (y.options && y.options.stacked)) return;
    var idx = Math.max(0, chart.data.datasets.findIndex(function(x) { return x.peak; }));
    var meta = chart.getDatasetMeta(idx), ds = chart.data.datasets[idx];
    if (!meta || meta.hidden || !ds || !meta.data.length) return;
    var best = -1, bestV = -Infinity;
    (ds.data || []).forEach(function(v, i) { var n = Number(v && typeof v === 'object' ? v.y : v); if (isFinite(n) && n > bestV) { bestV = n; best = i; } });
    if (best < 0 || bestV <= 0) return;
    var el = meta.data[best]; if (!el) return;
    var cb = y.options.ticks && y.options.ticks.callback;
    var label = cb ? cb.call(y, bestV, 0, []) : chartShortNumber(bestV);
    var c = chart.ctx;
    c.save();
    c.font = '700 12px ' + Chart.defaults.font.family;
    c.fillStyle = '#FAFAFA';
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    var x = Math.min(Math.max(el.x, chart.chartArea.left + 20), chart.chartArea.right - 20);
    c.fillText(String(label), x, Math.max(el.y - 6, chart.chartArea.top + 12));
    c.restore();
  }

  Chart.register({
    id: 'fuzionTheme',
    afterDatasetsDraw: function(chart) { try { if (!isEmpty(chart)) drawPeak(chart); } catch (e) {} },
    beforeInit: function(chart) { styleScales(chart); styleDatasets(chart); },
    beforeUpdate: function(chart) { styleDatasets(chart); },
    // graphique sans aucune donnée : message au lieu d'un cadre vide
    afterDraw: function(chart) {
      if (!isEmpty(chart)) return;
      var c = chart.ctx, a = chart.chartArea || { left: 0, right: chart.width, top: 0, bottom: chart.height };
      c.save();
      c.fillStyle = CHART_SURFACE;
      if (isRound(chart.config.type)) c.fillRect(0, 0, chart.width, chart.height);
      c.fillStyle = CHART_MUTED;
      c.font = '500 13px ' + Chart.defaults.font.family;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('Pas encore de données sur cette période', (a.left + a.right) / 2, (a.top + a.bottom) / 2);
      c.restore();
    }
  });
})();

// ========== GRAPHIQUE « MOIS EN COURS vs MOIS DERNIER » (comme sur Reveal) ==========
// rows : [{ d: 'YYYY-MM-DD', v: nombre }] couvrant au moins le mois dernier et le mois en cours
// today : 'YYYY-MM-DD'. Renvoie { chart, title, subtitle }.
function monthCompareChart(canvas, rows, today, opts) {
  opts = opts || {};
  if (!canvas || typeof Chart === 'undefined') return null;
  var old = Chart.getChart(canvas); if (old) old.destroy();
  var cur = today.slice(0, 7);
  var pd = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7) - 2, 1));
  var prev = pd.toISOString().slice(0, 7);
  var len = function(m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); };
  var n = Math.max(len(cur), len(prev));
  var map = {};
  (rows || []).forEach(function(r) { map[String(r.d).slice(0, 10)] = (map[String(r.d).slice(0, 10)] || 0) + (Number(r.v) || 0); });
  var pad = function(i) { return (i < 10 ? '0' : '') + i; };
  var curData = [], prevData = [];
  var todayDay = +today.slice(8, 10);
  for (var i = 1; i <= n; i++) {
    // jours à venir du mois en cours : vides (les barres restent à gauche)
    curData.push(i <= len(cur) && i <= todayDay ? (map[cur + '-' + pad(i)] || 0) : null);
    prevData.push(i <= len(prev) ? (map[prev + '-' + pad(i)] || 0) : null);
  }
  var monthName = function(m) { return new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long' }); };
  var cap = function(x) { return x.charAt(0).toUpperCase() + x.slice(1); };
  var unit = opts.unit || '€';
  var fmt = function(v) { return (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }) + ' ' + unit; };
  var chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({ length: n }, function(_, i) { return pad(i + 1); }),
      datasets: [
        { label: cap(monthName(prev)), data: prevData, keepColor: true, backgroundColor: CHART_SECOND, hoverBackgroundColor: CHART_SECOND, borderRadius: 4, borderSkipped: false, maxBarThickness: 6, categoryPercentage: 0.8, barPercentage: 0.9 },
        { label: cap(monthName(cur)), data: curData, peak: true, keepColor: true, backgroundColor: CHART_ACCENT, hoverBackgroundColor: CHART_ACCENT, borderRadius: 4, borderSkipped: false, maxBarThickness: 6, categoryPercentage: 0.8, barPercentage: 0.9 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: {
          title: function(items) { return 'Le ' + (items[0].dataIndex + 1); },
          label: function(c) { return ' ' + c.dataset.label + ' : ' + fmt(c.parsed.y); }
        } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 11 } },
        y: { ticks: { callback: function(v) { return chartShortNumber(v) + ' ' + unit; } } }
      }
    }
  });
  return { chart: chart, subtitle: monthName(prev) + ' vs ' + monthName(cur) + (opts.what ? ' · ' + opts.what : '') };
}

// ========== SÉLECTEUR DE PÉRIODE COMMUN ==========
var PERIODS = [['today', "Aujourd'hui"], ['yesterday', 'Hier'], ['7d', '7 derniers jours'], ['30d', '30 derniers jours'],
  ['60d', '60 derniers jours'], ['90d', '90 derniers jours'], ['month', 'Ce mois-ci'], ['lastmonth', 'Mois dernier'], ['365d', '12 derniers mois'], ['custom', 'Personnalisé…']];
function parisDay(offset) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + (offset || 0) * 86400000)); }
// { from, to, days } en dates de Paris
function periodRange(p, from, to) {
  var today = parisDay(0), r;
  var n = { '7d': 7, '30d': 30, '60d': 60, '90d': 90, '365d': 365 }[p];
  if (n) r = { from: parisDay(-(n - 1)), to: today };
  else if (p === 'today') r = { from: today, to: today };
  else if (p === 'yesterday') r = { from: parisDay(-1), to: parisDay(-1) };
  else if (p === 'month') r = { from: today.slice(0, 8) + '01', to: today };
  else if (p === 'lastmonth') {
    var d = new Date(today.slice(0, 8) + '01T12:00:00Z'); d.setUTCDate(0);
    var last = d.toISOString().slice(0, 10);
    r = { from: last.slice(0, 8) + '01', to: last };
  } else if (p === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) r = from <= to ? { from: from, to: to } : { from: to, to: from };
  else r = { from: parisDay(-29), to: today };
  r.days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  return r;
}
// sélecteur + deux dates (affichées pour « Personnalisé »). onchange(value, from, to)
function periodPickerHtml(id, value, from, to, onchange) {
  window['_pp_' + id] = onchange;
  var r = periodRange(value, from, to);
  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap" id="' + id + '">'
    + '<select class="form-input" style="max-width:200px" onchange="periodPickerChange(\'' + id + '\')">'
    + PERIODS.map(function(p) { return '<option value="' + p[0] + '"' + (value === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select>'
    + '<span class="pp-custom" style="display:' + (value === 'custom' ? 'inline-flex' : 'none') + ';gap:6px;align-items:center">'
    + '<input type="date" class="form-input" style="max-width:150px" value="' + r.from + '" max="' + parisDay(0) + '" onchange="periodPickerChange(\'' + id + '\')">'
    + '<span style="color:var(--text-tertiary);font-size:12px">au</span>'
    + '<input type="date" class="form-input" style="max-width:150px" value="' + r.to + '" max="' + parisDay(0) + '" onchange="periodPickerChange(\'' + id + '\')"></span></div>';
}
function periodPickerChange(id) {
  var el = document.getElementById(id); if (!el) return;
  var v = el.querySelector('select').value, ds = el.querySelectorAll('input[type=date]');
  el.querySelector('.pp-custom').style.display = v === 'custom' ? 'inline-flex' : 'none';
  if (v === 'custom' && (!ds[0].value || !ds[1].value)) return;
  var cb = window['_pp_' + id]; if (cb) cb(v, ds[0].value, ds[1].value);
}

// ========== UNE COULEUR PAR MODÈLE (foncée et électrique, fixe partout) ==========
// Ordre validé : deux couleurs voisines restent distinctes, y compris pour les daltoniens
var MODEL_COLORS = ['#1449E6', '#EA580C', '#0D9488', '#7C3AED', '#D97706', '#D61F8C', '#0284C7', '#DC2626'];
// La couleur suit la modèle (ordre de création dans le CRM), jamais son classement
function modelColor(crmId, name) {
  var list = (typeof allModels !== 'undefined' ? allModels : []).slice().sort(function(a, b) { return a.id - b.id; });
  var i = list.findIndex(function(m) { return (crmId != null && m.id === Number(crmId)) || (name && m.name === name); });
  // couleur choisie dans Modèles
  if (i >= 0 && list[i].chart_color) return list[i].chart_color;
  // sinon : couleurs de la palette pas encore prises par une autre modèle, dans l'ordre
  var used = list.map(function(m) { return String(m.chart_color || '').toLowerCase(); });
  var free = MODEL_COLORS.filter(function(c) { return used.indexOf(c.toLowerCase()) < 0; });
  if (!free.length) free = MODEL_COLORS;
  var autoList = list.filter(function(m) { return !m.chart_color; });
  var j = i >= 0 ? autoList.indexOf(list[i]) : -1;
  if (j < 0) { // modèle hors CRM : couleur dérivée du nom
    var h = 0; String(name || crmId || '').split('').forEach(function(c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    j = autoList.length + (h % free.length);
  }
  return free[j % free.length];
}

// Graphique : une barre par modèle et par jour, sur tout le mois en cours (jours à venir vides)
// rows : [{ d: 'YYYY-MM-DD', key, name, crmId, v }]
function modelDailyChart(canvas, rows, today, opts) {
  opts = opts || {};
  if (!canvas || typeof Chart === 'undefined') return null;
  var old = Chart.getChart(canvas); if (old) old.destroy();
  var cur = today.slice(0, 7);
  var n = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 0)).getUTCDate();
  var todayDay = +today.slice(8, 10);
  var pad = function(i) { return (i < 10 ? '0' : '') + i; };
  var models = {};
  (rows || []).forEach(function(r) {
    if (String(r.d).slice(0, 7) !== cur) return;
    var m = models[r.key] = models[r.key] || { name: r.name, crmId: r.crmId, days: {}, total: 0 };
    m.days[+String(r.d).slice(8, 10)] = (m.days[+String(r.d).slice(8, 10)] || 0) + (Number(r.v) || 0);
    m.total += Number(r.v) || 0;
  });
  var list = Object.keys(models).map(function(k) { return models[k]; }).filter(function(m) { return m.total > 0; })
    .sort(function(a, b) { return (a.crmId || 9e9) - (b.crmId || 9e9) || String(a.name).localeCompare(b.name); });
  var unit = opts.unit || '€';
  var fmt = function(v) { return (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }) + ' ' + unit; };
  var chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({ length: n }, function(_, i) { return pad(i + 1); }),
      datasets: list.map(function(m) {
        var c = modelColor(m.crmId, m.name);
        return { label: m.name, keepColor: true, backgroundColor: c, hoverBackgroundColor: c, borderRadius: 3, borderSkipped: false,
          maxBarThickness: 6, categoryPercentage: 0.82, barPercentage: 0.92,
          data: Array.from({ length: n }, function(_, i) { return i + 1 <= todayDay ? (m.days[i + 1] || 0) : null; }) };
      })
    },
    options: {
      noPeak: true,
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: {
        filter: function(it) { return it.parsed.y > 0; },
        itemSort: function(a, b) { return b.parsed.y - a.parsed.y; },
        callbacks: {
          title: function(items) { return items.length ? 'Le ' + (items[0].dataIndex + 1) : ''; },
          label: function(c) { return ' ' + c.dataset.label + ' : ' + fmt(c.parsed.y); },
          footer: function(items) { var t = items.reduce(function(s, x) { return s + (x.parsed.y || 0); }, 0); return items.length > 1 ? 'Total : ' + fmt(t) : ''; }
        } } },
      scales: { x: { ticks: { maxTicksLimit: 11 } }, y: { ticks: { callback: function(v) { return chartShortNumber(v) + ' ' + unit; } } } }
    }
  });
  var monthName = new Date(cur + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { chart: chart, subtitle: monthName + ' · ' + (opts.what || 'par modèle') };
}

// Debounce
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Empty state SVGs
const emptyStateSVG = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
};

function emptyStateHTML(iconKey, title, ctaText, ctaAction) {
  return '<div class="empty-state">'
    + '<div class="empty-state-icon">' + (emptyStateSVG[iconKey] || emptyStateSVG.search) + '</div>'
    + '<div class="empty-state-title">' + title + '</div>'
    + (ctaText ? '<button class="btn btn-primary" onclick="' + ctaAction + '">' + ctaText + '</button>' : '')
    + '</div>';
}

// Confirm delete modal
let _confirmDeleteResolve = null;
function confirmDelete(message) {
  return new Promise(function(resolve) {
    _confirmDeleteResolve = resolve;
    document.getElementById('confirm-delete-message').textContent = message || t('common.confirm_delete');
    document.getElementById('modal-confirm-delete').classList.add('show');
  });
}
function confirmDeleteYes() {
  document.getElementById('modal-confirm-delete').classList.remove('show');
  if (_confirmDeleteResolve) _confirmDeleteResolve(true);
  _confirmDeleteResolve = null;
}
function confirmDeleteNo() {
  document.getElementById('modal-confirm-delete').classList.remove('show');
  if (_confirmDeleteResolve) _confirmDeleteResolve(false);
  _confirmDeleteResolve = null;
}

// Pagination
function paginationHTML(page, totalPages, onPageFn) {
  if (totalPages <= 1) return '';
  return '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 0">'
    + '<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="' + onPageFn + '(' + (page - 1) + ')" ' + (page <= 1 ? 'disabled style="opacity:0.4;pointer-events:none;font-size:12px;padding:6px 14px"' : '') + '>← Précédent</button>'
    + '<span style="font-size:13px;color:var(--text-secondary)">Page ' + page + ' sur ' + totalPages + '</span>'
    + '<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="' + onPageFn + '(' + (page + 1) + ')" ' + (page >= totalPages ? 'disabled style="opacity:0.4;pointer-events:none;font-size:12px;padding:6px 14px"' : '') + '>Suivant →</button>'
    + '</div>';
}

// Toast notifications
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const colors = {
    error: { bg: 'var(--bg-elevated)', border: 'rgba(239,68,68,0.3)', accent: 'var(--accent-red)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' },
    success: { bg: 'var(--bg-elevated)', border: 'rgba(34,197,94,0.3)', accent: 'var(--accent-green)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
    info: { bg: 'var(--bg-elevated)', border: 'rgba(59,130,246,0.3)', accent: 'var(--accent-blue)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' },
    warning: { bg: 'var(--bg-elevated)', border: 'rgba(245,158,11,0.3)', accent: 'var(--accent-yellow)', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  toast.style.cssText = 'background:' + c.bg + ';color:var(--text-primary);padding:12px 16px;border-radius:var(--radius-lg);font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:var(--shadow-xl);animation:ds-fade-in-up 0.3s var(--ease-out);max-width:380px;border:1px solid ' + c.border + ';backdrop-filter:blur(16px)';
  toast.innerHTML = '<span style="color:' + c.accent + ';display:flex;flex-shrink:0">' + c.icon + '</span><span style="flex:1">' + message + '</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  container.appendChild(toast);
  // Auto-dismiss progress
  var progress = document.createElement('div');
  progress.style.cssText = 'position:absolute;bottom:0;left:0;height:2px;background:' + c.accent + ';border-radius:0 0 var(--radius-lg) var(--radius-lg);width:100%;transform-origin:left;animation:ds-toast-progress 4s linear forwards;opacity:0.5';
  toast.style.position = 'relative';
  toast.style.overflow = 'hidden';
  toast.appendChild(progress);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    toast.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Prompt modal
function showPromptModal(title, placeholder) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;animation:ds-fade-in 0.2s ease';
    overlay.innerHTML = '<div style="background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-2xl);padding:28px;width:400px;max-width:90vw;box-shadow:var(--shadow-xl)">'
      + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">' + title + '</h3>'
      + '<input type="text" id="prompt-modal-input" class="form-input" placeholder="' + (placeholder || '') + '" style="margin-bottom:16px" autofocus>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end">'
      + '<button id="prompt-modal-cancel" class="btn" style="background:var(--bg-elevated);color:var(--text-secondary);border:none;cursor:pointer">Annuler</button>'
      + '<button id="prompt-modal-ok" class="btn btn-primary">Ajouter</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    var input = document.getElementById('prompt-modal-input');
    input.focus();
    function close(val) { overlay.remove(); resolve(val); }
    document.getElementById('prompt-modal-cancel').onclick = function() { close(null); };
    document.getElementById('prompt-modal-ok').onclick = function() { close(input.value.trim() || null); };
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') close(input.value.trim() || null); if (e.key === 'Escape') close(null); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
  });
}

// Time since helper
function timeSince(dateStr) {
  var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return t('common.just_now');
  if (diff < 60) return diff + ' min';
  var hours = Math.floor(diff / 60);
  return hours + 'h' + (diff % 60 > 0 ? (diff % 60) + 'min' : '');
}

// Online check
function isUserOnline(userId) {
  return (window.onlineUsers || []).some(u => u.user_id === userId);
}

// Auto-fill username from Instagram URL
function autoFillUsername(url) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (match) {
    document.getElementById('lead-username').value = '@' + match[1];
  }
}

function extractUsernameFromUrl(url) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  return match ? '@' + match[1] : url;
}

// Account avatar helper
function accountAvatarHTML(accountId, handle, platform, size) {
  size = size || 36;
  var platColors = { instagram: '#E4405F', tiktok: '#00f2ea', onlyfans: '#0080FF', fansly: '#E040FB', fanvue: '#10B981', mym: '#F97316', reveal: '#E11D48' };
  var platIcons = { instagram: '📸', tiktok: '🎵', onlyfans: '💎', fansly: '🌸', fanvue: '💚', mym: '🔥', reveal: '👀' };
  var color = platColors[platform] || '#3B82F6';
  var initial = (handle || '?').replace(/^@/, '').charAt(0).toUpperCase();
  var avatarUrl = (platform === 'instagram' || platform === 'tiktok') ? 'https://unavatar.io/' + platform + '/' + (handle||'').replace(/^@/,'') : '/api/accounts/' + accountId + '/avatar';
  return '<div style="display:flex;align-items:center;gap:8px">'
    + '<img src="' + avatarUrl + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;border:2px solid ' + color + '30;background:' + color + '20" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
    + '<div style="display:none;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';align-items:center;justify-content:center;font-size:' + Math.round(size*0.4) + 'px;font-weight:700;color:white;flex-shrink:0">' + initial + '</div>'
    + '<div style="min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (handle || '') + '</div>'
    + '<div style="font-size:10px;color:var(--text-tertiary)">' + (platIcons[platform] || '') + ' ' + (platform || '') + '</div></div></div>';
}
