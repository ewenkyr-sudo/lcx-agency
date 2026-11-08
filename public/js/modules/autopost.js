// AUTO-POST REVEAL MODULE
// Pilotage du bot : réglages par modèle, contenu, planning, historique, rapports.

var ap = { tab: 'models', data: null, timer: null, mediaKind: 'post', mediaModel: null, uploads: 0 };
var AP_KIND = { post: 'Posts', reel: 'Reels', story: 'Stories' };
var AP_KIND1 = { post: 'Post', reel: 'Reel', story: 'Story' };
var AP_STATUS = {
  pending: ['Prévu', 'var(--text-tertiary)'], running: ['En cours…', 'var(--accent-blue)'], done: ['Publié', 'var(--accent-green)'],
  failed: ['Échec', 'var(--accent-red)'], skipped: ['Sauté', 'var(--accent-yellow)'], cancelled: ['Annulé', 'var(--text-muted)']
};
var AP_AUD = { subscribers: 'Abonnés', public: 'Public', video: 'Feed vidéo' };

function apEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function apApi(method, url, body) {
  return fetch('/api/autopost' + url, {
    method: method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r) {
    return r.json().catch(function() { return {}; }).then(function(j) {
      if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
      return j;
    });
  });
}
function apToast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'info'); else alert(msg); }
function apFmtTime(d) { return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); }
function apFmtDay(d) { return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }); }
function apFmtFull(d) { return d ? apFmtDay(d) + ' ' + apFmtTime(d) : ''; }
function apAgo(d) {
  if (!d) return 'jamais';
  var s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return 'à l\'instant';
  if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
  return 'il y a ' + Math.round(s / 86400) + ' j';
}
function apToggle(id, checked, onchange) {
  return '<label style="position:relative;width:44px;height:24px;flex-shrink:0;display:inline-block">' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (onchange ? ' onchange="' + onchange + '"' : '') + ' style="opacity:0;width:0;height:0">' +
    '<span class="toggle-slider"></span></label>';
}
function apPill(text, color) {
  return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-family:var(--font-sans);font-size:11px;font-weight:600;letter-spacing:0;color:' + color + ';background:color-mix(in srgb, ' + color + ' 14%, transparent)">' + apEsc(text) + '</span>';
}

// ========== MODALE GÉNÉRIQUE ==========
function apModal(title, bodyHtml, footerHtml, wide) {
  apCloseModal();
  var o = document.createElement('div');
  o.className = 'modal-overlay show';
  o.id = 'ap-modal';
  o.innerHTML = '<div class="modal" style="' + (wide ? 'max-width:980px;width:96vw' : 'max-width:560px;width:94vw') + ';max-height:92vh;overflow:auto">' +
    '<div class="modal-header"><div class="modal-title">' + title + '</div><button class="modal-close" onclick="apCloseModal()">✕</button></div>' +
    '<div class="modal-body" style="padding-top:4px">' + bodyHtml + '</div>' +
    (footerHtml ? '<div class="modal-footer">' + footerHtml + '</div>' : '') + '</div>';
  o.addEventListener('click', function(e) { if (e.target === o && !ap.uploads) apCloseModal(); });
  document.body.appendChild(o);
}
function apCloseModal() { var m = document.getElementById('ap-modal'); if (m) m.remove(); }

