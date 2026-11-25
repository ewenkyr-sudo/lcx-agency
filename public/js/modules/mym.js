// MYM MODULE — stats lues sur le compte MyM de chaque modèle (session copiée avec un favori)
// Réutilise les petites fonctions de reveal.js (rvEsc, rvEur, rvNum, rvStat, rvAgo, rvParis, rvToast).

var my = { tab: 'overview', period: '30d', model: '', data: null };

function myApi(method, url, body) {
  return fetch('/api/mym' + url, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); });
}
function myQs() { var r = periodRange(my.period, my.from, my.to); return '?from=' + r.from + '&to=' + r.to + (my.model ? '&model=' + my.model : ''); }
function myLinked() { return ((my.data && my.data.accounts) || []).filter(function(a) { return a.has_session || a.total_cents != null; }); }
function myName(id) { var m = ((my.data && my.data.models) || []).find(function(x) { return x.id === Number(id); }); return m ? m.name : ''; }
function myDot(id) { return '<span style="width:8px;height:8px;border-radius:50%;background:' + modelColor(Number(id), myName(id)) + ';flex-shrink:0"></span>'; }
var MY_STATUS = { ok: ['var(--accent-green)', 'Connecté'], unchecked: ['var(--accent-yellow)', 'Vérification…'], expired: ['var(--accent-red)', 'Déconnecté'] };

function renderMym() {
  var c = document.getElementById('mym-content');
  if (!c) return;
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="my-status"></div><div id="my-models" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"></div>'
      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap" id="my-tabs">' + [['overview', 'Vue d\'ensemble'], ['monthly', 'Par mois'], ['tx', 'Transactions'], ['settings', 'Connexion']].filter(function(t) { return !(isPartner() && t[0] === 'settings'); }).map(function(t) {
        return '<button class="filter-chip' + (my.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '" onclick="myTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>'
      + '<div id="my-period">' + periodPickerHtml('my-pp', my.period, my.from, my.to, function(v, f, t) { my.period = v; my.from = f; my.to = t; myBody(); }) + '</div>'
      + '</div><div id="my-body"><div class="skeleton-card" style="height:180px"></div></div>';
  }
  myLoad().then(function() {
    if (!myLinked().length && !isPartner()) my.tab = 'settings';
    myTab(my.tab);
  });
}
function myLoad() {
  return myApi('GET', '/accounts').then(function(d) {
    my.data = d;
    var el = document.getElementById('my-status'), linked = myLinked();
    var bad = linked.filter(function(a) { return a.status === 'expired'; });
    if (el) el.innerHTML = linked.length ? '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-secondary)">'
      + linked.map(function(a) { var s = MY_STATUS[a.status] || MY_STATUS.unchecked; return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + s[0] + '"></span>' + rvEsc(myName(a.model_id)) + ' : ' + (a.status === 'ok' ? 'à jour ' + rvAgo(a.last_sync_at) : s[1]) + '</span>'; }).join('')
      + '</div>' + (bad.length && !isPartner() ? '<div style="margin-top:10px;padding:10px 14px;border-radius:10px;background:var(--accent-red-bg);color:var(--accent-red);font-size:13px">🔑 ' + bad.map(function(a) { return rvEsc(myName(a.model_id)); }).join(', ') + ' : session MyM expirée, les stats ne se mettent plus à jour → onglet Connexion</div>' : '') : '';
    var mc = document.getElementById('my-models');
    if (mc) {
      var chip = function(id, label) { return '<button class="filter-chip' + (String(my.model) === String(id) ? ' active' : '') + '" style="display:inline-flex;align-items:center;gap:6px" onclick="mySetModel(\'' + id + '\')">' + rvEsc(label) + (id ? myDot(id) : '') + '</button>'; };
      mc.innerHTML = linked.length > 1 ? chip('', 'Toutes les modèles') + linked.map(function(a) { return chip(a.model_id, myName(a.model_id)); }).join('') : '';
    }
  });
}
function mySetModel(id) { my.model = id || ''; myLoad(); if (my.tab === 'settings') my.tab = 'overview'; myTab(my.tab); }
function myTab(t) {
  my.tab = t;
  document.querySelectorAll('#my-tabs .filter-chip').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === t); });
  var p = document.getElementById('my-period'); if (p) p.style.visibility = t === 'overview' ? 'visible' : 'hidden';
  var mc = document.getElementById('my-models'); if (mc) mc.style.display = t === 'settings' ? 'none' : 'flex';
  myBody();
}
function myBody() {
  var b = document.getElementById('my-body');
  if (!b) return;
  if (my.tab !== 'settings' && !myLinked().length) {
    b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucun compte MyM connecté</div>' + (isPartner() ? '' : '<button class="btn btn-primary" style="margin-top:10px" onclick="myTab(\'settings\')">Connecter un compte</button>') + '</div>';
    return;
  }
  b.innerHTML = '<div class="skeleton-card" style="height:180px"></div>';
  ({ overview: myOverview, monthly: myMonthly, tx: myTx, settings: mySettings }[my.tab] || myOverview)(b);
}
function myErr(b, e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; }

