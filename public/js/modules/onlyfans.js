// ONLYFANS MODULE — stats relevées par le bot sur la page Statistiques > Revenus de chaque modèle
// Réutilise les petites fonctions de reveal.js (rvEsc, rvEur, rvNum, rvStat, rvAgo, rvParis, rvToast).

var ofs = { tab: 'overview', period: '30d', model: '', data: null };
var OF_TYPES = { subscribes: 'Abonnements', tips: 'Pourboires', chat_messages: 'Messages', post: 'Posts', stream: 'Lives', call: 'Appels', ref: 'Parrainage' };
var OF_STATUS = { ok: ['var(--accent-green)', 'Connecté'], unchecked: ['var(--accent-yellow)', 'Premier relevé en attente…'], expired: ['var(--accent-red)', 'Déconnecté'] };

function ofApi(method, url, body) {
  return fetch('/api/onlyfans' + url, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); });
}
// montants OnlyFans : dans la devise du compte (dollars), avec l'équivalent en euros
function ofMoney(c, cur) { return ((Number(c) || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: cur || ofs.currency || 'USD', maximumFractionDigits: Math.abs(Number(c) || 0) < 10000 ? 2 : 0 }); }
function ofEur(c) { return ofs.rate && (ofs.currency || 'USD') !== 'EUR' ? '≈ ' + rvEur(Math.round((Number(c) || 0) * ofs.rate)) : ''; }
function ofQs() { var r = periodRange(ofs.period, ofs.from, ofs.to); return '?from=' + r.from + '&to=' + r.to + (ofs.model ? '&model=' + ofs.model : ''); }
function ofLinked() { return ((ofs.data && ofs.data.accounts) || []).filter(function(a) { return a.has_session || a.last_sync_at; }); }
function ofName(id) { var m = ((ofs.data && ofs.data.models) || []).find(function(x) { return x.id === Number(id); }); return m ? m.name : ''; }
function ofDot(id) { return '<span style="width:8px;height:8px;border-radius:50%;background:' + modelColor(Number(id), ofName(id)) + ';flex-shrink:0"></span>'; }
// soldes : on affiche ce que la page Revenus reçoit, quel que soit le nom exact des champs
function ofBalance(b) {
  if (!b || typeof b !== 'object') return null;
  var cur = b.currentBalance != null ? b.currentBalance : b.current_balance != null ? b.current_balance : b.balance;
  var pend = b.pendingBalance != null ? b.pendingBalance : b.pending_balance != null ? b.pending_balance : b.pending;
  return { current: cur != null ? Math.round(Number(cur) * 100) : null, pending: pend != null ? Math.round(Number(pend) * 100) : null };
}

function renderOnlyfans() {
  var c = document.getElementById('onlyfans-content');
  if (!c) return;
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="of-status"></div><div id="of-models" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"></div>'
      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap" id="of-tabs">' + [['overview', 'Vue d\'ensemble'], ['settings', 'Connexion']].filter(function(t) { return !(isPartner() && t[0] === 'settings'); }).map(function(t) {
        return '<button class="filter-chip' + (ofs.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '" onclick="ofTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>'
      + '<div id="of-period">' + periodPickerHtml('of-pp', ofs.period, ofs.from, ofs.to, function(v, f, t) { ofs.period = v; ofs.from = f; ofs.to = t; ofBody(); }) + '</div>'
      + '</div><div id="of-body"><div class="skeleton-card" style="height:180px"></div></div>';
  }
  ofLoad().then(function() { if (!ofLinked().length && !isPartner()) ofs.tab = 'settings'; ofTab(ofs.tab); });
}
function ofLoad() {
  return ofApi('GET', '/accounts').then(function(d) {
    ofs.data = d;
    var linked = ofLinked(), el = document.getElementById('of-status');
    var bad = linked.filter(function(a) { return a.status === 'expired'; });
    if (el) el.innerHTML = linked.length ? '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-secondary)">'
      + linked.map(function(a) { var s = OF_STATUS[a.status] || OF_STATUS.unchecked; return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + s[0] + '"></span>' + rvEsc(ofName(a.model_id)) + ' : ' + (a.status === 'ok' ? 'relevé ' + rvAgo(a.last_sync_at) : s[1]) + '</span>'; }).join('')
      + '</div>' + (bad.length && !isPartner() ? '<div style="margin-top:10px;padding:10px 14px;border-radius:10px;background:var(--accent-red-bg);color:var(--accent-red);font-size:13px">🔑 ' + bad.map(function(a) { return rvEsc(ofName(a.model_id)); }).join(', ') + ' : session OnlyFans expirée → onglet Connexion</div>' : '') : '';
    var mc = document.getElementById('of-models');
    if (mc) {
      var chip = function(id, label) { return '<button class="filter-chip' + (String(ofs.model) === String(id) ? ' active' : '') + '" style="display:inline-flex;align-items:center;gap:6px" onclick="ofSetModel(\'' + id + '\')">' + rvEsc(label) + (id ? ofDot(id) : '') + '</button>'; };
      mc.innerHTML = linked.length > 1 ? chip('', 'Toutes les modèles') + linked.map(function(a) { return chip(a.model_id, ofName(a.model_id)); }).join('') : '';
    }
  });
}
function ofSetModel(id) { ofs.model = id || ''; ofLoad(); if (ofs.tab === 'settings') ofs.tab = 'overview'; ofTab(ofs.tab); }
function ofTab(t) {
  ofs.tab = t;
  document.querySelectorAll('#of-tabs .filter-chip').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === t); });
  var p = document.getElementById('of-period'); if (p) p.style.visibility = t === 'overview' ? 'visible' : 'hidden';
  var mc = document.getElementById('of-models'); if (mc) mc.style.display = t === 'settings' ? 'none' : 'flex';
  ofBody();
}
function ofBody() {
  var b = document.getElementById('of-body');
  if (!b) return;
  if (ofs.tab !== 'settings' && !ofLinked().length) {
    b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucun compte OnlyFans connecté</div>' + (isPartner() ? '' : '<button class="btn btn-primary" style="margin-top:10px" onclick="ofTab(\'settings\')">Connecter un compte</button>') + '</div>';
    return;
  }
  b.innerHTML = '<div class="skeleton-card" style="height:180px"></div>';
  (ofs.tab === 'settings' ? ofSettings : ofOverview)(b);
}

