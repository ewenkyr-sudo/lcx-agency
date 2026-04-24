// CONTENT PLANNER MODULE
// Calendar views for content scheduling

var cpView = 'week';
var cpDate = new Date();
var cpPosts = [];
var cpModelFilter = null; // null = all models (global view)

var CP_PLATFORMS = {
  instagram: { label: 'Instagram', icon: '📸', cls: 'ig' },
  tiktok: { label: 'TikTok', icon: '🎵', cls: 'tt' },
  onlyfans: { label: 'OnlyFans', icon: '💎', cls: 'of' },
  fansly: { label: 'Fansly', icon: '🌸', cls: 'fansly' },
  fanvue: { label: 'Fanvue', icon: '💚', cls: 'fanvue' },
  mym: { label: 'MYM', icon: '🔥', cls: 'mym' },
  twitter: { label: 'Twitter', icon: '🐦', cls: 'tw' }
};

var CP_TYPES = {
  instagram: ['post_instagram', 'story', 'reel'],
  tiktok: ['post_tiktok', 'live_tiktok'],
  onlyfans: ['post_onlyfans'],
  fansly: ['post_fansly', 'story_fansly', 'ppv_fansly'],
  fanvue: ['post_fanvue', 'video_fanvue'],
  mym: ['post_mym', 'media_mym'],
  twitter: ['post_twitter']
};

function getCPTypeLabel(key) {
  var labels = {
    post_instagram: 'Post', story: 'Story', reel: 'Reel',
    post_tiktok: 'Post', live_tiktok: 'Live',
    post_onlyfans: 'Post OF',
    post_fansly: 'Post', story_fansly: 'Story', ppv_fansly: 'PPV',
    post_fanvue: 'Post', video_fanvue: t('cp.type_video'),
    post_mym: 'Post', media_mym: t('cp.type_media'),
    post_twitter: 'Post'
  };
  return labels[key] || key;
}

function getCPStatus(key) { var labels = { draft: 'cp.status_draft', scheduled: 'cp.status_scheduled', published: 'cp.status_published', cancelled: 'cp.status_cancelled' }; return labels[key] ? t(labels[key]) : key; }

// ========== RENDERING ==========

function renderContentPlanner(modelId) {
  cpModelFilter = modelId || null;
  var container = document.getElementById(modelId ? 'cockpit-planner-content' : 'content-planner-content');
  if (!container) return;
  container.innerHTML = '<div id="cp-toolbar"></div><div id="cp-calendar"></div>';
  renderCPToolbar();
  loadContentPosts();
}

function renderCPToolbar() {
  var tb = document.getElementById('cp-toolbar');
  if (!tb) return;
  var mon = getCPMonday(cpDate);
  var sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  var title = cpView === 'week'
    ? t('cp.week_of_label') + ' ' + mon.getDate() + ' ' + mon.toLocaleDateString(undefined,{month:'short'}) + ' — ' + sun.getDate() + ' ' + sun.toLocaleDateString(undefined,{month:'short',year:'numeric'})
    : cpView === 'month'
    ? cpDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : t('cp.list_view');

  tb.innerHTML = '<div class="cp-toolbar">'
    + '<button class="cp-nav-btn" onclick="cpNavigate(-1)">←</button>'
    + '<button class="cp-nav-btn" onclick="cpToday()">' + t('cp.today_btn') + '</button>'
    + '<button class="cp-nav-btn" onclick="cpNavigate(1)">→</button>'
    + '<div class="cp-toolbar-title">' + title + '</div>'
    + '<div style="display:flex;gap:4px">'
    + '<button class="cp-view-btn' + (cpView==='week'?' active':'') + '" onclick="setCPView(\'week\')">' + t('cp.week_view') + '</button>'
    + '<button class="cp-view-btn' + (cpView==='month'?' active':'') + '" onclick="setCPView(\'month\')">' + t('cp.month_view') + '</button>'
    + '<button class="cp-view-btn' + (cpView==='list'?' active':'') + '" onclick="setCPView(\'list\')">' + t('cp.list_view') + '</button>'
    + '</div>'
    + (isAdmin() ? '<button class="btn btn-primary" style="font-size:12px;margin-left:auto" onclick="openCPModal()">' + t('cp.new_post_btn') + '</button>' : '')
    + '</div>';
}

