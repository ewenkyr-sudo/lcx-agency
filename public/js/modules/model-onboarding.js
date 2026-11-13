// MODEL ONBOARDING WIZARD
// 6-step quiz when adding a new model

var moStep = 1;
var moTotalSteps = 6;
var moEditId = null;      // id de la modèle en cours de modification (null = création)
var moEditOrig = null;    // plateformes d'origine (pour ne pas perdre celles que l'assistant ne gère pas)
var MO_MANAGED_PLATFORMS = ['instagram', 'tiktok', 'twitter', 'onlyfans', 'fansly', 'fanvue', 'mym', 'reveal'];

// Ouvre l'assistant pré-rempli pour modifier une modèle existante
function openModelEdit(id) {
  var m = (allModels || []).find(function(x) { return x.id === id; });
  if (!m) return;
  var arr = function(v) { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  var data = {};
  Object.keys(m).forEach(function(k) { if (m[k] !== null && m[k] !== undefined) data[k] = m[k]; });
  data.platforms = arr(m.platforms);
  data.content_types = arr(m.content_types); data.languages = arr(m.languages); data.target_markets = arr(m.target_markets);
  if (data.birth_date) data.birth_date = String(data.birth_date).slice(0, 10);
  ['revenue_goal', 'of_revenue_monthly', 'fansly_revenue_monthly', 'fanvue_revenue_monthly', 'mym_revenue_monthly', 'reveal_revenue_monthly'].forEach(function(k) { if (data[k] != null) data[k] = parseFloat(data[k]) || 0; });
  // une plateforme listée sur la carte = case cochée, même si elle a été ajoutée sans l'assistant
  var keyOf = { onlyfans: 'of', fansly: 'fansly', fanvue: 'fanvue', mym: 'mym', reveal: 'reveal' };
  data.platforms.forEach(function(pl) { if (keyOf[pl]) data['has_' + keyOf[pl] + '_account'] = true; });
  if (m.autopost_reveal_id) data.reveal_dashboard_url = 'https://dashboard.reveal.me/models/' + m.autopost_reveal_id;
  moEditId = id;
  moEditOrig = data.platforms.slice();
  moData = data;
  openModelOnboarding(true);
}

function openModelOnboarding(keepData) {
  moStep = 1;
  if (!keepData) { moEditId = null; moEditOrig = null; moData = {}; }
  var overlay = document.getElementById('modal-add-model');
  overlay.innerHTML = '<div class="modal" style="width:560px;max-height:90vh;overflow-y:auto">'
    + '<div class="modal-header">'
    + '<div class="modal-title">' + (moEditId ? 'Modifier ' + String(moData.name || '').replace(/</g, '&lt;') : 'Nouvelle créatrice') + ' — Étape <span id="mo-step-num">1</span>/6</div>'
    + '<button class="modal-close" onclick="closeModal(\'add-model\')">✕</button>'
    + '</div>'
    + '<div style="padding:0 24px"><div style="height:4px;background:var(--bg4);border-radius:2px;overflow:hidden"><div id="mo-progress" style="height:100%;width:16.6%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:2px;transition:width 0.3s"></div></div></div>'
    + '<div class="modal-body" id="mo-body"></div>'
    + '<div class="modal-footer">'
    + '<button class="btn btn-secondary" id="mo-back" onclick="moBack()" style="display:none">Précédent</button>'
    + '<div style="flex:1"></div>'
    + '<button class="btn btn-primary" id="mo-next" onclick="moNext()">Continuer</button>'
    + '</div></div>';
  overlay.classList.add('show');
  renderMOStep();
}

// Override the default openModal for add-model
var _origOpenModal = window.openModal;
window.openModal = function(name) {
  if (name === 'add-model') return openModelOnboarding();
  return _origOpenModal(name);
};

function renderMOStep() {
  var body = document.getElementById('mo-body');
  if (!body) return;
  document.getElementById('mo-step-num').textContent = moStep;
  document.getElementById('mo-progress').style.width = (moStep / moTotalSteps * 100) + '%';
  document.getElementById('mo-back').style.display = moStep > 1 ? '' : 'none';
  document.getElementById('mo-next').textContent = moStep === moTotalSteps ? (moEditId ? 'Enregistrer' : t('mo.add_creator_btn')) : t('common.continue');

  if (moStep === 1) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Identité</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Informations de base sur la créatrice</p>'
      + moField(t('mo.firstname') + ' *', 'text', 'mo-name', 'Ex: Luna')
      + moField(t('mo.stage_name_alt'), 'text', 'mo-stage-name', 'Ex: Luna_exclusive')
      + '<div class="grid-2col" style="gap:12px">'
      + moField(t('mo.birth_date'), 'date', 'mo-birth')
      + moField(t('mo.nationality'), 'text', 'mo-nationality', 'Ex: Française')
      + '</div>'
      + '<div class="grid-2col" style="gap:12px">'
      + moField(t('mo.city'), 'text', 'mo-city', 'Ex: Paris')
      + moField(t('mo.country'), 'text', 'mo-country', 'Ex: France')
      + '</div>'
      + moField(t('mo.photo_url'), 'url', 'mo-photo', 'https://...');
  } else if (moStep === 2) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Réseaux sociaux</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Ses comptes actuels sur les réseaux</p>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">'
      + moField(t('mo.ig_label'), 'text', 'mo-ig', '@handle')
      + moField(t('mo.followers_ig'), 'number', 'mo-ig-followers', '0')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">'
      + moField(t('mo.tiktok_label'), 'text', 'mo-tiktok', '@handle')
      + moField(t('mo.followers_tt'), 'number', 'mo-tiktok-followers', '0')
      + '</div>'
      + moField(t('mo.twitter_label'), 'text', 'mo-twitter', '@handle')
      + moField(t('mo.snapchat_label'), 'text', 'mo-snapchat', '@handle')
      + moField(t('mo.other_socials'), 'text', 'mo-other-socials', 'Reddit, Telegram...');
  } else if (moStep === 3) {
    var platforms = [
      { key: 'of', label: '💎 OnlyFans', icon: '💎', color: '#0080FF' },
      { key: 'fansly', label: '🌸 Fansly', icon: '🌸', color: '#E040FB' },
      { key: 'fanvue', label: '💚 Fanvue', icon: '💚', color: '#10B981' },
      { key: 'mym', label: '🔥 MYM', icon: '🔥', color: '#F97316' },
      { key: 'reveal', label: '👀 Reveal', icon: '👀', color: '#E11D48' }
    ];
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Plateformes adultes</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Sur quelles plateformes la créatrice est-elle active ?</p>'
      + platforms.map(function(p) {
        var hasAccount = moData['has_' + p.key + '_account'];
        return '<div style="background:var(--bg-elevated);padding:14px;border-radius:10px;margin-bottom:10px;border-left:3px solid ' + p.color + '">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<strong style="font-size:14px">' + p.label + '</strong>'
          + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="mo-has-' + p.key + '" onchange="moTogglePlatform(\'' + p.key + '\')" ' + (hasAccount ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer"><span style="font-size:12px">' + (hasAccount ? t('mo.active') : 'Non') + '</span></label>'
          + '</div>'
          + '<div id="mo-plat-details-' + p.key + '" style="' + (hasAccount ? '' : 'display:none') + '">'
          + '<div class="grid-3col" style="gap:8px">'
          + moField(t('mo.link'), 'url', 'mo-' + p.key + '-link', 'https://...')
          + moField(t('mo.subscribers'), 'number', 'mo-' + p.key + '-subs', '0')
          + moField(t('mo.monthly_revenue'), 'number', 'mo-' + p.key + '-rev', '0')
          + '</div>'
          + (p.key === 'reveal' ? moField('Page de la modèle sur dashboard.reveal.me (pour l\'auto-post)', 'url', 'mo-reveal-dashboard', 'https://dashboard.reveal.me/models/...') : '')
          + '</div></div>';
      }).join('');
    // Restore values
    setTimeout(function() {
      platforms.forEach(function(p) {
        var s = function(id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
        s('mo-' + p.key + '-link', moData[p.key + '_link'] || moData[p.key === 'of' ? 'of_link' : p.key + '_link']);
        s('mo-' + p.key + '-subs', moData[p.key + '_subscribers'] || moData[p.key === 'of' ? 'of_subscribers' : p.key + '_subscribers']);
        s('mo-' + p.key + '-rev', moData[p.key + '_revenue_monthly'] || moData[p.key === 'of' ? 'of_revenue_monthly' : p.key + '_revenue_monthly']);
      });
      var rd = document.getElementById('mo-reveal-dashboard'); if (rd && moData.reveal_dashboard_url) rd.value = moData.reveal_dashboard_url;
    }, 20);
  } else if (moStep === 4) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Contenu</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Quel type de contenu elle produit</p>'
      + '<div class="form-group"><label class="form-label">Types de contenu</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="mo-content-types">'
      + ['Photos', 'Vidéos', 'Customs', 'Sexting', 'Lives', 'PPV', 'Dick ratings'].map(function(t) {
        var sel = (moData.content_types || []).includes(t) ? ' selected' : '';
        return '<button class="filter-chip' + sel + '" onclick="this.classList.toggle(\'selected\')" data-val="' + t + '">' + t + '</button>';
      }).join('') + '</div></div>'
      + moField(t('mo.post_frequency'), 'text', 'mo-frequency', 'Ex: 3 posts/jour')
      + '<div class="grid-2col" style="gap:12px">'
      + '<div class="form-group"><label class="form-label">A un photographe/vidéaste ?</label>'
      + '<select class="form-input" id="mo-photographer"><option value="false">Non</option><option value="true"' + (moData.has_photographer ? ' selected' : '') + '>Oui</option></select></div>'
      + moField(t('mo.content_stock'), 'number', 'mo-stock', '0')
      + '</div>';
  } else if (moStep === 5) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Objectifs</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Ses ambitions et disponibilités</p>'
      + moField(t('mo.revenue_goal'), 'number', 'mo-revenue-goal', 'Ex: 5000')
      + moField(t('mo.availability'), 'number', 'mo-availability', 'Ex: 20')
      + '<div class="form-group"><label class="form-label">Langues parlées</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="mo-languages">'
      + ['Français', 'English', 'Español', 'Deutsch', 'Italiano', 'Português', 'عربي'].map(function(l) {
        var sel = (moData.languages || []).includes(l) ? ' selected' : '';
        return '<button class="filter-chip' + sel + '" onclick="this.classList.toggle(\'selected\')" data-val="' + l + '">' + l + '</button>';
      }).join('') + '</div></div>'
      + '<div class="form-group"><label class="form-label">Marchés cibles</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="mo-markets">'
      + ['FR', 'US', 'UK', 'DE', 'ES', 'IT', 'LATAM', 'Multi'].map(function(m) {
        var sel = (moData.target_markets || []).includes(m) ? ' selected' : '';
        return '<button class="filter-chip' + sel + '" onclick="this.classList.toggle(\'selected\')" data-val="' + m + '">' + m + '</button>';
      }).join('') + '</div></div>';
  } else if (moStep === 6) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent-blue-light);margin-bottom:4px">Légal & admin</h3>'
      + '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Documents et notes internes</p>'
      + moField(t('mo.contract_link'), 'url', 'mo-contract', 'https://drive.google.com/...')
      + '<div class="form-group"><label class="form-label">Accord RGPD / Conditions acceptées</label>'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">'
      + '<input type="checkbox" id="mo-gdpr" style="width:18px;height:18px;cursor:pointer"' + (moData.gdpr_accepted ? ' checked' : '') + '>'
      + '<span style="font-size:13px">La créatrice a accepté les conditions</span></label></div>'
      + '<div class="form-group"><label class="form-label">Notes internes</label>'
      + '<textarea class="form-input" id="mo-notes" rows="3" placeholder="Notes visibles uniquement par les admins...">' + (moData.internal_notes || '') + '</textarea></div>';
  }

  // Restore values from moData
  restoreMOValues();
}