// ========== RENDU PRINCIPAL ==========
function renderAutopost() {
  var c = document.getElementById('autopost-content');
  if (!c) return;
  if (!c.dataset.ready) {
    c.dataset.ready = '1';
    c.innerHTML = '<div id="ap-status"></div>' +
      '<div class="tabs" id="ap-tabs" style="display:flex;gap:6px;margin:16px 0;flex-wrap:wrap">' +
      [['models', 'Modèles'], ['planning', 'Planning'], ['history', 'Historique'], ['reports', 'Rapports & analyse'], ['settings', 'Réglages']].map(function(t) {
        return '<button class="filter-chip' + (ap.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '" onclick="apSwitchTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div><div id="ap-body"><div class="skeleton-card" style="height:160px"></div></div>';
  }
  apLoad();
  clearInterval(ap.timer);
  ap.timer = setInterval(function() {
    var sec = document.getElementById('section-autopost');
    if (!sec || !sec.classList.contains('active')) { clearInterval(ap.timer); return; }
    if (!document.getElementById('ap-modal')) apLoad(true);
  }, 30000);
}

function apSwitchTab(tab) {
  ap.tab = tab;
  document.querySelectorAll('#ap-tabs .filter-chip').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
  apRenderBody();
}

function apLoad(silent) {
  return apApi('GET', '/overview').then(function(d) {
    ap.data = d;
    apRenderStatus();
    if (!silent || ap.tab === 'models') apRenderBody();
  }).catch(function(e) { if (!silent) document.getElementById('ap-body').innerHTML = '<div class="empty-state"><div class="empty-state-title">' + apEsc(e.message) + '</div></div>'; });
}

function apRenderStatus() {
  var d = ap.data, a = d.agency, w = d.worker;
  var sess = { ok: ['Connecté', 'var(--accent-green)'], unchecked: ['Vérification…', 'var(--accent-blue)'], expired: ['Connexion expirée', 'var(--accent-red)'], missing: ['Pas connecté', 'var(--accent-red)'] }[a.session_status] || ['?', 'var(--text-tertiary)'];
  var html = '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">' +
    '<div class="stat-card"><div class="stat-label">Bot</div><div style="margin-top:6px">' +
      (w.online ? apPill(w.status === 'publishing' ? 'En train de publier' : 'En ligne', 'var(--accent-green)') : apPill('Hors ligne', 'var(--accent-red)')) +
      '</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">Dernier signe de vie : ' + apAgo(w.last_seen) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Compte Reveal (agence)</div><div style="margin-top:6px">' + apPill(sess[0], sess[1]) + '</div>' +
      '<button class="btn btn-secondary" style="margin-top:8px;padding:6px 10px;font-size:12px" onclick="apOpenSession()">' + (a.session_status === 'ok' ? 'Changer' : 'Connecter') + '</button></div>' +
    '<div class="stat-card"><div class="stat-label">Publication automatique</div><div style="display:flex;align-items:center;gap:10px;margin-top:6px">' +
      apToggle('ap-global', !a.paused, 'apSetPaused(!this.checked)') + '<span style="font-weight:600">' + (a.paused ? 'En pause' : 'Active') + '</span></div>' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">Coupe tout d\'un coup, pour toutes les modèles</div></div>' +
  '</div>';
  var warn = [];
  if (d.storage === 'local') warn.push('Stockage local : les médias sont enregistrés sur le serveur du site. En production, configure le stockage cloud (R2) pour que le bot puisse les lire.');
  if (!w.online) warn.push('Le bot ne répond pas. Vérifie le service « lcx-autopost-worker » sur Render.');
  if (a.session_status === 'expired') warn.push('La connexion Reveal a expiré : rien ne sera publié tant que tu ne reconnectes pas le compte agence.');
  if (warn.length) html += '<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--accent-yellow-bg);color:var(--accent-yellow-light);font-size:13px">' + warn.map(apEsc).join('<br>') + '</div>';
  document.getElementById('ap-status').innerHTML = html;
}

function apRenderBody() {
  var b = document.getElementById('ap-body');
  if (!b || !ap.data) return;
  if (ap.tab === 'models') return apRenderModels(b);
  if (ap.tab === 'planning') return apRenderJobs(b, 'upcoming');
  if (ap.tab === 'history') return apRenderJobs(b, 'history');
  if (ap.tab === 'reports') return apRenderReports(b);
  if (ap.tab === 'settings') return apRenderSettings(b);
}

// ========== MODÈLES ==========
function apRenderModels(b) {
  var models = ap.data.models;
  if (!models.length) { b.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucune modèle dans le CRM</div></div>'; return; }
  b.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px">' + models.map(function(m) {
    var s = m.settings;
    var stock = ['post', 'reel', 'story'].map(function(k) {
      var st = m.stock[k], per = s[k === 'post' ? 'posts_per_day' : k === 'reel' ? 'reels_per_day' : 'stories_per_day'];
      var low = s.enabled && per > 0 && st.fresh < per * 3 && (!s.rotation_enabled || st.rotation_ready < per);
      return '<div style="flex:1;min-width:0;padding:8px;border-radius:8px;background:var(--bg-subtle);border:1px solid ' + (low ? 'var(--accent-red)' : 'var(--border-default)') + '">' +
        '<div style="font-size:11px;color:var(--text-tertiary)">' + AP_KIND[k] + ' · ' + per + '/j</div>' +
        '<div style="font-size:16px;font-weight:700">' + st.fresh + ' <span style="font-size:11px;font-weight:500;color:var(--text-tertiary)">neufs</span></div>' +
        '<div style="font-size:11px;color:var(--text-tertiary)">' + (st.days_fresh != null ? '~' + st.days_fresh + ' j · ' : '') + st.rotation_ready + ' en rotation</div></div>';
    }).join('');
    var t = m.today || {};
    return '<div class="panel" style="padding:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<div style="font-size:16px;font-weight:700">' + apEsc(m.name) + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text-tertiary)">' + (s.enabled ? 'Actif' : 'Off') + '</span>' +
        apToggle('ap-en-' + m.id, s.enabled, 'apSetEnabled(' + m.id + ', this.checked, this)') + '</div></div>' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin:4px 0 10px">' +
        (s.reveal_model_id ? 'Reveal ✓ · ' + apEsc(s.window_start) + '–' + apEsc(s.window_end) + (s.rotation_enabled ? ' · rotation ' + s.rotation_cooldown_days + ' j' : ' · sans rotation') : '<span style="color:var(--accent-yellow)">Identifiant Reveal à renseigner</span>') + '</div>' +
      '<div style="display:flex;gap:8px">' + stock + '</div>' +
      '<div style="font-size:12px;color:var(--text-secondary);margin-top:10px">Aujourd\'hui : ' + (t.done || 0) + ' publiés' + (t.failed ? ' · <span style="color:var(--accent-red)">' + t.failed + ' échecs</span>' : '') + (t.skipped ? ' · <span style="color:var(--accent-yellow)">' + t.skipped + ' sautés</span>' : '') + ' · ' + (t.pending || 0) + ' prévus' +
        (m.next ? '<br>Prochain : ' + AP_KIND1[m.next.kind] + ' à ' + apFmtTime(m.next.scheduled_at) : '') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" style="padding:7px 12px;font-size:13px" onclick="apOpenMedia(' + m.id + ')">Contenu</button>' +
        '<button class="btn btn-secondary" style="padding:7px 12px;font-size:13px" onclick="apOpenSettings(' + m.id + ')">Réglages</button>' +
        '<button class="btn btn-ghost" style="padding:7px 12px;font-size:13px" onclick="apOpenRunNow(' + m.id + ')">Publier maintenant</button>' +
      '</div></div>';
  }).join('') + '</div>';
}

function apModel(id) { return ap.data.models.find(function(m) { return m.id === id; }); }

function apSetEnabled(id, on, el) {
  var m = apModel(id);
  if (on && !m.settings.reveal_model_id) { el.checked = false; apToast('Renseigne d\'abord l\'identifiant Reveal dans les réglages', 'error'); apOpenSettings(id); return; }
  apApi('PUT', '/models/' + id + '/settings', Object.assign({}, m.settings, { enabled: on }))
    .then(function() { apToast(on ? 'Auto-post activé pour ' + m.name : 'Auto-post coupé pour ' + m.name, 'success'); apLoad(); })
    .catch(function(e) { el.checked = !on; apToast(e.message, 'error'); });
}
function apSetPaused(p) {
  apApi('PUT', '/agency', { paused: p }).then(function() { apToast(p ? 'Tout est en pause' : 'Publication automatique relancée', 'success'); apLoad(); })
    .catch(function(e) { apToast(e.message, 'error'); });
}

// ---------- réglages modèle ----------
function apOpenSettings(id) {
  var m = apModel(id), s = m.settings;
  var num = function(name, label, val, min, max) {
    return '<div class="form-group" style="flex:1"><label class="form-label">' + label + '</label><input class="form-input" type="number" min="' + min + '" max="' + max + '" name="' + name + '" value="' + apEsc(val) + '"></div>';
  };
  var body = '<form id="ap-settings-form">' +
    '<div class="form-group"><label class="form-label">Page de la modèle sur Reveal</label>' +
      '<input class="form-input" name="reveal_model_id" placeholder="https://dashboard.reveal.me/models/…" value="' + apEsc(s.reveal_model_id || '') + '">' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Ouvre la modèle dans ton dashboard Reveal et colle l\'adresse de la page.</div></div>' +
    '<div style="display:flex;gap:10px">' + num('posts_per_day', 'Posts / jour', s.posts_per_day, 0, 20) + num('reels_per_day', 'Reels / jour', s.reels_per_day, 0, 20) + num('stories_per_day', 'Stories / jour', s.stories_per_day, 0, 20) + '</div>' +
    '<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label class="form-label">Publier entre</label><input class="form-input" type="time" name="window_start" value="' + apEsc(s.window_start) + '"></div>' +
      '<div class="form-group" style="flex:1"><label class="form-label">et</label><input class="form-input" type="time" name="window_end" value="' + apEsc(s.window_end) + '"></div></div>' +
    '<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label class="form-label">Posts visibles par</label><select class="form-select form-input" name="post_audience">' +
      '<option value="subscribers"' + (s.post_audience !== 'public' ? ' selected' : '') + '>Abonnés uniquement</option><option value="public"' + (s.post_audience === 'public' ? ' selected' : '') + '>Feed public</option></select></div>' +
      '<div class="form-group" style="flex:1"><label class="form-label">Stories</label><select class="form-select form-input" name="story_public">' +
      '<option value="1"' + (s.story_public ? ' selected' : '') + '>Publiques</option><option value="0"' + (!s.story_public ? ' selected' : '') + '>Abonnés seulement</option></select></div></div>' +
    '<div style="font-size:12px;color:var(--text-tertiary);margin:-4px 0 12px">Les reels partent toujours en « Feed vidéo ».</div>' +
    '<div style="padding:12px;border-radius:10px;background:var(--bg-subtle);border:1px solid var(--border-default);margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:600">Rotation des anciens posts</div><div style="font-size:12px;color:var(--text-tertiary)">Republie l\'ancien contenu (le plus liké d\'abord) quand il n\'y a plus de neuf</div></div>' + apToggle('ap-rot', s.rotation_enabled) + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:10px">' + num('rotation_cooldown_days', 'Pas de repost avant (jours)', s.rotation_cooldown_days, 1, 365) + num('rotation_mix_pct', '% de repost même s\'il reste du neuf', s.rotation_mix_pct, 0, 100) + '</div></div>' +
    '<div class="form-group"><label class="form-label">Légendes de ' + apEsc(m.name) + ' (une par ligne, piochées au hasard)</label>' +
      '<textarea class="form-input" name="captions" rows="5" placeholder="Laisse vide pour utiliser les légendes générales de l\'agence">' + apEsc(s.captions || '') + '</textarea></div>' +
    '</form>';
  apModal('Réglages auto-post · ' + apEsc(m.name), body,
    '<button class="btn btn-ghost" onclick="apCloseModal()">Annuler</button><button class="btn btn-primary" id="ap-save-settings" onclick="apSaveSettings(' + id + ')">Enregistrer</button>');
}
function apSaveSettings(id) {
  var f = document.getElementById('ap-settings-form'), m = apModel(id);
  var v = Object.assign({}, m.settings);
  ['reveal_model_id', 'posts_per_day', 'reels_per_day', 'stories_per_day', 'window_start', 'window_end', 'post_audience', 'rotation_cooldown_days', 'rotation_mix_pct', 'captions'].forEach(function(k) { v[k] = f.elements[k].value; });
  v.story_public = f.elements.story_public.value === '1';
  v.rotation_enabled = document.getElementById('ap-rot').checked;
  var btn = document.getElementById('ap-save-settings'); btn.disabled = true;
  apApi('PUT', '/models/' + id + '/settings', v).then(function() { apCloseModal(); apToast('Réglages enregistrés, planning du jour recalculé', 'success'); apLoad(); })
    .catch(function(e) { btn.disabled = false; apToast(e.message, 'error'); });
}

// ---------- publier maintenant ----------
function apOpenRunNow(id) {
  var m = apModel(id);
  apModal('Publier maintenant · ' + apEsc(m.name),
    '<p style="color:var(--text-secondary);font-size:14px;margin:0 0 12px">Le bot prend le prochain contenu dans le stock et le publie dans la minute (en plus du planning).</p>' +
    '<div style="display:flex;gap:8px">' + ['post', 'reel', 'story'].map(function(k) {
      return '<button class="btn btn-secondary" style="flex:1" onclick="apRunNow(' + id + ',\'' + k + '\')">' + AP_KIND1[k] + '</button>';
    }).join('') + '</div>');
}
function apRunNow(id, kind) {
  apApi('POST', '/models/' + id + '/run-now', { kind: kind }).then(function() { apCloseModal(); apToast(AP_KIND1[kind] + ' ajouté, le bot s\'en occupe', 'success'); apLoad(); })
    .catch(function(e) { apToast(e.message, 'error'); });
}

// ========== CONTENU (MÉDIAS) ==========
function apOpenMedia(id, kind) {
  ap.mediaModel = id; ap.mediaKind = kind || ap.mediaKind || 'post';
  var m = apModel(id);
  apModal('Contenu · ' + apEsc(m.name),
    '<div style="display:flex;gap:6px;margin-bottom:12px">' + ['post', 'reel', 'story'].map(function(k) {
      return '<button class="filter-chip' + (ap.mediaKind === k ? ' active' : '') + '" onclick="apOpenMedia(' + id + ',\'' + k + '\')">' + AP_KIND[k] + ' <span style="opacity:.6">(' + m.stock[k].total + ')</span></button>';
    }).join('') + '</div>' +
    '<label id="ap-drop" style="display:block;border:2px dashed var(--border-hover);border-radius:12px;padding:22px;text-align:center;cursor:pointer;color:var(--text-secondary)">' +
      '<input type="file" id="ap-files" multiple accept="' + (ap.mediaKind === 'reel' ? 'video/*' : 'image/*,video/*') + '" style="display:none" onchange="apUpload(this.files)">' +
      '<div style="font-size:15px;font-weight:600">Glisse tes ' + (ap.mediaKind === 'reel' ? 'vidéos' : 'photos / vidéos') + ' ici ou clique</div>' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Ils sont publiés dans l\'ordre des noms de fichiers (001, 002…). Une légende propre à un fichier : clique dessus après l\'import.</div></label>' +
    '<div id="ap-upload-progress" style="margin-top:10px"></div>' +
    '<div id="ap-media-list" style="margin-top:14px"><div class="skeleton-card" style="height:120px"></div></div>', null, true);
  var drop = document.getElementById('ap-drop');
  ['dragover', 'dragenter'].forEach(function(e) { drop.addEventListener(e, function(ev) { ev.preventDefault(); drop.style.borderColor = 'var(--accent-blue)'; }); });
  ['dragleave', 'drop'].forEach(function(e) { drop.addEventListener(e, function(ev) { ev.preventDefault(); drop.style.borderColor = ''; }); });
  drop.addEventListener('drop', function(ev) { apUpload(ev.dataTransfer.files); });
  apLoadMedia();
}

function apLoadMedia() {
  apApi('GET', '/models/' + ap.mediaModel + '/media?kind=' + ap.mediaKind).then(function(list) {
    var el = document.getElementById('ap-media-list');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucun ' + AP_KIND1[ap.mediaKind].toLowerCase() + ' pour l\'instant</div></div>'; return; }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">' + list.map(function(md) {
      var src = '/api/autopost/media/' + md.id + '/file';
      var prev = /^video\//.test(md.mime) ? '<video src="' + src + '#t=0.5" preload="metadata" muted style="width:100%;height:100%;object-fit:cover"></video>' : '<img src="' + src + '" loading="lazy" style="width:100%;height:100%;object-fit:cover">';
      var tag = md.times_posted ? apPill('Posté ' + md.times_posted + 'x', 'var(--accent-blue)') : apPill('Neuf', 'var(--accent-green)');
      return '<div style="border:1px solid var(--border-default);border-radius:10px;overflow:hidden;background:var(--bg-surface);' + (md.disabled ? 'opacity:.45' : '') + '">' +
        '<div style="aspect-ratio:3/4;background:#000;position:relative">' + prev + '<div style="position:absolute;top:6px;left:6px">' + tag + '</div></div>' +
        '<div style="padding:8px;font-size:11px;color:var(--text-tertiary)">' +
          '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary)" title="' + apEsc(md.filename) + '">' + apEsc(md.filename || '#' + md.id) + '</div>' +
          (md.avg_likes != null ? '<div>❤️ ' + Math.round(md.avg_likes * 10) / 10 + ' moy.' + (md.best_likes != null ? ' · record ' + md.best_likes : '') + '</div>' : '') +
          (md.caption ? '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">« ' + apEsc(md.caption) + ' »</div>' : '') +
          '<div style="display:flex;gap:4px;margin-top:6px">' +
            '<button class="btn btn-ghost" style="padding:3px 6px;font-size:11px" onclick="apEditCaption(' + md.id + ', ' + apEsc(JSON.stringify(md.caption || '')) + ')">Légende</button>' +
            '<button class="btn btn-ghost" style="padding:3px 6px;font-size:11px" onclick="apToggleMedia(' + md.id + ',' + (!md.disabled) + ')">' + (md.disabled ? 'Réactiver' : 'Retirer') + '</button>' +
            '<button class="btn btn-ghost" style="padding:3px 6px;font-size:11px;color:var(--accent-red)" onclick="apDeleteMedia(' + md.id + ')">🗑</button>' +
          '</div></div></div>';
    }).join('') + '</div>';
  }).catch(function(e) { apToast(e.message, 'error'); });
}

