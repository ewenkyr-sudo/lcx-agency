// ========== STUDENT MODULE ==========
// Handles all student-specific functionality

const STEPS = [
  { key: 'onboarding', label: 'Onboarding', icon: '📋' },
  { key: 'accounts-setup', label: 'Comptes', icon: '🔧' },
  { key: 'outreach', label: 'Outreach', icon: '📨' },
  { key: 'model-setup', label: 'Modèle', icon: '👤' },
  { key: 'traffic', label: 'Trafic', icon: '🚀' }
];

const RECRUIT_STATUSES = {
  'interested': { label: 'Intéressée', color: 'var(--blue)', bg: 'var(--blue-bg)' },
  'whatsapp': { label: 'WhatsApp créé', color: 'var(--yellow)', bg: 'var(--yellow-bg)' },
  'call-planned': { label: 'Call planifié', color: 'var(--accent)', bg: 'var(--accent-glow)' },
  'signed': { label: 'Signée', color: 'var(--green)', bg: 'var(--green-bg)' }
};

let studentData = { leads: [], recruits: [], models: [], revenue: [], callRequests: [], objectives: [], conversations: [], messages: [] };
let userOptions = { script: [], account: [], type: [] };
let currentChatUserId = null;

// ========== DATA LOADING ==========
async function loadStudentData() {
  const f = (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
  const [leads, recruits, models, revenue, callRequests, objectives, conversations, opts] = await Promise.all([
    f('/api/student-leads'), f('/api/student-recruits'), f('/api/student-models'),
    f('/api/student-revenue'), f('/api/call-requests'), f('/api/objectives'), f('/api/conversations'),
    f('/api/user-options')
  ]);
  studentData = { leads, recruits, models, revenue, callRequests, objectives, conversations, messages: studentData.messages };
  if (opts.script) userOptions = opts;
}

// ========== STUDENT HOME ==========
async function renderStudentHome() {
  await loadStudentData();
  const c = document.getElementById('section-student-home');
  if (!c) return;

  const student = allStudents[0];
  const step = student?.progression_step || 'onboarding';
  const stepIdx = STEPS.findIndex(s => s.key === step);
  const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);

  const leadStats = await fetch('/api/student-leads/stats', { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
  const pendingCalls = studentData.callRequests.filter(c => c.status === 'pending').length;
  const acceptedCalls = studentData.callRequests.filter(c => c.status === 'accepted').length;
  const unreadMsgs = studentData.conversations.reduce((s, c) => s + parseInt(c.unread || 0), 0);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Mon tableau de bord</div><div class="page-subtitle">Bienvenue ${currentUser.display_name}</div></div></div>

    <!-- Progression -->
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Ma progression — ${pct}%</h3>
      <div style="display:flex;gap:4px;margin-bottom:16px;height:8px;border-radius:4px;overflow:hidden;background:var(--bg3)">
        <div style="width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:4px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${STEPS.map((s, i) => {
          const done = i <= stepIdx;
          const active = i === stepIdx;
          return `<div style="flex:1;min-width:80px;text-align:center;padding:10px 6px;border-radius:8px;background:${active ? 'var(--accent-glow)' : done ? 'var(--green-bg)' : 'var(--bg3)'};border:1px solid ${active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--border)'}">
            <div style="font-size:20px;margin-bottom:4px">${s.icon}</div>
            <div style="font-size:11px;font-weight:600;color:${active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--text3)'}">${s.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- KPIs -->
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value">${leadStats.dm_sent || 0}</div><div class="stat-label">DMs envoyés</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">${leadStats.reply_rate || 0}%</div><div class="stat-label">Taux de réponse</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">${studentData.recruits.filter(r => r.status === 'signed').length}</div><div class="stat-label">Modèles signées</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${studentData.models.length}</div><div class="stat-label">Modèles gérées</div></div>
    </div>

    <div class="two-col">
      <!-- Calls -->
      <div class="panel" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="font-size:14px">Demandes de call</strong>
          <button class="btn btn-primary" style="font-size:12px;padding:6px 12px" onclick="showCallRequestForm()">Demander un call</button>
        </div>
        ${studentData.callRequests.length === 0 ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px">Aucune demande</div>' :
          studentData.callRequests.slice(0, 5).map(c => {
            const stColor = c.status === 'pending' ? 'var(--yellow)' : c.status === 'accepted' ? 'var(--green)' : 'var(--red)';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
              <span>${c.message?.substring(0, 40) || 'Demande de call'}${c.message?.length > 40 ? '...' : ''}</span>
              <span style="color:${stColor};font-weight:600;font-size:11px">${c.status === 'pending' ? 'En attente' : c.status === 'accepted' ? 'Accepté — ' + (c.scheduled_at || '') : 'Refusé'}</span>
            </div>`;
          }).join('')}
      </div>

      <!-- Messages -->
      <div class="panel" style="padding:16px">
        <strong style="font-size:14px;display:block;margin-bottom:12px">Messages ${unreadMsgs > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + unreadMsgs + ' non lu(s)</span>' : ''}</strong>
        ${studentData.conversations.map(c => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="document.querySelector('[data-section=student-messages]').click()">
            ${avatarHTML(c, 32)}
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${c.display_name}</div>
              <div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${c.last_message || 'Pas de message'}</div>
            </div>
            ${parseInt(c.unread) > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + c.unread + '</span>' : ''}
          </div>
        `).join('') || '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px">Aucun message</div>'}
      </div>
    </div>
  `;
}

// ========== CALL REQUEST FORM ==========
function showCallRequestForm() {
  const section = document.getElementById('section-student-home');
  const existing = document.getElementById('call-request-form');
  if (existing) { existing.remove(); return; }
  const form = document.createElement('div');
  form.id = 'call-request-form';
  form.className = 'panel';
  form.style.cssText = 'padding:20px;margin-bottom:20px';
  form.innerHTML = `
    <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent2)">Demander un call</h3>
    <div style="display:grid;gap:12px;max-width:500px">
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Message / Sujet</label>
        <textarea id="cr-message" class="form-input" rows="2" placeholder="De quoi veux-tu parler ?"></textarea></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Disponibilités</label>
        <input type="text" id="cr-avail" class="form-input" placeholder="Ex: Lundi 14h-18h, Mardi matin..."></div>
      <button class="btn btn-primary" onclick="submitCallRequest()">Envoyer la demande</button>
    </div>`;
  section.querySelector('.page-header').after(form);
}

async function submitCallRequest() {
  const message = document.getElementById('cr-message').value.trim();
  const availabilities = document.getElementById('cr-avail').value.trim();
  if (!message) return showToast('Message requis', 'error');
  const res = await fetch('/api/call-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ message, availabilities }) });
  if (res.ok) { showToast('Demande envoyée !', 'success'); document.getElementById('call-request-form')?.remove(); renderStudentHome(); }
}

// ========== STUDENT OUTREACH ==========
let studentLeadFilter = 'all';

async function renderStudentOutreach() {
  await loadStudentData();
  const stats = await fetch('/api/student-leads/stats', { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
  const c = document.getElementById('section-student-outreach');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Mon Outreach</div><div class="page-subtitle">Gestion de mes leads</div></div>
      <div class="header-actions" style="display:flex;gap:8px"><button class="btn btn-primary" onclick="showStudentLeadForm()">+ Nouveau Lead</button><button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="showOptionsManager()">Mes options</button><button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById('csv-import-input').click()">Importer CSV</button><input type="file" id="csv-import-input" accept=".csv" style="display:none" onchange="importStudentCSV(this)"></div></div>
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value">${stats.leads_today || 0}</div><div class="stat-label">Leads aujourd'hui</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--blue)">${stats.dm_sent_today || 0}</div><div class="stat-label">DMs aujourd'hui</div></div>
      <div class="stat-card"><div class="stat-value">${stats.dm_sent || 0}</div><div class="stat-label">DMs total</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${stats.talking_warm || 0}</div><div class="stat-label">Talking Warm</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">${stats.call_booked || 0}</div><div class="stat-label">Call Booked</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">${stats.reply_rate || 0}%</div><div class="stat-label">Taux de réponse</div></div>
    </div>
    ${stats.shared && stats.contributions ? '<div class="panel" style="padding:14px;margin-bottom:20px"><strong style="font-size:13px;color:var(--accent2);display:block;margin-bottom:10px">Contributions</strong><div style="display:flex;gap:16px;flex-wrap:wrap">' + stats.contributions.map(function(c) { return '<div style="background:var(--bg3);padding:10px 14px;border-radius:8px;flex:1;min-width:150px"><strong style="font-size:13px">' + c.name + '</strong><div style="font-size:12px;color:var(--text2);margin-top:4px">' + c.leads_added + ' leads ajoutés</div><div style="font-size:12px;color:var(--blue)">' + c.dms_today + ' DMs auj.</div><div style="font-size:12px;color:var(--text3)">' + c.dms_total + ' DMs total</div></div>'; }).join('') + '</div></div>' : ''}
    <div id="student-lead-form-wrap"></div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      ${['all','to-send','sent','talking-cold','talking-warm','call-booked','signed'].map(f => `<button class="btn lead-filter ${studentLeadFilter===f?'active':''}" onclick="filterStudentLeads('${f}',this)" style="font-size:12px;padding:6px 14px;border-radius:20px;background:${studentLeadFilter===f?'var(--accent)':'var(--bg3)'};color:${studentLeadFilter===f?'white':'var(--text2)'};border:none;cursor:pointer">${f==='all'?'Tous':leadStatusColors[f]?.label||f}</button>`).join('')}
    </div>
    <div style="margin-bottom:16px"><input type="text" id="student-lead-search" class="form-input" placeholder="Rechercher un username..." oninput="renderStudentLeadTable()" style="max-width:350px"></div>
    <div class="panel"><table class="table mobile-cards" id="student-leads-table"><thead><tr><th>#</th><th>Username</th><th>Type</th><th>Script</th><th>Compte</th><th>Statut</th><th>Ajouté par</th><th>Notes</th><th>Date</th><th></th></tr></thead><tbody></tbody></table></div>
  `;
  renderStudentLeadTable();
}

function inlineSelect(leadId, field, currentValue, optType) {
  const opts = userOptions[optType] || [];
  const selectStyle = 'background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;min-height:28px;width:100%';
  let html = '<select onchange="updateStudentLeadField(' + leadId + ',\'' + field + '\',this.value)" style="' + selectStyle + '">';
  html += '<option value="">-</option>';
  // Ajouter la valeur actuelle si elle n'est pas dans les options
  const hasCurrentInOpts = opts.some(o => o.value === currentValue);
  if (currentValue && !hasCurrentInOpts) {
    html += '<option value="' + currentValue + '" selected>' + currentValue + '</option>';
  }
  opts.forEach(o => {
    html += '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.value + '</option>';
  });
  html += '</select>';
  return html;
}

function renderStudentLeadTable() {
  const search = (document.getElementById('student-lead-search')?.value || '').toLowerCase();
  let filtered = studentLeadFilter === 'all' ? studentData.leads : studentData.leads.filter(l => l.status === studentLeadFilter);
  if (search) filtered = filtered.filter(l => l.username.toLowerCase().includes(search));
  const tbody = document.querySelector('#student-leads-table tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map((l, idx) => {
    const st = leadStatusColors[l.status] || leadStatusColors['sent'];
    const date = new Date(l.created_at).toLocaleDateString('fr-FR');
    const igLink = l.ig_link ? '<a href="' + l.ig_link + '" target="_blank" style="color:var(--accent)">' + l.username + '</a>' : l.username;
    return '<tr><td data-label="#" style="color:var(--text3);font-size:12px">' + (filtered.length - idx) + '</td>'
      + '<td data-label="" class="mc-title"><strong>' + igLink + '</strong></td>'
      + '<td data-label="Type" class="mc-half">' + inlineSelect(l.id, 'lead_type', l.lead_type, 'type') + '</td>'
      + '<td data-label="Script" class="mc-half">' + inlineSelect(l.id, 'script_used', l.script_used, 'script') + '</td>'
      + '<td data-label="Compte" class="mc-half">' + inlineSelect(l.id, 'ig_account_used', l.ig_account_used, 'account') + '</td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="updateStudentLead(' + l.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(leadStatusColors).map(([k,v]) => '<option value="' + k + '"' + (l.status===k?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + v.label + '</option>').join('') + '</select></td>'
      + '<td data-label="Modifié par" class="mc-half" style="font-size:11px;color:var(--accent2)">' + (l.modified_by_name || l.added_by_name || '-') + '</td>'
      + '<td data-label="Notes" class="mc-full" style="color:var(--text2);font-size:12px">' + (l.notes || '-') + '</td>'
      + '<td data-label="Date" class="mc-half" style="font-size:12px;color:var(--text3)">' + date + '</td>'
      + '<td data-label="" class="mc-full" style="text-align:right;padding-top:8px"><button class="btn-delete-small" onclick="deleteStudentLead(' + l.id + ')" style="background:var(--red-bg);color:var(--red);border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">Supprimer</button></td></tr>';
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:24px">Aucun lead</td></tr>';
}

function filterStudentLeads(f, btn) {
  studentLeadFilter = f;
  document.querySelectorAll('#section-student-outreach .lead-filter').forEach(b => { b.style.background = 'var(--bg3)'; b.style.color = 'var(--text2)'; });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
  renderStudentLeadTable();
}

function optionSelect(id, optType, placeholder) {
  const opts = userOptions[optType] || [];
  return '<div style="display:flex;gap:6px;align-items:center">'
    + '<select id="' + id + '" class="form-input" style="flex:1">'
    + '<option value="">-- ' + placeholder + ' --</option>'
    + opts.map(o => '<option value="' + o.value + '">' + o.value + '</option>').join('')
    + '</select>'
    + '<button class="btn" style="padding:6px 10px;font-size:14px;background:var(--bg3);color:var(--accent);border:none;cursor:pointer" onclick="addNewOption(\'' + optType + '\',\'' + id + '\')" title="Ajouter">+</button>'
    + '</div>';
}

function showStudentLeadForm() {
  const wrap = document.getElementById('student-lead-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent2)">Ajouter un lead</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:700px">'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Username *</label><input type="text" id="sl-username" class="form-input" placeholder="@username"></div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Lien Instagram</label><input type="text" id="sl-iglink" class="form-input" placeholder="https://instagram.com/..." oninput="autoFillUsername(this.value,\'sl-username\')"></div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Type</label>' + optionSelect('sl-type', 'type', 'Type de lead') + '</div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Script</label>' + optionSelect('sl-script', 'script', 'Script utilisé') + '</div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Compte utilisé</label>' + optionSelect('sl-account', 'account', 'Compte Instagram') + '</div>'
    + '<div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Notes</label><input type="text" id="sl-notes" class="form-input" placeholder="Notes..."></div>'
    + '</div>'
    + '<div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addStudentLead()">Ajouter</button><button class="btn" style="background:var(--bg3);color:var(--text2)" onclick="document.getElementById(\'student-lead-form-wrap\').innerHTML=\'\'">Annuler</button></div>'
    + '</div>';
}

async function addNewOption(optType, selectId) {
  const labels = { script: 'script', account: 'compte Instagram', type: 'type de lead' };
  const value = prompt('Nouveau ' + (labels[optType] || optType) + ' :');
  if (!value || !value.trim()) return;
  const res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value: value.trim() }) });
  if (res.ok) {
    const opt = await res.json();
    userOptions[optType].push(opt);
    // Ajouter l'option au select et la sélectionner
    const select = document.getElementById(selectId);
    const newOpt = document.createElement('option');
    newOpt.value = opt.value;
    newOpt.textContent = opt.value;
    newOpt.selected = true;
    select.appendChild(newOpt);
    showToast('"' + opt.value + '" ajouté', 'success');
  } else {
    const e = await res.json();
    showToast(e.error || 'Erreur', 'error');
  }
}

function autoFillUsername(url, targetId) {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (match) document.getElementById(targetId).value = '@' + match[1];
}

async function addStudentLead() {
  const username = document.getElementById('sl-username').value.trim();
  if (!username) return showToast('Username requis', 'error');
  const dup = studentData.leads.find(l => l.username.replace(/^@/,'').toLowerCase() === username.replace(/^@/,'').toLowerCase());
  if (dup) return showToast('Ce lead existe déjà (' + dup.status + ')', 'error');
  const res = await fetch('/api/student-leads', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({
    username, ig_link: document.getElementById('sl-iglink').value.trim(), lead_type: document.getElementById('sl-type').value,
    script_used: document.getElementById('sl-script').value, ig_account_used: document.getElementById('sl-account')?.value || '', notes: document.getElementById('sl-notes').value.trim()
  })});
  if (res.ok) { showToast('Lead ajouté !', 'success'); document.getElementById('student-lead-form-wrap').innerHTML = ''; await loadStudentData(); renderStudentLeadTable(); }
  else { const e = await res.json(); showToast(e.error || 'Erreur', 'error'); }
}

async function updateStudentLead(id, status) {
  await fetch('/api/student-leads/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) });
  await loadStudentData(); renderStudentLeadTable();
}

async function updateStudentLeadField(id, field, value) {
  const body = {};
  body[field] = value;
  await fetch('/api/student-leads/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
  // Mettre à jour localement sans tout recharger
  const lead = studentData.leads.find(l => l.id === id);
  if (lead) lead[field] = value;
}

async function deleteStudentLead(id) {
  if (!confirm('Supprimer ce lead ?')) return;
  await fetch('/api/student-leads/' + id, { method:'DELETE', credentials:'include' });
  await loadStudentData(); renderStudentLeadTable();
}

function showOptionsManager() {
  const wrap = document.getElementById('student-lead-form-wrap');
  if (wrap.querySelector('#options-manager')) { wrap.innerHTML = ''; return; }
  const labels = { type: 'Types de lead', script: 'Scripts', account: 'Comptes Instagram' };
  wrap.innerHTML = '<div class="panel" style="padding:20px;margin-bottom:20px" id="options-manager">'
    + '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Gérer mes options</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">'
    + Object.entries(labels).map(([key, label]) => {
      const opts = userOptions[key] || [];
      return '<div style="background:var(--bg3);padding:14px;border-radius:10px">'
        + '<strong style="font-size:13px;display:block;margin-bottom:10px">' + label + '</strong>'
        + (opts.length === 0 ? '<div style="color:var(--text3);font-size:12px">Aucune option</div>' : '')
        + opts.map(o => '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px"><span>' + o.value + '</span><button class="btn-delete-small" onclick="deleteOption(' + o.id + ')" style="font-size:10px">✕</button></div>').join('')
        + '<div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="new-opt-' + key + '" class="form-input" style="font-size:12px;padding:6px 8px;flex:1" placeholder="Ajouter..."><button class="btn btn-primary" style="padding:6px 10px;font-size:11px" onclick="addOptionFromManager(\'' + key + '\')">+</button></div>'
        + '</div>';
    }).join('')
    + '</div>'
    + '<div style="margin-top:12px"><button class="btn" style="background:var(--bg3);color:var(--text2);border:none;cursor:pointer" onclick="document.getElementById(\'student-lead-form-wrap\').innerHTML=\'\'">Fermer</button></div>'
    + '</div>';
}

async function addOptionFromManager(optType) {
  const input = document.getElementById('new-opt-' + optType);
  const value = input.value.trim();
  if (!value) return;
  const res = await fetch('/api/user-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ option_type: optType, value }) });
  if (res.ok) {
    const opt = await res.json();
    userOptions[optType].push(opt);
    showToast('"' + value + '" ajouté', 'success');
    showOptionsManager(); // Re-render
  } else {
    const e = await res.json();
    showToast(e.error || 'Erreur', 'error');
  }
}

async function deleteOption(id) {
  await fetch('/api/user-options/' + id, { method: 'DELETE', credentials: 'include' });
  // Retirer de userOptions
  ['script', 'account', 'type'].forEach(key => {
    userOptions[key] = userOptions[key].filter(o => o.id !== id);
  });
  showToast('Option supprimée', 'success');
  showOptionsManager();
}

// ========== CSV IMPORT ==========
async function importStudentCSV(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';

  var reader = new FileReader();
  reader.onload = async function() {
    var content = reader.result;
    var lines = content.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) return showToast('Fichier vide', 'error');

    showToast('Import en cours... (' + (lines.length - 1) + ' lignes)', 'info');

    var res = await fetch('/api/student-leads/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ csv_content: content })
    });

    if (res.ok) {
      var data = await res.json();
      showToast(data.imported + ' importés, ' + data.updated + ' mis à jour sur ' + data.total + ' lignes', 'success');
    } else {
      var err = await res.json();
      showToast(err.error || 'Erreur import', 'error');
    }
    await loadStudentData();
    renderStudentLeadTable();
  };
  reader.readAsText(file);
}

// ========== STUDENT RECRUITS ==========
async function renderStudentRecruits() {
  await loadStudentData();
  const c = document.getElementById('section-student-recruits');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Recrutement modèles</div><div class="page-subtitle">Modèles trouvées en outreach</div></div>
      <div class="header-actions"><button class="btn btn-primary" onclick="showRecruitForm()">+ Nouvelle modèle</button></div></div>
    <div id="recruit-form-wrap"></div>
    <div class="panel"><table class="table mobile-cards" id="recruits-table"><thead><tr><th>Instagram</th><th>Statut</th><th>Notes</th><th>Date</th><th></th></tr></thead><tbody></tbody></table></div>
  `;

  const tbody = document.querySelector('#recruits-table tbody');
  tbody.innerHTML = studentData.recruits.map(r => {
    const st = RECRUIT_STATUSES[r.status] || RECRUIT_STATUSES['interested'];
    const date = new Date(r.created_at).toLocaleDateString('fr-FR');
    return '<tr><td data-label="" class="mc-title"><strong>' + (r.ig_link ? '<a href="' + r.ig_link + '" target="_blank" style="color:var(--accent)">' + r.ig_name + '</a>' : r.ig_name) + '</strong></td>'
      + '<td data-label="Statut" class="mc-half"><select onchange="updateRecruit(' + r.id + ',this.value)" style="background:' + st.bg + ';color:' + st.color + ';border:none;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;min-height:32px">'
      + Object.entries(RECRUIT_STATUSES).map(([k,v]) => '<option value="' + k + '"' + (r.status===k?' selected':'') + ' style="background:var(--bg2);color:var(--text)">' + v.label + '</option>').join('') + '</select></td>'
      + '<td data-label="Notes" class="mc-full" style="color:var(--text2);font-size:12px">' + (r.notes || '-') + '</td>'
      + '<td data-label="Date" class="mc-half" style="font-size:12px;color:var(--text3)">' + date + '</td>'
      + '<td data-label="" class="mc-actions"><button class="btn-delete-small" onclick="deleteRecruit(' + r.id + ')">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">Aucune modèle</td></tr>';
}

function showRecruitForm() {
  const wrap = document.getElementById('recruit-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:500px">
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Instagram *</label><input type="text" id="rec-name" class="form-input" placeholder="@username"></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Lien profil</label><input type="text" id="rec-link" class="form-input" placeholder="https://instagram.com/..." oninput="autoFillUsername(this.value,'rec-name')"></div>
      <div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Notes</label><input type="text" id="rec-notes" class="form-input" placeholder="Notes..."></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addRecruit()">Ajouter</button><button class="btn" style="background:var(--bg3);color:var(--text2)" onclick="document.getElementById('recruit-form-wrap').innerHTML=''">Annuler</button></div>
  </div>`;
}

async function addRecruit() {
  const ig_name = document.getElementById('rec-name').value.trim();
  if (!ig_name) return showToast('Nom Instagram requis', 'error');
  const res = await fetch('/api/student-recruits', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ ig_name, ig_link: document.getElementById('rec-link').value.trim(), notes: document.getElementById('rec-notes').value.trim() })});
  if (res.ok) { showToast('Modèle ajoutée !', 'success'); renderStudentRecruits(); }
}

async function updateRecruit(id, status) {
  await fetch('/api/student-recruits/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) });
  await loadStudentData(); renderStudentRecruits();
}

async function deleteRecruit(id) {
  if (!confirm('Supprimer ?')) return;
  await fetch('/api/student-recruits/' + id, { method:'DELETE', credentials:'include' });
  renderStudentRecruits();
}

// ========== STUDENT MODELS ==========
async function renderStudentModels() {
  await loadStudentData();
  const c = document.getElementById('section-student-models');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Mes modèles</div><div class="page-subtitle">Gestion de mes modèles OnlyFans</div></div>
      <div class="header-actions"><button class="btn btn-primary" onclick="showStudentModelForm()">+ Ajouter un modèle</button></div></div>
    <div id="smodel-form-wrap"></div>
    <div id="smodel-cards"></div>
  `;

  const cards = document.getElementById('smodel-cards');
  cards.innerHTML = studentData.models.map(m => {
    const stColors = { active: 'var(--green)', onboarding: 'var(--yellow)', pause: 'var(--text3)' };
    const modelRev = studentData.revenue.filter(r => r.student_model_id === m.id);
    const totalRev = modelRev.reduce((s, r) => s + parseFloat(r.revenue), 0);
    const commission = totalRev * (parseFloat(m.commission_rate) / 100);
    return `<div class="panel" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><strong style="font-size:16px">${m.name}</strong> <span style="font-size:12px;color:var(--text3)">${m.of_handle || ''}</span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="updateStudentModel(${m.id},{status:this.value})" style="background:var(--bg3);color:${stColors[m.status]||'var(--text)'};border:1px solid var(--border);padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">
            <option value="active" ${m.status==='active'?'selected':''}>Active</option><option value="onboarding" ${m.status==='onboarding'?'selected':''}>Onboarding</option><option value="pause" ${m.status==='pause'?'selected':''}>Pause</option>
          </select>
          <button class="btn-delete-small" onclick="deleteStudentModel(${m.id})">✕</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
        <div><span style="color:var(--text3)">Fans:</span> <strong>${m.fans_count}</strong></div>
        <div><span style="color:var(--text3)">Commission:</span> <strong>${m.commission_rate}%</strong></div>
        <div><span style="color:var(--text3)">Revenue totale:</span> <strong style="color:var(--green)">$${totalRev.toFixed(2)}</strong></div>
        <div><span style="color:var(--text3)">Commission due:</span> <strong style="color:var(--accent)">$${commission.toFixed(2)}</strong></div>
      </div>
    </div>`;
  }).join('') || '<div class="panel" style="padding:24px;text-align:center;color:var(--text3)">Aucun modèle</div>';
}

function showStudentModelForm() {
  const wrap = document.getElementById('smodel-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:600px">
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Nom *</label><input type="text" id="sm-name" class="form-input" placeholder="Nom du modèle"></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Profil OnlyFans</label><input type="text" id="sm-handle" class="form-input" placeholder="@handle_of"></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Nombre de fans</label><input type="number" id="sm-fans" class="form-input" placeholder="0" min="0"></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Commission (%)</label><input type="number" id="sm-commission" class="form-input" placeholder="15" min="0" max="100" step="0.5"></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn btn-primary" onclick="addStudentModel()">Ajouter</button><button class="btn" style="background:var(--bg3);color:var(--text2)" onclick="document.getElementById('smodel-form-wrap').innerHTML=''">Annuler</button></div>
  </div>`;
}

async function addStudentModel() {
  const name = document.getElementById('sm-name').value.trim();
  if (!name) return showToast('Nom requis', 'error');
  await fetch('/api/student-models', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name, of_handle: document.getElementById('sm-handle').value.trim(), fans_count: parseInt(document.getElementById('sm-fans').value)||0, commission_rate: parseFloat(document.getElementById('sm-commission').value)||0 })});
  showToast('Modèle ajouté !', 'success'); renderStudentModels();
}

async function updateStudentModel(id, data) {
  await fetch('/api/student-models/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(data) });
  await loadStudentData(); renderStudentModels();
}

async function deleteStudentModel(id) {
  if (!confirm('Supprimer ce modèle et tous ses revenus ?')) return;
  await fetch('/api/student-models/' + id, { method:'DELETE', credentials:'include' });
  renderStudentModels();
}

// ========== STUDENT REVENUE ==========
async function renderStudentRevenue() {
  await loadStudentData();
  const c = document.getElementById('section-student-revenue');
  if (!c) return;

  const currentMonth = new Date().toISOString().substring(0, 7);
  const monthRevenue = studentData.revenue.filter(r => r.month === currentMonth);
  const totalMonth = monthRevenue.reduce((s, r) => s + parseFloat(r.revenue), 0);
  const totalCommission = monthRevenue.reduce((s, r) => s + (parseFloat(r.revenue) * parseFloat(r.commission_rate) / 100), 0);
  const totalAll = studentData.revenue.reduce((s, r) => s + parseFloat(r.revenue), 0);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Mes revenus</div><div class="page-subtitle">OnlyFans — Suivi financier</div></div></div>
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">$${totalMonth.toFixed(2)}</div><div class="stat-label">Revenue ce mois</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent)">$${totalCommission.toFixed(2)}</div><div class="stat-label">Commission ce mois</div></div>
      <div class="stat-card"><div class="stat-value">$${totalAll.toFixed(2)}</div><div class="stat-label">Revenue totale</div></div>
      <div class="stat-card"><div class="stat-value">${studentData.models.length}</div><div class="stat-label">Modèles</div></div>
    </div>
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent2)">Ajouter un revenu</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
        <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Modèle</label>
          <select id="rev-model" class="form-input">${studentData.models.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('')}</select></div>
        <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Mois</label>
          <input type="month" id="rev-month" class="form-input" value="${currentMonth}"></div>
        <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Revenue ($)</label>
          <input type="number" id="rev-amount" class="form-input" placeholder="0.00" step="0.01" min="0"></div>
        <button class="btn btn-primary" onclick="addStudentRevenue()">Ajouter</button>
      </div>
    </div>
    <div class="panel" style="padding:20px;margin-bottom:20px"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Évolution mensuelle</h3><div style="position:relative;height:250px"><canvas id="chart-student-revenue"></canvas></div></div>
    <div class="panel"><table class="table mobile-cards" id="revenue-table"><thead><tr><th>Mois</th><th>Modèle</th><th>Revenue</th><th>Commission</th></tr></thead><tbody>
      ${studentData.revenue.map(r => {
        const comm = (parseFloat(r.revenue) * parseFloat(r.commission_rate) / 100).toFixed(2);
        return '<tr><td data-label="Mois" class="mc-half">' + r.month + '</td><td data-label="Modèle" class="mc-half"><strong>' + r.model_name + '</strong></td><td data-label="Revenue" class="mc-half" style="color:var(--green)">$' + parseFloat(r.revenue).toFixed(2) + '</td><td data-label="Commission" class="mc-half" style="color:var(--accent)">$' + comm + ' (' + r.commission_rate + '%)</td></tr>';
      }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:24px">Aucun revenu</td></tr>'}
    </tbody></table></div>
  `;

  // Chart
  const months = [...new Set(studentData.revenue.map(r => r.month))].sort();
  if (months.length > 0 && typeof Chart !== 'undefined') {
    const revByMonth = months.map(m => studentData.revenue.filter(r => r.month === m).reduce((s, r) => s + parseFloat(r.revenue), 0));
    new Chart(document.getElementById('chart-student-revenue'), {
      type: 'bar', data: { labels: months, datasets: [{ label: 'Revenue', data: revByMonth, backgroundColor: '#8b5cf6cc', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b80' } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b80' }, beginAtZero: true } }, plugins: { legend: { labels: { color: '#e4e4eb' } } } }
    });
  }
}

async function addStudentRevenue() {
  const student_model_id = document.getElementById('rev-model').value;
  const month = document.getElementById('rev-month').value;
  const revenue = parseFloat(document.getElementById('rev-amount').value) || 0;
  if (!student_model_id || !month) return showToast('Modèle et mois requis', 'error');
  await fetch('/api/student-revenue', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ student_model_id, month, revenue }) });
  showToast('Revenu ajouté !', 'success'); renderStudentRevenue();
}

// ========== MESSAGES (Chat) ==========
async function renderStudentMessages() {
  await loadStudentData();
  const c = document.getElementById('section-student-messages');
  if (!c) return;

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Messages</div><div class="page-subtitle">Messagerie interne</div></div></div>
    <div style="display:flex;gap:0;height:calc(100vh - 200px);border-radius:12px;overflow:hidden;border:1px solid var(--border)">
      <div id="chat-contacts" style="width:280px;background:var(--bg2);border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0"></div>
      <div id="chat-area" style="flex:1;display:flex;flex-direction:column;background:var(--bg)">
        <div id="chat-header" style="padding:14px 20px;border-bottom:1px solid var(--border);font-weight:600;font-size:14px">Sélectionne une conversation</div>
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px"></div>
        <div id="chat-input-wrap" style="padding:12px;border-top:1px solid var(--border);display:none">
          <div style="display:flex;gap:8px"><input type="text" id="chat-input" class="form-input" placeholder="Écrire un message..." style="flex:1" onkeydown="if(event.key==='Enter')sendMessage()"><button class="btn btn-primary" onclick="sendMessage()" style="padding:8px 16px">Envoyer</button></div>
        </div>
      </div>
    </div>
  `;

  renderChatContacts();
}

function renderChatContacts() {
  const contacts = document.getElementById('chat-contacts');
  if (!contacts) return;
  contacts.innerHTML = studentData.conversations.map(c => `
    <div onclick="openChat(${c.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--border);background:${currentChatUserId===c.id?'var(--bg3)':'transparent'}" id="contact-${c.id}">
      ${avatarHTML(c, 36)}
      <div style="flex:1;overflow:hidden">
        <div style="font-size:13px;font-weight:600">${c.display_name}</div>
        <div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.last_message || '...'}</div>
      </div>
      ${parseInt(c.unread) > 0 ? '<span style="background:var(--red);color:white;font-size:10px;padding:2px 6px;border-radius:10px">' + c.unread + '</span>' : ''}
    </div>
  `).join('') || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Aucune conversation</div>';
}

async function openChat(userId) {
  currentChatUserId = userId;
  const contact = studentData.conversations.find(c => c.id === userId);
  document.getElementById('chat-header').textContent = contact?.display_name || 'Chat';
  document.getElementById('chat-input-wrap').style.display = 'block';
  renderChatContacts();

  const res = await fetch('/api/messages/' + userId, { credentials: 'include' });
  if (res.ok) { studentData.messages = await res.json(); renderChatMessages(); }
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = studentData.messages.map(m => {
    const isMe = m.from_user_id === currentUser.id;
    return `<div style="display:flex;justify-content:${isMe?'flex-end':'flex-start'}">
      <div style="max-width:70%;padding:10px 14px;border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};background:${isMe?'var(--accent)':'var(--bg3)'};color:${isMe?'white':'var(--text)'};font-size:13px">
        ${m.content}
        <div style="font-size:10px;margin-top:4px;opacity:0.6">${new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !currentChatUserId) return;
  input.value = '';
  await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ to_user_id: currentChatUserId, content }) });
  const res = await fetch('/api/messages/' + currentChatUserId, { credentials: 'include' });
  if (res.ok) { studentData.messages = await res.json(); renderChatMessages(); }
}

