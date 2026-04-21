// MODEL ONBOARDING WIZARD
// 6-step quiz when adding a new model

var moStep = 1;
var moTotalSteps = 6;

function openModelOnboarding() {
  moStep = 1;
  var overlay = document.getElementById('modal-add-model');
  overlay.innerHTML = '<div class="modal" style="width:560px;max-height:90vh;overflow-y:auto">'
    + '<div class="modal-header">'
    + '<div class="modal-title">Nouvelle créatrice — Étape <span id="mo-step-num">1</span>/6</div>'
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
  document.getElementById('mo-next').textContent = moStep === moTotalSteps ? 'Ajouter la créatrice' : 'Continuer';

  if (moStep === 1) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">Identité</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Informations de base sur la créatrice</p>'
      + moField('Prénom / Nom de scène *', 'text', 'mo-name', 'Ex: Luna')
      + moField('Nom de scène (si différent)', 'text', 'mo-stage-name', 'Ex: Luna_exclusive')
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + moField('Date de naissance', 'date', 'mo-birth')
      + moField('Nationalité', 'text', 'mo-nationality', 'Ex: Française')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + moField('Ville', 'text', 'mo-city', 'Ex: Paris')
      + moField('Pays', 'text', 'mo-country', 'Ex: France')
      + '</div>'
      + moField('Photo de profil (URL)', 'url', 'mo-photo', 'https://...');
  } else if (moStep === 2) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">Réseaux sociaux</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Ses comptes actuels sur les réseaux</p>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">'
      + moField('Instagram', 'text', 'mo-ig', '@handle')
      + moField('Followers IG', 'number', 'mo-ig-followers', '0')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">'
      + moField('TikTok', 'text', 'mo-tiktok', '@handle')
      + moField('Followers TT', 'number', 'mo-tiktok-followers', '0')
      + '</div>'
      + moField('Twitter / X', 'text', 'mo-twitter', '@handle')
      + moField('Snapchat', 'text', 'mo-snapchat', '@handle')
      + moField('Autres réseaux', 'text', 'mo-other-socials', 'Reddit, Telegram...');
  } else if (moStep === 3) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">OnlyFans</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Situation actuelle sur OnlyFans</p>'
      + '<div class="form-group"><label class="form-label">A déjà un compte OnlyFans ?</label>'
      + '<div style="display:flex;gap:10px">'
      + '<button class="filter-chip" id="mo-of-yes" onclick="moSetOF(true)">Oui</button>'
      + '<button class="filter-chip" id="mo-of-no" onclick="moSetOF(false)">Non</button>'
      + '</div></div>'
      + '<div id="mo-of-details"></div>';
    // Restore state
    var hasOF = document.getElementById('mo-of-yes');
    if (moData.has_of_account) { setTimeout(function() { moSetOF(true); }, 50); }
    else { setTimeout(function() { moSetOF(false); }, 50); }
  } else if (moStep === 4) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">Contenu</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Quel type de contenu elle produit</p>'
      + '<div class="form-group"><label class="form-label">Types de contenu</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="mo-content-types">'
      + ['Photos', 'Vidéos', 'Customs', 'Sexting', 'Lives', 'PPV', 'Dick ratings'].map(function(t) {
        var sel = (moData.content_types || []).includes(t) ? ' selected' : '';
        return '<button class="filter-chip' + sel + '" onclick="this.classList.toggle(\'selected\')" data-val="' + t + '">' + t + '</button>';
      }).join('') + '</div></div>'
      + moField('Fréquence de publication souhaitée', 'text', 'mo-frequency', 'Ex: 3 posts/jour')
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div class="form-group"><label class="form-label">A un photographe/vidéaste ?</label>'
      + '<select class="form-input" id="mo-photographer"><option value="false">Non</option><option value="true"' + (moData.has_photographer ? ' selected' : '') + '>Oui</option></select></div>'
      + moField('Stock de contenu (photos+vidéos prêtes)', 'number', 'mo-stock', '0')
      + '</div>';
  } else if (moStep === 5) {
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">Objectifs</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Ses ambitions et disponibilités</p>'
      + moField('Objectif de revenu mensuel ($)', 'number', 'mo-revenue-goal', 'Ex: 5000')
      + moField('Disponibilité (heures/semaine)', 'number', 'mo-availability', 'Ex: 20')
      + '<div class="form-group"><label class="form-label">Langues parlées</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="mo-languages">'
      + ['Français', 'Anglais', 'Espagnol', 'Allemand', 'Italien', 'Portugais', 'Arabe'].map(function(l) {
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
    body.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:var(--accent2);margin-bottom:4px">Légal & admin</h3>'
      + '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Documents et notes internes</p>'
      + moField('Lien vers le contrat signé (Drive)', 'url', 'mo-contract', 'https://drive.google.com/...')
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
    moData.city = g('mo-city'); moData.country = g('mo-country'); moData.photo_url = g('mo-photo');
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
    moData.platforms = plats;
  } else if (moStep === 3) {
    moData.has_of_account = !!document.getElementById('mo-of-yes')?.classList.contains('active');
    if (moData.has_of_account) {
      moData.of_link = g('mo-of-link'); moData.of_subscribers = gn('mo-of-subs');
      moData.of_revenue_monthly = parseFloat(g('mo-of-revenue')) || 0;
      if (moData.of_link) moData.platforms = (moData.platforms || []).concat(['onlyfans']);
    } else {
      moData.of_launch_date = g('mo-of-launch') || null;
    }
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
      s('mo-city', moData.city); s('mo-country', moData.country); s('mo-photo', moData.photo_url);
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
  if (moStep === 1 && !moData.name) return showToast('Nom requis', 'error');
  if (moStep < moTotalSteps) { moStep++; renderMOStep(); }
  else submitModelOnboarding();
}

function moBack() {
  saveMOStep();
  if (moStep > 1) { moStep--; renderMOStep(); }
}

function moSetOF(hasAccount) {
  var yes = document.getElementById('mo-of-yes');
  var no = document.getElementById('mo-of-no');
  if (yes) { yes.classList.toggle('active', hasAccount); yes.style.background = hasAccount ? 'var(--accent)' : ''; yes.style.color = hasAccount ? 'white' : ''; }
  if (no) { no.classList.toggle('active', !hasAccount); no.style.background = !hasAccount ? 'var(--accent)' : ''; no.style.color = !hasAccount ? 'white' : ''; }
  moData.has_of_account = hasAccount;
  var details = document.getElementById('mo-of-details');
  if (details) {
    if (hasAccount) {
      details.innerHTML = moField('Lien OnlyFans', 'url', 'mo-of-link', 'https://onlyfans.com/...')
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + moField('Abonnés actuels', 'number', 'mo-of-subs', '0')
        + moField('Revenu mensuel actuel ($)', 'number', 'mo-of-revenue', '0')
        + '</div>';
      var sl = function(id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
      sl('mo-of-link', moData.of_link); sl('mo-of-subs', moData.of_subscribers); sl('mo-of-revenue', moData.of_revenue_monthly);
    } else {
      details.innerHTML = moField('Date de lancement prévue', 'date', 'mo-of-launch', '');
      if (moData.of_launch_date) { var el = document.getElementById('mo-of-launch'); if (el) el.value = moData.of_launch_date; }
    }
  }
}

async function submitModelOnboarding() {
  var btn = document.getElementById('mo-next');
  btn.disabled = true; btn.textContent = 'Création...';
  try {
    var res = await fetch('/api/models', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(moData)
    });
    if (res.ok) {
      showToast('Créatrice ajoutée ! 🎉', 'success');
      closeModal('add-model');
      moData = {};
      allModels = await fetch('/api/models', { credentials: 'include' }).then(function(r) { return r.json(); });
      renderModels();
    } else {
      var err = await res.json().catch(function() { return {}; });
      showToast(err.error || 'Erreur', 'error');
      btn.disabled = false; btn.textContent = 'Ajouter la créatrice';
    }
  } catch(e) {
    showToast('Erreur réseau', 'error');
    btn.disabled = false; btn.textContent = 'Ajouter la créatrice';
  }
}

function moField(label, type, id, placeholder) {
  return '<div class="form-group"><label class="form-label">' + label + '</label>'
    + '<input class="form-input" type="' + type + '" id="' + id + '" placeholder="' + (placeholder || '') + '"></div>';
}