var moData = {};

function saveMOStep() {
  var g = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var gn = function(id) { var v = g(id); return v ? parseInt(v) : 0; };
  if (moStep === 1) {
    moData.name = g('mo-name'); moData.stage_name = g('mo-stage-name');
    moData.birth_date = g('mo-birth') || null; moData.nationality = g('mo-nationality');
    moData.city = g('mo-city'); moData.country = g('mo-country');
    var ph = g('mo-photo'); if (ph || String(moData.photo_url || '').indexOf('data:') !== 0) moData.photo_url = ph; // garde la photo importée
  } else if (moStep === 2) {
    moData.ig_handle = g('mo-ig'); moData.ig_followers = gn('mo-ig-followers');
    moData.tiktok_handle = g('mo-tiktok'); moData.tiktok_followers = gn('mo-tiktok-followers');
    moData.twitter_handle = g('mo-twitter'); moData.snapchat_handle = g('mo-snapchat');
    moData.other_socials = g('mo-other-socials');
    // Build platforms array
    var plats = [];
    if (moData.ig_handle) plats.push('instagram');
    if (moData.tiktok_handle) plats.push('tiktok');
    if (moData.twitter_handle) plats.push('twitter');
    // en modification : on garde les plateformes que l'assistant ne gère pas (ex : telegram)
    if (moEditOrig) moEditOrig.forEach(function(pl) { if (MO_MANAGED_PLATFORMS.indexOf(pl) < 0 && plats.indexOf(pl) < 0) plats.push(pl); });
    moData.platforms = plats;
  } else if (moStep === 3) {
    var platKeys = ['of', 'fansly', 'fanvue', 'mym', 'reveal'];
    var platNames = { of: 'onlyfans', fansly: 'fansly', fanvue: 'fanvue', mym: 'mym', reveal: 'reveal' };
    platKeys.forEach(function(k) {
      var cb = document.getElementById('mo-has-' + k);
      moData['has_' + k + '_account'] = cb ? cb.checked : false;
      if (!moData['has_' + k + '_account']) moData.platforms = (moData.platforms || []).filter(function(pl) { return pl !== platNames[k]; });
      if (moData['has_' + k + '_account']) {
        moData[k + '_link'] = g('mo-' + k + '-link');
        moData[k + '_subscribers'] = gn('mo-' + k + '-subs');
        moData[k + '_revenue_monthly'] = parseFloat(g('mo-' + k + '-rev')) || 0;
        if (k === 'reveal') moData.reveal_dashboard_url = g('mo-reveal-dashboard');
        if (!(moData.platforms || []).includes(platNames[k])) {
          moData.platforms = (moData.platforms || []).concat([platNames[k]]);
        }
      }
    });
    // Backward compat: copy of_ fields
    moData.of_link = moData.of_link; moData.of_subscribers = moData.of_subscribers; moData.of_revenue_monthly = moData.of_revenue_monthly;
  } else if (moStep === 4) {
    moData.content_types = Array.from(document.querySelectorAll('#mo-content-types .selected')).map(function(b) { return b.dataset.val; });
    moData.post_frequency = g('mo-frequency');
    moData.has_photographer = g('mo-photographer') === 'true';
    moData.content_stock = gn('mo-stock');
  } else if (moStep === 5) {
    moData.revenue_goal = parseFloat(g('mo-revenue-goal')) || 0;
    moData.availability_hours = gn('mo-availability');
    moData.languages = Array.from(document.querySelectorAll('#mo-languages .selected')).map(function(b) { return b.dataset.val; });
    moData.target_markets = Array.from(document.querySelectorAll('#mo-markets .selected')).map(function(b) { return b.dataset.val; });
  } else if (moStep === 6) {
    moData.contract_link = g('mo-contract');
    moData.gdpr_accepted = document.getElementById('mo-gdpr')?.checked || false;
    moData.internal_notes = g('mo-notes');
  }
}