// ========== RESOURCES ==========
async function renderStudentResources() {
  const res = await fetch('/api/resources', { credentials: 'include' });
  const resources = res.ok ? await res.json() : [];
  const c = document.getElementById('section-student-resources');
  if (!c) return;

  const categories = { outreach: 'Outreach', chatting: 'Chatting', traffic: 'Traffic', general: 'Général' };
  const grouped = {};
  resources.forEach(r => { if (!grouped[r.category]) grouped[r.category] = []; grouped[r.category].push(r); });

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Formation</div><div class="page-subtitle">Ressources et guides</div></div>
      ${currentUser.role === 'admin' ? '<div class="header-actions"><button class="btn btn-primary" onclick="showAddResourceForm()">+ Ajouter une ressource</button></div>' : ''}
    </div>
    <div id="resource-form-wrap"></div>
    ${Object.entries(grouped).map(([cat, items]) => `
      <div class="panel" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--accent2)">${categories[cat] || cat}</h3>
        <div style="display:grid;gap:10px">
          ${items.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg3);border-radius:8px">
            <div>
              <div style="font-size:14px;font-weight:600">${r.title}</div>
              ${r.description ? '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + r.description + '</div>' : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${r.url ? '<a href="' + r.url + '" target="_blank" class="btn btn-primary" style="padding:6px 12px;font-size:11px;text-decoration:none">Ouvrir</a>' : ''}
              ${r.file_name ? '<a href="/api/resources/' + r.id + '/download" class="btn btn-primary" style="padding:6px 12px;font-size:11px;text-decoration:none">Télécharger</a>' : ''}
              ${currentUser.role === 'admin' ? '<button class="btn-delete-small" onclick="deleteResource(' + r.id + ')">✕</button>' : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
    `).join('') || '<div class="panel" style="padding:24px;text-align:center;color:var(--text3)">Aucune ressource</div>'}
  `;
}

function showAddResourceForm() {
  const wrap = document.getElementById('resource-form-wrap');
  if (wrap.children.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="panel" style="padding:20px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:600px">
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Titre *</label><input type="text" id="res-title" class="form-input" placeholder="Titre"></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Catégorie</label><select id="res-cat" class="form-input"><option value="outreach">Outreach</option><option value="chatting">Chatting</option><option value="traffic">Traffic</option><option value="general">Général</option></select></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Type</label><select id="res-type" class="form-input" onchange="document.getElementById('res-url-wrap').style.display=this.value==='link'?'':'none';document.getElementById('res-file-wrap').style.display=this.value==='file'?'':'none'"><option value="link">Lien (YouTube, etc.)</option><option value="file">Fichier (PDF, doc...)</option></select></div>
      <div><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Description</label><input type="text" id="res-desc" class="form-input" placeholder="Description..."></div>
      <div id="res-url-wrap" style="grid-column:1/-1"><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">URL</label><input type="text" id="res-url" class="form-input" placeholder="https://..."></div>
      <div id="res-file-wrap" style="grid-column:1/-1;display:none"><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Fichier</label><input type="file" id="res-file" class="form-input"></div>
    </div>
    <div style="margin-top:12px"><button class="btn btn-primary" onclick="addResource()">Ajouter</button></div>
  </div>`;
}