function ofOverview(b) {
  ofApi('GET', '/overview' + ofQs()).then(function(o) {
    var t = o.totals;
    ofs.currency = o.currency; ofs.rate = o.eur_rate;
    var types = o.byType.filter(function(x) { return Number(x.gross) > 0; });
    var bal = o.accounts.map(function(a) { return ofBalance(a.balances); }).filter(Boolean);
    var cur = bal.reduce(function(s, x) { return s + (x.current || 0); }, 0), pend = bal.reduce(function(s, x) { return s + (x.pending || 0); }, 0);
    b.innerHTML = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      + rvStat('CA TTC', ofMoney(t.ttc), ofEur(t.ttc) + (o.vat_ratio != null ? ' · dont TVA ' + Math.round(o.vat_ratio * 100) + ' % payée par les fans' : ''))
      + rvStat('CA brut', ofMoney(t.gross), 'Net (part de la modèle) : ' + ofMoney(t.net) + ' ' + ofEur(t.net))
      + rvStat('Ventes', rvNum(t.sales), t.sales ? 'Panier moyen ' + ofMoney(Math.round(t.gross / t.sales)) : null)
      + rvStat('Abonnements payants', rvNum(t.new_paid_subs), t.subscribers ? rvNum(t.subscribers) + ' abonnés au total' : 'sur la période')
      + (bal.length ? rvStat('Solde', ofMoney(cur), ofMoney(pend) + ' en attente', 'var(--accent-green)') : '')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin:14px 0;align-items:start">'
      + '<div class="panel" style="padding:16px"><div style="font-weight:700;font-size:15px">Revenu journalier</div><div id="of-daily-sub" style="font-size:12px;color:var(--text-tertiary);margin:2px 0 8px"></div><div style="position:relative;height:240px"><canvas id="of-daily-chart"></canvas></div></div>'
      + '<div class="panel" style="padding:16px"><div style="font-weight:700;font-size:15px;margin-bottom:10px">Par type</div>'
      + (types.length ? types.map(function(x) {
        var pct = t.gross ? Math.round(Number(x.gross) / t.gross * 100) : 0;
        return '<div style="padding:7px 0;border-bottom:1px solid var(--border-subtle)"><div style="display:flex;justify-content:space-between;font-size:13px"><span>' + rvEsc(OF_TYPES[x.type] || x.type) + ' <span style="color:var(--text-tertiary)">· ' + rvNum(x.sales) + '</span></span><b>' + ofMoney(x.gross) + '</b></div>'
          + '<div style="height:5px;border-radius:3px;background:var(--bg-subtle);margin-top:5px"><div style="height:5px;border-radius:3px;width:' + pct + '%;background:#0EA5E9"></div></div></div>';
      }).join('') : '<div style="color:var(--text-tertiary);font-size:13px">Rien sur la période</div>') + '</div></div>'
      + (ofs.model ? '' : '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th><th>CA brut</th><th>Net</th><th>Ventes</th><th>Abonnés</th><th>Solde</th></tr></thead><tbody>'
        + o.accounts.map(function(a) {
          var bb = ofBalance(a.balances);
          return '<tr style="cursor:pointer" onclick="ofSetModel(' + a.model_id + ')"><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + ofDot(a.model_id) + '<div><div style="font-weight:600">' + rvEsc(a.name) + '</div><div style="font-size:11px;color:' + (a.status === 'expired' ? 'var(--accent-red)' : 'var(--text-tertiary)') + '">' + (a.status === 'expired' ? 'session expirée' : a.last_sync_at ? 'relevé ' + rvAgo(a.last_sync_at) : 'premier relevé en attente') + '</div></div></div></td>'
            + '<td style="font-weight:600">' + ofMoney(a.gross) + '</td><td>' + ofMoney(a.net) + '</td><td>' + rvNum(a.sales) + '</td><td>' + (a.subscribers != null ? rvNum(a.subscribers) : '–') + '</td><td>' + (bb && bb.current != null ? ofMoney(bb.current) : '–') + '</td></tr>';
        }).join('') + '</tbody></table></div>')
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin-top:14px;align-items:start">'
      + '<div class="panel" style="padding:0;overflow:auto"><div style="font-weight:700;padding:14px 16px 4px">Dernières ventes</div><table class="table" style="width:100%"><tbody>'
      + (o.recent.length ? o.recent.slice(0, 15).map(function(x) {
        return '<tr><td style="text-align:left;white-space:nowrap">' + new Date(x.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) + '</td><td style="text-align:left">' + rvEsc(x.model_name) + ' · ' + rvEsc({ message: 'Message', tips: 'Pourboire', post: 'Post', subscription: 'Abonnement', stream: 'Live' }[x.type] || x.type || '') + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(x.fan || '') + '</div></td><td style="font-weight:600;white-space:nowrap">' + ofMoney(x.amount_cents) + '</td></tr>';
      }).join('') : '<tr><td style="color:var(--text-tertiary);padding:16px">Pas encore relevées</td></tr>') + '</tbody></table></div>'
      + '<div class="panel" style="padding:16px"><div style="font-weight:700;margin-bottom:8px">Meilleurs fans (31 jours)</div>' + (o.topFans.length ? o.topFans.map(function(f, i) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><div><b>' + (i + 1) + '.</b> ' + rvEsc(f.fan) + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(f.model_name) + ' · ' + f.n + ' achat(s)</div></div><div style="font-weight:600">' + ofMoney(f.total) + '</div></div>';
      }).join('') : '<div style="color:var(--text-tertiary);font-size:13px">Rien pour l\'instant</div>') + '</div></div>'
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:10px">Le bot ouvre la page Statistiques d\'OnlyFans environ toutes les 6 h et lit ce qu\'elle affiche (30 derniers jours). L\'historique se construit au fil des relevés. Montants en ' + rvEsc(o.currency) + ' comme sur OnlyFans (≈ € au taux du jour : 1 ' + rvEsc(o.currency) + ' = ' + (o.eur_rate || 0).toFixed(3) + ' €). Brut = prix payé ; TTC = brut + TVA payée par les fans ; net = 80 % du brut, la part de la modèle.</div>';
    var today = rvParis(0), canvas = document.getElementById('of-daily-chart'), sub = document.getElementById('of-daily-sub');
    ofApi('GET', '/daily-by-model?from=' + today.slice(0, 8) + '01&to=' + today + (ofs.model ? '&model=' + ofs.model : '')).then(function(d) {
      var mc = modelDailyChart(canvas, d.rows.map(function(r) { return { d: r.d, key: r.key, name: r.name, crmId: r.crm_model_id, v: Number(r.gross) / 100 }; }), today, { what: 'CA brut par modèle', unit: o.currency === 'USD' ? '$' : o.currency });
      if (mc && sub) sub.textContent = mc.subtitle;
    }).catch(function() {});
  }).catch(function(e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; });
}