// ---------- vue d'ensemble ----------
function myOverview(b) {
  myApi('GET', '/overview' + myQs()).then(function(o) {
    var t = o.totals;
    var types = (o.byType || []).map(function(x) { return rvEsc(x.type) + ' ' + rvEur(x.amount); }).join(' · ');
    b.innerHTML = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      + rvStat('CA net', rvEur(t.net), types || 'Ce que touche la modèle (après la part de MyM)')
      + rvStat('Nouveaux abonnés', rvNum(t.new_subs), rvNum(t.subscribers) + ' abonnés au total')
      + rvStat('Ventes', rvNum(t.sales), rvNum(t.buyers) + ' acheteur' + (t.buyers > 1 ? 's' : '') + (t.sales ? ' · panier ' + rvEur(Math.round(t.tx_net / t.sales)) : ''))
      + rvStat('LTV par abonné', o.ltv != null ? rvEur(o.ltv) : '–', 'Revenus depuis la création divisés par le nombre d\'abonnés', 'var(--accent-blue)')
      + rvStat('Prochain versement', rvEur(o.accounts.reduce(function(s, a) { return s + Number(a.validated_cents || 0); }, 0)), rvEur(t.pending_cents) + ' en attente de validation')
      + '</div>'
      + '<div class="panel" style="padding:16px;margin:14px 0"><div style="font-weight:700;font-size:15px">Revenu journalier</div><div id="my-daily-sub" style="font-size:12px;color:var(--text-tertiary);margin:2px 0 8px"></div><div style="position:relative;height:240px"><canvas id="my-daily-chart"></canvas></div></div>'
      + (my.model ? '' : '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th><th>CA net</th><th>Nouv. abonnés</th><th>Abonnés</th><th>Depuis la création</th><th title="Revenus depuis la création ÷ abonnés">LTV</th><th>À verser</th></tr></thead><tbody>'
        + o.accounts.map(function(a) {
          var grow = a.subs_30d_ago != null && a.subscribers != null ? a.subscribers - a.subs_30d_ago : null;
          return '<tr style="cursor:pointer" onclick="mySetModel(' + a.model_id + ')"><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + myDot(a.model_id) + '<div><div style="font-weight:600">' + rvEsc(a.name) + '</div><div style="font-size:11px;color:' + (a.status === 'expired' ? 'var(--accent-red)' : 'var(--text-tertiary)') + '">' + (a.status === 'expired' ? 'session expirée' : 'à jour ' + rvAgo(a.last_sync_at)) + '</div></div></div></td>'
            + '<td style="font-weight:600">' + rvEur(a.net) + '</td><td>' + rvNum(a.new_subs) + '</td><td>' + rvNum(a.subscribers) + (grow != null ? '<div style="font-size:11px;color:' + (grow >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') + '">' + (grow >= 0 ? '+' : '') + rvNum(grow) + ' en 30 j</div>' : '') + '</td>'
            + '<td>' + rvEur(a.total_cents) + '</td><td style="font-weight:600">' + (a.ltv != null ? rvEur(a.ltv) : '–') + '</td><td>' + rvEur(a.validated_cents) + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(a.next_payout || '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>')
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:10px">MyM n\'affiche que la part de la modèle : les montants sont nets (pas de TTC comme sur Reveal). Le CA jour par jour vient du graphique MyM depuis la création du compte ; les nouveaux abonnés et les ventes une par une sont relevés depuis la connexion au CRM.</div>';
    myDaily();
  }).catch(function(e) { myErr(b, e); });
}
function myDaily() {
  var today = rvParis(0), canvas = document.getElementById('my-daily-chart'), sub = document.getElementById('my-daily-sub');
  if (!my.model) {
    myApi('GET', '/daily-by-model?from=' + today.slice(0, 8) + '01&to=' + today).then(function(o) {
      var mc = modelDailyChart(canvas, o.rows.map(function(r) { return { d: r.d, key: r.key, name: r.name, crmId: r.crm_model_id, v: Number(r.net) / 100 }; }), today, { what: 'CA net par modèle' });
      if (mc && sub) sub.textContent = mc.subtitle;
    }).catch(function() {});
    return;
  }
  var pd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  myApi('GET', '/overview?from=' + pd + '&to=' + today + '&model=' + my.model).then(function(o) {
    var mc = monthCompareChart(canvas, o.daily.map(function(x) { return { d: x.d, v: Number(x.net) / 100 }; }), today, { what: 'CA net' });
    if (mc && sub) sub.textContent = mc.subtitle;
  }).catch(function() {});
}

// ---------- par mois (récap MyM, avec le détail par catégorie) ----------
function myMonthly(b) {
  myApi('GET', '/monthly' + (my.model ? '?model=' + my.model : '')).then(function(o) {
    b.innerHTML = o.accounts.map(function(a) {
      var months = a.monthly || [];
      var max = Math.max.apply(null, months.map(function(m) { return Number(m.amount_cents) || 0; }).concat([1]));
      return '<div class="panel" style="padding:16px;margin-bottom:14px"><div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:12px">' + myDot(a.model_id) + rvEsc(a.name) + '</div>'
        + (months.length ? months.map(function(m) {
          return '<div style="padding:8px 0;border-bottom:1px solid var(--border-subtle)"><div style="display:flex;justify-content:space-between;font-size:14px"><span>' + rvEsc(m.month) + '</span><b>' + rvEur(m.amount_cents) + '</b></div>'
            + '<div style="height:6px;border-radius:3px;background:var(--bg-subtle);margin:6px 0"><div style="height:6px;border-radius:3px;width:' + Math.round((Number(m.amount_cents) || 0) / max * 100) + '%;background:' + modelColor(a.model_id, a.name) + '"></div></div>'
            + '<div style="font-size:12px;color:var(--text-tertiary)">' + (m.parts || []).map(function(p) { return rvEsc(p.label) + ' ' + rvEur(p.amount_cents); }).join(' · ') + '</div></div>';
        }).join('') : '<div style="color:var(--text-tertiary)">Pas encore relevé</div>') + '</div>';
    }).join('') || '<div class="empty-state"><div class="empty-state-title">Rien pour l\'instant</div></div>';
  }).catch(function(e) { myErr(b, e); });
}

// ---------- transactions ----------
function myTx(b) {
  my.paidOnly = my.paidOnly !== false;
  myApi('GET', '/transactions?limit=200' + (my.paidOnly ? '&paid=1' : '') + (my.model ? '&model=' + my.model : '')).then(function(o) {
    b.innerHTML = '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:14px;align-items:start" class="rv-sales-grid">'
      + '<div class="panel" style="padding:0;overflow:auto"><div style="padding:10px 14px;display:flex;gap:8px"><button class="filter-chip' + (my.paidOnly ? ' active' : '') + '" onclick="my.paidOnly=true;myBody()">Ventes</button><button class="filter-chip' + (!my.paidOnly ? ' active' : '') + '" onclick="my.paidOnly=false;myBody()">Tout (avec les abonnements)</button></div>'
      + '<table class="table" style="width:100%"><thead><tr><th style="text-align:left">Quand</th><th style="text-align:left">Modèle</th><th style="text-align:left">Type</th><th style="text-align:left">Fan</th><th>Montant net</th></tr></thead><tbody>'
      + (o.transactions.length ? o.transactions.map(function(t) {
        return '<tr><td style="text-align:left;white-space:nowrap">' + new Date(t.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) + '</td>'
          + '<td style="text-align:left">' + rvEsc(t.model_name) + '</td><td style="text-align:left">' + rvEsc(t.type) + (t.status === 'pending' ? ' <span style="font-size:11px;color:var(--text-tertiary)">en attente</span>' : '') + '</td>'
          + '<td style="text-align:left">' + rvEsc(t.fan_username ? '@' + t.fan_username : '–') + '</td><td style="font-weight:600">' + rvEur(t.amount_cents) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:24px">Rien pour l\'instant</td></tr>')
      + '</tbody></table></div>'
      + '<div class="panel" style="padding:16px"><div style="font-weight:600;margin-bottom:10px">Meilleurs fans (31 jours)</div>' + (o.topFans.length ? o.topFans.map(function(f, i) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><div><b>' + (i + 1) + '.</b> @' + rvEsc(f.fan) + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(f.model_name) + ' · ' + f.n + ' achat(s)</div></div><div style="font-weight:600">' + rvEur(f.total) + '</div></div>';
      }).join('') : '<div style="color:var(--text-tertiary);font-size:13px">Rien pour l\'instant</div>') + '</div></div>';
  }).catch(function(e) { myErr(b, e); });
}

// ---------- connexion ----------
function mySettings(b) {
  var d = my.data || { models: [], accounts: [] };
  var acc = function(id) { return d.accounts.find(function(a) { return a.model_id === id; }); };
  b.innerHTML = '<div class="panel" style="padding:18px;margin-bottom:14px"><div style="font-weight:700;font-size:15px;margin-bottom:8px">Connecter le compte MyM d\'une modèle</div>'
    + '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.8;margin:0 0 12px">'
    + '<li>Glisse ce bouton dans ta barre de favoris : <a id="my-bm" href="#" style="display:inline-block;padding:3px 10px;border-radius:8px;background:var(--accent-blue);color:#fff;text-decoration:none;font-weight:600" onclick="event.preventDefault();rvToast(\'Glisse-le dans ta barre de favoris\')">Session MyM</a></li>'
    + '<li>Ouvre une <b>fenêtre privée</b>, va sur <b>creators.mym.fans</b> et connecte-toi au compte de la modèle.</li>'
    + '<li>Clique sur le favori <b>Session MyM</b>, puis colle ici ce qu\'il a copié. Ferme ensuite la fenêtre privée <b>sans te déconnecter</b> (« Déconnexion » couperait aussi le CRM).</li></ol>'
    + '<div style="display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:start" class="my-connect"><select class="form-input" id="my-model"><option value="">Choisis la modèle</option>'
    + d.models.map(function(m) { return '<option value="' + m.id + '">' + rvEsc(m.name) + '</option>'; }).join('') + '</select>'
    + '<textarea class="form-input" id="my-export" rows="3" placeholder="Colle la session ici"></textarea></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap"><div style="font-size:12px;color:var(--text-tertiary);max-width:620px">La session est chiffrée dans la base et renouvelée toute seule. Le CRM ne fait que lire (revenus, abonnés, transactions) : il n\'envoie rien et ne touche à rien sur le compte.</div>'
    + '<button class="btn btn-primary" onclick="mySave()">Connecter</button></div></div>'
    + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th><th style="text-align:left">État</th><th style="text-align:left">Dernière synchro</th><th></th></tr></thead><tbody>'
    + d.models.map(function(m) {
      var a = acc(m.id), s = a && a.has_session ? (MY_STATUS[a.status] || MY_STATUS.unchecked) : null;
      return '<tr><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + myDot(m.id) + rvEsc(m.name) + '</div></td>'
        + '<td style="text-align:left">' + (s ? '<span style="color:' + s[0] + '">● ' + s[1] + '</span>' + (a.last_error ? '<div style="font-size:11px;color:var(--text-tertiary);max-width:360px">' + rvEsc(a.last_error) + '</div>' : '') : '<span style="color:var(--text-tertiary)">pas connectée</span>') + '</td>'
        + '<td style="text-align:left">' + (a && a.last_sync_at ? rvAgo(a.last_sync_at) : '–') + '</td>'
        + '<td style="white-space:nowrap">' + (a && a.has_session ? '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="mySync(' + m.id + ', this)">Actualiser</button><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;color:var(--accent-red)" onclick="myRemove(' + m.id + ')">Déconnecter</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  myApi('GET', '/bookmarklet').then(function(r) { var a = document.getElementById('my-bm'); if (a) a.setAttribute('href', r.bookmarklet); });
}
function mySave() {
  var id = document.getElementById('my-model').value, v = document.getElementById('my-export').value.trim();
  if (!id) return rvToast('Choisis la modèle', 'error');
  if (!v) return rvToast('Colle la session d\'abord', 'error');
  myApi('POST', '/accounts', { model_id: Number(id), export: v }).then(function() {
    rvToast('Session enregistrée : premier relevé en cours (quelques minutes pour l\'historique)', 'success');
    myLoad().then(function() { myBody(); setTimeout(function() { myLoad().then(function() { if (my.tab === 'settings') myBody(); }); }, 8000); });
  }).catch(function(e) { rvToast(e.message, 'error'); });
}
function mySync(id, btn) {
  btn.disabled = true; btn.textContent = 'Synchro…';
  myApi('POST', '/accounts/' + id + '/sync').then(function(r) { rvToast(r.ok ? 'Stats MyM à jour' : r.error, r.ok ? 'success' : 'error'); })
    .catch(function(e) { rvToast(e.message, 'error'); }).then(function() { myLoad().then(myBody); });
}
function myRemove(id) {
  if (!confirm('Déconnecter MyM pour ' + myName(id) + ' ? Les stats déjà relevées restent.')) return;
  myApi('DELETE', '/accounts/' + id).then(function() { rvToast('Déconnecté', 'success'); myLoad().then(myBody); });
}
