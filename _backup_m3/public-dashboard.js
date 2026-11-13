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
  function fileLabel(n) {
    if (!n.fileName) return 'NOTES';
    var ext = n.fileName.split('.').pop().toUpperCase();
    return ext + ' · ' + fmtSize(n.fileSize);
  }

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
      ? [['overview.html', '📊', 'Overview'], ['my-notes.html', '📚', 'My Notes'], ['recent.html', '🕒', 'Recently Added'], ['saved.html', '⭐', 'Saved Notes'], ['downloads.html', '⬇️', 'Downloads'], ['profile.html', '👤', 'My Profile'], ['settings.html', '⚙️', 'Settings']]
      : [['overview.html', '📊', 'Overview'], ['my-notes.html', '📑', 'My Notes'], ['publish.html', '📤', 'Publish Note'], ['stats.html', '📈', 'Downloads'], ['profile.html', '👤', 'My Profile'], ['settings.html', '⚙️', 'Settings']];
    var here = window.location.pathname.split('/').pop();
    nav.innerHTML = items.map(function (it) {
      var active = (it[0] === here && sameDir) ? ' active' : '';
      return '<a class="snav' + active + '" href="' + onSubdir + it[0] + '"><span class="ic">' + it[1] + '</span>' + it[2] + '</a>';
    }).join('') + '<button class="snav" id="sideLogout"><span class="ic">↩️</span>Logout</button>';
    $('sideInitial').textContent = (u.fullName || 'N').charAt(0).toUpperCase();
    $('sideName').textContent = u.fullName;
    $('sideRole').textContent = u.username + ' · ' + (role === 'student' ? 'Student' : 'Teacher');
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
    return u;
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
      '<span>👩‍🏫 ' + esc(n.teacherName || '') + '</span>' +
      '<span>🗓 ' + fmtDate(n.createdAt) + '</span>' +
      '<span>⬇️ ' + esc(n.downloadCount || 0) + '</span>' +
      '</div>' +
      '<div class="note-actions">' +
      '<a class="btn btn-dark" href="preview.html?note=' + n.id + '">👁 Preview</a>' +
      '<a class="btn btn-primary" href="/api/notes/' + n.id + '/file" download>⬇ Download</a>' +
      (mode === 'student' ? '<button class="btn btn-ghost save-btn" data-save="' + n.id + '" aria-pressed="' + saved + '">' + (n.saved ? '⭐ Saved' : '☆ Save') + '</button>' : '') +
      '</div></article>';
  }

  function renderNotes(container, notes, opts) {
    opts = opts || {};
    if (!container) return;
    if (!notes.length) {
      container.innerHTML = '<div class="empty"><span class="big">' + (opts.icon || '📭') + '</span><h3>' + (opts.emptyTitle || 'No notes yet') + '</h3><p>' + (opts.emptyText || 'Nothing here right now.') + '</p></div>';
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
      var view = document.body.dataset.view;
      var role = u.role;

      // Student overview
      if (view === 's-overview') NN.api('/api/student/dashboard').then(function (r) {
        if (!r.ok) return;
        $('welcomeMsg').textContent = 'Welcome back, ' + u.fullName + ' 👋';
        $('welcomeSub').textContent = [u.sectionName, u.levelName, u.className ? 'Class ' + u.className : ''].filter(Boolean).join(' · ');
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
                mode: 'student', icon: '📚',
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
              mode: 'student', icon: view === 's-saved' ? '⭐' : '⬇️',
              emptyTitle: view === 's-saved' ? 'No saved notes yet' : 'No downloads yet',
              emptyText: view === 's-saved' ? 'Tap ☆ Save on any note to keep it here.' : 'When you download a note, it will appear here.',
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
        if (u.sectionName) $('pSection').textContent = u.sectionName;
        if (u.levelName) $('pLevel').textContent = u.levelName;
        if (u.className) $('pClass').textContent = u.className;
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
          $('pwOk').textContent = '✅ Password changed successfully.';
        });
      }

      // Preview
      if (view === 'preview') {
        var id = new URLSearchParams(window.location.search).get('note');
        $('backLink').href = role === 'student' ? 'student/my-notes.html' : 'teacher/my-notes.html';
        fetch('/api/notes/' + id + '/file', { headers: { Accept: 'application/octet-stream' } }).catch(function () {});
        // Use metadata from the library endpoints to describe the file.
        var src = role === 'student' ? '/api/student/notes' : '/api/teacher/dashboard';
        fetch(src).then(function (r) { return r.json(); }).then(function (data) {
          var list = Array.isArray(data) ? data : data.notes || [];
          var n = list.find(function (x) { return String(x.id) === String(id); });
          var slot = $('previewSlot');
          if (!n) { slot.innerHTML = '<div class="empty"><span class="big">🔒</span><h3>Not available</h3><p>This note is not available to you (it may be unpublished or for another section/level).</p></div>'; return; }
          $('pvTitle').textContent = n.title;
          $('pvMeta').textContent = [n.department, n.level, n.subject, 'By ' + (n.teacherName || ''), fmtDate(n.createdAt)].filter(Boolean).join(' · ');
          $('pvDownload').href = '/api/notes/' + n.id + '/file';
          if (n.description) $('pvDesc').textContent = n.description;
          var ext = (n.fileName || '').split('.').pop().toLowerCase();
          var fileApi = '/api/notes/' + n.id + '/file?mode=preview';
          if (ext === 'pdf' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
            slot.innerHTML = '<iframe class="preview-frame" src="' + fileApi + '" title="Preview"></iframe>';
          } else if (['txt', 'md', 'csv', 'json', 'html'].includes(ext)) {
            slot.innerHTML = '<div class="preview-pre">Loading…</div>';
            fetch(fileApi).then(function (r) { return r.text(); }).then(function (t) {
              slot.querySelector('.preview-pre').textContent = t.slice(0, 20000);
            }).catch(function () { slot.innerHTML = '<p class="muted">Preview failed.</p>'; });
          } else {
            slot.innerHTML = '<div class="empty"><span class="big">📄</span><h3>Preview not available for this file type</h3><p>Download it to open: <b>' + esc(n.fileName || '') + '</b></p></div>';
          }
        });
      }

      // Teacher overview
      if (view === 't-overview') NN.api('/api/teacher/dashboard').then(function (r) {
        if (!r.ok) return;
        $('welcomeMsg').textContent = 'Welcome, ' + u.fullName + ' 👋';
        $('welcomeSub').textContent = r.data.stats.notes + ' note' + (r.data.stats.notes === 1 ? '' : 's') + ' published by you';
        $('statNotes').textContent = r.data.stats.notes;
        $('statPublished').textContent = r.data.stats.published;
        $('statDownloads').textContent = r.data.stats.downloads;
        renderNotes($('recentGrid'), r.data.notes.slice(0, 3), {
          mode: 'teacher', emptyTitle: 'No notes yet', emptyText: 'Publish your first note to get started.',
        });
      });

      // Teacher my notes
      if (view === 't-notes') {
        NN.api('/api/teacher/dashboard').then(function (r) {
          var notes = r.data.notes || [];
          $('notesCount').textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's');
          var box = $('notesGrid');
          if (!notes.length) { box.innerHTML = '<div class="empty"><span class="big">📭</span><h3>No notes published yet</h3><p>Publish a note for your students.</p><p><a class="btn btn-primary" href="publish.html">Publish Note</a></p></div>'; return; }
          box.innerHTML = notes.map(function (n) {
            return noteCard(n, 'teacher').replace('</div></article>',
              '<div class="note-actions"><button class="btn btn-ghost" data-toggle="' + n.id + '">' + (n.isPublished ? 'Unpublish' : 'Publish') + '</button>' +
              '<button class="btn btn-ghost" data-del="' + n.id + '">🗑 Delete</button></div></article>');
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
          return '<li><span><b>' + esc(n.title) + '</b><br><small class="muted">' + esc(n.department) + ' · ' + esc(n.level) + ' · ' + esc(n.fileName || '') + '</small></span><span class="badge">⬇️ ' + esc(n.downloadCount) + '</span></li>';
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
          var ok = $('publishOk'); ok.classList.add('show'); ok.textContent = '✅ Note published! Students in that section & level can now see it.';
        });
      }
    });
  });
})();
