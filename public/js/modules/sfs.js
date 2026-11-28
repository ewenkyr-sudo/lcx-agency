// SFS : abonnés par modèle (Reveal + MyM) et planning des SFS en mass DM

var sfs = { week: null, platform: '', model: '', subs: [], pushes: [], partners: [], kits: [], kitModel: '' };
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
    c.innerHTML = ''
      + '<div class="panel" style="padding:16px;margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
      + '<div><div style="font-weight:700;font-size:15px">Kits SFS</div><div style="font-size:12px;color:var(--text-tertiary)">Photos + description de chaque modèle, prêtes à copier pour le partenaire</div></div>'
      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><div id="sfs-kit-chips" style="display:flex;gap:4px;flex-wrap:wrap"></div>'
      + '<button class="btn btn-primary" onclick="sfsKitOpen()">+ Nouveau kit</button></div></div>'
      + '<div id="sfs-kits"><div class="skeleton-card" style="height:120px"></div></div></div>'
      + '<div id="sfs-subs"><div class="skeleton-card" style="height:160px"></div></div>'
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
  sfsLoadKits();
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
      var edit = (!d || d.source === 'manual') ? ' onclick="sfsEditSubs(' + m.id + ',\'' + p + '\')" style="cursor:pointer" title="Modifier"' : ' title="' + (p === 'mym' ? 'Chiffres lus sur MyM (Stats MyM)' : 'Chiffres de l\'API Reveal') + '"';
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
    + sfsBotBadge(p) + (p.auto_send && p.media && p.media.length ? '<div style="font-size:11px;color:var(--text-tertiary)">📎 ' + p.media.length + ' média' + (p.media.length > 1 ? 's' : '') + '</div>' : '')
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
      + (sent ? '' : '<div class="form-group"><label class="form-label">Partir d\'un kit SFS</label><select class="form-input" id="sfs-f-kit" onchange="sfsUseKit(this.value)"><option value="">—</option>'
        + sfs.kits.map(function(k) { return '<option value="' + k.id + '">' + sfsEsc(k.model_name + ' · ' + sfsKitName(k)) + '</option>'; }).join('') + '</select></div>')
      + '<div class="form-group"><label class="form-label">Message du mass DM (gratuit)</label><textarea class="form-input" id="sfs-f-msg" rows="4"' + (sent ? ' disabled' : '') + ' placeholder="Ex. Allez voir ma copine @jade, elle est trop mignonne 😍 reveal.me/jade">' + sfsEsc(p ? p.message : '') + '</textarea>'
      + '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">%NAME% est remplacé par le prénom du fan.</div></div>'
      + '<div class="form-group"><label class="form-label">Photos / vidéos (4 max)</label>'
      + '<div id="sfs-media-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>'
      + (sent ? '' : '<label class="btn btn-secondary" style="padding:4px 12px;font-size:12px;cursor:pointer">📎 Ajouter<input type="file" accept="image/*,video/*" multiple style="display:none" onchange="sfsAddMedia(this)"></label>')
      + '</div>'
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
    sfs.media = (p && Array.isArray(p.media) ? p.media : []).map(function(m) { return Object.assign({}, m); });
    sfs.mediaLocked = sent;
    sfsPaintMedia();
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
// photos / vidéos jointes : fichiers déjà en ligne {key,…} ou à envoyer {file}
function sfsPaintMedia() {
  var el = document.getElementById('sfs-media-list');
  if (!el) return;
  el.innerHTML = (sfs.media || []).map(function(m, i) {
    var name = m.file ? m.file.name : m.filename, vid = /^video/.test(m.file ? m.file.type : m.mime);
    var src = !vid ? (m.file ? URL.createObjectURL(m.file) : sfsFileUrl(m.key)) : null;
    var thumb = src ? '<img src="' + src + '" style="width:28px;height:28px;object-fit:cover;border-radius:4px">' : '<span>🎬</span>';
    return '<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid var(--border-default);border-radius:6px;font-size:12px;max-width:220px">' + thumb
      + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + sfsEsc(name) + '</span>'
      + (sfs.mediaLocked ? '' : '<button class="btn btn-ghost" style="padding:0 4px" title="Retirer" onclick="sfsRemoveMedia(' + i + ')">✕</button>') + '</span>';
  }).join('') || '<span style="font-size:12px;color:var(--text-tertiary)">Aucune — texte seul</span>';
}
function sfsAddMedia(input, max) {
  max = max || 4;
  var files = Array.prototype.slice.call(input.files || []);
  input.value = '';
  files.forEach(function(f) {
    if (!/^(image|video)\//.test(f.type)) return sfsToast(f.name + ' : seulement des photos ou des vidéos', 'error');
    if ((sfs.media || []).length >= max) return sfsToast(max + ' photos ou vidéos maximum', 'error');
    sfs.media.push({ file: f });
  });
  sfsPaintMedia();
}
function sfsRemoveMedia(i) { sfs.media.splice(i, 1); sfsPaintMedia(); }
function sfsUploadMedia() {
  return Promise.all((sfs.media || []).map(function(m) {
    if (!m.file) return Promise.resolve({ key: m.key, filename: m.filename, mime: m.mime, size: m.size });
    var f = m.file;
    return sfsApi('POST', '/upload-url', { filename: f.name, mime: f.type, size: f.size }).then(function(u) {
      return new Promise(function(res, rej) {
        var x = new XMLHttpRequest();
        x.open('PUT', u.url);
        if (u.mode === 'local') x.withCredentials = true;
        x.setRequestHeader('Content-Type', u.mode === 'local' ? 'application/octet-stream' : f.type);
        x.onload = function() { x.status < 300 ? res() : rej(new Error(f.name + ' : envoi refusé (' + x.status + ')')); };
        x.onerror = function() { rej(new Error(f.name + ' : envoi impossible')); };
        x.send(f);
      }).then(function() { var d = { key: u.key, filename: f.name, mime: f.type, size: f.size }; Object.assign(m, d); delete m.file; return d; });
    });
  }));
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
  var btn = document.querySelector('#sfs-modal button.btn-primary');
  var hasNew = body.auto_send && (sfs.media || []).some(function(m) { return m.file; });
  if (btn) { btn.disabled = true; if (hasNew) btn.textContent = 'Envoi des photos…'; }
  var again = function() { if (btn) { btn.disabled = false; btn.textContent = id ? 'Enregistrer' : 'Programmer'; } };
  (body.auto_send && !sfs.mediaLocked ? sfsUploadMedia() : Promise.resolve(null)).then(function(media) {
    if (media) body.media = media;
    return sfsApi(id ? 'PUT' : 'POST', id ? '/pushes/' + id : '/pushes', body);
  }).then(function() {
    sfsCloseModal(); sfsToast(body.auto_send ? (id ? 'SFS mis à jour : le bot met Reveal à jour' : 'SFS programmé : le bot le programme sur Reveal') : (id ? 'SFS mis à jour' : 'SFS programmé'), 'success');
    var d = sfsMonday(new Date(body.scheduled_at)); if (!id) sfs.week = d;
    sfsLoadPushes(); sfsLoadPartners();
  }).catch(function(e) { again(); sfsToast(e.message, 'error'); });
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

// ---------- kits SFS ----------
var SFS_KIT_PLAT = { reveal: 'Reveal', mym: 'MyM', onlyfans: 'OnlyFans' };
function sfsKitName(k) { return k.title || (k.platform ? SFS_KIT_PLAT[k.platform] : 'Kit'); }
function sfsFileUrl(key, dl, name) { return '/api/sfs/file?key=' + encodeURIComponent(key) + (dl ? '&dl=1&name=' + encodeURIComponent(name || '') : ''); }
function sfsLoadKits() {
  sfsApi('GET', '/kits').then(function(rows) { sfs.kits = rows; sfsRenderKits(); })
    .catch(function(e) { var el = document.getElementById('sfs-kits'); if (el) el.innerHTML = '<div class="empty-state">' + sfsEsc(e.message) + '</div>'; });
}
function sfsRenderKits() {
  var chips = document.getElementById('sfs-kit-chips'), el = document.getElementById('sfs-kits');
  if (!el) return;
  var ids = []; sfs.kits.forEach(function(k) { if (ids.indexOf(k.model_id) < 0) ids.push(k.model_id); });
  if (chips) chips.innerHTML = ids.length > 1 ? [['', 'Toutes']].concat(ids.map(function(id) { return [String(id), (sfs.kits.find(function(k) { return k.model_id === id; }) || {}).model_name]; })).map(function(c) {
    return '<button class="filter-chip' + (String(sfs.kitModel) === c[0] ? ' active' : '') + '" onclick="sfs.kitModel=\'' + c[0] + '\';sfsRenderKits()">' + sfsEsc(c[1]) + '</button>';
  }).join('') : '';
  var list = sfs.kits.filter(function(k) { return !sfs.kitModel || String(k.model_id) === String(sfs.kitModel); });
  if (!list.length) { el.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">Pas encore de kit. Crée-en un par modèle avec ses photos SFS et sa description : tu n\'auras plus qu\'à copier et envoyer au partenaire.</div>'; return; }
  el.innerHTML = '<div class="sfs-kit-grid">' + list.map(function(k) {
    var col = typeof modelColor === 'function' ? modelColor(k.model_id, k.model_name) : 'var(--accent)';
    var media = k.media || [];
    return '<div class="sfs-kit" style="border-top-color:' + col + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:center;gap:8px;min-width:0">' + (typeof modelAvatarHtml === 'function' ? modelAvatarHtml({ id: k.model_id, name: k.model_name }, 28, false) : '')
      + '<div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + sfsEsc(k.model_name) + '</div>'
      + '<div style="font-size:12px;color:var(--text-tertiary)">' + sfsEsc(sfsKitName(k)) + (k.title && k.platform ? ' · ' + SFS_KIT_PLAT[k.platform] : '') + '</div></div></div>'
      + '<button class="btn btn-ghost" style="padding:2px 8px" title="Modifier" onclick="sfsKitOpen(' + k.id + ')">✎</button></div>'
      + (media.length ? '<div class="sfs-kit-media">' + media.map(function(m, i) {
          var vid = /^video/.test(m.mime);
          return '<div class="sfs-kit-thumb" title="' + (vid ? 'Vidéo : clique pour la télécharger' : 'Clique pour copier la photo') + '" onclick="' + (vid ? 'sfsKitDownload(' + k.id + ',' + i + ')' : 'sfsKitCopyPhoto(' + k.id + ',' + i + ',this)') + '">'
            + (vid ? '<video src="' + sfsFileUrl(m.key) + '#t=0.5" preload="metadata" muted></video><span class="sfs-kit-badge">🎬</span>' : '<img loading="lazy" src="' + sfsFileUrl(m.key) + '" alt="">')
            + '<a class="sfs-kit-dl" title="Télécharger" href="' + sfsFileUrl(m.key, 1, m.filename) + '" onclick="event.stopPropagation()">⬇</a></div>';
        }).join('') + '</div>' : '')
      + (k.description ? '<div class="sfs-kit-desc">' + sfsEsc(k.description) + '</div>' : '')
      + (k.link ? '<div style="font-size:12px;margin-top:6px;word-break:break-all"><a href="' + sfsEsc(/^https?:/.test(k.link) ? k.link : 'https://' + k.link) + '" target="_blank" rel="noopener" style="color:var(--accent-blue)">' + sfsEsc(k.link) + '</a></div>' : '')
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">'
      + (k.description || k.link ? '<button class="btn btn-primary" style="padding:5px 12px;font-size:12px" onclick="sfsKitCopyText(' + k.id + ',this)">📋 Copier le texte</button>' : '')
      + (media.length ? '<button class="btn btn-secondary" style="padding:5px 12px;font-size:12px" onclick="sfsKitDownloadAll(' + k.id + ')">⬇ Tout télécharger (' + media.length + ')</button>' : '')
      + '</div></div>';
  }).join('') + '</div>'
  + '<div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">Clique sur une photo pour la copier, puis colle-la (Cmd/Ctrl + V) dans la conversation avec le partenaire. Les vidéos se téléchargent.</div>';
}
function sfsKitText(k) { return [k.description, k.link].filter(Boolean).join('\n\n'); }
function sfsFlash(btn, txt) { if (!btn) return; var o = btn.innerHTML; btn.innerHTML = txt; setTimeout(function() { btn.innerHTML = o; }, 1500); }
function sfsKitCopyText(id, btn) {
  var k = sfs.kits.find(function(x) { return x.id === id; }); if (!k) return;
  var t = sfsKitText(k);
  var done = function() { sfsFlash(btn, '✓ Copié'); sfsToast('Texte copié', 'success'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function() { sfsCopyFallback(t); done(); });
  else { sfsCopyFallback(t); done(); }
}
function sfsCopyFallback(t) { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); }
// copie une photo dans le presse-papiers (convertie en PNG : seul format accepté partout)
function sfsKitCopyPhoto(id, i, el) {
  var k = sfs.kits.find(function(x) { return x.id === id; }); if (!k) return;
  var m = k.media[i];
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { sfsToast('Ton navigateur ne permet pas de copier une photo : télécharge-la avec ⬇', 'error'); return; }
  var png = fetch(sfsFileUrl(m.key), { credentials: 'include' }).then(function(r) { if (!r.ok) throw new Error('Photo introuvable'); return r.blob(); }).then(function(b) {
    if (b.type === 'image/png') return b;
    return new Promise(function(res, rej) {
      var img = new Image(), u = URL.createObjectURL(b);
      img.onload = function() {
        var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(u);
        c.toBlob(function(x) { x ? res(x) : rej(new Error('Conversion impossible')); }, 'image/png');
      };
      img.onerror = function() { URL.revokeObjectURL(u); rej(new Error('Format de photo non lisible par le navigateur : télécharge-la avec ⬇')); };
      img.src = u;
    });
  });
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(function() {
    if (el) { el.classList.add('copied'); setTimeout(function() { el.classList.remove('copied'); }, 1200); }
    sfsToast('Photo copiée : colle-la dans la conversation', 'success');
  }).catch(function(e) { sfsToast(e && e.message && !/NotAllowed/.test(e.name) ? e.message : 'Copie refusée par le navigateur : télécharge la photo avec ⬇', 'error'); });
}
function sfsKitDownload(id, i) {
  var k = sfs.kits.find(function(x) { return x.id === id; }); if (!k) return;
  var m = k.media[i], a = document.createElement('a');
  a.href = sfsFileUrl(m.key, 1, m.filename); a.download = m.filename || ''; document.body.appendChild(a); a.click(); a.remove();
}
function sfsKitDownloadAll(id) {
  var k = sfs.kits.find(function(x) { return x.id === id; }); if (!k) return;
  k.media.forEach(function(m, i) { setTimeout(function() { sfsKitDownload(id, i); }, i * 400); });
  if (k.media.length > 1) sfsToast('Si Chrome demande « télécharger plusieurs fichiers », clique sur Autoriser', 'info');
}
function sfsKitOpen(id) {
  var k = id ? sfs.kits.find(function(x) { return x.id === id; }) : null;
  var models = typeof allModels !== 'undefined' ? allModels : [];
  var cur = k ? k.model_id : Number(sfs.kitModel) || (models[0] || {}).id;
  sfsModal(k ? 'Kit SFS · ' + sfsEsc(k.model_name) : 'Nouveau kit SFS',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div class="form-group"><label class="form-label">Modèle</label><select class="form-input" id="sfs-k-model">' + models.map(function(m) { return '<option value="' + m.id + '"' + (m.id === cur ? ' selected' : '') + '>' + sfsEsc(m.name) + '</option>'; }).join('') + '</select></div>'
    + '<div class="form-group"><label class="form-label">Plateforme</label><select class="form-input" id="sfs-k-plat"><option value="">Toutes</option>'
      + Object.keys(SFS_KIT_PLAT).map(function(p) { return '<option value="' + p + '"' + (k && k.platform === p ? ' selected' : '') + '>' + SFS_KIT_PLAT[p] + '</option>'; }).join('') + '</select></div></div>'
    + '<div class="form-group"><label class="form-label">Nom du kit (facultatif)</label><input class="form-input" id="sfs-k-title" maxlength="120" placeholder="Ex. Kit Noël, Kit soft…" value="' + sfsEsc(k ? k.title : '') + '"></div>'
    + '<div class="form-group"><label class="form-label">Description à envoyer</label><textarea class="form-input" id="sfs-k-desc" rows="5" placeholder="Ex. Allez voir ma copine Chloé 😍 elle poste tous les jours, abonnez-vous 👉">' + sfsEsc(k ? k.description : '') + '</textarea></div>'
    + '<div class="form-group"><label class="form-label">Lien du profil</label><input class="form-input" id="sfs-k-link" placeholder="reveal.me/… ou onlyfans.com/…" value="' + sfsEsc(k ? k.link : '') + '"></div>'
    + '<div class="form-group"><label class="form-label">Photos / vidéos (10 max)</label><div id="sfs-media-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>'
    + '<label class="btn btn-secondary" style="padding:4px 12px;font-size:12px;cursor:pointer">📎 Ajouter<input type="file" accept="image/*,video/*" multiple style="display:none" onchange="sfsAddMedia(this,10)"></label></div>',
    (k ? '<button class="btn btn-ghost" style="color:var(--accent-red);margin-right:auto" onclick="sfsKitDelete(' + k.id + ')">Supprimer</button>' : '')
    + '<button class="btn btn-primary" onclick="sfsKitSave(' + (k ? k.id : 'null') + ')">Enregistrer</button>');
  sfs.media = (k ? k.media || [] : []).map(function(m) { return Object.assign({}, m); });
  sfs.mediaLocked = false;
  sfsPaintMedia();
}
function sfsKitSave(id) {
  var g = function(x) { return document.getElementById('sfs-k-' + x).value; };
  var body = { model_id: g('model'), platform: g('plat'), title: g('title'), description: g('desc'), link: g('link') };
  if (!String(body.description).trim() && !(sfs.media || []).length) return sfsToast('Ajoute une description ou une photo', 'error');
  var btn = document.querySelector('#sfs-modal button.btn-primary');
  if (btn) { btn.disabled = true; if ((sfs.media || []).some(function(m) { return m.file; })) btn.textContent = 'Envoi des photos…'; }
  sfsUploadMedia().then(function(media) {
    body.media = media;
    return sfsApi(id ? 'PUT' : 'POST', id ? '/kits/' + id : '/kits', body);
  }).then(function() { sfsCloseModal(); sfsToast('Kit enregistré', 'success'); sfsLoadKits(); })
    .catch(function(e) { if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; } sfsToast(e.message, 'error'); });
}
function sfsKitDelete(id) {
  if (!confirm('Supprimer ce kit et ses photos ?')) return;
  sfsApi('DELETE', '/kits/' + id).then(function() { sfsCloseModal(); sfsToast('Kit supprimé', 'success'); sfsLoadKits(); })
    .catch(function(e) { sfsToast(e.message, 'error'); });
}
// remplit le mass DM avec un kit (texte + 4 premières photos)
function sfsUseKit(id) {
  var k = sfs.kits.find(function(x) { return String(x.id) === String(id); }); if (!k) return;
  var msg = document.getElementById('sfs-f-msg'); if (msg) msg.value = sfsKitText(k);
  sfs.media = (k.media || []).slice(0, 4).map(function(m) { return Object.assign({}, m); });
  sfsPaintMedia();
  if ((k.media || []).length > 4) sfsToast('Reveal accepte 4 médias max : les 4 premiers sont repris', 'info');
}
