// APALINK settings center — profile, appearance, security, privacy, notifications, regional, sessions.
(function () {
  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.body.dataset.view || !document.body.dataset.view.startsWith('settings')) return;

    NN.api('/api/settings/prefs').then(function (r) {
      var p = r.data;
      for (const [id, value] of Object.entries(p)) {
        var el = document.getElementsByName(id)[0] || document.getElementById(id);
        if (el && 'value' in el && el.type !== 'checkbox') el.value = value;
        if (el && el.type === 'checkbox') el.checked = value === 'on';
      }
      NN.applyPrefs(p);
    });
    NN.api('/api/auth/me').then(function (r) {
      if (!r.ok) return;
      var u = r.data.user;
      $('sName').textContent = u.fullName; $('sUser').textContent = u.username;
      $('sEmail').textContent = u.email || '—'; $('sRole').textContent = u.role;
      $('sCreated').textContent = String(u.createdAt || '').slice(0, 10);
      if (u.sectionName) $('sDept').textContent = u.sectionName;
      if (u.levelName) $('sLevel').textContent = u.levelName;
      if (u.className) $('sClass').textContent = u.className;
      if (u.schoolName && $('sSchool')) $('sSchool').textContent = u.schoolName;
      if (u.district && $('sDistrict')) $('sDistrict').textContent = u.district + ' District';
      if ($('fullName')) $('fullName').value = u.fullName || '';
      if ($('username')) $('username').value = u.username || '';
      if ($('email')) $('email').value = u.email || '';
      if (NN.loadActivity) NN.loadActivity();
      loadSessions(); loadPrefs();
    });

    function loadSessions() {
      NN.api('/api/settings/sessions').then(function (r) {
        if (!r.ok) return;
        var box = $('sessionList');
        box.innerHTML = r.data.sessions.length
          ? r.data.sessions.map(function (s) {
            return '<li><span><b>' + (s.current ? 'This session' : 'Another session') + '</b><br><small class="muted">' + (s.cookieMaxAge ? 'expires in ~' + s.cookieMaxAge + ' min' : 'session cookie') + '</small></span>' +
              (s.current ? '' : '<button class="btn btn-ghost" data-endsession="' + s.id + '">Terminate</button>') + '</li>';
          }).join('')
          : '<li class="muted">No sessions listed.</li>';
        box.querySelectorAll('[data-endsession]').forEach(function (b) {
          b.addEventListener('click', function () {
            alert('To terminate another session, log out from that device — the server invalidates all other sessions when you change your password or use “Log out everywhere”.');
          });
        });
      });
    }

    $('savePrefsBtn').addEventListener('click', function () {
      var prefs = {};
      document.querySelectorAll('[data-pref]').forEach(function (el) {
        prefs[el.dataset.pref] = el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value;
      });
      NN.api('/api/settings/prefs', { method: 'POST', body: JSON.stringify({ prefs: prefs }) }).then(function (r) {
        var ok = $('prefOk');
        if (r.ok) { ok.classList.add('show'); ok.textContent = 'Preferences saved.'; NN.applyPrefs(prefs); }
        else { NN.showError($('prefError'), r.data.error || 'Save failed.'); }
      });
    });

    $('profileForm').addEventListener('submit', function (e) {
      e.preventDefault();
      NN.api('/api/settings/profile', { method: 'POST', body: JSON.stringify({
        fullName: $('fullName').value, username: $('username').value, email: $('email').value,
      }) }).then(function (r) {
        if (r.ok) { $('profileOk').classList.add('show'); $('profileOk').textContent = 'Profile updated (refresh to see sidebar).'; }
        else NN.showError($('profileError'), r.data.error || 'Update failed.');
      });
    });

    $('avatarFile').addEventListener('change', function () {
      var f = $('avatarFile').files[0]; if (!f) return;
      var fd = new FormData(); fd.append('file', f);
      fetch('/api/settings/avatar', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
        .then(function (r) {
          var ok = $('profileOk');
          if (r.ok) { ok.classList.add('show'); ok.textContent = 'Profile picture updated.'; }
          else NN.showError($('profileError'), r.data.error || 'Upload failed.');
        });
    });

    $('pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      NN.api('/api/settings/change-password', { method: 'POST', body: JSON.stringify({
        currentPassword: f.elements.currentPassword.value, newPassword: f.elements.newPassword.value, confirm: f.elements.confirm.value,
      }) }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { f.reset(); $('pwOk').classList.add('show'); $('pwOk').textContent = 'Password changed. All other sessions signed out.'; }
        else NN.showError($('pwError'), r.data.error || 'Change failed.');
      });
    });

    $('logoutAll').addEventListener('click', function () {
      if (!confirm('Sign out of APALINK on all other devices?')) return;
      NN.api('/api/settings/logout-all', { method: 'POST' }).then(function () { alert('Other sessions ended.'); loadSessions(); });
    });

    function loadPrefs() {
      NN.api('/api/settings/prefs').then(function (r) {
        document.querySelectorAll('[data-pref]').forEach(function (el) {
          var v = r.data[el.dataset.pref];
          if (v !== undefined) el.value = v;
        });
      });
    }
  });
})();
