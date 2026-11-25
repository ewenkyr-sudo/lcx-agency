// TELEGRAM MODULE — données Wysper (ventes, nouveaux contacts, équipe, liens de tracking)
// Réutilise les petites fonctions de reveal.js (rvEsc, rvEur, rvNum, rvStat, rvAgo, rvParis, rvToast).

var tg = { tab: 'overview', period: '30d', status: null, account: '', accounts: [] };

function tgApi(method, url, body) {
  return fetch('/api/wysper' + url, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); });
}
function tgRange() { return periodRange(tg.period, tg.from, tg.to); }
function tgQs() { var r = tgRange(); return '?from=' + r.from + '&to=' + r.to + (tg.account ? '&account=' + encodeURIComponent(tg.account) : ''); }
function tgCurAccount() { return tg.accounts.find(function(a) { return a.telegram_id === tg.account; }); }
function tgName(a) { return a ? (a.crm_name || a.name || 'Compte') : ''; }
function tgDot(a) { return '<span style="width:8px;height:8px;border-radius:50%;background:' + modelColor(a.crm_model_id, tgName(a)) + ';flex-shrink:0"></span>'; }
var TG_STATUS = { paid: '', refunded: '<span style="color:var(--accent-red)">remboursé</span>', disputed: '<span style="color:var(--accent-yellow)">litige</span>' };
var TG_TYPES = { ppv: 'PPV', tip: 'Pourboire', custom: 'Perso', subscription: 'Abonnement' };

function renderTelegram() {
  var c = document.getElementById('telegram-content');
  if (!c) return;
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="tg-status"></div><div id="tg-accounts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"></div>'
      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap" id="tg-tabs">' + [['overview', 'Vue d\'ensemble'], ['team', 'Équipe'], ['tracking', 'Liens de tracking'], ['sales', 'Ventes'], ['settings', 'Réglages']].filter(function(t) { return !(isPartner() && t[0] === 'settings'); }).map(function(t) {
        return '<button class="filter-chip' + (tg.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '" onclick="tgTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>'
      + '<div id="tg-period">' + periodPickerHtml('tg-pp', tg.period, tg.from, tg.to, function(v, f, t) { tg.period = v; tg.from = f; tg.to = t; tgBody(); }) + '</div>'
      + '</div><div id="tg-body"><div class="skeleton-card" style="height:180px"></div></div>';
  }
  tgLoadStatus().then(function() {
    if (!tg.status.connected && tg.tab !== 'settings') tg.tab = isPartner() ? 'overview' : 'settings';
    if (isPartner() && tg.tab === 'settings') tg.tab = 'overview';
    tgTab(tg.tab);
    if (tg.status.connected) tgLoadAccounts();
  });
}

function tgLoadAccounts() {
  return tgApi('GET', '/accounts').then(function(o) {
    tg.accounts = o.accounts || []; tg.crm = o.crm || [];
    if (tg.account && !tgCurAccount()) tg.account = '';
    tgRenderChips();
  }).catch(function() {});
}
function tgRenderChips() {
  var el = document.getElementById('tg-accounts');
  if (!el) return;
  if (!tg.status || !tg.status.connected || tg.accounts.length < 2) { el.innerHTML = ''; return; }
  var chip = function(id, label, a) {
    return '<button class="filter-chip' + (tg.account === id ? ' active' : '') + '" style="display:inline-flex;align-items:center;gap:6px" onclick="tgSetAccount(\'' + id + '\')">' + rvEsc(label) + (a ? tgDot(a) : '') + '</button>';
  };
  el.innerHTML = chip('', 'Tous les comptes') + tg.accounts.map(function(a) { return chip(a.telegram_id, tgName(a), a); }).join('');
}
function tgSetAccount(id) { tg.account = id || ''; tgRenderChips(); if (tg.tab === 'settings') tg.tab = 'overview'; tgTab(tg.tab); }
function tgTab(t) {
  tg.tab = t;
  document.querySelectorAll('#tg-tabs .filter-chip').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === t); });
  var p = document.getElementById('tg-period'); if (p) p.style.visibility = (t === 'settings' || t === 'sales') ? 'hidden' : 'visible';
  var mc = document.getElementById('tg-accounts'); if (mc) mc.style.display = t === 'settings' ? 'none' : 'flex';
  tgBody();
}

