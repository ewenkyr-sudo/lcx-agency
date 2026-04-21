// MODEL TOOLS — Fiche personnelle + Planning modèle + Tracklinks
// Integrated as tabs in model cockpit

// ========== FICHE PERSONNELLE ==========

var CONTENT_PREF_OPTIONS = [
  'Bikini', 'Pieds', 'Fesses', 'Lingerie', 'Notes vocales', 'Poitrine caché',
  'Photos de sexe féminin', 'Photos/Vidéos entièrement nues', 'Évaluations de pénis (texte)',
  'Contenu fille-fille', 'Contenu garçon-fille', 'Contenu de masturbation nu',
  'Anal', 'Vidéos JOI', 'Vidéos de twerk', 'Contenu avec gode'
];

async function renderModelProfile(modelId) {
  var container = document.getElementById('cockpit-profile-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Chargement...</div>';
  var res = await fetch('/api/model-profile/' + modelId, { credentials: 'include' });
  var p = await res.json();
  var canEdit = isAdmin();

  container.innerHTML = '<form id="profile-form" style="display:grid;gap:20px;max-width:700px">'
    // Section 1: Infos de base
    + '<div style="background:var(--bg3);padding:16px;border-radius:12px"><h4 style="color:var(--accent2);margin-bottom:12px;font-size:14px">Informations de base</h4>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + pf('Nom en ligne', 'online_name', p.online_name) + pf('Âge', 'age', p.age, 'number')
    + pf('Date de naissance', 'birth_date', p.birth_date ? p.birth_date.substring(0,10) : '', 'date') + pf('Signe astrologique', 'zodiac_sign', p.zodiac_sign)
    + pf('Orientation sexuelle', 'sexual_orientation', p.sexual_orientation) + pf('Origine ethnique', 'ethnicity', p.ethnicity)
    + pf('Taille', 'height', p.height) + pf('Pointure', 'shoe_size', p.shoe_size)
    + pf('Taille soutien-gorge', 'bra_size', p.bra_size) + pf('Localisation', 'location', p.location)
    + pf('Originaire de', 'hometown', p.hometown) + pf('Langues parlées', 'spoken_languages', p.spoken_languages)
    + pf('Niveau d\'anglais', 'english_level', p.english_level)
    + '</div></div>'
    // Section 2: Profil personnel
    + '<div style="background:var(--bg3);padding:16px;border-radius:12px"><h4 style="color:var(--accent2);margin-bottom:12px;font-size:14px">Profil personnel</h4>'
    + pfArea('À propos', 'about', p.about)
    + pfArea('Personnalité & style de discussion', 'personality', p.personality)
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + pf('Loisirs', 'hobbies', p.hobbies) + pf('Couleur préférée', 'fav_color', p.fav_color)
    + pf('Plat préféré', 'fav_food', p.fav_food) + pf('Musique préférée', 'fav_music', p.fav_music)
    + pf('Chanteuse préférée', 'fav_singer', p.fav_singer) + pf('Sports', 'sports', p.sports)
    + pf('Animaux', 'pets', p.pets) + pf('Université', 'university', p.university)
    + pf('Spécialité', 'specialty', p.specialty) + pf('Autre emploi', 'other_job', p.other_job)
    + '</div></div>'
    // Section 3: Préférences de contenu
    + '<div style="background:var(--bg3);padding:16px;border-radius:12px"><h4 style="color:var(--accent2);margin-bottom:12px;font-size:14px">Préférences de contenu</h4>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px" id="pref-checks">'
    + CONTENT_PREF_OPTIONS.map(function(opt) {
      var checked = p.content_prefs && p.content_prefs[opt];
      return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px 0"><input type="checkbox" data-pref="' + opt + '"' + (checked ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' style="width:16px;height:16px;cursor:pointer"><span>' + opt + '</span></label>';
    }).join('')
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">'
    + pfBool('Demandes personnalisées', 'custom_requests', p.custom_requests) + pfBool('Appels vidéo', 'video_calls', p.video_calls)
    + pfBool('Live sur OF', 'live_of', p.live_of) + pfBool('Autres personnes présentes', 'other_people', p.other_people)
    + '</div></div>'
    // Section 4: Notes supplémentaires
    + '<div style="background:var(--bg3);padding:16px;border-radius:12px"><h4 style="color:var(--accent2);margin-bottom:12px;font-size:14px">Notes supplémentaires</h4>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + pf('Statut relationnel public', 'relationship_status', p.relationship_status)
    + pf('Expérience de voyage', 'travel_experience', p.travel_experience)
    + pf('Partie du corps la plus sexy', 'sexiest_body_part', p.sexiest_body_part)
    + pf('Apparence physique', 'physical_appearance', p.physical_appearance)
    + pf('Disponibilité de travail', 'work_availability', p.work_availability)
    + pf('Expérience plateformes adultes', 'of_experience', p.of_experience)
    + pf('Revenus', 'current_revenue', p.current_revenue)
    + pf('Équipement', 'equipment', p.equipment)
    + '</div>'
    + pfArea('Situation actuelle', 'current_situation', p.current_situation)
    + pfArea('Bloqué / Remarques', 'blocked_notes', p.blocked_notes)
    + '</div>'
    + (canEdit ? '<button type="button" class="btn btn-primary" onclick="saveModelProfile(' + modelId + ')" style="width:fit-content">Sauvegarder la fiche</button>' : '')
    + '</form>';
}

function pf(label, name, value, type) {
  return '<div class="form-group" style="margin-bottom:0"><label class="form-label" style="font-size:10px">' + label + ' <span style="color:var(--red)">*</span></label><input class="form-input" id="pf-' + name + '" type="' + (type||'text') + '" value="' + (value||'').toString().replace(/"/g,'&quot;') + '" required style="padding:7px 10px;font-size:12px"></div>';
}
function pfArea(label, name, value) {
  return '<div class="form-group"><label class="form-label" style="font-size:10px">' + label + ' <span style="color:var(--red)">*</span></label><textarea class="form-input" id="pf-' + name + '" rows="2" required style="font-size:12px;resize:vertical">' + (value||'') + '</textarea></div>';
}
function pfBool(label, name, value) {
  return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="pf-' + name + '"' + (value ? ' checked' : '') + ' style="width:16px;height:16px"><span>' + label + '</span></label>';
}

async function saveModelProfile(modelId) {
  var g = function(id) { var el = document.getElementById('pf-' + id); return el ? el.value.trim() : ''; };
  var gc = function(id) { var el = document.getElementById('pf-' + id); return el ? el.checked : false; };

  // Validate all required fields
  var requiredFields = [
    'online_name', 'age', 'birth_date', 'zodiac_sign', 'sexual_orientation', 'ethnicity',
    'height', 'shoe_size', 'bra_size', 'location', 'hometown', 'spoken_languages', 'english_level',
    'about', 'personality', 'hobbies', 'fav_color', 'fav_food', 'fav_music', 'fav_singer',
    'sports', 'pets', 'university', 'specialty', 'other_job',
    'relationship_status', 'travel_experience', 'sexiest_body_part', 'physical_appearance',
    'work_availability', 'of_experience', 'current_revenue', 'equipment',
    'current_situation', 'blocked_notes'
  ];
  var missing = [];
  for (var i = 0; i < requiredFields.length; i++) {
    var el = document.getElementById('pf-' + requiredFields[i]);
    if (el && !el.value.trim()) {
      el.style.borderColor = 'var(--red)';
      missing.push(requiredFields[i]);
    } else if (el) {
      el.style.borderColor = '';
    }
  }
  if (missing.length > 0) {
    showToast('Il reste ' + missing.length + ' champ(s) obligatoire(s) à remplir', 'error');
    // Scroll to first empty field
    var firstEmpty = document.getElementById('pf-' + missing[0]);
    if (firstEmpty) firstEmpty.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  var prefs = {};
  document.querySelectorAll('#pref-checks input[data-pref]').forEach(function(cb) { prefs[cb.dataset.pref] = cb.checked; });

  var data = {
    online_name: g('online_name'), age: parseInt(g('age'))||null, birth_date: g('birth_date')||null, zodiac_sign: g('zodiac_sign'),
    sexual_orientation: g('sexual_orientation'), ethnicity: g('ethnicity'), height: g('height'),
    shoe_size: g('shoe_size'), bra_size: g('bra_size'), location: g('location'), hometown: g('hometown'),
    spoken_languages: g('spoken_languages'), english_level: g('english_level'),
    about: g('about'), personality: g('personality'), hobbies: g('hobbies'),
    fav_color: g('fav_color'), fav_food: g('fav_food'), fav_music: g('fav_music'), fav_singer: g('fav_singer'),
    sports: g('sports'), pets: g('pets'), university: g('university'), specialty: g('specialty'), other_job: g('other_job'),
    content_prefs: prefs, custom_requests: gc('custom_requests'), video_calls: gc('video_calls'),
    live_of: gc('live_of'), other_people: gc('other_people'),
    relationship_status: g('relationship_status'), travel_experience: g('travel_experience'),
    sexiest_body_part: g('sexiest_body_part'), physical_appearance: g('physical_appearance'),
    work_availability: g('work_availability'), of_experience: g('of_experience'),
    current_revenue: g('current_revenue'), equipment: g('equipment'),
    current_situation: g('current_situation'), blocked_notes: g('blocked_notes')
  };
  var res = await fetch('/api/model-profile/' + modelId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) showToast(t('mp.profile_saved'), 'success');
  else showToast('Erreur', 'error');
}

// ========== PLANNING MODÈLE ==========

var msDate = new Date();
var msItems = [];

async function renderModelSchedule(modelId) {
  var container = document.getElementById('cockpit-schedule-content');
  if (!container) return;
  var mon = getCPMonday(msDate);
  var sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  var start = fmtDateISO(mon), end = fmtDateISO(sun);
  var res = await fetch('/api/model-schedule/' + modelId + '?start=' + start + '&end=' + end, { credentials: 'include' });
  msItems = await res.json();

  var days = []; for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(d.getDate()+i); days.push(d); }
  var dayNames = ['LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE'];
  var hours = ['10:00','12:00','14:00','17:00','18:00','18:30','19:00','20:00','21:30','22:00','23:00','23:30','00:00'];
  var today = new Date(); today.setHours(0,0,0,0);
  var catColors = { content: '#22D3EE', live: '#dc2626', call: '#FBBF24', deadline: '#F472B6', task: '#A855F7' };

  var html = '<div class="cp-toolbar">'
    + '<button class="cp-nav-btn" onclick="msNavigate(-1,' + modelId + ')">←</button>'
    + '<button class="cp-nav-btn" onclick="msToday(' + modelId + ')">Aujourd\'hui</button>'
    + '<button class="cp-nav-btn" onclick="msNavigate(1,' + modelId + ')">→</button>'
    + '<div class="cp-toolbar-title">Semaine du ' + mon.getDate() + '/' + (mon.getMonth()+1) + ' au ' + sun.getDate() + '/' + (sun.getMonth()+1) + '</div>'
    + (isAdmin() ? '<button class="btn btn-primary" style="font-size:12px;margin-left:auto" onclick="openMSModal(' + modelId + ')">+ Ajouter</button>' : '')
    + '</div>';

  html += '<div style="display:grid;grid-template-columns:60px repeat(7,1fr);border:1px solid var(--border);border-radius:12px;overflow:hidden">';
  // Header
  html += '<div style="background:var(--bg4);padding:8px;border-bottom:1px solid var(--border)"></div>';
  for (var i = 0; i < 7; i++) {
    var isToday = days[i].getTime() === today.getTime();
    html += '<div style="background:var(--bg4);padding:8px;text-align:center;font-size:10px;font-weight:700;color:' + (isToday?'var(--accent)':'var(--text3)') + ';border-bottom:1px solid var(--border);border-left:1px solid var(--border)">' + dayNames[i] + '<br>' + days[i].getDate() + '/' + (days[i].getMonth()+1) + '</div>';
  }
  // Rows
  for (var hi = 0; hi < hours.length; hi++) {
    html += '<div style="padding:4px 6px;font-size:10px;color:var(--text3);text-align:right;border-bottom:1px solid var(--border);min-height:40px;display:flex;align-items:flex-start;justify-content:flex-end">' + hours[hi] + '</div>';
    for (var di = 0; di < 7; di++) {
      var dayStr = fmtDateISO(days[di]);
      var cellItems = msItems.filter(function(it) { return it.day_date && it.day_date.substring(0,10) === dayStr && (it.time_slot === hours[hi] || (!it.time_slot && hi === 0)); });
      html += '<div style="border-left:1px solid var(--border);border-bottom:1px solid var(--border);padding:2px;min-height:40px;cursor:pointer" onclick="' + (isAdmin()?'openMSModal('+modelId+',\''+dayStr+'\',\''+hours[hi]+'\')':'') + '">';
      cellItems.forEach(function(it) {
        var col = catColors[it.category] || it.color || '#A855F7';
        html += '<div onclick="event.stopPropagation();openMSModal(' + modelId + ',null,null,' + it.id + ')" style="background:' + col + ';color:white;padding:3px 6px;border-radius:4px;font-size:9px;font-weight:600;margin:1px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + it.title + '</div>';
      });
      html += '</div>';
    }
  }
  html += '</div>';

  // Tasks sections
  var modelTasks = msItems.filter(function(it) { return it.category === 'model_task'; });
  var agencyTasks = msItems.filter(function(it) { return it.category === 'agency_task'; });
  if (modelTasks.length > 0 || agencyTasks.length > 0) {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">';
    html += '<div style="background:var(--bg3);padding:12px;border-radius:10px"><strong style="font-size:12px;display:block;margin-bottom:8px">TÂCHES À EFFECTUER PAR LA MODÈLE</strong>';
    modelTasks.forEach(function(t) { html += '<div style="font-size:12px;color:var(--text2);padding:2px 0">• ' + t.title + '</div>'; });
    html += '</div>';
    html += '<div style="background:var(--bg3);padding:12px;border-radius:10px"><strong style="font-size:12px;display:block;margin-bottom:8px">TÂCHES À EFFECTUER PAR L\'AGENCE</strong>';
    agencyTasks.forEach(function(t) { html += '<div style="font-size:12px;color:var(--text2);padding:2px 0">• ' + t.title + '</div>'; });
    html += '</div></div>';
  }

  container.innerHTML = html;
}

function msNavigate(dir, modelId) { msDate.setDate(msDate.getDate() + 7*dir); renderModelSchedule(modelId); }
function msToday(modelId) { msDate = new Date(); renderModelSchedule(modelId); }

function openMSModal(modelId, dayDate, timeSlot, editId) {
  var item = editId ? msItems.find(function(it) { return it.id === editId; }) : null;
  var cats = [
    { val: 'content', label: '📸 Contenu à produire', col: '#22D3EE' },
    { val: 'live', label: '🔴 Live', col: '#dc2626' },
    { val: 'call', label: '📞 Call', col: '#FBBF24' },
    { val: 'deadline', label: '⏰ Deadline', col: '#F472B6' },
    { val: 'task', label: '✅ Tâche', col: '#A855F7' },
    { val: 'model_task', label: '👤 Tâche modèle (en bas)', col: '#10B981' },
    { val: 'agency_task', label: '🏢 Tâche agence (en bas)', col: '#3B82F6' }
  ];
  var html = '<div class="modal-overlay show" id="ms-modal" onclick="if(event.target===this)document.getElementById(\'ms-modal\').remove()">'
    + '<div class="modal" style="width:420px"><div class="modal-header"><div class="modal-title">' + (item ? 'Modifier' : 'Ajouter') + '</div><button class="modal-close" onclick="document.getElementById(\'ms-modal\').remove()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">Titre *</label><input class="form-input" id="ms-title" value="' + (item ? item.title : '') + '"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="ms-date" value="' + (item ? item.day_date.substring(0,10) : dayDate || fmtDateISO(new Date())) + '"></div>'
    + '<div class="form-group"><label class="form-label">Heure</label><input type="time" class="form-input" id="ms-time" value="' + (item ? (item.time_slot||'') : timeSlot || '') + '"></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Catégorie</label><select class="form-input" id="ms-cat">' + cats.map(function(c) { return '<option value="' + c.val + '"' + (item && item.category === c.val ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') + '</select></div>'
    + '<div class="form-group"><label class="form-label">Notes</label><textarea class="form-input" id="ms-notes" rows="2">' + (item ? (item.notes||'') : '') + '</textarea></div>'
    + '</div><div class="modal-footer">'
    + (item ? '<button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer" onclick="deleteMSItem(' + item.id + ',' + modelId + ')">Supprimer</button>' : '')
    + '<div style="flex:1"></div><button class="btn btn-secondary" onclick="document.getElementById(\'ms-modal\').remove()">Annuler</button>'
    + '<button class="btn btn-primary" onclick="saveMSItem(' + modelId + ',' + (editId||'null') + ')">' + (item ? 'Enregistrer' : 'Ajouter') + '</button>'
    + '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveMSItem(modelId, editId) {
  var title = document.getElementById('ms-title').value.trim();
  if (!title) return showToast(t('ms.title_required'), 'error');
  var data = { model_id: modelId, day_date: document.getElementById('ms-date').value, time_slot: document.getElementById('ms-time').value || null, title: title, category: document.getElementById('ms-cat').value, notes: document.getElementById('ms-notes').value };
  var url = editId ? '/api/model-schedule/' + editId : '/api/model-schedule';
  var method = editId ? 'PUT' : 'POST';
  await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  document.getElementById('ms-modal').remove();
  showToast(editId ? 'Modifié' : t('ms.added_toast'), 'success');
  renderModelSchedule(modelId);
}

async function deleteMSItem(id, modelId) {
  await fetch('/api/model-schedule/' + id, { method: 'DELETE', credentials: 'include' });
  document.getElementById('ms-modal').remove();
  showToast(t('ms.deleted_toast'), 'success');
  renderModelSchedule(modelId);
}

// ========== TRACKLINKS ==========

async function renderModelTracklinks(modelId) {
  var container = document.getElementById('cockpit-tracklinks-content');
  if (!container) return;
  var res = await fetch('/api/model-tracklinks/' + modelId, { credentials: 'include' });
  var links = await res.json();

  var html = isAdmin() ? '<div style="margin-bottom:12px"><button class="btn btn-primary" style="font-size:12px" onclick="addTracklink(' + modelId + ')">+ Ajouter un lien</button></div>' : '';
  html += '<table class="table mobile-cards"><thead><tr><th>Réseau social</th><th>Account</th><th>Link</th>' + (isAdmin()?'<th></th>':'') + '</tr></thead><tbody>';
  if (links.length === 0) {
    html += '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">Aucun tracklink</td></tr>';
  } else {
    links.forEach(function(l) {
      html += '<tr>'
        + '<td data-label="Réseau" class="mc-half"><strong>' + l.platform + '</strong></td>'
        + '<td data-label="Account" class="mc-half">' + (l.account_name || '-') + '</td>'
        + '<td data-label="Link" class="mc-full">' + (l.link ? '<a href="' + l.link + '" target="_blank" style="color:var(--accent2);word-break:break-all">' + l.link + '</a>' : '-') + '</td>'
        + (isAdmin() ? '<td data-label="" class="mc-half"><button class="btn-delete-small" onclick="deleteTracklink(' + l.id + ',' + modelId + ')">✕</button></td>' : '')
        + '</tr>';
    });
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function addTracklink(modelId) {
  var platform = await showPromptModal('Réseau social', 'Ex: Instagram, TikTok, OnlyFans...');
  if (!platform) return;
  var account = await showPromptModal('Nom du compte', 'Ex: @chloe.agts');
  var link = await showPromptModal('Lien', 'https://...');
  await fetch('/api/model-tracklinks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ model_id: modelId, platform: platform, account_name: account, link: link }) });
  showToast(t('tl.added_toast'), 'success');
  renderModelTracklinks(modelId);
}

async function deleteTracklink(id, modelId) {
  if (!(await confirmDelete(t('tl.delete_confirm')))) return;
  await fetch('/api/model-tracklinks/' + id, { method: 'DELETE', credentials: 'include' });
  renderModelTracklinks(modelId);
}