function apUpload(files) {
  files = Array.prototype.slice.call(files || []);
  if (!files.length) return;
  var model = ap.mediaModel, kind = ap.mediaKind, box = document.getElementById('ap-upload-progress');
  var bad = files.filter(function(f) { return kind === 'reel' ? !/^video\//.test(f.type) : !/^(image|video)\//.test(f.type); });
  if (bad.length) apToast(bad.length + ' fichier(s) ignoré(s) : ' + (kind === 'reel' ? 'un reel doit être une vidéo' : 'photos ou vidéos uniquement'), 'error');
  files = files.filter(function(f) { return bad.indexOf(f) < 0; }).sort(function(a, b) { return a.name.localeCompare(b.name, 'fr', { numeric: true }); });
  var queue = files.slice(), done = 0, failed = 0;
  ap.uploads += files.length;
  var paint = function() { if (box) box.innerHTML = files.length ? '<div style="font-size:13px;color:var(--text-secondary)">Import : ' + done + '/' + files.length + (failed ? ' · <span style="color:var(--accent-red)">' + failed + ' échec(s)</span>' : '') + '</div><div style="height:6px;background:var(--bg-subtle);border-radius:4px;margin-top:6px"><div id="ap-bar" style="height:100%;width:' + Math.round(done / files.length * 100) + '%;background:var(--accent-blue);border-radius:4px;transition:width .2s"></div></div>' : ''; };
  paint();
  var one = function(file) {
    return apApi('POST', '/media/upload-url', { model_id: model, kind: kind, filename: file.name, mime: file.type, size: file.size }).then(function(u) {
      return new Promise(function(res, rej) {
        var x = new XMLHttpRequest();
        x.open('PUT', u.url);
        if (u.mode === 'local') x.withCredentials = true;
        x.setRequestHeader('Content-Type', u.mode === 'local' ? 'application/octet-stream' : file.type);
        x.onload = function() { x.status < 300 ? res(u) : rej(new Error('Upload refusé (' + x.status + ')')); };
        x.onerror = function() { rej(new Error('Upload impossible (réseau ou CORS du stockage)')); };
        x.send(file);
      });
    }).then(function(u) {
      return apApi('POST', '/media', { model_id: model, kind: kind, key: u.key, filename: file.name, mime: file.type, size: file.size });
    });
  };
  var worker = function() {
    var f = queue.shift();
    if (!f) return Promise.resolve();
    return one(f).then(function() { done++; }, function(e) { failed++; done++; console.error(e); apToast(f.name + ' : ' + e.message, 'error'); })
      .then(function() { ap.uploads--; paint(); return worker(); });
  };
  Promise.all([worker(), worker(), worker()]).then(function() {
    if (files.length) apToast((files.length - failed) + ' fichier(s) ajouté(s)', failed ? 'error' : 'success');
    apLoad(true).then(function() { if (document.getElementById('ap-modal') && ap.mediaModel === model) { apLoadMedia(); var m = apModel(model); document.querySelectorAll('#ap-modal .filter-chip').forEach(function(b, i) { var k = ['post', 'reel', 'story'][i]; if (m && k) b.querySelector('span').textContent = '(' + m.stock[k].total + ')'; }); } });
  });
}

function apEditCaption(id, current) {
  var v = prompt('Légende pour ce média (vide = pioche dans la liste) :', current || '');
  if (v === null) return;
  apApi('PATCH', '/media/' + id, { caption: v.trim() }).then(apLoadMedia).catch(function(e) { apToast(e.message, 'error'); });
}
function apToggleMedia(id, disabled) {
  apApi('PATCH', '/media/' + id, { disabled: disabled }).then(function() { apLoadMedia(); apLoad(true); }).catch(function(e) { apToast(e.message, 'error'); });
}
function apDeleteMedia(id) {
  if (!confirm('Supprimer définitivement ce média ?')) return;
  apApi('DELETE', '/media/' + id).then(function() { apLoadMedia(); apLoad(true); }).catch(function(e) { apToast(e.message, 'error'); });
}

// ========== PLANNING / HISTORIQUE ==========
function apRenderJobs(b, scope) {
  var models = ap.data.models;
  var sel = '<select class="form-input" id="ap-jobs-model" style="max-width:240px" onchange="apRenderJobs(document.getElementById(\'ap-body\'), \'' + scope + '\')"><option value="">Toutes les modèles</option>' +
    models.map(function(m) { return '<option value="' + m.id + '"' + (String(ap.jobsModel || '') === String(m.id) ? ' selected' : '') + '>' + apEsc(m.name) + '</option>'; }).join('') + '</select>';
  var prev = document.getElementById('ap-jobs-model');
  ap.jobsModel = prev ? prev.value : (ap.jobsModel || '');
  b.innerHTML = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">' + sel + '</div><div id="ap-jobs"><div class="skeleton-table" style="height:200px"></div></div>';
  document.getElementById('ap-jobs-model').value = ap.jobsModel;
  apApi('GET', '/jobs?scope=' + scope + (ap.jobsModel ? '&model_id=' + ap.jobsModel : '') + '&limit=300').then(function(rows) {
    var el = document.getElementById('ap-jobs');
    if (!rows.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + (scope === 'upcoming' ? 'Rien de prévu. Active une modèle et ajoute du contenu.' : 'Pas encore de publication') + '</div></div>'; return; }
    var lastDay = '', html = '';
    rows.forEach(function(j) {
      var when = j.done_at || j.scheduled_at, day = apFmtDay(when);
      if (day !== lastDay) { html += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-tertiary);margin:16px 0 6px">' + day + '</div>'; lastDay = day; }
      var st = AP_STATUS[j.status] || [j.status, 'var(--text-tertiary)'];
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border-default);border-radius:10px;margin-bottom:6px;background:var(--bg-surface)">' +
        '<div style="font-variant-numeric:tabular-nums;font-weight:600;width:48px">' + apFmtTime(when) + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-weight:600">' + apEsc(j.model_name) + ' · ' + AP_KIND1[j.kind] + ' <span style="font-weight:400;color:var(--text-tertiary);font-size:12px">' + (AP_AUD[j.audience] || '') + '</span>' + (j.is_rotation ? ' ' + apPill('Repost', 'var(--accent-purple)') : '') + '</div>' +
          '<div style="font-size:12px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + apEsc(j.filename || (j.status === 'pending' ? 'Contenu choisi au moment de publier' : '')) + (j.caption ? ' · « ' + apEsc(j.caption) + ' »' : '') + '</div>' +
          (j.error ? '<div style="font-size:12px;color:var(--accent-red);margin-top:2px">' + apEsc(j.error) + '</div>' : '') + '</div>' +
        (j.likes != null ? '<div style="font-weight:600">❤️ ' + j.likes + '</div>' : '') +
        apPill(st[0], st[1]) +
        (j.has_screenshot ? '<a class="btn btn-ghost" style="padding:4px 8px;font-size:12px" href="/api/autopost/jobs/' + j.id + '/screenshot" target="_blank" rel="noopener">Capture</a>' : '') +
        (j.status === 'failed' || j.status === 'skipped' ? '<button class="btn btn-secondary" style="padding:4px 8px;font-size:12px" onclick="apJobAction(' + j.id + ',\'retry\',\'' + scope + '\')">Relancer</button>' : '') +
        (j.status === 'pending' ? '<button class="btn btn-ghost" style="padding:4px 8px;font-size:12px" onclick="apJobAction(' + j.id + ',\'cancel\',\'' + scope + '\')">Annuler</button>' : '') +
      '</div>';
    });
    el.innerHTML = html;
  }).catch(function(e) { apToast(e.message, 'error'); });
}
function apJobAction(id, action, scope) {
  apApi('POST', '/jobs/' + id + '/' + action).then(function() { apToast(action === 'retry' ? 'Relancé, le bot s\'en occupe' : 'Créneau annulé', 'success'); apRenderJobs(document.getElementById('ap-body'), scope); })
    .catch(function(e) { apToast(e.message, 'error'); });
}

// ========== RAPPORTS ==========
function apRenderReports(b) {
  var models = ap.data.models;
  b.innerHTML = '<div class="panel" style="padding:16px;margin-bottom:14px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
    '<select class="form-input" id="ap-rep-model" style="max-width:240px">' + models.map(function(m) { return '<option value="' + m.id + '">' + apEsc(m.name) + '</option>'; }).join('') + '</select>' +
    '<select class="form-input" id="ap-rep-days" style="max-width:160px"><option value="7">7 derniers jours</option><option value="14" selected>14 derniers jours</option><option value="30">30 derniers jours</option></select>' +
    '<button class="btn btn-primary" onclick="apGenerateReport()">Analyser maintenant</button></div>' +
    '<div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">Le bot relève les j\'aime de chaque post et les stats Reveal tous les soirs, et t\'envoie un rapport chaque lundi.</div></div>' +
    '<div id="ap-reports"><div class="skeleton-card" style="height:140px"></div></div>';
  apApi('GET', '/reports').then(function(list) {
    document.getElementById('ap-reports').innerHTML = list.length ? list.map(apReportCard).join('') : '<div class="empty-state"><div class="empty-state-title">Pas encore de rapport</div></div>';
  });
}
function apReportCard(r) {
  var d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
  var bars = function(title, g) {
    var e = Object.entries(g || {}).filter(function(x) { return x[1].n; });
    if (!e.length) return '';
    var max = Math.max.apply(null, e.map(function(x) { return x[1].avg || 0; })) || 1;
    return '<div style="flex:1;min-width:200px"><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">' + title + '</div>' + e.map(function(x) {
      return '<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:4px"><div style="width:80px;color:var(--text-tertiary)">' + apEsc(x[0]) + '</div>' +
        '<div style="flex:1;height:8px;background:var(--bg-subtle);border-radius:4px"><div style="height:100%;width:' + Math.round((x[1].avg || 0) / max * 100) + '%;background:var(--accent-blue);border-radius:4px"></div></div>' +
        '<div style="width:70px;text-align:right">' + (x[1].avg != null ? x[1].avg : '–') + ' <span style="color:var(--text-muted)">(' + x[1].n + ')</span></div></div>';
    }).join('') + '</div>';
  };
  return '<div class="panel" style="padding:16px;margin-bottom:12px">' +
    '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-weight:700">' + apEsc(r.model_name || '') + '</div><div style="font-size:12px;color:var(--text-tertiary)">' + apFmtFull(r.created_at) + '</div></div>' +
    '<div style="white-space:pre-wrap;font-size:14px;line-height:1.55;margin:10px 0 14px">' + apEsc(r.summary).replace(/^📊[^\n]*\n/, '') + '</div>' +
    '<div style="display:flex;gap:20px;flex-wrap:wrap">' + bars('J\'aime moyens par type', d.byKind) + bars('Par créneau', d.bySlot) + bars('Neuf vs repost', d.byRotation) + '</div></div>';
}
function apGenerateReport() {
  var id = document.getElementById('ap-rep-model').value, days = document.getElementById('ap-rep-days').value;
  apApi('POST', '/reports/generate', { model_id: id, days: days }).then(function() { apToast('Analyse terminée', 'success'); apRenderReports(document.getElementById('ap-body')); })
    .catch(function(e) { apToast(e.message, 'error'); });
}

// ========== RÉGLAGES GÉNÉRAUX ==========
function apRenderSettings(b) {
  var a = ap.data.agency;
  b.innerHTML = '<div class="panel" style="padding:16px;margin-bottom:14px">' +
    '<div class="form-group"><label class="form-label">Légendes par défaut (toutes les modèles, une par ligne)</label><textarea class="form-input" id="ap-captions" rows="8">' + apEsc(a.captions) + '</textarea></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border-default)"><div><div style="font-weight:600">Rapport hebdo sur WhatsApp</div><div style="font-size:12px;color:var(--text-tertiary)">Chaque lundi, l\'analyse de chaque modèle</div></div>' + apToggle('ap-wa-rep', a.whatsapp_reports) + '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border-default)"><div><div style="font-weight:600">Alertes sur WhatsApp</div><div style="font-size:12px;color:var(--text-tertiary)">Échecs de publication, connexion expirée, stock bas</div></div>' + apToggle('ap-wa-fail', a.whatsapp_failures) + '</div>' +
    '<button class="btn btn-primary" style="margin-top:8px" onclick="apSaveAgency()">Enregistrer</button></div>' +
    '<div class="panel" style="padding:16px"><div style="font-weight:600;margin-bottom:8px">Journal du bot</div><div id="ap-logs" style="font-size:12px;font-family:ui-monospace,monospace;max-height:320px;overflow:auto;color:var(--text-secondary)">Chargement…</div></div>';
  apApi('GET', '/logs').then(function(rows) {
    document.getElementById('ap-logs').innerHTML = rows.length ? rows.map(function(l) {
      var col = l.level === 'error' ? 'var(--accent-red)' : l.level === 'warn' ? 'var(--accent-yellow)' : 'var(--text-tertiary)';
      return '<div style="padding:3px 0;border-bottom:1px solid var(--border-subtle)"><span style="color:var(--text-muted)">' + apFmtFull(l.created_at) + '</span> <span style="color:' + col + '">' + apEsc(l.message) + '</span></div>';
    }).join('') : 'Rien pour l\'instant.';
  });
}
function apSaveAgency() {
  apApi('PUT', '/agency', { captions: document.getElementById('ap-captions').value, whatsapp_reports: document.getElementById('ap-wa-rep').checked, whatsapp_failures: document.getElementById('ap-wa-fail').checked })
    .then(function() { apToast('Enregistré', 'success'); apLoad(true); }).catch(function(e) { apToast(e.message, 'error'); });
}

// ========== CONNEXION REVEAL ==========
function apOpenSession() {
  apApi('GET', '/session/bookmarklet').then(function(r) {
    apModal('Connecter le compte agence Reveal',
      '<ol style="padding-left:18px;color:var(--text-secondary);font-size:14px;line-height:1.7;margin:0 0 14px">' +
        '<li>Glisse ce bouton dans ta barre de favoris : <a id="ap-bm" href="#" style="display:inline-block;padding:4px 10px;border-radius:8px;background:var(--accent-blue);color:#fff;text-decoration:none;font-weight:600" onclick="event.preventDefault();apToast(\'Glisse-le dans ta barre de favoris\')">Session Reveal</a></li>' +
        '<li>Va sur <b>dashboard.reveal.me</b>, connecté à ton compte agence, et clique sur ce favori.</li>' +
        '<li>Colle ici ce qu\'il a copié :</li></ol>' +
      '<textarea class="form-input" id="ap-session-text" rows="5" placeholder="Colle la session ici"></textarea>' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">La session est chiffrée dans la base. Ne la partage avec personne : elle donne accès au compte agence. Si tu te déconnectes de Reveal sur ce navigateur, elle peut expirer : refais juste l\'opération.</div>',
      '<button class="btn btn-ghost" onclick="apCloseModal()">Annuler</button><button class="btn btn-primary" onclick="apSaveSession()">Enregistrer</button>');
    document.getElementById('ap-bm').setAttribute('href', r.bookmarklet);
  });
}
function apSaveSession() {
  var v = document.getElementById('ap-session-text').value.trim();
  if (!v) return apToast('Colle la session d\'abord', 'error');
  apApi('POST', '/session', { export: v }).then(function() { apCloseModal(); apToast('Session enregistrée, le bot la vérifie dans la minute', 'success'); apLoad(); })
    .catch(function(e) { apToast(e.message, 'error'); });
}