async function loadContentPosts() {
  var mon = getCPMonday(cpDate);
  var start, end;
  if (cpView === 'week') {
    start = fmtDateISO(mon);
    var sun = new Date(mon); sun.setDate(sun.getDate() + 7);
    end = fmtDateISO(sun);
  } else if (cpView === 'month') {
    start = cpDate.getFullYear() + '-' + String(cpDate.getMonth()+1).padStart(2,'0') + '-01';
    var last = new Date(cpDate.getFullYear(), cpDate.getMonth()+1, 0);
    end = fmtDateISO(last);
  } else {
    start = fmtDateISO(new Date(cpDate.getTime() - 30*24*60*60*1000));
    end = fmtDateISO(new Date(cpDate.getTime() + 60*24*60*60*1000));
  }
  var url = '/api/content-posts?start_date=' + start + '&end_date=' + end;
  if (cpModelFilter) url += '&model_id=' + cpModelFilter;
  try {
    var res = await fetch(url, { credentials: 'include' });
    cpPosts = await res.json();
  } catch(e) { cpPosts = []; }
  renderCPCalendar();
}

function renderCPCalendar() {
  var cal = document.getElementById('cp-calendar');
  if (!cal) return;
  if (cpView === 'week') renderCPWeek(cal);
  else if (cpView === 'month') renderCPMonth(cal);
  else renderCPList(cal);
}

// ========== WEEK VIEW ==========

function renderCPWeek(container) {
  var mon = getCPMonday(cpDate);
  var today = new Date(); today.setHours(0,0,0,0);
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon); d.setDate(d.getDate() + i);
    days.push(d);
  }
  var dayNames = [t('cp.day_mon'),t('cp.day_tue'),t('cp.day_wed'),t('cp.day_thu'),t('cp.day_fri'),t('cp.day_sat'),t('cp.day_sun')];
  var hours = [];
  for (var h = 6; h <= 23; h++) hours.push(h);

  var html = '<div class="scroll-x"><div class="cp-week">';
  // Header row
  html += '<div class="cp-week-header"></div>';
  for (var i = 0; i < 7; i++) {
    var isToday = days[i].getTime() === today.getTime();
    html += '<div class="cp-week-header' + (isToday?' today':'') + '">' + dayNames[i] + '<br>' + days[i].getDate() + '/' + (days[i].getMonth()+1) + '</div>';
  }
  // Hour rows
  for (var hi = 0; hi < hours.length; hi++) {
    var h = hours[hi];
    html += '<div class="cp-time-label">' + h + t('cp.hour_suffix') + '</div>';
    for (var di = 0; di < 7; di++) {
      var dayStr = fmtDateISO(days[di]);
      var cellPosts = cpPosts.filter(function(p) {
        var pDate = new Date(p.scheduled_at);
        return fmtDateISO(pDate) === dayStr && pDate.getHours() === h;
      });
      html += '<div class="cp-week-cell" onclick="' + (isAdmin() ? 'openCPModal(null,\'' + dayStr + 'T' + String(h).padStart(2,'0') + ':00\')' : '') + '">';
      cellPosts.forEach(function(p) {
        var plat = CP_PLATFORMS[p.platform] || CP_PLATFORMS.instagram;
        var statusCls = p.status === 'draft' ? ' cp-post-draft' : p.status === 'cancelled' ? ' cp-post-cancelled' : '';
        html += '<div class="cp-post cp-post-' + plat.cls + statusCls + '" onclick="event.stopPropagation();openCPModal(' + p.id + ')" title="' + (p.caption || '').replace(/"/g,'&quot;').substring(0,60) + '">'
          + plat.icon + ' '
          + (cpModelFilter ? '' : '<strong>' + (p.model_name || '').substring(0,8) + '</strong> ')
          + getCPTypeLabel(p.content_type)
          + '</div>';
      });
      html += '</div>';
    }
  }
  html += '</div></div>'; // close cp-week + scroll-x
  container.innerHTML = html;
}

// ========== MONTH VIEW ==========

