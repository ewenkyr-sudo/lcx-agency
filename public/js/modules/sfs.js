// SFS : abonnés par modèle (Reveal + MyM) et planning des SFS en mass DM

var sfs = { week: null, platform: '', model: '', subs: [], pushes: [], partners: [] };
var SFS_PLAT = { reveal: 'Reveal', mym: 'MyM' };

function sfsEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function sfsNum(n) { return n == null ? '–' : Number(n).toLocaleString('fr-FR'); }
function sfsApi(method, url, body) {
  return fetch('/api/sfs' + url, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); });
}
function sfsToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function sfsMonday(d) { var x = new Date(d); var day = x.getDay(); x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)); x.setHours(0, 0, 0, 0); return x; }
function sfsYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function sfsTime(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function sfsModelById(id) { return (typeof allModels !== 'undefined' ? allModels : []).find(function(m) { return m.id === Number(id); }) || { id: id, name: '?' }; }

function renderSfs() {
  var c = document.getElementById('sfs-content');
  if (!c) return;
  if (!sfs.week) sfs.week = sfsMonday(new Date());
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="sfs-subs"><div class="skeleton-card" style="height:160px"></div></div>'
      + '<div id="sfs-late"></div>'
      + '<div class="panel" style="padding:16px;margin-top:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div style="font-weight:700;font-size:15px;margin-right:6px">Planning des SFS</div>'
      + '<button class="btn btn-ghost" style="padding:4px 10px" onclick="sfsMoveWeek(-1)">←</button>'
      + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="sfsMoveWeek(0)">Cette semaine</button>'
      + '<button class="btn btn-ghost" style="padding:4px 10px" onclick="sfsMoveWeek(1)">→</button>'
      + '<span id="sfs-week-label" style="font-size:13px;color:var(--text-secondary)"></span></div>'
      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
      + '<div id="sfs-plat-chips" style="display:flex;gap:4px"></div>'
      + '<select class="form-input" id="sfs-model-filter" style="max-width:170px;padding:6px 10px;font-size:13px" onchange="sfs.model=this.value;sfsLoadPushes()"></select>'
      + '<button class="btn btn-primary" onclick="sfsOpen()">+ Programmer un SFS</button></div></div>'
      + '<div id="sfs-week"></div></div>'
      + '<div class="panel" style="padding:16px;margin-top:16px"><div style="font-weight:700;font-size:15px;margin-bottom:10px">Partenaires</div><div id="sfs-partners"></div></div>';
  }
  sfsRenderFilters();
  sfsLoadSubs();
  sfsLoadPushes();
  sfsLoadPartners();
}

function sfsRenderFilters() {
  var chips = document.getElementById('sfs-plat-chips');
  if (chips) chips.innerHTML = [['', 'Tout'], ['reveal', 'Reveal'], ['mym', 'MyM']].map(function(p) {
    return '<button class="filter-chip' + (sfs.platform === p[0] ? ' active' : '') + '" onclick="sfs.platform=\'' + p[0] + '\';sfsRenderFilters();sfsLoadPushes()">' + p[1] + '</button>';
  }).join('');
  var sel = document.getElementById('sfs-model-filter');
  if (sel) sel.innerHTML = '<option value="">Toutes les modèles</option>' + (typeof allModels !== 'undefined' ? allModels : []).map(function(m) {
    return '<option value="' + m.id + '"' + (String(sfs.model) === String(m.id) ? ' selected' : '') + '>' + sfsEsc(m.name) + '</option>';
  }).join('');
}

