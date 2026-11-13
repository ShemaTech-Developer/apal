// APALINK dashboard shell — role-aware sidebar, note rendering, actions (student + teacher).
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtSize(n) {
    n = Number(n || 0);
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtDate(s) { return String(s || '').replace('T', ' ').slice(0, 10); }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  // ---------- Top-right account chip (avatar + name + role) ----------
  function renderTopUser(u, role) {
    var head = document.querySelector('.dash-head');
    if (!head) return;
    var sameDir = window.location.pathname.includes('/student/') || window.location.pathname.includes('/teacher/');
    var notifHref = (sameDir ? '../' : '') + 'notifications.html';
    if (!head.querySelector('#topBell')) {
      var bell = document.createElement('a');
      bell.className = 'top-bell';
      bell.id = 'topBell';
      bell.setAttribute('href', notifHref);
      bell.setAttribute('aria-label', 'Notifications');
      bell.style.padding = '5px 12px';
      bell.style.gap = '8px';
      bell.innerHTML = '<span style="display:inline-flex">' + NN.icon('bell', 17) + '</span>' +
        '<span id="topBellBadge" style="display:none;background:#C92A2A;color:#fff;border-radius:999px;font-size:.68rem;font-weight:800;min-width:20px;height:20px;place-items:center;padding:0 6px"></span>';
      head.appendChild(bell);
      NN.api('/api/notifications').then(function (r) {
        if (r.ok && r.data && r.data.unread > 0) { var b = document.getElementById('topBellBadge'); if (b) { b.textContent = r.data.unread; b.style.display = 'grid'; } }
      }).catch(function () {});
    }
    var box = head.querySelector('#topUser');
    if (!box) {
      box = document.createElement('div');
      box.className = 'top-user';
      box.id = 'topUser';
      box.innerHTML = '<span class="avatar" id="topAvatar">?</span>' +
        '<span class="top-user-meta"><b id="topName"></b><small id="topRole"></small></span>';
      head.appendChild(box);
    }
    var name = u.fullName || u.username || 'Account';
    var av = box.querySelector('.avatar');
    if (u.avatar) {
      var img = document.createElement('img');
      img.src = '/api/settings/avatar/' + encodeURIComponent(u.avatar);
      img.alt = name;
      img.onerror = function () { av.textContent = initials(name); };
      av.textContent = '';
      av.appendChild(img);
    } else {
      av.textContent = initials(name);
    }
    box.querySelector('#topName').textContent = name;
    box.querySelector('#topRole').textContent = role === 'student' ? 'Student' : 'Teacher';
  }
  function fileLabel(n) {
    if (!n.fileName) return 'NOTES';
    var ext = n.fileName.split('.').pop().toUpperCase();
    return ext + ' · ' + fmtSize(n.fileSize);
  }

  // ---------- Per-user activity history (profile + settings) ----------
  var ACTIVITY_LABELS = {
    'auth.login': 'Signed in', 'auth.register': 'Created account', 'auth.passwordChange': 'Changed password',
    'note.publish': 'Published a note', 'note.unpublish': 'Unpublished a note', 'note.update': 'Edited a note',
    'note.delete': 'Deleted a note', 'note.view': 'Viewed a note', 'note.download': 'Downloaded a note',
    'note.save': 'Saved a note', 'note.unsave': 'Removed a saved note', 'message.send': 'Sent a message',
    'admin.reply': 'Replied to administration', 'profile.update': 'Updated profile', 'profile.avatar': 'Changed profile picture',
    'message.report': 'Reported a message', 'message.delete': 'Deleted a message', 'timetable.publish': 'Timetable published',
  };
  function activityLabel(action) { return ACTIVITY_LABELS[action] || action; }
  function loadMyActivity() {
    var box = $('activityList');
    if (!box) return;
    NN.api('/api/settings/activity').then(function (r) {
      if (!r.ok) { box.innerHTML = '<li class="muted">Could not load your activity history.</li>'; return; }
      if (!r.data.activity.length) {
        box.innerHTML = '<li class="muted">No activity yet — things you do in APALINK will appear here.</li>';
      } else {
        box.innerHTML = r.data.activity.map(function (a) {
          return '<li><span><b>' + esc(activityLabel(a.action)) + '</b><br><small class="muted">' +
            esc(a.details || '') + ' · ' + esc(String(a.createdAt).slice(0, 16)) + '</small></span>' +
            '<button class="btn btn-ghost" data-del-activity="' + a.id + '" title="Remove this entry from my history">' + NN.icon('trash-2') + '</button></li>';
        }).join('');
      }
      box.querySelectorAll('[data-del-activity]').forEach(function (b) {
        b.addEventListener('click', function () {
          NN.api('/api/settings/activity/' + b.dataset.delActivity, { method: 'DELETE' }).then(loadMyActivity);
        });
      });
    });
  }
  function bindActivityClear() {
    var btn = $('clearActivityBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      if (!confirm('Remove every entry from your activity history? Admins keep the safety audit log.')) return;
      NN.api('/api/settings/activity', { method: 'DELETE' }).then(loadMyActivity);
    });
  }
  document.addEventListener('DOMContentLoaded', bindActivityClear);
  window.NN.loadActivity = loadMyActivity;

  // ---------- Shell: sidebar + auth + logout ----------
  async function initShell() {
    var me = await NN.api('/api/auth/me');
    var sameDir = window.location.pathname.includes('/student/') || window.location.pathname.includes('/teacher/');
    if (!me.ok) { window.location.href = sameDir ? '../student-login.html' : 'student-login.html'; return null; }
    var u = me.data.user;
    var nav = $('sideNav');
    var role = u.role;
    var onSubdir = sameDir ? '' : (role === 'student' ? 'student/' : 'teacher/');
    var items = role === 'student'
      ? [['overview.html', 'layout-dashboard', 'Overview'], ['my-notes.html', 'file-text', 'My Notes'], ['recent.html', 'clock', 'Recently Added'], ['saved.html', 'star', 'Saved Notes'], ['downloads.html', 'download', 'Downloads'], ['timetable.html', 'calendar', 'My Timetable'], ['my-class.html', 'graduation-cap', 'My Class'], ['profile.html', 'user', 'My Profile'], ['settings.html', 'settings', 'Settings']]
      : [['overview.html', 'layout-dashboard', 'Overview'], ['my-notes.html', 'file-text', 'My Notes'], ['publish.html', 'upload', 'Publish Note'], ['stats.html', 'bar-chart-3', 'Downloads'], ['schedule.html', 'calendar-days', 'My Teaching Schedule'], ['eclass.html', 'presentation', 'E-Class'], ['profile.html', 'user', 'My Profile'], ['settings.html', 'settings', 'Settings']];
    // Admin gate (teachers): opens the admin sign-in; admin credentials required.
    if (role === 'teacher') items.push(['admin-gate', 'shield', 'Admin']);
    var here = window.location.pathname.split('/').pop();
    var extra = function (href, icon, label, id, base) {
      return '<a class="snav" href="' + (base || onSubdir) + href + '"><span class="ic">' + icon + '</span>' + label + (id ? ' <span class="badge" id="' + id + '" style="display:none"></span>' : '') + '</a>';
    };
    var msgHref = onSubdir + '../messages.html'; var notifHref = onSubdir + '../notifications.html';
    nav.innerHTML = items.map(function (it) {
      var active = (it[0] === here && sameDir) ? ' active' : '';
      var href = it[0] === 'admin-gate' ? (sameDir ? '../admin/login.html' : 'admin/login.html') : onSubdir + it[0];
      return '<a class="snav' + active + '" href="' + href + '"><span class="ic">' + NN.icon(it[1]) + '</span>' + it[2] + '</a>';
    }).join('')
      + '<a class="snav' + (here === 'announcements.html' ? ' active' : '') + '" href="' + onSubdir + '../announcements.html"><span class="ic">' + NN.icon('megaphone') + '</span>Announcements</a>'
      + '<a class="snav' + (here === 'messages.html' ? ' active' : '') + '" href="' + msgHref + '"><span class="ic">' + NN.icon('message-square') + '</span>Messages<span class="badge" id="msgUnread" style="display:none"></span></a>'
      + '<a class="snav' + (here === 'notifications.html' ? ' active' : '') + '" href="' + notifHref + '"><span class="ic">' + NN.icon('bell') + '</span>Notifications<span class="badge" id="notifUnread" style="display:none"></span></a>'
      + '<button class="snav" id="sideLogout"><span class="ic">' + NN.icon('log-out') + '</span>Logout</button>';
    // Update with real unread counts.
    (async function () {
      try {
        var m = await NN.api('/api/messages/unread');
        if (m.ok && m.data.unread > 0) { var b = $('msgUnread'); b.textContent = m.data.unread; b.style.display = ''; }
        var n = await NN.api('/api/notifications');
        if (n.ok && n.data.unread > 0) { var b2 = $('notifUnread'); b2.textContent = n.data.unread; b2.style.display = ''; }
      } catch (e) {}
    })();
    // Top-right account chip (avatar + name + role) in the page header.
    renderTopUser(u, role);
    var lo = $('sideLogout');
    if (lo) lo.addEventListener('click', async function () {
      await NN.api('/api/auth/logout', { method: 'POST' });
      window.location.href = sameDir ? '../student-login.html' : 'student-login.html';
    });
    var burger = $('burger');
    if (burger) burger.addEventListener('click', function () {
      $('sidebar').classList.toggle('open'); $('overlay').classList.toggle('show');
    });
    var ov = $('overlay');
    if (ov) ov.addEventListener('click', function () { $('sidebar').classList.remove('open'); ov.classList.remove('show'); });
    // Sync saved preferences (theme etc.) — server is source of truth, local is fallback.
    NN.api('/api/settings/prefs').then(function (p) { if (p.ok) NN.applyPrefs(p.data); });
    return u;
  }

  // ---------- Global search (top of every student/teacher dashboard) ----------
  function initGlobalSearch() {
    var head = document.querySelector('.dash-head');
    if (!head || head.querySelector('.global-search')) return;
    var wrap = document.createElement('div');
    wrap.className = 'global-search';
    wrap.innerHTML =
      '<div class="searchbar" role="search"><span aria-hidden="true">' + NN.icon('search') + '</span>' +
      '<input id="globalSearchInput" type="search" autocomplete="off" placeholder="Search notes, people, announcements…" aria-label="Search APALINK">' +
      '<kbd>/</kbd></div>' +
      '<div class="search-results" id="globalSearchResults" hidden></div>';
    head.appendChild(wrap);
    var input = document.getElementById('globalSearchInput');
    var box = document.getElementById('globalSearchResults');
    var timer = null;
    function close() { box.hidden = true; box.innerHTML = ''; }
    function section(title, items) {
      if (!items.length) return '';
      return '<div class="sr-group"><h4>' + title + '</h4>' + items.join('') + '</div>';
    }
    function render(data) {
      var notes = (data.notes || []).map(function (n) {
        return '<a class="sr-item" href="/pages/preview.html?note=' + n.id + '"><span class="sr-ic">' + NN.icon('file-text') + '</span><span><b>' + esc(n.title) + '</b><small>' +
          esc([n.subject, n.department, n.level].filter(Boolean).join(' · ')) + '</small></span></a>';
      });
      var users = (data.users || []).map(function (u) {
        return '<a class="sr-item" href="/pages/messages.html?with=' + u.role + ':' + u.id + '"><span class="sr-ic">' + (u.role === 'student' ? NN.icon('graduation-cap') : NN.icon('book-open')) + '</span><span><b>' + esc(u.fullName) + '</b><small>' +
          esc([u.username, u.detail, u.school].filter(Boolean).join(' · ')) + '</small></span><span class="sr-go">Message →</span></a>';
      });
      var anns = (data.announcements || []).map(function (a) {
        return '<a class="sr-item" href="/pages/announcements.html"><span class="sr-ic">' + NN.icon('megaphone') + '</span><span><b>' + esc(a.title) + '</b><small>' + esc(a.category) + '</small></span></a>';
      });
      var html = section('Notes', notes) + section('People', users) + section('Announcements', anns);
      box.innerHTML = html || '<div class="sr-empty">No matches for “' + esc(input.value.trim()) + '”. Try a different word.</div>';
      box.hidden = false;
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        NN.api('/api/search?q=' + encodeURIComponent(q)).then(function (r) { if (r.ok) render(r.data); else close(); });
      }, 220);
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
      if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) {
        e.preventDefault(); input.focus();
      }
    });
  }

  // ---------- Theme toggle (top-right on every user page) ----------
  function initThemeToggle() {
    var head = document.querySelector('.dash-head');
    if (!head || document.getElementById('themeToggle')) return;
    var btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.type = 'button';
    btn.className = 'btn btn-ghost theme-toggle';
    var actions = head.querySelector('.dash-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'dash-actions';
      Array.prototype.slice.call(head.children).forEach(function (child, i) {
        if (i === 0 || child === btn || child.classList.contains('global-search') || child.classList.contains('dash-actions')) return;
        actions.appendChild(child);
      });
      head.appendChild(actions);
    }
    actions.appendChild(btn);
    function paint() {
      var dark = document.documentElement.dataset.theme === 'dark';
      btn.innerHTML = dark ? '<span aria-hidden="true">' + NN.icon('sun') + '</span><span class="theme-label">Light</span>' : '<span aria-hidden="true">' + NN.icon('moon') + '</span><span class="theme-label">Dark</span>';
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    paint();
    btn.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('nn-theme', next); } catch (e) {}
      NN.api('/api/settings/prefs', { method: 'POST', body: JSON.stringify({ prefs: { theme: next } }) }).catch(function () {});
      paint();
    });
  }

  // ---------- Presence heartbeat (drives the little online dots) ----------
  function initPresence() {
    function ping() { NN.api('/api/messages/presence', { method: 'POST' }).catch(function () {}); }
    ping();
    setInterval(ping, 25000);
  }

  // ---------- Note card ----------
  function noteCard(n, mode) {
    var saved = n.saved ? 'true' : 'false';
    var badge = n.isPublished === false ? ' <span class="badge">Unpublished</span>' : '';
    return '<article class="note-card">' +
      '<h3>' + esc(n.title) + badge + '</h3>' +
      (n.description ? '<p class="note-desc">' + esc(n.description) + '</p>' : '') +
      '<div class="meta">' +
      '<span class="file">' + esc(fileLabel(n)) + '</span>' +
      '<span>' + esc(n.department || '') + '</span>' +
      '<span>' + esc(n.level || '') + '</span>' +
      (n.subject ? '<span>' + esc(n.subject) + '</span>' : '') +
      (n.className ? '<span>Class ' + esc(n.className) + '</span>' : '') +
      '</div>' +
      '<div class="meta">' +
      '<span>' + NN.icon('user') + ' ' + esc(n.teacherName || '') + '</span>' +
      '<span>' + NN.icon('calendar') + ' ' + fmtDate(n.createdAt) + '</span>' +
      '<span>' + NN.icon('download') + ' ' + esc(n.downloadCount || 0) + '</span>' +
      '</div>' +
      '<div class="note-actions">' +
      '<a class="btn btn-dark" href="/pages/preview.html?note=' + n.id + '">' + NN.icon('eye') + ' Preview</a>' +
      '<a class="btn btn-primary" href="/api/notes/' + n.id + '/file" download>' + NN.icon('download') + ' Download</a>' +
      (mode === 'student' ? '<button class="btn btn-ghost save-btn" data-save="' + n.id + '" aria-pressed="' + saved + '">' + (n.saved ? NN.icon('star') + ' Saved' : NN.icon('star') + ' Save') + '</button>' : '') +
      '</div></article>';
  }

  function renderNotes(container, notes, opts) {
    opts = opts || {};
    if (!container) return;
    if (!notes.length) {
      container.innerHTML = '<div class="empty"><span class="big">' + NN.icon(opts.icon || 'inbox', 26) + '</span><h3>' + (opts.emptyTitle || 'No notes yet') + '</h3><p>' + (opts.emptyText || 'Nothing here right now.') + '</p></div>';
      return;
    }
    container.innerHTML = notes.map(function (n) { return noteCard(n, opts.mode); }).join('');
  }

  // Delegated save / unsave
  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-save]');
    if (!btn) return;
    var id = btn.dataset.save;
    var isSaved = btn.getAttribute('aria-pressed') === 'true';
    if (isSaved) await NN.api('/api/student/notes/' + id + '/save', { method: 'DELETE' });
    else await NN.api('/api/student/notes/' + id + '/save', { method: 'POST' });
    window.location.reload();
  });

  // ---------- Page wiring ----------
  document.addEventListener('DOMContentLoaded', function () {
    initShell().then(async function (u) {
      if (!u) return;
      initGlobalSearch();
      initThemeToggle();
      initPresence();
      var view = document.body.dataset.view;
      var role = u.role;

      // Student overview
      if (view === 's-overview') NN.api('/api/student/dashboard').then(function (r) {
        if (!r.ok) return;
        $('welcomeMsg').textContent = 'Welcome back, ' + u.fullName;
        $('welcomeSub').textContent = [u.sectionName, u.levelName, u.className ? 'Class ' + u.className : '', u.schoolName].filter(Boolean).join(' · ');
        $('statNotes').textContent = r.data.stats.availableNotes;
        $('statSaved').textContent = r.data.stats.savedCount;
        $('statDownloads').textContent = r.data.stats.downloadsCount;
        var notif = $('notifList');
        if (!r.data.notifications.length) { notif.innerHTML = '<li class="muted">No new notes yet — check back soon.</li>'; }
        else notif.innerHTML = r.data.notifications.map(function (n) {
          return '<li><span><b>' + esc(n.title) + '</b><br><small class="muted">' + esc(n.department) + ' · ' + esc(n.level) + ' · ' + fmtDate(n.createdAt) + '</small></span><a class="btn btn-ghost" href="preview.html?note=' + n.id + '">View</a></li>';
        }).join('');
        renderNotes($('recentGrid'), r.data.notifications, { mode: 'student', emptyTitle: 'No notes yet', emptyText: 'Your teachers have not published notes for your section yet.' });
      });
      if (view === 's-overview' && $('announcementPreview')) NN.api('/api/announcements/latest').then(function (r) {
        if (!r.ok) return;
        var box = $('announcementPreview');
        box.innerHTML = r.data.length ? r.data.map(function (a) {
          return '<li><span><b>' + (a.isPinned ? NN.icon('pin') + ' ' : '') + esc(a.title) + '</b><br><small class="muted">' + esc(a.category) + ' · ' + esc(fmtDate(a.createdAt)) + '</small></span><a class="btn btn-ghost" href="/pages/announcements.html">Read</a></li>';
        }).join('') : '<li class="muted">No announcements right now.</li>';
      });

      // Student library (my-notes / recent)
      if (view === 's-notes' || view === 's-recent') {
        var url = view === 's-recent' ? '/api/student/recent' : '/api/student/notes';
        var subjectsSeen = false;
        function load() {
          var params = new URLSearchParams();
          var q = $('q'); if (q && q.value.trim()) params.set('q', q.value.trim());
          var subject = $('subject'); if (subject && subject.value) params.set('subject', subject.value);
          var type = $('ftype'); if (type && type.value !== 'all') params.set('type', type.value);
          var sort = $('sort'); if (sort && sort.value) params.set('sort', sort.value);
          var qs = params.toString();
          fetch(url + (qs ? '?' + qs : ''), { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (notes) {
              renderNotes($('notesGrid'), notes, {
                mode: 'student', icon: 'file-text',
                emptyTitle: 'No notes found',
                emptyText: 'Try a different search — or ask your teacher to publish for your section & level.',
              });
              $('notesCount').textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's');
              if (!subjectsSeen && $('subject')) {
                var subjects = [...new Set(notes.map(function (n) { return n.subject || ''; }).filter(Boolean))].sort();
                subjects.forEach(function (s) {
                  var o = document.createElement('option'); o.value = s; o.textContent = s; $('subject').appendChild(o);
                });
                subjectsSeen = true;
              }
            });
        }
        ['q', 'subject', 'ftype', 'sort'].forEach(function (id) {
          var el = $('' + id); if (!el) return;
          el.addEventListener('input', load); el.addEventListener('change', load);
        });
        load();
      }

      // Student saved / downloads
      if (view === 's-saved' || view === 's-downloads') {
        fetch(view === 's-saved' ? '/api/student/saved' : '/api/student/downloads')
          .then(function (r) { return r.json(); })
          .then(function (notes) {
            renderNotes($('notesGrid'), notes, {
              mode: 'student', icon: view === 's-saved' ? 'star' : 'download',
              emptyTitle: view === 's-saved' ? 'No saved notes yet' : 'No downloads yet',
              emptyText: view === 's-saved' ? 'Tap the star on any note to keep it here.' : 'When you download a note, it will appear here.',
            });
            $('notesCount').textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's');
          });
      }

      // Profile
      if (view === 's-profile' || view === 't-profile') {
        $('pName').textContent = u.fullName;
        $('pUser').textContent = u.username;
        $('pEmail').textContent = u.email || '—';
        $('pRole').textContent = role === 'student' ? 'Student' : 'Teacher';
        $('pJoined').textContent = fmtDate(u.createdAt);
        if (u.sectionName && $('pSection')) $('pSection').textContent = u.sectionName;
        if (u.levelName && $('pLevel')) $('pLevel').textContent = u.levelName;
        if (u.className && $('pClass')) $('pClass').textContent = u.className;
        if (u.schoolName && $('pSchool')) $('pSchool').textContent = u.schoolName;
        if (u.district && $('pDistrict')) $('pDistrict').textContent = u.district + ' District';
        loadMyActivity();
      }

      // Announcements (students + teachers)
      if (view === 'announcements') {
        NN.api('/api/announcements').then(function (r) {
          var box = $('announcementList');
          if (!r.ok) { box.innerHTML = '<div class="empty"><h3>Could not load announcements</h3><p>Please refresh and try again.</p></div>'; return; }
          if (!r.data.length) { box.innerHTML = '<div class="empty"><span class="big">' + NN.icon('megaphone', 26) + '</span><h3>No announcements yet</h3><p>School news and updates will appear here.</p></div>'; return; }
          box.innerHTML = r.data.map(function (a) {
            return '<article class="announcement-card cat-' + esc(a.category) + (a.isPinned ? ' pinned' : '') + '">' +
              '<div class="ann-head"><span class="ann-cat">' + esc(a.category) + '</span>' +
              (a.isPinned ? '<span class="badge">' + NN.icon('pin') + ' Pinned</span>' : '') +
              '<small class="muted">' + esc(fmtDate(a.createdAt)) + (a.schoolName ? ' · ' + esc(a.schoolName) : ' · All schools') + '</small></div>' +
              '<h3>' + esc(a.title) + '</h3><p>' + esc(a.body) + '</p>' +
              '<small class="muted">For ' + esc(a.audience === 'all' ? 'everyone' : a.audience) + '</small></article>';
          }).join('');
        });
      }

      // Settings: change password
      if (view === 's-settings' || view === 't-settings') {
        $('pwForm').addEventListener('submit', async function (e) {
          e.preventDefault();
          var f = e.target, btn = f.querySelector('button[type=submit]');
          NN.clearError($('pwError'));
          var original = btn.textContent;
          btn.disabled = true; btn.textContent = 'Saving…';
          var r = await NN.api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({
            currentPassword: f.elements.currentPassword.value,
            newPassword: f.elements.newPassword.value,
            confirm: f.elements.confirm.value,
          }) });
          btn.disabled = false; btn.textContent = original;
          if (!r.ok) { NN.showError($('pwError'), r.data.error || 'Could not change password.'); return; }
          f.reset();
          $('pwOk').classList.add('show');
          $('pwOk').textContent = 'Password changed successfully.';
        });
      }

      // Preview (multi-format: PDF embedded, images, text, documents)
      if (view === 'preview') {
        var id = new URLSearchParams(window.location.search).get('note');
        $('backLink').href = role === 'student' ? 'student/my-notes.html' : 'teacher/my-notes.html';
        var src = role === 'student' ? '/api/student/notes' : '/api/teacher/dashboard';
        fetch(src).then(function (r) { return r.json(); }).then(function (data) {
          var list = Array.isArray(data) ? data : data.notes || [];
          var n = list.find(function (x) { return String(x.id) === String(id); });
          var slot = $('previewSlot');
          if (!n) { slot.innerHTML = '<div class="empty"><span class="big">' + NN.icon('lock', 26) + '</span><h3>Not available</h3><p>This note is not available to you (it may be unpublished or for another section/level).</p></div>'; return; }
          $('pvTitle').textContent = n.title;
          $('pvMeta').textContent = [n.department, n.level, n.subject, 'By ' + (n.teacherName || ''), fmtDate(n.createdAt)].filter(Boolean).join(' · ');
          $('pvDownload').href = '/api/notes/' + n.id + '/file';
          if (n.description) $('pvDesc').textContent = n.description;

          var ext = (n.fileName || '').split('.').pop().toLowerCase();
          var fileApi = '/api/notes/' + n.id + '/file?mode=preview';
          var download = '/api/notes/' + n.id + '/file';
          var typeLabel = (ext || 'file').toUpperCase() + ' · ' + fmtSize(n.fileSize);
          var toolbar = '<div class="preview-toolbar">' +
            '<span class="badge">' + esc(typeLabel) + '</span>' +
            '<span class="muted preview-name">' + esc(n.fileName || '') + '</span>' +
            '<span class="preview-spacer"></span>' +
            '<a class="btn btn-ghost" href="' + fileApi + '" target="_blank" rel="noopener">↗ Open in new tab</a>' +
            '<a class="btn btn-primary" href="' + download + '" download>' + NN.icon('download') + ' Download</a>' +
            '</div>';

          if (ext === 'pdf') {
            slot.innerHTML = toolbar +
              '<div class="preview-pdf-wrap"><iframe class="preview-frame preview-pdf" src="' + fileApi + '#view=FitH&toolbar=1" title="PDF preview" loading="lazy"></iframe></div>' +
              '<p class="preview-hint">On a phone, if the PDF does not appear inside this page, tap <b>Open in new tab</b> — it opens in your device PDF viewer.</p>';
          } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
            slot.innerHTML = toolbar + '<div class="preview-image-wrap"><img class="preview-image" src="' + fileApi + '" alt="' + esc(n.title) + '"></div>';
            var img = slot.querySelector('.preview-image');
            if (img) img.addEventListener('click', function () {
              if (document.fullscreenElement) document.exitFullscreen();
              else if (img.requestFullscreen) img.requestFullscreen();
            });
          } else if (['txt', 'md', 'csv', 'json', 'html'].includes(ext)) {
            slot.innerHTML = toolbar + '<pre class="preview-pre">Loading…</pre>';
            fetch(fileApi).then(function (r) { return r.text(); }).then(function (t) {
              var pre = slot.querySelector('.preview-pre');
              if (pre) pre.textContent = t.slice(0, 50000);
            }).catch(function () { slot.innerHTML = toolbar + '<div class="empty"><h3>Preview failed</h3><p>Open or download the file instead.</p></div>'; });
          } else if (['doc', 'docx', 'ppt', 'pptx'].includes(ext)) {
            slot.innerHTML = toolbar +
              '<div class="empty preview-office"><span class="big">' + (ext.startsWith('ppt') ? NN.icon('presentation', 26) : NN.icon('file-text', 26)) + '</span>' +
              '<h3>' + (ext.startsWith('ppt') ? 'Presentation' : 'Document') + ' file</h3>' +
              '<p>Browsers cannot render <b>.' + ext + '</b> files inside a page. Download it to open in Word/PowerPoint — or open it directly.</p>' +
              '<p><a class="btn btn-primary" href="' + download + '" download>' + NN.icon('download') + ' Download ' + esc(n.fileName || 'file') + '</a> ' +
              '<a class="btn btn-ghost" href="' + fileApi + '" target="_blank" rel="noopener">↗ Open in new tab</a></p></div>';
          } else {
            slot.innerHTML = toolbar +
              '<div class="empty preview-office"><span class="big">' + NN.icon('file-text', 26) + '</span><h3>Preview not available for this file type</h3>' +
              '<p>Download it to open: <b>' + esc(n.fileName || '') + '</b></p>' +
              '<p><a class="btn btn-primary" href="' + download + '" download>' + NN.icon('download') + ' Download file</a></p></div>';
          }
        });
      }

      // Teacher overview
      if (view === 't-overview') NN.api('/api/teacher/dashboard').then(function (r) {
        if (!r.ok) return;
        $('welcomeMsg').textContent = 'Welcome, ' + u.fullName;
        $('welcomeSub').textContent = [u.schoolName, r.data.stats.notes + ' note' + (r.data.stats.notes === 1 ? '' : 's') + ' published by you'].filter(Boolean).join(' · ');
        $('statNotes').textContent = r.data.stats.notes;
        $('statPublished').textContent = r.data.stats.published;
        $('statDownloads').textContent = r.data.stats.downloads;
        renderNotes($('recentGrid'), r.data.notes.slice(0, 3), {
          mode: 'teacher', emptyTitle: 'No notes yet', emptyText: 'Publish your first note to get started.',
        });
      });
      if (view === 't-overview' && $('announcementPreview')) NN.api('/api/announcements/latest').then(function (r) {
        if (!r.ok) return;
        var box = $('announcementPreview');
        box.innerHTML = r.data.length ? r.data.map(function (a) {
          return '<li><span><b>' + (a.isPinned ? NN.icon('pin') + ' ' : '') + esc(a.title) + '</b><br><small class="muted">' + esc(a.category) + ' · ' + esc(fmtDate(a.createdAt)) + '</small></span><a class="btn btn-ghost" href="/pages/announcements.html">Read</a></li>';
        }).join('') : '<li class="muted">No announcements right now.</li>';
      });

      // Teacher my notes
      if (view === 't-notes') {
        NN.api('/api/teacher/dashboard').then(function (r) {
          var notes = r.data.notes || [];
          $('notesCount').textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's');
          var box = $('notesGrid');
          if (!notes.length) { box.innerHTML = '<div class="empty"><span class="big">' + NN.icon('inbox', 26) + '</span><h3>No notes published yet</h3><p>Publish a note for your students.</p><p><a class="btn btn-primary" href="publish.html">Publish Note</a></p></div>'; return; }
          box.innerHTML = notes.map(function (n) {
            return noteCard(n, 'teacher').replace('</div></article>',
              '<div class="note-actions"><button class="btn btn-ghost" data-toggle="' + n.id + '">' + (n.isPublished ? 'Unpublish' : 'Publish') + '</button>' +
              '<button class="btn btn-ghost" data-del="' + n.id + '">' + NN.icon('trash-2') + ' Delete</button></div></article>');
          }).join('');
        });
        document.addEventListener('click', async function (e) {
          var t = e.target.closest('[data-toggle]'); var d = e.target.closest('[data-del]');
          if (t) { var n = await fetch('/api/teacher/dashboard').then(r => r.json()).then(r => (r.notes || []).find(x => x.id == t.dataset.toggle)); if (n) { await NN.api('/api/teacher/notes/' + n.id, { method: 'PATCH', body: JSON.stringify({ isPublished: !n.isPublished }) }); window.location.reload(); } }
          if (d && window.confirm('Delete this note and its file? This cannot be undone.')) { await NN.api('/api/teacher/notes/' + d.dataset.del, { method: 'DELETE' }); window.location.reload(); }
        });
      }

      // Teacher stats
      if (view === 't-stats') NN.api('/api/teacher/dashboard').then(function (r) {
        var notes = r.data.notes || [];
        $('statNotes').textContent = r.data.stats.notes;
        $('statDownloads').textContent = r.data.stats.downloads;
        var list = $('downloadsList');
        if (!notes.length) { list.innerHTML = '<li class="muted">You have not published any notes yet — no downloads to show.</li>'; return; }
        list.innerHTML = notes.slice().sort(function (a, b) { return b.downloadCount - a.downloadCount; }).map(function (n) {
          return '<li><span><b>' + esc(n.title) + '</b><br><small class="muted">' + esc(n.department) + ' · ' + esc(n.level) + ' · ' + esc(n.fileName || '') + '</small></span><span class="badge">' + NN.icon('download') + ' ' + esc(n.downloadCount) + '</span></li>';
        }).join('');
      });

      // Teacher publish
      if (view === 't-publish') {
        var deps = await NN.api('/api/auth/departments');
        var lvls = await NN.api('/api/auth/levels');
        var ds = $('department'), ls = $('level');
        deps.data.forEach(function (d) { var o = document.createElement('option'); o.value = d.id; o.textContent = d.name; ds.appendChild(o); });
        lvls.data.forEach(function (l) { var o = document.createElement('option'); o.value = l.id; o.textContent = l.name; ls.appendChild(o); });
        $('publishForm').addEventListener('submit', async function (e) {
          e.preventDefault();
          var f = e.target, btn = f.querySelector('button[type=submit]');
          NN.clearError($('publishError'));
          btn.disabled = true; btn.textContent = 'Publishing…';
          var fd = new FormData(f);
          var r = await fetch('/api/teacher/notes', { method: 'POST', body: fd }).then(async function (res) { return { ok: res.ok, data: await res.json() }; });
          btn.disabled = false; btn.textContent = 'Publish Note';
          if (!r.ok) { NN.showError($('publishError'), r.data.error || 'Publish failed.'); return; }
          f.reset();
          var ok = $('publishOk'); ok.classList.add('show'); ok.textContent = 'Note published! Students in that section & level can now see it.';
        });
      }
    });
  });
})();

// Clerk AI — floating assistant available on every page.
(function () {
  if (document.getElementById('clerkFab')) return;
  var s = document.createElement('script');
  s.src = '/js/clerk.js';
  s.async = true;
  document.head.appendChild(s);
})();