function renderCPMonth(container) {
  var year = cpDate.getFullYear(), month = cpDate.getMonth();
  var first = new Date(year, month, 1);
  var startDay = (first.getDay() + 6) % 7; // Monday = 0
  var daysInMonth = new Date(year, month+1, 0).getDate();
  var today = new Date(); today.setHours(0,0,0,0);
  var dayNames = [t('cp.day_mon'),t('cp.day_tue'),t('cp.day_wed'),t('cp.day_thu'),t('cp.day_fri'),t('cp.day_sat'),t('cp.day_sun')];

  var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:12px;overflow:hidden">';
  dayNames.forEach(function(d) { html += '<div style="background:rgba(19,13,33,0.8);padding:8px;text-align:center;font-size:10px;font-weight:700;color:var(--text-tertiary)">' + d + '</div>'; });

  for (var i = 0; i < startDay; i++) html += '<div style="background:var(--bg2);min-height:80px"></div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var dateObj = new Date(year, month, d);
    var dayStr = fmtDateISO(dateObj);
    var isToday = dateObj.getTime() === today.getTime();
    var dayPosts = cpPosts.filter(function(p) { return fmtDateISO(new Date(p.scheduled_at)) === dayStr; });

    html += '<div style="background:var(--bg2);min-height:80px;padding:4px;cursor:pointer;' + (isToday?'border:1px solid var(--accent);':'') + '" onclick="' + (isAdmin()?'openCPModal(null,\''+dayStr+'T10:00\')':'') + '">';
    html += '<div style="font-size:11px;font-weight:' + (isToday?'800':'500') + ';color:' + (isToday?'var(--accent)':'var(--text-secondary)') + ';margin-bottom:2px">' + d + '</div>';
    dayPosts.slice(0,3).forEach(function(p) {
      var plat = CP_PLATFORMS[p.platform] || CP_PLATFORMS.instagram;
      var time = new Date(p.scheduled_at); var hh = String(time.getHours()).padStart(2,'0') + ':' + String(time.getMinutes()).padStart(2,'0');
      html += '<div class="cp-post cp-post-' + plat.cls + '" onclick="event.stopPropagation();openCPModal(' + p.id + ')" style="font-size:9px;padding:2px 4px">' + hh + ' ' + plat.icon + '</div>';
    });
    if (dayPosts.length > 3) html += '<div style="font-size:9px;color:var(--text-tertiary);text-align:center">+' + (dayPosts.length-3) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// ========== LIST VIEW ==========

function renderCPList(container) {
  if (cpPosts.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px">' + t('cp.no_posts') + '</div>';
    return;
  }
  var html = '<table class="table mobile-cards"><thead><tr><th>' + t('cp.table_date') + '</th><th>' + t('cp.table_model') + '</th><th>' + t('cp.table_platform') + '</th><th>' + t('cp.table_type') + '</th><th>' + t('cp.table_caption') + '</th><th>' + t('cp.table_status') + '</th><th></th></tr></thead><tbody>';
  cpPosts.forEach(function(p) {
    var plat = CP_PLATFORMS[p.platform] || CP_PLATFORMS.instagram;
    var dt = new Date(p.scheduled_at);
    var dateStr = dt.toLocaleDateString(undefined, { day:'2-digit', month:'short' }) + ' ' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
    html += '<tr onclick="openCPModal(' + p.id + ')" style="cursor:pointer">'
      + '<td data-label="' + t('cp.table_date') + '" class="mc-half">' + dateStr + '</td>'
      + '<td data-label="' + t('cp.table_model') + '" class="mc-half"><strong>' + (p.model_name || '-') + '</strong></td>'
      + '<td data-label="" class="mc-half">' + plat.icon + ' ' + plat.label + '</td>'
      + '<td data-label="' + t('cp.table_type') + '" class="mc-half">' + getCPTypeLabel(p.content_type) + '</td>'
      + '<td data-label="' + t('cp.table_caption') + '" class="mc-full" style="color:var(--text-secondary);font-size:12px">' + ((p.caption || '').substring(0,50) || '-') + '</td>'
      + '<td data-label="' + t('cp.table_status') + '" class="mc-half"><span style="font-size:11px;font-weight:600;color:' + (p.status==='published'?'var(--green)':p.status==='cancelled'?'var(--red)':'var(--accent-blue-light)') + '">' + (getCPStatus(p.status)) + '</span></td>'
      + '<td data-label="" class="mc-half">' + (isAdmin() ? '<button class="btn-delete-small" onclick="event.stopPropagation();deleteCPPost(' + p.id + ')">✕</button>' : '') + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ========== MODAL ==========

function openCPModal(postId, defaultDateTime) {
  var post = postId ? cpPosts.find(function(p) { return p.id === postId; }) : null;
  var isReadOnly = !isAdmin();
  var modelOpts = (window.allModels || []).map(function(m) { return '<option value="' + m.id + '"' + (post && post.model_id === m.id ? ' selected' : cpModelFilter && cpModelFilter === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('');
  var teamOpts = '<option value="">—</option>' + (window.allTeam || []).concat(window.allUsers || []).filter(function(u, i, arr) { return arr.findIndex(function(x) { return x.id === u.id; }) === i; }).map(function(u) { return '<option value="' + u.id + '"' + (post && post.assigned_to_id === u.id ? ' selected' : '') + '>' + (u.display_name || u.name) + '</option>'; }).join('');

  var dt = post ? new Date(post.scheduled_at) : defaultDateTime ? new Date(defaultDateTime) : new Date();
  var dateVal = fmtDateISO(dt);
  var timeVal = String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
  var plat = post ? post.platform : 'instagram';

  var html = '<div class="modal-overlay show" id="cp-modal-overlay" onclick="if(event.target===this)closeCPModal()">'
    + '<div class="modal" style="width:520px">'
    + '<div class="modal-header"><div class="modal-title">' + (post ? (isReadOnly ? t('cp.post_details_title') : t('cp.edit_post_title')) : t('cp.new_post_title')) + '</div><button class="modal-close" onclick="closeCPModal()">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_model') + '</label><select id="cp-model" class="form-input"' + (isReadOnly?' disabled':'') + '>' + modelOpts + '</select></div>'
    + '<div class="grid-2col" style="gap:12px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_date') + '</label><input type="date" id="cp-date" class="form-input" value="' + dateVal + '"' + (isReadOnly?' disabled':'') + '></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_time') + '</label><input type="time" id="cp-time" class="form-input" value="' + timeVal + '"' + (isReadOnly?' disabled':'') + '></div>'
    + '</div>'
    + '<div class="grid-2col" style="gap:12px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_platform') + '</label><select id="cp-platform" class="form-input" onchange="updateCPTypes()"' + (isReadOnly?' disabled':'') + '><option value="instagram"' + (plat==='instagram'?' selected':'') + '>📸 Instagram</option><option value="tiktok"' + (plat==='tiktok'?' selected':'') + '>🎵 TikTok</option><option value="onlyfans"' + (plat==='onlyfans'?' selected':'') + '>💎 OnlyFans</option><option value="fansly"' + (plat==='fansly'?' selected':'') + '>🌸 Fansly</option><option value="fanvue"' + (plat==='fanvue'?' selected':'') + '>💚 Fanvue</option><option value="mym"' + (plat==='mym'?' selected':'') + '>🔥 MYM</option><option value="twitter"' + (plat==='twitter'?' selected':'') + '>🐦 Twitter</option></select></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_type') + '</label><select id="cp-type" class="form-input"' + (isReadOnly?' disabled':'') + '></select></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_caption') + '</label><textarea id="cp-caption" class="form-input" rows="3" style="resize:vertical"' + (isReadOnly?' disabled':'') + '>' + (post ? (post.caption || '') : '') + '</textarea></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_media_link') + '</label><input type="url" id="cp-media" class="form-input" value="' + (post ? (post.media_link || '') : '') + '"' + (isReadOnly?' disabled':'') + '>' + (post && post.media_link ? '<a href="' + post.media_link + '" target="_blank" style="font-size:11px;color:var(--accent-blue-light)">' + t('cp.open_media') + '</a>' : '') + '</div>'
    + '<div class="grid-2col" style="gap:12px">'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_status') + '</label><select id="cp-status" class="form-input"' + (isReadOnly?' disabled':'') + '><option value="draft"' + (post&&post.status==='draft'?' selected':'') + '>' + t('cp.status_draft') + '</option><option value="scheduled"' + (post&&post.status==='scheduled'?' selected':'') + '>' + t('cp.status_scheduled') + '</option><option value="published"' + (post&&post.status==='published'?' selected':'') + '>' + t('cp.status_published') + '</option><option value="cancelled"' + (post&&post.status==='cancelled'?' selected':'') + '>' + t('cp.status_cancelled') + '</option></select></div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_assigned') + '</label><select id="cp-assign" class="form-input"' + (isReadOnly?' disabled':'') + '>' + teamOpts + '</select></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">' + t('cp.form_notes') + '</label><textarea id="cp-notes" class="form-input" rows="2" style="resize:vertical"' + (isReadOnly?' disabled':'') + '>' + (post ? (post.notes || '') : '') + '</textarea></div>'
    + '</div>'
    + (isReadOnly ? '' : '<div class="modal-footer">'
      + (post ? '<button class="btn" style="background:var(--red-bg);color:var(--red);border:none;cursor:pointer" onclick="deleteCPPost(' + post.id + ');closeCPModal()">' + t('common.delete') + '</button>' : '')
      + '<div style="flex:1"></div>'
      + '<button class="btn btn-secondary" onclick="closeCPModal()">' + t('common.cancel') + '</button>'
      + '<button class="btn btn-primary" onclick="saveCPPost(' + (post ? post.id : 'null') + ')">' + (post ? t('common.save_btn') : t('common.create_btn')) + '</button>'
      + '</div>')
    + '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  updateCPTypes(post ? post.content_type : null);
}