function tgLoadStatus() {
  return tgApi('GET', '/status').then(function(s) {
    tg.status = s;
    var el = document.getElementById('tg-status');
    if (!el) return;
    if (!s.connected) { el.innerHTML = ''; return; }
    if (isPartner()) { el.innerHTML = '<div style="font-size:13px;color:var(--text-secondary)">Données à jour ' + rvAgo(s.last_sync_at) + '</div>'; return; }
    var warn = [];
    if (s.last_error) warn.push('<span style="color:var(--accent-red)">⚠️ ' + rvEsc(s.last_error) + '</span> <span style="color:var(--text-tertiary)">(' + rvAgo(s.last_error_at) + ')</span>');
    if (s.counts.accounts_unmapped) warn.push(s.counts.accounts_unmapped + ' compte(s) Telegram pas relié(s) à une modèle → onglet Réglages');
    if (!s.secret_set) warn.push('Temps réel pas branché : les ventes arrivent toutes les 5 min → onglet Réglages, étape 2');
    el.innerHTML = '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-secondary)">'
      + '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + (s.last_error ? 'var(--accent-red)' : 'var(--accent-green)') + '"></span>Wysper connecté</span>'
      + '<span>Synchro ' + rvAgo(s.last_sync_at) + '</span>' + (s.secret_set ? '<span>Temps réel : dernier événement ' + rvAgo(s.last_event_at) + '</span>' : '')
      + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="tgSyncNow(this)">Actualiser</button></div>'
      + (warn.length ? '<div style="margin-top:10px;padding:10px 14px;border-radius:10px;background:var(--accent-yellow-bg);color:var(--accent-yellow-light);font-size:13px;line-height:1.6">' + warn.join('<br>') + '</div>' : '');
  });
}
function tgSyncNow(btn) {
  btn.disabled = true; btn.textContent = 'Synchro…';
  tgApi('POST', '/sync').then(function(r) { rvToast(r.ok === false ? r.error : 'Données Telegram à jour', r.ok === false ? 'error' : 'success'); })
    .catch(function(e) { rvToast(e.message, 'error'); })
    .then(function() { tgLoadStatus(); tgLoadAccounts(); tgBody(); });
}
function tgBody() {
  var b = document.getElementById('tg-body');
  if (!b) return;
  b.innerHTML = '<div class="skeleton-card" style="height:180px"></div>';
  ({ overview: tgOverview, team: tgTeam, tracking: tgTracking, sales: tgSales, settings: tgSettings }[tg.tab] || tgOverview)(b);
}
function tgErr(b, e) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + rvEsc(e.message) + '</div></div>'; }