// ---------- abonnés ----------
function sfsLoadSubs() {
  sfsApi('GET', '/subs').then(function(rows) {
    sfs.subs = rows;
    var tot = { rs: 0, rn: 0, ms: 0, mn: 0 };
    rows.forEach(function(m) {
      if (m.reveal) { tot.rs += m.reveal.subscribers || 0; tot.rn += m.reveal.new_30 || 0; }
      if (m.mym) { tot.ms += m.mym.subscribers || 0; tot.mn += m.mym.new_30 || 0; }
    });
    var block = function(m, p) {
      var d = m[p];
      var edit = (p === 'mym' || !d || d.source === 'manual') ? ' onclick="sfsEditSubs(' + m.id + ',\'' + p + '\')" style="cursor:pointer" title="Modifier"' : ' title="Chiffres de l\'API Reveal"';
      return '<div' + edit + ' class="sfs-plat"><div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em;display:flex;gap:6px;align-items:center">' + SFS_PLAT[p]
        + (d && d.source === 'api' ? '<span style="font-size:9px;padding:1px 5px;border-radius:6px;background:rgba(34,197,94,.12);color:var(--accent-green)">API</span>' : '<span style="font-size:10px;opacity:.7">✎</span>') + '</div>'
        + '<div style="font-size:22px;font-weight:800;font-family:var(--font-mono, monospace);margin-top:2px">' + sfsNum(d && d.subscribers) + '</div>'
        + '<div style="font-size:12px;color:' + (d && d.new_30 ? 'var(--accent-green)' : 'var(--text-tertiary)') + '">' + (d && d.new_30 != null ? '+' + sfsNum(d.new_30) + ' sur 30 j' : (d ? '30 j : –' : 'à renseigner')) + '</div></div>';
    };
    var el = document.getElementById('sfs-subs');
    if (!el) return;
    el.innerHTML = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">'
      + sfsStat('Abonnés Reveal', sfsNum(tot.rs), '+' + sfsNum(tot.rn) + ' sur 30 jours')
      + sfsStat('Abonnés MyM', sfsNum(tot.ms), '+' + sfsNum(tot.mn) + ' sur 30 jours')
      + sfsStat('Total', sfsNum(tot.rs + tot.ms), '+' + sfsNum(tot.rn + tot.mn) + ' sur 30 jours')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">' + rows.map(function(m) {
        var col = typeof modelColor === 'function' ? modelColor(m.id, m.name) : 'var(--accent)';
        return '<div class="panel" style="padding:14px;border-top:3px solid ' + col + '">'
          + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' + (typeof modelAvatarHtml === 'function' ? modelAvatarHtml(m, 34, false) : '')
          + '<div style="font-weight:700">' + sfsEsc(m.name) + '</div></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + block(m, 'reveal') + block(m, 'mym') + '</div></div>';
      }).join('') + '</div>'
      + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">Reveal se met à jour tout seul avec l\'API. MyM n\'a pas d\'API : clique sur le bloc MyM pour mettre à jour les chiffres.</div>';
  }).catch(function(e) { var el = document.getElementById('sfs-subs'); if (el) el.innerHTML = '<div class="empty-state">' + sfsEsc(e.message) + '</div>'; });
}
function sfsStat(label, v, sub) {
  return '<div class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value" style="font-size:24px">' + v + '</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">' + sub + '</div></div>';
}
function sfsEditSubs(modelId, p) {
  var m = sfs.subs.find(function(x) { return x.id === modelId; }) || {};
  var d = m[p] || {};
  sfsModal('Abonnés ' + SFS_PLAT[p] + ' · ' + sfsEsc(m.name),
    '<div class="form-group"><label class="form-label">Abonnés actuels</label><input class="form-input" id="sfs-s-subs" type="number" min="0" value="' + (d.subscribers != null ? d.subscribers : '') + '"></div>'
    + '<div class="form-group"><label class="form-label">Nouveaux abonnés sur les 30 derniers jours</label><input class="form-input" id="sfs-s-new" type="number" min="0" value="' + (d.new_30 != null ? d.new_30 : '') + '"></div>',
    '<button class="btn btn-primary" onclick="sfsSaveSubs(' + modelId + ',\'' + p + '\')">Enregistrer</button>');
}
function sfsSaveSubs(modelId, p) {
  sfsApi('PUT', '/subs/' + modelId + '/' + p, { subscribers: document.getElementById('sfs-s-subs').value, new_30: document.getElementById('sfs-s-new').value })
    .then(function() { sfsCloseModal(); sfsToast('Abonnés mis à jour', 'success'); sfsLoadSubs(); })
    .catch(function(e) { sfsToast(e.message, 'error'); });
}