async function addResource() {
  const title = document.getElementById('res-title').value.trim();
  if (!title) return showToast('Titre requis', 'error');
  const resType = document.getElementById('res-type').value;
  const body = { title, category: document.getElementById('res-cat').value, res_type: resType, description: document.getElementById('res-desc').value.trim() };

  if (resType === 'link') { body.url = document.getElementById('res-url').value.trim(); }
  else {
    const file = document.getElementById('res-file').files[0];
    if (!file) return showToast('Fichier requis', 'error');
    if (file.size > 10 * 1024 * 1024) return showToast('Fichier trop gros (max 10Mo)', 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      body.file_data = reader.result; body.file_name = file.name; body.file_mime = file.type;
      await fetch('/api/resources', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      showToast('Ressource ajoutée !', 'success'); renderStudentResources();
    };
    reader.readAsDataURL(file); return;
  }
  await fetch('/api/resources', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
  showToast('Ressource ajoutée !', 'success'); renderStudentResources();
}

async function deleteResource(id) {
  if (!confirm('Supprimer cette ressource ?')) return;
  await fetch('/api/resources/' + id, { method:'DELETE', credentials:'include' });
  renderStudentResources();
}

// ========== WEEKLY OBJECTIVES ==========
async function renderStudentObjectives() {
  await loadStudentData();
  const c = document.getElementById('section-student-objectives');
  if (!c) return;

  const thisWeek = getWeekStart();
  const weekObjectives = studentData.objectives.filter(o => o.week_start === thisWeek);
  const pastObjectives = studentData.objectives.filter(o => o.week_start !== thisWeek);

  c.innerHTML = `
    <div class="page-header"><div><div class="page-title">Objectifs</div><div class="page-subtitle">Semaine du ${thisWeek}</div></div></div>
    <div class="panel" style="padding:20px;margin-bottom:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;color:var(--accent2)">Cette semaine</h3>
      ${weekObjectives.length === 0 ? '<div style="color:var(--text3);text-align:center;padding:16px">Aucun objectif cette semaine</div>' :
        '<div style="display:grid;gap:12px">' + weekObjectives.map(o => {
          const pct = o.target > 0 ? Math.min(100, Math.round((o.current / o.target) * 100)) : 0;
          const done = pct >= 100;
          return `<div style="background:var(--bg3);padding:14px;border-radius:10px;border-left:3px solid ${done?'var(--green)':'var(--accent)'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="font-size:14px">${o.description || o.obj_type}</strong>
              <span style="font-size:13px;font-weight:700;color:${done?'var(--green)':'var(--accent)'}">${o.current} / ${o.target}</span>
            </div>
            <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${done?'var(--green)':'var(--accent)'};border-radius:3px;transition:width 0.3s"></div></div>
            ${currentUser.role === 'student' ? '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><input type="number" class="form-input" style="width:80px;padding:4px 8px;font-size:12px" value="' + o.current + '" id="obj-cur-' + o.id + '" min="0"><button class="btn btn-primary" style="padding:4px 10px;font-size:11px" onclick="updateObjective(' + o.id + ')">Mettre à jour</button></div>' : ''}
          </div>`;
        }).join('') + '</div>'}
    </div>
    ${pastObjectives.length > 0 ? `<div class="panel" style="padding:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text2)">Semaines précédentes</h3>
      ${pastObjectives.map(o => {
        const pct = o.target > 0 ? Math.min(100, Math.round((o.current / o.target) * 100)) : 0;
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span>' + o.week_start + ' — ' + (o.description || o.obj_type) + '</span><span style="color:' + (pct>=100?'var(--green)':'var(--red)') + '">' + o.current + '/' + o.target + ' (' + pct + '%)</span></div>';
      }).join('')}
    </div>` : ''}
  `;
}

async function updateObjective(id) {
  const current = parseInt(document.getElementById('obj-cur-' + id).value) || 0;
  await fetch('/api/objectives/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ current }) });
  showToast('Objectif mis à jour !', 'success'); renderStudentObjectives();
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().split('T')[0];
}

// ========== INIT STUDENT SECTIONS ==========
async function initStudentSections() {
  if (currentUser.role !== 'student' && currentUser.role !== 'admin') return;
  if (currentUser.role === 'student') {
    await renderStudentHome();
    // Make first student section active
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-student-home')?.classList.add('active');
    document.querySelectorAll('[data-section]').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-section="student-home"]')?.classList.add('active');
  }
}
