// APALINK homepage — floating search panel (opens on focus, closes on outside click / Esc).
(function () {
  var wrap = document.getElementById('heroSearch');
  if (!wrap) return;
  var input = document.getElementById('heroSearchInput');
  var panel = document.getElementById('heroSearchPanel');
  var list = document.getElementById('heroSearchList');

  var BASE = [
    { t: 'Sign in to APALINK', d: 'Students & teachers', k: 'login sign in student teacher', h: 'pages/student-login.html', i: 'key-round' },
    { t: 'Create student account', d: 'Register with section & level', k: 'register sign up student', h: 'pages/student-register.html', i: 'user-plus' },
    { t: 'School announcements', d: 'News, events and official notices', k: 'news events notice announcement', h: 'pages/announcements.html', i: 'megaphone' },
    { t: 'My notes', d: 'Browse notes for your section', k: 'notes browse files download', h: 'pages/student/my-notes.html', i: 'file-text' },
    { t: 'Messages', d: 'Chat with classmates and teachers', k: 'chat message people talk', h: 'pages/messages.html', i: 'message-square' },
    { t: 'My timetable', d: 'Weekly class schedule', k: 'timetable schedule classes lessons', h: 'pages/student/timetable.html', i: 'calendar' },
    { t: 'Downloads', d: 'Everything you have downloaded', k: 'downloads files', h: 'pages/student/downloads.html', i: 'download' },
    { t: 'Settings', d: 'Account, appearance and security', k: 'settings preferences account security theme', h: 'pages/student/settings.html', i: 'settings' },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function results(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return BASE;
    return BASE.filter(function (r) {
      return (r.t + ' ' + r.d + ' ' + r.k).toLowerCase().indexOf(q) > -1;
    });
  }

  function render(q) {
    var rs = results(q);
    list.innerHTML = rs.length
      ? rs.map(function (r) {
          return '<li><a role="option" href="' + r.h + '"><span class="hsp-ic">' + NN.icon(r.i) +
            '</span><span><b>' + esc(r.t) + '</b><small>' + esc(r.d) + '</small></span></a></li>';
        }).join('')
      : '<li class="muted hsp-none">No matches — try “notes”, “messages” or “timetable”.</li>';
    NN.paintIcons(list);
  }

  function open() {
    render(input.value);
    panel.hidden = false;
    wrap.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.hidden = true;
    wrap.classList.remove('is-open');
    input.setAttribute('aria-expanded', 'false');
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', function () { render(input.value); if (panel.hidden) open(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'Enter') {
      var first = list.querySelector('a');
      if (first) { e.preventDefault(); window.location.href = first.getAttribute('href'); }
    }
    if (e.key === 'ArrowDown') {
      var f = list.querySelector('a');
      if (f) { e.preventDefault(); f.focus(); }
    }
  });
  document.addEventListener('click', function (e) {
    if (!panel.hidden && !wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
})();