// ---------- planning ----------
function sfsMoveWeek(n) {
  if (n === 0) sfs.week = sfsMonday(new Date());
  else { var d = new Date(sfs.week); d.setDate(d.getDate() + 7 * n); sfs.week = d; }
  sfsLoadPushes();
}
function sfsLoadPushes() {
  var end = new Date(sfs.week); end.setDate(end.getDate() + 7);
  var q = '?from=' + encodeURIComponent(sfs.week.toISOString()) + '&to=' + encodeURIComponent(end.toISOString())
    + (sfs.platform ? '&platform=' + sfs.platform : '') + (sfs.model ? '&model_id=' + sfs.model : '');
  var last = new Date(sfs.week); last.setDate(last.getDate() + 6);
  var lab = document.getElementById('sfs-week-label');
  if (lab) lab.textContent = 'du ' + sfs.week.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' au ' + last.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  sfsApi('GET', '/pushes' + q).then(function(rows) { sfs.pushes = rows; sfsRenderWeek(); }).catch(function(e) { sfsToast(e.message, 'error'); });
  // en retard : prévus, passés, pas encore faits (toutes semaines)
  sfsApi('GET', '/pushes?to=' + encodeURIComponent(new Date().toISOString())).then(function(rows) {
    var late = rows.filter(function(p) { return p.status === 'planned' && (!p.our_sent || !p.partner_sent); });
    var el = document.getElementById('sfs-late');
    if (!el) return;
    el.innerHTML = late.length ? '<div class="panel" style="padding:14px 16px;margin-top:16px;border-left:3px solid var(--accent-yellow)">'
      + '<div style="font-weight:700;margin-bottom:8px">À vérifier (' + late.length + ')</div>'
      + late.slice(-8).reverse().map(function(p) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:13px;cursor:pointer" onclick="sfsOpen(' + p.id + ')"><span>'
          + new Date(p.scheduled_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + sfsTime(p.scheduled_at) + ' · <b>' + sfsEsc(p.model_name) + '</b> × ' + sfsEsc(p.partner_name) + ' (' + SFS_PLAT[p.platform] + ')</span>'
          + '<span style="color:var(--text-tertiary)">' + (!p.our_sent ? 'notre DM pas coché' : 'DM partenaire pas reçu') + '</span></div>';
      }).join('') + '</div>' : '';
  }).catch(function() {});
}
function sfsRenderWeek() {
  var el = document.getElementById('sfs-week');
  if (!el) return;
  var today = sfsYmd(new Date());
  var days = [];
  for (var i = 0; i < 7; i++) { var d = new Date(sfs.week); d.setDate(d.getDate() + i); days.push(d); }
  el.innerHTML = '<div class="sfs-week-grid">' + days.map(function(d) {
    var ymd = sfsYmd(d);
    var items = sfs.pushes.filter(function(p) { return sfsYmd(new Date(p.scheduled_at)) === ymd; });
    return '<div class="sfs-day' + (ymd === today ? ' sfs-today' : '') + '">'
      + '<div class="sfs-day-head"><span>' + d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + d.getDate() + '</span>'
      + '<button class="btn btn-ghost" style="padding:0 6px;font-size:14px;line-height:1.4" title="Programmer ce jour-là" onclick="sfsOpen(null,\'' + ymd + '\')">+</button></div>'
      + (items.length ? items.map(sfsCard).join('') : '<div style="font-size:12px;color:var(--text-muted, #52525b);padding:6px 2px">—</div>')
      + '</div>';
  }).join('') + '</div>';
}
function sfsCard(p) {
  var col = typeof modelColor === 'function' ? modelColor(p.model_id, p.model_name) : 'var(--accent)';
  var st = p.status === 'cancelled' ? 'opacity:.45;text-decoration:line-through;' : '';
  var tick = function(ok, label) { return '<span title="' + label + '" style="color:' + (ok ? 'var(--accent-green)' : 'var(--text-tertiary)') + '">' + (ok ? '✓' : '○') + '</span>'; };
  return '<div class="sfs-card" style="border-left-color:' + col + ';' + st + '" onclick="sfsOpen(' + p.id + ')">'
    + '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;color:var(--text-tertiary)"><span>' + sfsTime(p.scheduled_at) + ' · ' + SFS_PLAT[p.platform] + '</span>'
    + '<span style="display:flex;gap:4px">' + tick(p.our_sent, 'Notre mass DM envoyé') + tick(p.partner_sent, 'Mass DM de la partenaire reçu') + '</span></div>'
    + '<div style="font-weight:600;font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + sfsEsc(p.model_name) + ' × ' + sfsEsc(p.partner_name) + '</div>'
    + sfsBotBadge(p)
    + (p.subs_gained != null || p.reveal_new_subs_day != null ? '<div style="font-size:11px;color:var(--accent-green);margin-top:2px">'
      + (p.subs_gained != null ? '+' + sfsNum(p.subs_gained) + ' abonnés' : '+' + sfsNum(p.reveal_new_subs_day) + ' abonnés ce jour-là') + '</div>' : '')
    + '</div>';
}