function closeCPModal() {
  var overlay = document.getElementById('cp-modal-overlay');
  if (overlay) overlay.remove();
}

function updateCPTypes(selectedType) {
  var plat = document.getElementById('cp-platform').value;
  var types = CP_TYPES[plat] || ['post_instagram'];
  var sel = document.getElementById('cp-type');
  sel.innerHTML = types.map(function(tp) { return '<option value="' + tp + '"' + (tp === selectedType ? ' selected' : '') + '>' + getCPTypeLabel(tp) + '</option>'; }).join('');
}

async function saveCPPost(postId) {
  var data = {
    model_id: parseInt(document.getElementById('cp-model').value),
    scheduled_at: document.getElementById('cp-date').value + 'T' + document.getElementById('cp-time').value + ':00',
    platform: document.getElementById('cp-platform').value,
    content_type: document.getElementById('cp-type').value,
    caption: document.getElementById('cp-caption').value,
    media_link: document.getElementById('cp-media').value || null,
    status: document.getElementById('cp-status').value,
    assigned_to_id: document.getElementById('cp-assign').value ? parseInt(document.getElementById('cp-assign').value) : null,
    notes: document.getElementById('cp-notes').value
  };
  if (!data.model_id || !data.scheduled_at) return showToast(t('cp.model_date_required'), 'error');
  var url = postId ? '/api/content-posts/' + postId : '/api/content-posts';
  var method = postId ? 'PUT' : 'POST';
  var res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
  if (res.ok) {
    showToast(postId ? t('cp.post_modified_toast') : t('cp.post_created_toast'), 'success');
    closeCPModal();
    loadContentPosts();
  } else {
    var err = await res.json().catch(function() { return {}; });
    showToast(err.error || t('common.error'), 'error');
  }
}

async function deleteCPPost(id) {
  if (!(await confirmDelete(t('cp.post_deleted_confirm')))) return;
  await fetch('/api/content-posts/' + id, { method: 'DELETE', credentials: 'include' });
  showToast(t('cp.post_deleted_toast'), 'success');
  loadContentPosts();
}

// ========== NAVIGATION ==========

function cpNavigate(dir) {
  if (cpView === 'week') cpDate.setDate(cpDate.getDate() + 7 * dir);
  else if (cpView === 'month') cpDate.setMonth(cpDate.getMonth() + dir);
  renderCPToolbar();
  loadContentPosts();
}

function cpToday() {
  cpDate = new Date();
  renderCPToolbar();
  loadContentPosts();
}

function setCPView(view) {
  cpView = view;
  renderCPToolbar();
  loadContentPosts();
}

// ========== HELPERS ==========

function getCPMonday(d) {
  var dt = new Date(d); var day = dt.getDay();
  var diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff); dt.setHours(0,0,0,0);
  return dt;
}

function fmtDateISO(d) { return d.toISOString().slice(0, 10); }