function restoreMOValues() {
  setTimeout(function() {
    var s = function(id, val) { var el = document.getElementById(id); if (el && val) el.value = val; };
    if (moStep === 1) {
      s('mo-name', moData.name); s('mo-stage-name', moData.stage_name);
      s('mo-birth', moData.birth_date); s('mo-nationality', moData.nationality);
      s('mo-city', moData.city); s('mo-country', moData.country); s('mo-photo', String(moData.photo_url || '').indexOf('data:') === 0 ? '' : moData.photo_url);
    } else if (moStep === 2) {
      s('mo-ig', moData.ig_handle); s('mo-ig-followers', moData.ig_followers);
      s('mo-tiktok', moData.tiktok_handle); s('mo-tiktok-followers', moData.tiktok_followers);
      s('mo-twitter', moData.twitter_handle); s('mo-snapchat', moData.snapchat_handle);
      s('mo-other-socials', moData.other_socials);
    } else if (moStep === 4) {
      s('mo-frequency', moData.post_frequency); s('mo-stock', moData.content_stock);
    } else if (moStep === 5) {
      s('mo-revenue-goal', moData.revenue_goal); s('mo-availability', moData.availability_hours);
    } else if (moStep === 6) {
      s('mo-contract', moData.contract_link); s('mo-notes', moData.internal_notes);
    }
  }, 10);
}

