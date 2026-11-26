// DASHBOARD — CA TTC de toutes les plateformes (Reveal + Telegram + MyM)
// Réutilise rvEsc, rvEur, rvNum, rvStat (reveal.js) et modelDailyChart (dashboard-utils.js).

var PLAT = {
  reveal: { label: 'Reveal', color: '#1449E6', section: 'reveal' },
  onlyfans: { label: 'OnlyFans', color: '#0EA5E9', section: 'onlyfans' },
  telegram: { label: 'Telegram', color: '#0D9488', section: 'telegram' },
  mym: { label: 'MyM', color: '#EA580C', section: 'mym' },
};

function platGo(section) {
  var n = document.querySelector('.nav-item[data-section="' + section + '"]');
  if (n) n.click();
}

function platDashWidget() {
  var box = document.getElementById('dashboard-platforms');
  if (!box) return;
  fetch('/api/platforms/summary', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }).then(function(o) {
    if (!o) { box.innerHTML = ''; return; }
    var keys = Object.keys(PLAT).filter(function(k) { return o.platforms[k] && (o.platforms[k].connected || o.platforms[k].month > 0); });
    if (!keys.length) { box.innerHTML = ''; return; }
    var p = o.platforms, t = o.total;
    var split = function(field) {
      return keys.map(function(k) { return '<span style="white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + PLAT[k].color + ';margin-right:4px"></span>' + PLAT[k].label + ' ' + (k === 'mym' ? '≈ ' : '') + rvEur(p[k][field]) + '</span>'; }).join(' · ');
    };
    var subsSub = ['reveal', 'onlyfans', 'mym'].filter(function(k) { return p[k] && p[k].connected; }).map(function(k) { return PLAT[k].label + ' ' + rvNum(p[k].subs_month); }).join(' · ')
      + (p.telegram && p.telegram.connected ? ' · ' + rvNum(p.telegram.contacts_month) + ' nouveaux contacts Telegram' : '');
    var cell = function(v, k) { return '<td style="white-space:nowrap">' + (v ? (k === 'mym' ? '≈ ' : '') + rvEur(v) : '<span style="color:var(--text-tertiary)">–</span>') + '</td>'; };
    box.innerHTML = '<div style="margin-bottom:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">'
      + '<div style="font-weight:700;font-size:15px">Toutes les plateformes <span style="font-weight:400;font-size:12px;color:var(--text-tertiary)">CA TTC</span></div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + keys.map(function(k) { return '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="platGo(\'' + PLAT[k].section + '\')">' + PLAT[k].label + ' →</button>'; }).join('') + '</div></div>'
      + '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'
      + rvStat('CA TTC aujourd\'hui', rvEur(t.today), split('today'))
      + rvStat('CA TTC hier', rvEur(t.yesterday), 'Journée entière · ' + split('yesterday'))
      + rvStat('CA TTC ce mois', rvEur(t.month), split('month'), 'var(--accent-green)')
      + rvStat('Nouveaux abonnés ce mois', rvNum(t.subs_month), subsSub || null)
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin-top:14px;align-items:start" class="plat-grid">'
      + '<div class="panel" style="padding:16px"><div style="font-weight:600">Revenu journalier</div><div id="plat-daily-sub" style="font-size:12px;color:var(--text-tertiary);margin:2px 0 8px"></div><div style="position:relative;height:220px"><canvas id="plat-daily-chart"></canvas></div></div>'
      + '<div class="panel" style="padding:0;overflow:auto"><div style="font-weight:600;padding:16px 16px 6px">Modèles ce mois</div><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th>'
      + keys.map(function(k) { return '<th>' + PLAT[k].label + '</th>'; }).join('') + '<th>Total TTC</th></tr></thead><tbody>'
      + (o.models.length ? o.models.slice(0, 8).map(function(m) {
        return '<tr><td style="text-align:left"><div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + modelColor(m.model_id, m.name) + '"></span>' + rvEsc(m.name) + '</div></td>'
          + keys.map(function(k) { return cell(m[k], k); }).join('') + '<td style="font-weight:700;white-space:nowrap">' + rvEur(m.total) + '</td></tr>';
      }).join('') : '<tr><td colspan="' + (keys.length + 2) + '" style="text-align:center;color:var(--text-tertiary);padding:16px">Rien ce mois-ci pour l\'instant</td></tr>')
      + '</tbody></table></div></div>'
      + (keys.indexOf('mym') >= 0 ? '<div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">≈ ' + rvEsc(o.mym_note) + '</div>' : '')
      + '</div>';
    var mc = modelDailyChart(document.getElementById('plat-daily-chart'), o.daily.map(function(r) {
      return { d: r.d, key: r.platform, name: PLAT[r.platform].label, crmId: keys.indexOf(r.platform) + 1, color: PLAT[r.platform].color, v: Number(r.v) / 100 };
    }), o.today, { what: 'CA TTC par plateforme' });
    var sub = document.getElementById('plat-daily-sub');
    if (mc && sub) sub.textContent = mc.subtitle;
  }).catch(function() { box.innerHTML = ''; });
}