// ---------- vue d'ensemble ----------
function tgOverview(b) {
  tgApi('GET', '/overview' + tgQs()).then(function(o) {
    var t = o.totals, l = o.ltv || {}, cur = tgCurAccount();
    var mois = function(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : ''; };
    var conv = t.contacts ? Math.round(t.first_buyers / t.contacts * 100) : null;
    b.innerHTML = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      + rvStat('CA TTC', rvEur(t.gross), 'Net : ' + rvEur(t.net))
      + rvStat('Ventes', rvNum(t.sales), rvNum(t.buyers) + ' acheteur' + (t.buyers > 1 ? 's' : '') + (t.sales ? ' · panier ' + rvEur(Math.round(t.gross / t.sales)) : ''))
      + rvStat('Nouveaux contacts', rvNum(t.contacts), rvNum(t.first_buyers) + ' 1er(s) achat(s)' + (conv != null ? ' · ' + conv + ' %' : ''))
      + rvStat('LTV par contact', l.contact != null ? rvEur(l.contact) : '–', (l.buyer != null ? 'Fan payeur : ' + rvEur(l.buyer) + ' (' + rvNum(l.buyers) + ')' : 'Pas encore de ventes') + (l.since ? ' · depuis ' + mois(l.since) : ''), 'var(--accent-blue)')
      + (t.refunds || t.disputes ? rvStat('Remboursements', rvNum(t.refunds), rvEur(t.refunded) + (t.disputes ? ' · ' + t.disputes + ' litige(s)' : ''), 'var(--accent-red)') : '')
      + '</div>'
      + '<div class="panel" style="padding:16px;margin:14px 0"><div style="font-weight:700;font-size:15px">Revenu journalier</div><div id="tg-daily-sub" style="font-size:12px;color:var(--text-tertiary);margin:2px 0 8px"></div><div style="position:relative;height:240px"><canvas id="tg-daily-chart"></canvas></div></div>'
      + (cur ? '' : '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Compte</th><th>CA TTC</th><th>Net</th><th>Ventes</th><th>Nouv. contacts</th><th title="CA TTC total ÷ fans qui ont écrit, sur tout l\'historique">LTV contact</th><th title="CA TTC total ÷ fans qui ont payé">LTV fan payeur</th></tr></thead><tbody>'
        + (o.accounts.length ? o.accounts.map(function(a) {
          return '<tr style="cursor:pointer" onclick="tgSetAccount(\'' + a.telegram_id + '\')"><td style="text-align:left"><div style="display:flex;align-items:center;gap:8px">' + tgDot(a)
            + '<div><div style="font-weight:600">' + rvEsc(tgName(a)) + '</div><div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(a.name) + (a.crm_name ? '' : ' · <span style="color:var(--accent-yellow)">pas reliée au CRM</span>') + (a.status === 'disconnected' ? ' · <span style="color:var(--accent-red)">déconnecté</span>' : '') + '</div></div></div></td>'
            + '<td style="font-weight:600">' + rvEur(a.gross) + '</td><td>' + rvEur(a.net) + '</td><td>' + rvNum(a.sales) + '</td><td>' + rvNum(a.contacts) + '</td>'
            + '<td style="font-weight:600">' + (a.ltv_contact != null ? rvEur(a.ltv_contact) : '–') + '</td><td>' + (a.ltv_buyer != null ? rvEur(a.ltv_buyer) : '–') + '</td></tr>';
        }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">Aucun compte Telegram</td></tr>')
        + '</tbody></table><div style="font-size:12px;color:var(--text-tertiary);padding:10px 14px">Clique sur un compte pour voir ses stats seules.</div></div>');
    tgDaily();
  }).catch(function(e) { tgErr(b, e); });
}
function tgDaily() {
  var today = rvParis(0), canvas = document.getElementById('tg-daily-chart'), sub = document.getElementById('tg-daily-sub');
  if (!tg.account) {
    tgApi('GET', '/daily-by-model?from=' + today.slice(0, 8) + '01&to=' + today).then(function(o) {
      var mc = modelDailyChart(canvas, o.rows.map(function(r) { return { d: r.d, key: r.key, name: r.name, crmId: r.crm_model_id, v: Number(r.gross) / 100 }; }), today, { what: 'CA TTC par compte' });
      if (mc && sub) sub.textContent = mc.subtitle;
    }).catch(function() {});
    return;
  }
  var pd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  tgApi('GET', '/overview?from=' + pd + '&to=' + today + '&account=' + encodeURIComponent(tg.account)).then(function(o) {
    var mc = monthCompareChart(canvas, o.daily.map(function(x) { return { d: x.d, v: Number(x.gross) / 100 }; }), today, { what: 'CA TTC' });
    if (mc && sub) sub.textContent = mc.subtitle;
  }).catch(function() {});
}

// ---------- équipe ----------
function tgTeam(b) {
  tgApi('GET', '/team' + tgQs()).then(function(o) {
    b.innerHTML = '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Membre</th><th>CA TTC</th><th>Net</th><th>Ventes</th><th>Acheteurs</th><th>Panier moyen</th></tr></thead><tbody>'
      + (o.members.length ? o.members.map(function(m, i) {
        return '<tr><td style="text-align:left;font-weight:600">' + (i < 3 && m.gross > 0 ? ['🥇', '🥈', '🥉'][i] + ' ' : '') + rvEsc(m.name) + '</td><td style="font-weight:600">' + rvEur(m.gross) + '</td><td>' + rvEur(m.net) + '</td><td>' + rvNum(m.sales) + '</td><td>' + rvNum(m.buyers) + '</td><td>' + (m.sales ? rvEur(Math.round(m.gross / m.sales)) : '–') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:24px">Pas de vente sur la période</td></tr>')
      + '</tbody></table><div style="font-size:12px;color:var(--text-tertiary);padding:10px 14px">Chaque vente est comptée au membre qui a envoyé le PPV dans Wysper.</div></div>';
  }).catch(function(e) { tgErr(b, e); });
}

// ---------- liens de tracking (lus en direct chez Wysper) ----------
function tgTracking(b) {
  tgApi('GET', '/tracking' + tgQs()).then(function(o) {
    var links = [];
    (o.accounts || []).forEach(function(a) { (a.links || []).forEach(function(l) { links.push(Object.assign({ _acc: a.name || (a.account && a.account.name) }, l)); }); });
    if (!links.length) links = o.links || [];
    if (!links.length) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucun lien de tracking</div><div style="color:var(--text-tertiary);font-size:13px">Ils se créent dans Wysper (Canal > Liens de tracking).</div></div>'; return; }
    links.sort(function(x, y) { return (Number(y.brut_cents) || 0) - (Number(x.brut_cents) || 0); });
    b.innerHTML = '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Lien</th><th>Arrivées</th><th>Contacts</th><th>Acheteurs</th><th>Ventes</th><th>CA TTC</th><th title="CA TTC du lien ÷ contacts venus par le lien">LTV contact</th></tr></thead><tbody>'
      + links.map(function(l) {
        return '<tr' + (l.revoked || l.gone ? ' style="opacity:.55"' : '') + '><td style="text-align:left"><div style="font-weight:600">' + rvEsc(l.name || l.url_masked || 'Lien') + (l.revoked ? ' <span style="color:var(--accent-red);font-weight:400;font-size:11px">révoqué</span>' : '') + '</div>'
          + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(l.url_masked || l.url || '') + (l._acc ? ' · ' + rvEsc(l._acc) : '') + '</div></td>'
          + '<td>' + rvNum(l.arrivals) + '</td><td>' + rvNum(l.contacts) + '</td><td>' + rvNum(l.buyers) + '</td><td>' + rvNum(l.sales) + '</td><td style="font-weight:600">' + rvEur(l.brut_cents) + '</td>'
          + '<td>' + (Number(l.contacts) ? rvEur(Math.round(Number(l.brut_cents) / Number(l.contacts))) : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function(e) { tgErr(b, e); });
}

// ---------- ventes ----------
function tgSales(b) {
  tgApi('GET', '/sales?limit=200' + (tg.account ? '&account=' + encodeURIComponent(tg.account) : '')).then(function(o) {
    b.innerHTML = '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:14px;align-items:start" class="rv-sales-grid">'
      + '<div class="panel" style="padding:0;overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Quand</th><th style="text-align:left">Compte</th><th style="text-align:left">Type</th><th style="text-align:left">Fan</th><th style="text-align:left">Envoyé par</th><th>Montant</th></tr></thead><tbody>'
      + (o.sales.length ? o.sales.map(function(s) {
        var off = s.status !== 'paid';
        return '<tr' + (off ? ' style="opacity:.6"' : '') + '><td style="text-align:left;white-space:nowrap">' + new Date(s.paid_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) + '</td>'
          + '<td style="text-align:left">' + rvEsc(s.model_name || '') + '</td><td style="text-align:left">' + (TG_TYPES[s.type] || rvEsc(s.type || '')) + ' ' + (TG_STATUS[s.status] || '') + (s.buyer_first ? ' <span style="color:var(--accent-green)">1er achat</span>' : '') + '</td>'
          + '<td style="text-align:left">' + rvEsc(s.buyer_username ? '@' + s.buyer_username : 'tg:' + s.buyer_tid) + (s.source_link ? '<div style="font-size:11px;color:var(--text-tertiary)">via ' + rvEsc(s.source_link) + '</div>' : '') + '</td>'
          + '<td style="text-align:left">' + rvEsc(s.sent_by_name || '–') + '</td>'
          + '<td style="font-weight:600;white-space:nowrap">' + (s.currency && s.currency !== 'EUR' ? ((Number(s.gross_cents) || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: s.currency }) : rvEur(s.gross_cents)) + '<div style="font-size:11px;font-weight:400;color:var(--text-tertiary)">net ' + rvEur(s.net_cents) + '</div></td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:24px">Pas encore de vente</td></tr>')
      + '</tbody></table></div>'
      + '<div class="panel" style="padding:16px"><div style="font-weight:600;margin-bottom:10px">Meilleurs fans (31 jours)</div>' + (o.topFans.length ? o.topFans.map(function(f, i) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><div><b>' + (i + 1) + '.</b> ' + rvEsc(f.fan) + '<div style="font-size:11px;color:var(--text-tertiary)">' + rvEsc(f.model_name || '') + ' · ' + f.n + ' achat(s)</div></div><div style="font-weight:600">' + rvEur(f.total) + '</div></div>';
      }).join('') : '<div style="color:var(--text-tertiary);font-size:13px">Rien pour l\'instant</div>')
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:10px">Chaque fan qui achète est ajouté au Fan CRM de la modèle (plateforme Telegram), avec son total dépensé.</div></div></div>';
  }).catch(function(e) { tgErr(b, e); });
}

// ---------- réglages ----------
function tgSettings(b) {
  var s = tg.status || {};
  var step = function(n, title, body) { return '<div class="panel" style="padding:18px;margin-bottom:14px"><div style="font-weight:700;font-size:15px;margin-bottom:6px">' + n + '. ' + title + '</div>' + body + '</div>'; };
  var html = step(1, 'Clé d\'accès Wysper', s.connected
    ? '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Clé enregistrée <code>wsk_live_…' + rvEsc(s.key_last4) + '</code>, connectée ' + rvAgo(s.connected_at) + '. Elle est chiffrée et ne s\'affiche plus.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" onclick="tgKeyForm()">Remplacer la clé</button><button class="btn btn-ghost" style="color:var(--accent-red)" onclick="tgRemoveKey()">Déconnecter</button></div><div id="tg-keyform"></div>'
    : '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.7;margin:6px 0 4px">'
      + '<li>Dans <b>Wysper</b> : <b>Intégrations</b> → <b>Clés d\'accès</b> → <b>Créer une clé</b> (tu peux la créer « sans le portefeuille »).</li>'
      + '<li>Copie la clé (elle ne s\'affiche qu\'une fois) et colle-la ici. Tout l\'historique est importé.</li></ol><div id="tg-keyform"></div>');
  if (s.connected) {
    html += step(2, 'Ventes en temps réel', '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:10px">Sans ça, les ventes arrivent toutes les 5 minutes. Avec, elles arrivent à la seconde (et les alertes WhatsApp aussi).</div>'
      + '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.8;margin:0 0 10px">'
      + '<li>Copie cette adresse : <div style="display:flex;gap:6px;margin:6px 0"><input class="form-input" readonly value="' + rvEsc(s.webhook_url || '') + '" style="flex:1;font-family:monospace;font-size:12px" onclick="this.select()"><button class="btn btn-secondary" onclick="navigator.clipboard.writeText(\'' + rvEsc(s.webhook_url || '') + '\');rvToast(\'Adresse copiée\',\'success\')">Copier</button></div></li>'
      + '<li>Dans <b>Wysper</b> : <b>Intégrations</b> → <b>Événements en temps réel</b> → <b>Ajouter une adresse</b>, colle-la et coche tous les événements.</li>'
      + '<li>Wysper affiche un <b>secret de signature</b> (<code>whsec_…</code>) : colle-le ici.</li></ol>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="form-input" id="tg-secret" type="password" autocomplete="off" placeholder="' + (s.secret_set ? 'Secret enregistré — colle-en un nouveau pour le remplacer' : 'whsec_…') + '" style="flex:1;min-width:240px">'
      + '<button class="btn btn-primary" onclick="tgSaveSecret()">Enregistrer</button>' + (s.secret_set ? '<button class="btn btn-secondary" id="tg-testbtn" onclick="tgTestHook()">Tester</button>' : '') + '</div>'
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">' + (s.secret_set ? '✅ Secret enregistré · dernier événement reçu : ' + (s.last_event_at ? rvAgo(s.last_event_at) + ' (' + rvEsc(s.last_event_type) + ')' : 'aucun pour l\'instant') : 'Chaque événement est vérifié avec ce secret : personne d\'autre ne peut envoyer de fausses ventes au CRM.') + '</div>');
    html += step(3, 'Options', '<div class="form-group" style="max-width:320px"><label class="form-label">WhatsApp pour chaque vente d\'au moins (€)</label><input class="form-input" id="tg-alertmin" type="number" min="0" step="1" placeholder="Vide = pas d\'alerte" value="' + (s.sale_alert_min != null ? s.sale_alert_min : '') + '"></div><button class="btn btn-primary" onclick="tgSaveOptions()">Enregistrer</button>');
    html += step(4, 'Comptes Telegram ↔ modèles', '<div style="font-size:13px;color:var(--text-tertiary);margin-bottom:10px">Reliés automatiquement par le nom. Corrige ici si besoin : c\'est ce qui donne la couleur, le Fan CRM et l\'accès des associés.</div><div id="tg-map">Chargement…</div>');
  }
  b.innerHTML = html;
  if (!s.connected) tgKeyForm();
  else tgApi('GET', '/accounts').then(function(o) {
    document.getElementById('tg-map').innerHTML = o.accounts.length ? o.accounts.map(function(a) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle)"><div style="flex:1;min-width:0"><div style="font-weight:600">' + rvEsc(a.name) + '</div>'
        + '<div style="font-size:11px;color:var(--text-tertiary)">' + (a.status === 'disconnected' ? '<span style="color:var(--accent-red)">déconnecté de Wysper</span>' : 'actif') + ' · ' + rvEsc(a.currency || '') + '</div></div>'
        + '<select class="form-input" style="max-width:200px" onchange="tgMap(\'' + a.telegram_id + '\', this.value)"><option value="">— pas reliée —</option>'
        + o.crm.map(function(c) { return '<option value="' + c.id + '"' + (String(a.crm_model_id) === String(c.id) ? ' selected' : '') + '>' + rvEsc(c.name) + '</option>'; }).join('') + '</select></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">Aucun compte Telegram dans Wysper.</div>';
  });
}
function tgKeyForm() {
  var f = document.getElementById('tg-keyform');
  if (!f) return;
  f.innerHTML = '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><input class="form-input" id="tg-key" type="password" autocomplete="off" placeholder="wsk_live_…" style="flex:1;min-width:240px">'
    + '<button class="btn btn-primary" id="tg-keybtn" onclick="tgSaveKey()">Connecter</button></div>'
    + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">La clé est vérifiée auprès de Wysper puis enregistrée chiffrée. Elle permet seulement de lire (jamais les conversations ni les médias).</div>';
}
function tgSaveKey() {
  var k = document.getElementById('tg-key').value.trim();
  if (!k) return rvToast('Colle la clé d\'abord', 'error');
  var btn = document.getElementById('tg-keybtn'); btn.disabled = true; btn.textContent = 'Connexion et import de l\'historique…';
  tgApi('POST', '/key', { key: k }).then(function(r) {
    rvToast(r.ok === false ? 'Clé enregistrée, mais : ' + r.error : 'Wysper connecté, historique importé', r.ok === false ? 'error' : 'success');
    return tgLoadStatus().then(function() { tgLoadAccounts(); tgTab('settings'); });
  }).catch(function(e) { btn.disabled = false; btn.textContent = 'Connecter'; rvToast(e.message, 'error'); });
}
function tgRemoveKey() {
  if (!confirm('Déconnecter Wysper ? Les données déjà importées restent, mais plus rien ne se met à jour.')) return;
  tgApi('DELETE', '/key').then(function() { rvToast('Wysper déconnecté', 'success'); tgLoadStatus().then(tgBody); });
}
function tgSaveSecret() {
  var v = document.getElementById('tg-secret').value.trim();
  if (!v) return rvToast('Colle le secret d\'abord', 'error');
  tgApi('POST', '/secret', { secret: v }).then(function() { rvToast('Secret enregistré : clique sur « Tester »', 'success'); return tgLoadStatus().then(tgBody); })
    .catch(function(e) { rvToast(e.message, 'error'); });
}
function tgTestHook() {
  var btn = document.getElementById('tg-testbtn'); btn.disabled = true; btn.textContent = 'Test…';
  tgApi('POST', '/test-webhook').then(function(r) {
    rvToast(r.delivered ? 'Ça marche : Wysper a bien joint le CRM ✅' : 'Wysper n\'a pas pu joindre le CRM (réponse ' + (r.status_code || 'aucune') + ') : vérifie l\'adresse et le secret', r.delivered ? 'success' : 'error');
  }).catch(function(e) { rvToast(e.message, 'error'); }).then(function() { tgLoadStatus().then(tgBody); });
}
function tgSaveOptions() {
  tgApi('PUT', '/options', { sale_alert_min: document.getElementById('tg-alertmin').value }).then(function() { rvToast('Options enregistrées', 'success'); tgLoadStatus(); })
    .catch(function(e) { rvToast(e.message, 'error'); });
}
function tgMap(tid, crmId) {
  tgApi('PUT', '/accounts/' + tid + '/map', { crm_model_id: crmId || null }).then(function() { rvToast('Correspondance enregistrée', 'success'); tgLoadStatus(); tgLoadAccounts(); })
    .catch(function(e) { rvToast(e.message, 'error'); });
}
