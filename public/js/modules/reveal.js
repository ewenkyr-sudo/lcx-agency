// REVEAL MODULE — données de l'API officielle Reveal (stats, chatteurs, liens de suivi, ventes)

var rv = { tab: 'overview', period: '30d', status: null };
var RV_TYPES = { subscription: 'Abonnement', renewal: 'Renouvellement', ppv: 'PPV', mass_dm: 'Mass DM', tip: 'Pourboire', payment_link: 'Lien de paiement', boudoir: 'Boudoir', paid_message: 'Message payant', other: 'Autre' };

function rvEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rvEur(c) { var big = Math.abs(Number(c) || 0) >= 10000; return ((Number(c) || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 }); }
function rvNum(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
function rvApi(method, url, body) {
  return fetch('/api/reveal' + url, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); });
}
function rvToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); else alert(m); }
function rvAgo(d) {
  if (!d) return 'jamais';
  var s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return 'à l\'instant'; if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h'; return 'il y a ' + Math.round(s / 86400) + ' j';
}
function rvParis(offset) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + (offset || 0) * 86400000)); }
function rvRange() {
  var today = rvParis(0);
  if (rv.period === '7d') return { from: rvParis(-6), to: today };
  if (rv.period === 'today') return { from: today, to: today };
  if (rv.period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (rv.period === 'lastmonth') {
    var d = new Date(today.slice(0, 8) + '01T12:00:00Z'); d.setUTCDate(0);
    var last = d.toISOString().slice(0, 10);
    return { from: last.slice(0, 8) + '01', to: last };
  }
  return { from: rvParis(-29), to: today };
}
function rvQs() { var r = rvRange(); return '?from=' + r.from + '&to=' + r.to; }
function rvStat(label, value, sub, color) {
  return '<div class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value" style="font-size:22px' + (color ? ';color:' + color : '') + '">' + value + '</div>' + (sub ? '<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">' + sub + '</div>' : '') + '</div>';
}

// ========== RENDU ==========
function renderReveal() {
  var c = document.getElementById('reveal-content');
  if (!c) return;
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="rv-status"></div>'
      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap" id="rv-tabs">' + [['overview', 'Vue d\'ensemble'], ['chatters', 'Chatteurs'], ['tracking', 'Liens de suivi'], ['sales', 'Ventes'], ['settings', 'Réglages']].map(function(t) {
        return '<button class="filter-chip' + (rv.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '" onclick="rvTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>'
      + '<select class="form-input" id="rv-period" style="max-width:200px" onchange="rv.period=this.value;rvBody()">'
      + [['today', 'Aujourd\'hui'], ['7d', '7 derniers jours'], ['30d', '30 derniers jours'], ['month', 'Ce mois-ci'], ['lastmonth', 'Mois dernier']].map(function(p) { return '<option value="' + p[0] + '"' + (rv.period === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select></div><div id="rv-body"><div class="skeleton-card" style="height:180px"></div></div>';
  }
  rvLoadStatus().then(function() {
    if (!rv.status.connected && rv.tab !== 'settings') rv.tab = 'settings';
    rvTab(rv.tab);
  });
}

function rvTab(t) {
  rv.tab = t;
  document.querySelectorAll('#rv-tabs .filter-chip').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === t); });
  var p = document.getElementById('rv-period'); if (p) p.style.visibility = (t === 'settings' || t === 'sales') ? 'hidden' : 'visible';
  rvBody();
}

function rvLoadStatus() {
  return rvApi('GET', '/status').then(function(s) {
    rv.status = s;
    var el = document.getElementById('rv-status');
    if (!el) return;
    if (!s.connected) { el.innerHTML = ''; return; }
    var warn = [];
    if (s.last_error) warn.push('<span style="color:var(--accent-red)">⚠️ ' + rvEsc(s.last_error) + '</span> <span style="color:var(--text-tertiary)">(' + rvAgo(s.last_error_at) + ')</span>');
    if (s.counts.models_unmapped) warn.push(s.counts.models_unmapped + ' modèle(s) Reveal pas reliée(s) au CRM → onglet Réglages');
    if (s.counts.chatters_unmapped) warn.push(s.counts.chatters_unmapped + ' chatteur(s) qui vendent sur Reveal pas relié(s) à un compte CRM → onglet Chatteurs');
    if (s.sales_enabled === false) warn.push('La clé n\'a pas l\'accès « Ventes une par une » : ventes et Fan CRM désactivés');
    el.innerHTML = '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-secondary)">'
      + '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + (s.last_error ? 'var(--accent-red)' : 'var(--accent-green)') + '"></span>API Reveal connectée</span>'
      + '<span>Stats à jour ' + rvAgo(s.last_sync_at) + '</span>' + (s.sales_enabled ? '<span>Ventes ' + rvAgo(s.last_sales_sync_at) + '</span>' : '')
      + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="rvSyncNow(this)">Actualiser</button></div>'
      + (warn.length ? '<div style="margin-top:10px;padding:10px 14px;border-radius:10px;background:var(--accent-yellow-bg);color:var(--accent-yellow-light);font-size:13px;line-height:1.6">' + warn.join('<br>') + '</div>' : '');
  });
}

function rvSyncNow(btn) {
  btn.disabled = true; btn.textContent = 'Synchro…';
  rvApi('POST', '/sync').then(function(r) { rvToast(r.ok === false ? r.error : 'Données Reveal à jour', r.ok === false ? 'error' : 'success'); })
    .catch(function(e) { rvToast(e.message, 'error'); })
    .then(function() { rvLoadStatus(); rvBody(); });
}

function rvBody() {
  var b = document.getElementById('rv-body');
  if (!b) return;
  b.innerHTML = '<div class="skeleton-card" style="height:180px"></div>';
  ({ overview: rvOverview, chatters: rvChatters, tracking: rvTracking, sales: rvSales, settings: rvSettings }[rv.tab] || rvOverview)(b);
}

// ---------- vue d'ensemble ----------
function rvBars(daily) {
  if (!daily.length) return '';
  var max = Math.max.apply(null, daily.map(function(d) { return Number(d.net) || 0; })) || 1;
  var w = 100 / daily.length;
  return '<div class="panel" style="padding:16px;margin:14px 0"><div style="font-weight:600;margin-bottom:10px">CA net par jour</div>'
    + '<svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:160px;display:block">' + daily.map(function(d, i) {
      var h = (Number(d.net) || 0) / max * 38;
      return '<rect x="' + (i * w + w * 0.15) + '" y="' + (40 - h) + '" width="' + (w * 0.7) + '" height="' + h + '" rx="0.4" fill="var(--accent-blue)"><title>' + d.d + ' : ' + rvEur(d.net) + ' net · ' + rvNum(d.new_subs) + ' nouveaux abonnés</title></rect>';
    }).join('') + '</svg>'
    + '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-tertiary);margin-top:4px"><span>' + daily[0].d.slice(5).split('-').reverse().join('/') + '</span><span>' + daily[daily.length - 1].d.slice(5).split('-').reverse().join('/') + '</span></div></div>';
}

function rvOverview(b) {
  rvApi('GET', '/overview' + rvQs()).then(function(o) {
    var t = o.totals, net = Number(t.agency) + Number(t.model);
    var mix = [['Abonnements', t.subs_net], ['Renouvellements', t.renewals_net], ['PPV', t.ppv_net], ['Pourboires', t.tips_net], ['Liens de paiement', t.links_net], ['Boudoir', t.boudoir_net], ['Messages payants', t.paid_msg_net], ['Autre', t.other_net]]
      .filter(function(x) { return Number(x[1]) > 0; });
    b.innerHTML = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      + rvStat('CA TTC', rvEur(t.ttc), 'HT : ' + rvEur(t.ht))
      + rvStat('Part agence', rvEur(t.agency), 'Part modèles : ' + rvEur(t.model), 'var(--accent-green)')
      + rvStat('Nouveaux abonnés', rvNum(t.new_subs), rvNum(t.unsubs) + ' fins d\'abonnement')
      + rvStat('PPV vendus', rvNum(t.ppv_purchased), (t.ppv_sent ? rvNum(t.ppv_sent) + ' envoyés · ' + Math.round(t.ppv_purchased / t.ppv_sent * 100) + ' %' : rvEur(t.ppv_net) + ' net'))
      + rvStat('Pourboires', rvNum(t.tips), rvEur(t.tips_net) + ' net')
      + (Number(t.messages_sent) || Number(t.messages_received) ? rvStat('Messages', rvNum(t.messages_sent), rvNum(t.messages_received) + ' reçus des fans') : '')
      + '</div>'
      + rvBars(o.daily)
      + (mix.length ? '<div class="panel" style="padding:16px;margin-bottom:14px"><div style="font-weight:600;margin-bottom:10px">D\'où vient le CA net</div>' + mix.map(function(x) {
          var pct = net ? Math.round(x[1] / net * 100) : 0;
          return '<div style="display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:6px"><div style="width:130px;color:var(--text-secondary)">' + x[0] + '</div>'
            + '<div style="flex:1;height:8px;background:var(--bg-subtle);border-radius:4px"><div style="height:100%;width:' + pct + '%;background:var(--accent-blue);border-radius:4px"></div></div>'
            + '<div style="width:120px;text-align:right">' + rvEur(x[1]) + ' <span style="color:var(--text-muted)">' + pct + ' %</span></div></div>';
        }).join('') + '</div>' : '')
      + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Modèle</th><th>CA TTC</th><th>Net</th><th>Agence</th><th>Nouv. abonnés</th><th>Abonnés</th><th>PPV vendus</th><th>Pourboires</th></tr></thead><tbody>'
      + o.models.map(function(m) {
        return '<tr><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + (m.avatar_url ? '<img src="' + rvEsc(m.avatar_url) + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover">' : '')
          + '<div><div style="font-weight:600">' + rvEsc(m.display_name || m.user_name) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + (m.crm_name ? 'CRM : ' + rvEsc(m.crm_name) : '<span style="color:var(--accent-yellow)">pas reliée au CRM</span>') + '</div></div></div></td>'
          + '<td>' + rvEur(m.ttc) + '</td><td>' + rvEur(m.net) + '</td><td style="color:var(--accent-green)">' + rvEur(m.agency) + '</td><td>' + rvNum(m.new_subs) + '</td><td>' + rvNum(m.subscribers_count) + '</td><td>' + rvNum(m.ppv_purchased) + '</td><td>' + rvNum(m.tips) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function(e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; });
}

// ---------- chatteurs ----------
function rvChatters(b) {
  rvApi('GET', '/chatters' + rvQs()).then(function(o) {
    var list = o.chatters.filter(function(c) { return !c.is_bot; });
    var opts = function(sel) { return '<option value="">— pas relié —</option>' + o.users.map(function(u) { return '<option value="' + u.id + '"' + (String(sel) === String(u.id) ? ' selected' : '') + '>' + rvEsc(u.display_name) + '</option>'; }).join(''); };
    b.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);margin-bottom:10px">Ventes attribuées comme dans le classement Reveal. Le net (part agence + part modèle) est la base habituelle des commissions. '
      + 'Les chatteurs reliés à un compte CRM n\'ont plus à saisir leurs PPV / pourboires : ils arrivent tout seuls dans leurs shifts.</div>'
      + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Chatteur</th><th>Compte CRM</th><th>Net</th><th>CA HT</th><th>Agence</th><th>Ventes</th><th>PPV vendus / envoyés</th><th>Pourboires</th><th>Messages</th></tr></thead><tbody>'
      + list.map(function(c, i) {
        return '<tr' + (c.removed_at ? ' style="opacity:.5"' : '') + '><td style="text-align:left"><div style="font-weight:600">' + (i < 3 && Number(c.net) > 0 ? ['🥇', '🥈', '🥉'][i] + ' ' : '') + rvEsc((c.first_name || '') + ' ' + (c.last_name || '')) + '</div>'
          + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(c.role || '') + (c.is_external ? ' · prestataire' : '') + (c.removed_at ? ' · retiré' : '') + '</div></td>'
          + '<td><select class="form-input" style="min-width:150px;padding:4px 8px;font-size:12px" onchange="rvMapChatter(\'' + c.chatter_id + '\', this.value)">' + opts(c.crm_user_id) + '</select></td>'
          + '<td style="font-weight:600">' + rvEur(c.net) + '</td><td>' + rvEur(c.ht) + '</td><td style="color:var(--accent-green)">' + rvEur(c.agency) + '</td><td>' + rvNum(c.sales) + '</td>'
          + '<td>' + rvNum(c.ppv_purchased) + ' / ' + rvNum(c.ppv_sent) + '</td><td>' + rvNum(c.tips) + '</td><td>' + rvNum(c.messages_sent) + '</td></tr>';
      }).join('')
      + '<tr style="color:var(--text-tertiary)"><td style="text-align:left">Ventes sans chatteur<div style="font-size:11px">abonnements, renouvellements, Mass DM…</div></td><td></td><td>' + rvEur(o.nobody.net) + '</td><td colspan="6"></td></tr>'
      + '</tbody></table></div>';
  }).catch(function(e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; });
}
function rvMapChatter(id, uid) {
  rvApi('PUT', '/chatters/' + id + '/map', { crm_user_id: uid || null }).then(function() { rvToast(uid ? 'Chatteur relié : ses ventes arrivent dans ses shifts' : 'Correspondance retirée', 'success'); rvLoadStatus(); rvBody(); })
    .catch(function(e) { rvToast(e.message, 'error'); });
}

// ---------- liens de suivi ----------
function rvTracking(b) {
  rvApi('GET', '/tracking' + rvQs()).then(function(o) {
    if (!o.links.length) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucun lien de suivi</div><div style="color:var(--text-tertiary);font-size:13px">Ils se créent dans le dashboard Reveal (Liens de suivi).</div></div>'; return; }
    b.innerHTML = '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Lien</th><th>Modèle</th><th>Clics</th><th>Abonnés</th><th>CA TTC</th><th>€ / clic</th><th style="border-left:1px solid var(--border-default)">Depuis la création</th></tr></thead><tbody>'
      + o.links.map(function(l) {
        return '<tr><td style="text-align:left"><div style="font-weight:600">' + rvEsc(l.name || l.tracking_code) + '</div><div style="font-size:11px"><a href="' + rvEsc(l.url) + '" target="_blank" rel="noopener" style="color:var(--text-tertiary)">' + rvEsc(l.url) + '</a> '
          + '<button class="btn btn-ghost" style="padding:0 4px;font-size:11px" onclick="navigator.clipboard.writeText(\'' + rvEsc(l.url) + '\');rvToast(\'Lien copié\',\'success\')">copier</button></div></td>'
          + '<td>' + rvEsc(l.model_name || '') + '</td><td>' + rvNum(l.p_clicks) + '</td><td>' + rvNum(l.p_subs) + '</td><td style="font-weight:600">' + rvEur(l.p_revenue) + '</td>'
          + '<td>' + (l.p_clicks ? rvEur(Math.round(l.p_revenue / l.p_clicks)) : '–') + '</td>'
          + '<td style="border-left:1px solid var(--border-default);font-size:12px;color:var(--text-secondary)">' + rvNum(l.clicks) + ' clics · ' + rvNum(l.new_subscribers) + ' abonnés (' + rvNum(l.paid_subscribers) + ' payants) · ' + rvEur(l.revenue_ttc) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function(e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; });
}

// ---------- ventes ----------
function rvSales(b) {
  if (rv.status && rv.status.sales_enabled === false) {
    b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Ventes non disponibles</div><div style="color:var(--text-tertiary);font-size:13px;max-width:460px;margin:auto">Ta clé n\'a pas l\'accès « Ventes une par une ». Dans Reveal > Paramètres > CRM / API, clique sur « Ajouter les ventes » sur ta clé (sans la changer), puis « Actualiser » ici.</div></div>';
    return;
  }
  rvApi('GET', '/sales?limit=200').then(function(o) {
    b.innerHTML = '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:14px;align-items:start" class="rv-sales-grid">'
      + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Quand</th><th style="text-align:left">Modèle</th><th style="text-align:left">Type</th><th style="text-align:left">Fan</th><th style="text-align:left">Chatteur</th><th>Montant</th></tr></thead><tbody>'
      + (o.sales.length ? o.sales.map(function(s) {
        var ref = s.status === 'refunded';
        return '<tr' + (ref ? ' style="opacity:.55"' : '') + '><td style="text-align:left;white-space:nowrap">' + new Date(s.sale_created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) + '</td>'
          + '<td style="text-align:left">' + rvEsc(s.model_name || '') + '</td><td style="text-align:left">' + (RV_TYPES[s.type] || rvEsc(s.type)) + (ref ? ' <span style="color:var(--accent-red)">remboursé</span>' : s.status === 'refund_asked' ? ' <span style="color:var(--accent-yellow)">remb. demandé</span>' : '') + '</td>'
          + '<td style="text-align:left">' + rvEsc(s.fan_username || '–') + '</td><td style="text-align:left">' + rvEsc(((s.chatter_first || '') + ' ' + (s.chatter_last || '')).trim() || '–') + '</td>'
          + '<td style="font-weight:600;white-space:nowrap">' + rvEur(s.amount_ttc) + '<div style="font-size:11px;font-weight:400;color:var(--text-tertiary)">net ' + rvEur(s.net_amount) + '</div></td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:24px">Pas encore de vente relevée</td></tr>')
      + '</tbody></table></div>'
      + '<div class="panel" style="padding:16px"><div style="font-weight:600;margin-bottom:10px">Meilleurs fans (31 jours)</div>' + (o.topFans.length ? o.topFans.map(function(f, i) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><div><b>' + (i + 1) + '.</b> ' + rvEsc(f.fan_username) + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(f.model_name || '') + ' · ' + f.n + ' achat(s)</div></div><div style="font-weight:600">' + rvEur(f.total) + '</div></div>';
      }).join('') : '<div style="color:var(--text-tertiary);font-size:13px">Rien pour l\'instant</div>')
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:10px">Chaque fan qui achète est ajouté au Fan CRM de la modèle, avec son total dépensé.</div></div></div>';
  }).catch(function(e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; });
}

// ---------- réglages ----------
function rvSettings(b) {
  var s = rv.status || {};
  var html = '<div class="panel" style="padding:18px;margin-bottom:14px">'
    + '<div style="font-weight:700;font-size:15px;margin-bottom:4px">Clé API Reveal</div>';
  if (s.connected) {
    html += '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Clé enregistrée <code>rvl_…' + rvEsc(s.key_last4) + '</code>, connectée ' + rvAgo(s.connected_at) + '. Elle est chiffrée et ne s\'affiche plus.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" onclick="rvShowKeyForm()">Remplacer la clé</button><button class="btn btn-ghost" style="color:var(--accent-red)" onclick="rvRemoveKey()">Déconnecter</button></div>'
      + '<div id="rv-keyform"></div>';
  } else {
    html += '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.7;margin:6px 0 12px">'
      + '<li>Sur <b>dashboard.reveal.me</b> : Paramètres → <b>CRM / API</b> → <b>Créer une clé</b>.</li>'
      + '<li>Coche l\'accès <b>Statistiques</b> et <b>Ventes une par une</b> (pour les ventes et le Fan CRM), pour toute l\'agence.</li>'
      + '<li>Copie la clé (elle ne s\'affiche qu\'une fois) et colle-la ici.</li></ol><div id="rv-keyform"></div>';
  }
  html += '</div>';
  if (s.connected) {
    html += '<div class="panel" style="padding:18px;margin-bottom:14px"><div style="font-weight:700;font-size:15px;margin-bottom:10px">Options</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">'
      + '<div class="form-group"><label class="form-label">Objectifs de CA des modèles : « réalisé » =</label><select class="form-input" id="rv-objbase">'
      + [['net', 'CA net (agence + modèle)'], ['ttc', 'CA TTC (ce que les fans paient)'], ['ht', 'CA HT'], ['agency', 'Part agence']].map(function(o) { return '<option value="' + o[0] + '"' + (s.objectives_base === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="form-group"><label class="form-label">WhatsApp pour chaque vente d\'au moins (€)</label><input class="form-input" id="rv-alertmin" type="number" min="0" step="1" placeholder="Vide = pas d\'alerte" value="' + (s.sale_alert_min != null ? s.sale_alert_min : '') + '"></div>'
      + '<div class="form-group"><label class="form-label">Shifts remplis par Reveal à partir du</label><input class="form-input" id="rv-shiftsince" type="date" value="' + (s.shifts_since ? String(s.shifts_since).slice(0, 10) : '') + '">'
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Avant cette date, les saisies manuelles restent. Pas plus de 31 jours en arrière.</div></div>'
      + '</div><button class="btn btn-primary" onclick="rvSaveOptions()">Enregistrer</button></div>'
      + '<div class="panel" style="padding:18px"><div style="font-weight:700;font-size:15px;margin-bottom:4px">Modèles Reveal ↔ CRM</div><div style="font-size:13px;color:var(--text-tertiary);margin-bottom:12px">Reliées automatiquement par le nom ou la page auto-post. Corrige ici si besoin.</div><div id="rv-modelmap">Chargement…</div></div>';
  }
  b.innerHTML = html;
  if (!s.connected) rvShowKeyForm();
  if (s.connected) rvApi('GET', '/models').then(function(o) {
    document.getElementById('rv-modelmap').innerHTML = o.reveal.length ? o.reveal.map(function(m) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">'
        + (m.avatar_url ? '<img src="' + rvEsc(m.avatar_url) + '" style="width:30px;height:30px;border-radius:50%;object-fit:cover">' : '')
        + '<div style="flex:1;min-width:0"><div style="font-weight:600">' + rvEsc(m.display_name) + ' <span style="font-weight:400;color:var(--text-tertiary)">@' + rvEsc(m.user_name) + '</span></div>'
        + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvNum(m.subscribers_count) + ' abonnés · ' + rvEsc(m.status || '') + '</div></div>'
        + '<select class="form-input" style="max-width:200px" onchange="rvMapModel(\'' + m.reveal_model_id + '\', this.value)"><option value="">— pas reliée —</option>'
        + o.crm.map(function(c) { return '<option value="' + c.id + '"' + (String(m.crm_model_id) === String(c.id) ? ' selected' : '') + '>' + rvEsc(c.name) + '</option>'; }).join('') + '</select></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">Aucune modèle trouvée sur Reveal.</div>';
  });
}
function rvShowKeyForm() {
  var f = document.getElementById('rv-keyform');
  if (!f) return;
  f.innerHTML = '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><input class="form-input" id="rv-key" type="password" autocomplete="off" placeholder="rvl_…" style="flex:1;min-width:240px">'
    + '<button class="btn btn-primary" id="rv-keybtn" onclick="rvSaveKey()">Connecter</button></div>'
    + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">La clé est vérifiée auprès de Reveal puis enregistrée chiffrée. Elle permet seulement de lire tes statistiques et tes ventes.</div>';
}
function rvSaveKey() {
  var k = document.getElementById('rv-key').value.trim();
  if (!k) return rvToast('Colle la clé d\'abord', 'error');
  var btn = document.getElementById('rv-keybtn'); btn.disabled = true; btn.textContent = 'Connexion et import des 31 derniers jours…';
  rvApi('POST', '/key', { key: k }).then(function(r) {
    rvToast(r.ok === false ? 'Clé enregistrée, mais : ' + r.error : 'API Reveal connectée, 31 derniers jours importés', r.ok === false ? 'error' : 'success');
    return rvLoadStatus().then(function() { rvTab('overview'); });
  }).catch(function(e) { btn.disabled = false; btn.textContent = 'Connecter'; rvToast(e.message, 'error'); });
}
function rvRemoveKey() {
  if (!confirm('Déconnecter l\'API Reveal ? Les données déjà importées restent, mais plus rien ne se met à jour et les chatteurs devront ressaisir leurs PPV.')) return;
  rvApi('DELETE', '/key').then(function() { rvToast('API Reveal déconnectée', 'success'); rvLoadStatus().then(function() { rvBody(); }); });
}
function rvSaveOptions() {
  rvApi('PUT', '/options', { objectives_base: document.getElementById('rv-objbase').value, sale_alert_min: document.getElementById('rv-alertmin').value, shifts_since: document.getElementById('rv-shiftsince').value })
    .then(function() { rvToast('Options enregistrées', 'success'); rvLoadStatus(); }).catch(function(e) { rvToast(e.message, 'error'); });
}
function rvMapModel(id, crmId) {
  rvApi('PUT', '/models/' + id + '/map', { crm_model_id: crmId || null }).then(function() { rvToast('Correspondance enregistrée', 'success'); rvLoadStatus(); })
    .catch(function(e) { rvToast(e.message, 'error'); });
}

// ---------- encart sur le Dashboard (admin) ----------
function rvGoTo(tab) {
  rv.tab = tab || 'overview';
  var nav = document.querySelector('.nav-item[data-section="reveal"]');
  if (nav) nav.click();
}
function rvDashWidget() {
  var box = document.getElementById('dashboard-reveal');
  if (!box) return;
  rvApi('GET', '/status').then(function(s) {
    rv.status = s;
    if (!s.connected) {
      box.innerHTML = '<div class="panel" style="padding:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'
        + '<div><div style="font-weight:700">Stats Reveal</div><div style="font-size:13px;color:var(--text-tertiary)">Connecte l\'API Reveal pour voir ton CA en direct ici.</div></div>'
        + '<button class="btn btn-primary" onclick="rvGoTo(\'settings\')">Connecter</button></div>';
      return;
    }
    var today = rvParis(0), yest = rvParis(-1), month = today.slice(0, 8) + '01';
    return Promise.all([
      rvApi('GET', '/overview?from=' + (yest < month ? yest : month) + '&to=' + today),
      rvApi('GET', '/chatters?from=' + month + '&to=' + today),
      s.sales_enabled === false ? Promise.resolve({ sales: [] }) : rvApi('GET', '/sales?limit=6'),
    ]).then(function(r) {
      var daily = r[0].daily, models = r[0].models;
      var day = function(d) { return daily.find(function(x) { return x.d === d; }) || { net: 0, ttc: 0, agency: 0, new_subs: 0 }; };
      var td = day(today), yd = day(yest);
      var m = daily.filter(function(x) { return x.d >= month; }).reduce(function(a, x) {
        a.net += Number(x.net); a.agency += Number(x.agency); a.ttc += Number(x.ttc); a.subs += Number(x.new_subs); return a;
      }, { net: 0, agency: 0, ttc: 0, subs: 0 });
      // le CA par modèle couvre hier + le mois : on garde le mois seulement si hier est dans le mois
      var modelsMonth = yest < month ? null : models;
      var chatters = r[1].chatters.filter(function(c) { return !c.is_bot && Number(c.net) > 0; }).slice(0, 5);
      var row = function(left, sub, right) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + left + '</div>'
          + (sub ? '<div style="font-size:11px;color:var(--text-tertiary)">' + sub + '</div>' : '') + '</div><div style="font-weight:600;white-space:nowrap">' + right + '</div></div>';
      };
      var empty = '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">Rien pour l\'instant</div>';
      var col = function(title, tab, body) {
        return '<div class="panel" style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-weight:600">' + title + '</div>'
          + '<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="rvGoTo(\'' + tab + '\')">Tout voir</button></div>' + body + '</div>';
      };
      box.innerHTML = '<div style="margin-bottom:20px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">'
        + '<div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:' + (s.last_error ? 'var(--accent-red)' : 'var(--accent-green)') + '"></span>Reveal'
        + '<span style="font-weight:400;font-size:12px;color:var(--text-tertiary)">' + (s.last_error ? rvEsc(s.last_error) : 'à jour ' + rvAgo(s.last_sync_at)) + '</span></div>'
        + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="rvGoTo(\'overview\')">Stats Reveal →</button></div>'
        + '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
        + rvStat('CA net aujourd\'hui', rvEur(td.net), 'Hier (journée entière) : ' + rvEur(yd.net))
        + rvStat('CA net ce mois', rvEur(m.net), 'TTC : ' + rvEur(m.ttc))
        + rvStat('Part agence ce mois', rvEur(m.agency), null, 'var(--accent-green)')
        + rvStat('Nouveaux abonnés aujourd\'hui', rvNum(td.new_subs), rvNum(m.subs) + ' ce mois')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:14px;align-items:start">'
        + (modelsMonth ? col('Modèles ce mois', 'overview', modelsMonth.filter(function(x) { return Number(x.net) > 0; }).slice(0, 5).map(function(x) {
            return row(rvEsc(x.display_name || x.user_name), rvNum(x.new_subs) + ' nouveaux abonnés', rvEur(x.net));
          }).join('') || empty) : '')
        + col('Top chatteurs du mois', 'chatters', chatters.map(function(c, i) {
            return row((i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : '') + rvEsc((c.first_name || '') + ' ' + (c.last_name || '')), rvNum(c.ppv_purchased) + ' PPV · ' + rvNum(c.tips) + ' pourboires', rvEur(c.net));
          }).join('') || empty)
        + (s.sales_enabled === false ? '' : col('Dernières ventes', 'sales', r[2].sales.map(function(x) {
            var when = new Date(x.sale_created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
            return row(rvEsc(x.model_name || '') + ' · ' + (RV_TYPES[x.type] || rvEsc(x.type)), when + (x.fan_username ? ' · ' + rvEsc(x.fan_username) : '') + (x.status === 'refunded' ? ' · <span style="color:var(--accent-red)">remboursé</span>' : ''), rvEur(x.amount_ttc));
          }).join('') || empty))
        + '</div></div>';
    });
  }).catch(function() { box.innerHTML = ''; });
}