function moNext() {
  saveMOStep();
  if (moStep === 1 && !moData.name) return showToast(t('mo.name_required'), 'error');
  if (moStep < moTotalSteps) { moStep++; renderMOStep(); }
  else submitModelOnboarding();
}

function moBack() {
  saveMOStep();
  if (moStep > 1) { moStep--; renderMOStep(); }
}

function moTogglePlatform(key) {
  var cb = document.getElementById('mo-has-' + key);
  var details = document.getElementById('mo-plat-details-' + key);
  var label = cb?.parentElement?.querySelector('span');
  if (details) details.style.display = cb?.checked ? '' : 'none';
  if (label) label.textContent = cb?.checked ? 'Actif' : 'Non';
}

async function submitModelOnboarding() {
  var btn = document.getElementById('mo-next');
  btn.disabled = true; btn.textContent = moEditId ? 'Enregistrement…' : t('mo.creating');
  try {
    var res = await fetch(moEditId ? '/api/models/' + moEditId + '/full' : '/api/models', {
      method: moEditId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(moData)
    });
    if (res.ok) {
      showToast(moEditId ? 'Modèle mise à jour' : t('mo.creator_added'), 'success');
      closeModal('add-model');
      moData = {}; moEditId = null; moEditOrig = null;
      allModels = await fetch('/api/models', { credentials: 'include' }).then(function(r) { return r.json(); });
      renderModels();
    } else {
      var err = await res.json().catch(function() { return {}; });
      showToast(err.error || 'Erreur', 'error');
      btn.disabled = false; btn.textContent = moEditId ? 'Enregistrer' : t('mo.add_creator_btn');
    }
  } catch(e) {
    showToast(t('toast.error_network'), 'error');
    btn.disabled = false; btn.textContent = moEditId ? 'Enregistrer' : t('mo.add_creator_btn');
  }
}

function moField(label, type, id, placeholder) {
  return '<div class="form-group"><label class="form-label">' + label + '</label>'
    + '<input class="form-input" type="' + type + '" id="' + id + '" placeholder="' + (placeholder || '') + '"></div>';
}