// état de l'envoi automatique
var SFS_BOT = {
  queued: ['🤖 En attente du bot', 'var(--accent-blue)'], requeue: ['🤖 Mise à jour…', 'var(--accent-blue)'],
  scheduled: ['🤖 Programmé sur Reveal', 'var(--accent-blue)'], sent: ['🤖 Envoyé', 'var(--accent-green)'],
  failed: ['⚠️ Erreur', 'var(--accent-red)'], cancel_requested: ['🤖 Annulation…', 'var(--text-tertiary)'], cancelled: ['Annulé', 'var(--text-tertiary)']
};
function sfsBotBadge(p) {
  if (!p.auto_send && !['cancel_requested', 'cancelled'].includes(p.bot_status)) return '';
  var b = SFS_BOT[p.bot_status]; if (!b) return '';
  return '<div style="font-size:11px;margin-top:3px;color:' + b[1] + '">' + b[0] + (p.bot_status === 'sent' && p.sent_count != null ? ' à ' + sfsNum(p.sent_count) + ' fans' : '') + '</div>';
}

// ---------- partenaires ----------
function sfsLoadPartners() {
  sfsApi('GET', '/partners').then(function(rows) {
    sfs.partners = rows;
    var el = document.getElementById('sfs-partners');
    if (!el) return;
    el.innerHTML = rows.length ? '<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th style="text-align:left">Partenaire</th><th>Abonnés</th><th>SFS</th><th>Abonnés gagnés</th><th>Dernier</th></tr></thead><tbody>'
      + rows.map(function(r) {
        return '<tr><td style="text-align:left"><b>' + sfsEsc(r.partner_name) + '</b>' + (r.partner_link ? ' <a href="' + sfsEsc(/^https?:/.test(r.partner_link) ? r.partner_link : '#') + '" target="_blank" rel="noopener" style="font-size:12px;color:var(--text-tertiary)">' + sfsEsc(r.partner_link.slice(0, 40)) + '</a>' : '') + '</td>'
          + '<td>' + sfsNum(r.partner_subs) + '</td><td>' + r.n + '</td><td>' + (r.subs_gained != null ? '+' + sfsNum(r.subs_gained) : '–') + '</td>'
          + '<td>' + new Date(r.last_at).toLocaleDateString('fr-FR') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div style="color:var(--text-tertiary);font-size:13px">Les partenaires apparaîtront ici après ton premier SFS.</div>';
  }).catch(function() {});
}

// ---------- fenêtre ajout / modification ----------
function sfsOpen(id, ymd) {
  var p = id ? sfs.pushes.find(function(x) { return x.id === id; }) : null;
  var go = function(p) {
    var models = typeof allModels !== 'undefined' ? allModels : [];
    var dt = p ? new Date(p.scheduled_at) : null;
    var date = p ? sfsYmd(dt) : (ymd || sfsYmd(new Date()));
    var time = p ? dt.toTimeString().slice(0, 5) : '20:00';
    var body = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '<div class="form-group"><label class="form-label">Modèle</label><select class="form-input" id="sfs-f-model">' + models.map(function(m) {
          return '<option value="' + m.id + '"' + ((p ? p.model_id : Number(sfs.model)) === m.id ? ' selected' : '') + '>' + sfsEsc(m.name) + '</option>'; }).join('') + '</select></div>'
      + '<div class="form-group"><label class="form-label">Plateforme</label><select class="form-input" id="sfs-f-plat" onchange="sfsAutoToggle()">'
        + ['reveal', 'mym'].map(function(k) { return '<option value="' + k + '"' + ((p ? p.platform : (sfs.platform || 'reveal')) === k ? ' selected' : '') + '>' + SFS_PLAT[k] + '</option>'; }).join('') + '</select></div>'
      + '<div class="form-group"><label class="form-label">Date</label><input class="form-input" id="sfs-f-date" type="date" value="' + date + '"></div>'
      + '<div class="form-group"><label class="form-label">Heure du mass DM</label><input class="form-input" id="sfs-f-time" type="time" value="' + time + '"></div>'
      + '</div>'
      + '<div class="form-group"><label class="form-label">Partenaire</label><input class="form-input" id="sfs-f-partner" list="sfs-partner-list" placeholder="Nom de la créatrice" value="' + sfsEsc(p ? p.partner_name : '') + '" oninput="sfsFillPartner(this.value)">'
      + '<datalist id="sfs-partner-list">' + sfs.partners.map(function(r) { return '<option value="' + sfsEsc(r.partner_name) + '">'; }).join('') + '</datalist></div>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">'
      + '<div class="form-group"><label class="form-label">Lien du profil / contact du manager</label><input class="form-input" id="sfs-f-link" value="' + sfsEsc(p ? p.partner_link : '') + '"></div>'
      + '<div class="form-group"><label class="form-label">Ses abonnés</label><input class="form-input" id="sfs-f-psubs" type="number" min="0" value="' + (p && p.partner_subs != null ? p.partner_subs : '') + '"></div></div>';
    var auto = p ? !!p.auto_send : true;
    var sent = p && p.bot_status === 'sent';
    body += '<div id="sfs-auto-box" class="panel" style="padding:12px;margin:4px 0 12px;background:var(--bg-base)">'
      + '<label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="sfs-f-auto"' + (auto ? ' checked' : '') + (sent ? ' disabled' : '') + ' onchange="sfsAutoToggle()"> 🤖 Le bot envoie le mass DM (Reveal)</label>'
      + '<div id="sfs-auto-fields" style="margin-top:10px">'
      + '<div class="form-group"><label class="form-label">Message du mass DM (gratuit)</label><textarea class="form-input" id="sfs-f-msg" rows="4"' + (sent ? ' disabled' : '') + ' placeholder="Ex. Allez voir ma copine @jade, elle est trop mignonne 😍 reveal.me/jade">' + sfsEsc(p ? p.message : '') + '</textarea>'
      + '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">%NAME% est remplacé par le prénom du fan. Texte seul pour l\'instant.</div></div>'
      + '<div class="form-group" style="margin-bottom:0"><label class="form-label">Envoyé à</label><select class="form-input" id="sfs-f-aud"' + (sent ? ' disabled' : '') + '>'
        + [['active', 'Abonnés actuels'], ['expired', 'Anciens abonnés']].map(function(a) { return '<option value="' + a[0] + '"' + ((p ? p.audience : 'active') === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></div>'
      + (p && p.auto_send ? '<div style="font-size:12px;margin-top:10px;color:' + ((SFS_BOT[p.bot_status] || [])[1] || 'var(--text-tertiary)') + '">' + ((SFS_BOT[p.bot_status] || [''])[0])
        + (p.bot_status === 'sent' && p.sent_count != null ? ' à ' + sfsNum(p.sent_count) + ' fans' : '')
        + (p.bot_error ? '<div style="color:var(--accent-red);margin-top:4px">' + sfsEsc(p.bot_error) + '</div>' : '')
        + (p.bot_status === 'failed' ? ' <button class="btn btn-secondary" style="padding:3px 10px;font-size:12px;margin-top:6px" onclick="sfsRetry(' + p.id + ')">Réessayer</button>' : '') + '</div>' : '')
      + '</div></div>';
    if (p) body += '<div style="display:grid;gap:8px;margin:4px 0 12px">'
      + '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sfs-f-our"' + (p.our_sent ? ' checked' : '') + '> Mass DM envoyé par ' + sfsEsc(p.model_name) + '</label>'
      + '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sfs-f-their"' + (p.partner_sent ? ' checked' : '') + '> Mass DM de ' + sfsEsc(p.partner_name) + ' reçu</label></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '<div class="form-group"><label class="form-label">Abonnés gagnés</label><input class="form-input" id="sfs-f-gained" type="number" value="' + (p.subs_gained != null ? p.subs_gained : '') + '" placeholder="' + (p.reveal_new_subs_day != null ? 'Reveal ce jour-là : +' + p.reveal_new_subs_day : '') + '"></div>'
      + '<div class="form-group"><label class="form-label">Statut</label><select class="form-input" id="sfs-f-status">'
        + [['planned', 'Prévu'], ['done', 'Fait'], ['cancelled', 'Annulé']].map(function(s) { return '<option value="' + s[0] + '"' + (p.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div></div>';
    body += '<div class="form-group"><label class="form-label">Notes</label><textarea class="form-input" id="sfs-f-notes" rows="2">' + sfsEsc(p ? p.notes : '') + '</textarea></div>';
    sfsModal(p ? 'SFS · ' + sfsEsc(p.model_name) + ' × ' + sfsEsc(p.partner_name) : 'Programmer un SFS', body,
      (p && p.bot_status !== 'sent' ? '<button class="btn btn-ghost" style="color:var(--accent-red);margin-right:auto" onclick="sfsDelete(' + p.id + ')">Supprimer</button>' : '')
      + '<button class="btn btn-primary" onclick="sfsSave(' + (p ? p.id : 'null') + ')">' + (p ? 'Enregistrer' : 'Programmer') + '</button>');
    sfsAutoToggle();
  };
  if (id && !p) sfsApi('GET', '/pushes').then(function(all) { go(all.find(function(x) { return x.id === id; })); });
  else go(p);
}
function sfsAutoToggle() {
  var plat = document.getElementById('sfs-f-plat'), box = document.getElementById('sfs-auto-box'), f = document.getElementById('sfs-auto-fields'), cb = document.getElementById('sfs-f-auto');
  if (!plat || !box) return;
  box.style.display = plat.value === 'reveal' ? '' : 'none';
  if (f) f.style.display = cb && cb.checked ? '' : 'none';
}
function sfsRetry(id) {
  sfsApi('POST', '/pushes/' + id + '/retry').then(function() { sfsCloseModal(); sfsToast('Le bot va réessayer', 'success'); sfsLoadPushes(); })
    .catch(function(e) { sfsToast(e.message, 'error'); });
}
function sfsFillPartner(name) {
  var r = sfs.partners.find(function(x) { return x.partner_name === name; });
  if (!r) return;
  var l = document.getElementById('sfs-f-link'), s = document.getElementById('sfs-f-psubs');
  if (l && !l.value && r.partner_link) l.value = r.partner_link;
  if (s && !s.value && r.partner_subs != null) s.value = r.partner_subs;
}
function sfsSave(id) {
  var g = function(k) { var e = document.getElementById('sfs-f-' + k); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined; };
  var date = g('date'), time = g('time') || '00:00';
  if (!date) return sfsToast('Choisis une date', 'error');
  var body = { model_id: g('model'), platform: g('plat'), partner_name: g('partner'), partner_link: g('link'), partner_subs: g('psubs'),
    scheduled_at: new Date(date + 'T' + time + ':00').toISOString(), notes: g('notes'),
    auto_send: g('plat') === 'reveal' && !!g('auto'), message: g('msg'), audience: g('aud') };
  if (body.auto_send && !String(body.message || '').trim()) return sfsToast('Écris le message du mass DM', 'error');
  if (id) { body.our_sent = g('our'); body.partner_sent = g('their'); body.subs_gained = g('gained'); body.status = g('status'); }
  sfsApi(id ? 'PUT' : 'POST', id ? '/pushes/' + id : '/pushes', body).then(function() {
    sfsCloseModal(); sfsToast(body.auto_send ? (id ? 'SFS mis à jour : le bot met Reveal à jour' : 'SFS programmé : le bot le programme sur Reveal') : (id ? 'SFS mis à jour' : 'SFS programmé'), 'success');
    var d = sfsMonday(new Date(body.scheduled_at)); if (!id) sfs.week = d;
    sfsLoadPushes(); sfsLoadPartners();
  }).catch(function(e) { sfsToast(e.message, 'error'); });
}
function sfsDelete(id) {
  if (!confirm('Supprimer ce SFS ?')) return;
  sfsApi('DELETE', '/pushes/' + id).then(function(r) { sfsCloseModal(); sfsToast(r && r.cancelled ? 'Annulé : le bot retire le mass DM de Reveal' : 'SFS supprimé', 'success'); sfsLoadPushes(); sfsLoadPartners(); })
    .catch(function(e) { sfsToast(e.message, 'error'); });
}

function sfsModal(title, body, actions) {
  sfsCloseModal();
  var d = document.createElement('div');
  d.id = 'sfs-modal';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  d.innerHTML = '<div class="panel" style="width:100%;max-width:520px;max-height:90vh;overflow:auto;padding:20px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div style="font-weight:700;font-size:16px">' + title + '</div>'
    + '<button class="btn btn-ghost" style="padding:2px 8px" onclick="sfsCloseModal()">✕</button></div>' + body
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">' + actions + '</div></div>';
  d.addEventListener('click', function(e) { if (e.target === d) sfsCloseModal(); });
  document.body.appendChild(d);
}
function sfsCloseModal() { var m = document.getElementById('sfs-modal'); if (m) m.remove(); }