function ofSettings(b) {
  var d = ofs.data || { models: [], accounts: [] };
  var acc = function(id) { return d.accounts.find(function(a) { return a.model_id === id; }); };
  b.innerHTML = '<div class="panel" style="padding:18px;margin-bottom:14px"><div style="font-weight:700;font-size:15px;margin-bottom:8px">Connecter le compte OnlyFans d\'une modèle</div>'
    + '<div style="padding:10px 14px;border-radius:10px;background:var(--accent-yellow-bg);color:var(--accent-yellow-light);font-size:13px;margin-bottom:12px;line-height:1.6">⚠️ Le bot ouvre OnlyFans avec la session de la modèle depuis le serveur du CRM. OnlyFans peut demander une vérification ou déconnecter la session. Commence par <b>une seule modèle</b> et surveille son compte les premiers jours.</div>'
    + '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.8;margin:0 0 12px">'
    + '<li>Installe l\'extension Chrome <b>Cookie-Editor</b> et autorise-la en navigation privée (chrome://extensions &gt; Détails &gt; « Autoriser en mode navigation privée »).</li>'
    + '<li>Sur onlyfans.com (connecté au compte de la modèle), ouvre Cookie-Editor &gt; <b>Export</b> &gt; <b>JSON</b> : le texte est copié. Colle-le ici.</li>'
    + '<li style="opacity:.7">Le favori <a id="of-bm" href="#" style="display:inline-block;padding:1px 8px;border-radius:8px;background:#0EA5E9;color:#fff;text-decoration:none;font-weight:600" onclick="event.preventDefault();rvToast(\'Glisse-le dans ta barre de favoris\')">Session OnlyFans</a> ne suffit pas : OnlyFans lui cache ses cookies de connexion.</li>'
    + '<li>Ferme la fenêtre privée <b>sans te déconnecter</b>.</li></ol>'
    + '<div style="display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:start"><select class="form-input" id="of-model"><option value="">Choisis la modèle</option>'
    + d.models.map(function(m) { return '<option value="' + m.id + '">' + rvEsc(m.name) + '</option>'; }).join('') + '</select>'
    + '<textarea class="form-input" id="of-export" rows="3" placeholder="Colle la session ici"></textarea></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap"><div style="font-size:12px;color:var(--text-tertiary);max-width:620px">Session chiffrée. Le bot ne fait que lire la page Statistiques (revenus, soldes) : il n\'envoie rien, ne clique sur rien et ne touche à rien sur le compte.</div>'
    + '<button class="btn btn-primary" onclick="ofSave()">Connecter</button></div></div>'
    + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th><th style="text-align:left">État</th><th style="text-align:left">Dernier relevé</th><th></th></tr></thead><tbody>'
    + d.models.map(function(m) {
      var a = acc(m.id), s = a && a.has_session ? (OF_STATUS[a.status] || OF_STATUS.unchecked) : null;
      return '<tr><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + ofDot(m.id) + rvEsc(m.name) + '</div></td>'
        + '<td style="text-align:left">' + (s ? '<span style="color:' + s[0] + '">● ' + s[1] + '</span>' + (a.last_error ? '<div style="font-size:11px;color:var(--text-tertiary);max-width:360px">' + rvEsc(a.last_error) + '</div>' : '') : '<span style="color:var(--text-tertiary)">pas connectée</span>') + '</td>'
        + '<td style="text-align:left">' + (a && a.last_sync_at ? rvAgo(a.last_sync_at) : '–') + '</td>'
        + '<td style="white-space:nowrap">' + (a && a.has_session ? '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="ofSync(' + m.id + ')">Relever maintenant</button><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;color:var(--accent-red)" onclick="ofRemove(' + m.id + ')">Déconnecter</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  ofApi('GET', '/bookmarklet').then(function(r) { var a = document.getElementById('of-bm'); if (a) a.setAttribute('href', r.bookmarklet); });
}
function ofSave() {
  var id = document.getElementById('of-model').value, v = document.getElementById('of-export').value.trim();
  if (!id) return rvToast('Choisis la modèle', 'error');
  if (!v) return rvToast('Colle la session d\'abord', 'error');
  ofApi('POST', '/accounts', { model_id: Number(id), export: v }).then(function() {
    rvToast('Session enregistrée : le bot fait le premier relevé dans quelques minutes', 'success');
    ofLoad().then(ofBody);
  }).catch(function(e) { rvToast(e.message, 'error'); });
}
function ofSync(id) {
  ofApi('POST', '/accounts/' + id + '/sync').then(function() { rvToast('Le bot relève les stats dans la minute', 'success'); }).catch(function(e) { rvToast(e.message, 'error'); });
}
function ofRemove(id) {
  if (!confirm('Déconnecter OnlyFans pour ' + ofName(id) + ' ? Les stats déjà relevées restent.')) return;
  ofApi('DELETE', '/accounts/' + id).then(function() { rvToast('Déconnecté', 'success'); ofLoad().then(ofBody); });
}
