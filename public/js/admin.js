  // On page load, show dashboard content by default
  document.addEventListener('DOMContentLoaded', function () {
    // Set initial active section
    var initialSection = 'dashboard';
    document.querySelectorAll('.anav').forEach(function (b) {
      b.classList.remove('active');
    });
    var initialBtn = document.querySelector('.anav[data-section="dashboard"]');
    if (initialBtn) {
      initialBtn.classList.add('active');
    }
    
    // Hide action buttons on dashboard load
    document.getElementById('addUserBtn')?.classList.add('hidden');
    document.getElementById('addTeacherBtn')?.classList.add('hidden');
    
    // Load initial content
    loadSectionContent(initialSection);
  });

  // Safe helpers (referenced by action handlers below). Using getElementById
  // instead of $ so this file never throws when an optional button is missing.
  function showAlert(msg, type) {
    var el = document.getElementById('adminAlert');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'alert show' + (type === 'error' ? ' error' : '');
    if (msg && type !== 'error') {
      clearTimeout(showAlert._t);
      showAlert._t = setTimeout(function () { el.className = 'alert'; }, 3200);
    }
  }
  function loadUsers() {}
  function loadTeachers() {}

  // Section navigation handler
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.anav');
    if (!btn) return;

    // Remove active class from all nav buttons
    document.querySelectorAll('.anav').forEach(function (b) { b.classList.remove('active'); });

    // Add active to clicked button
    btn.classList.add('active');

    var section = btn.dataset.section;
    var pageTitle = btn.querySelector('span') ? btn.querySelector('span').textContent.trim() : section;

    // Update page title
    document.getElementById('pageTitle').textContent = pageTitle;

    // Hide all action buttons by default
    document.getElementById('addUserBtn')?.classList.add('hidden');
    document.getElementById('addTeacherBtn')?.classList.add('hidden');

    // Show appropriate buttons based on section
    if (section === 'users') {
      var addUserBtn = document.getElementById('addUserBtn');
      if (addUserBtn) addUserBtn.classList.remove('hidden');
    } else if (section === 'teachers') {
      var addTeacherBtn = document.getElementById('addTeacherBtn');
      if (addTeacherBtn) addTeacherBtn.classList.remove('hidden');
    }

    // Navigate to the appropriate page for this section
    var pageMap = {
      'dashboard': 'index.html',
      'users': 'users.html',
      'teachers': 'teachers.html',
      'notes': 'notes.html',
      'announcements': 'announcements.html',
      'messages': 'messages.html',
      'reports': 'reports.html',
      'schools': 'schools.html'
    };
    var dest = pageMap[section] || (/\.html$/i.test(section) ? section : section + '.html');
    if (section === 'dashboard' || section === 'sub-admins') {
      // Dashboard / Sub-admins stay on the same page - reload content
      loadSectionContent(section);
    } else {
      window.location.href = dest;
    }
  });

  // Load section content
  async function loadSectionContent(section) {
    var adminView = document.getElementById('adminView');

    if (section === 'sub-admins') {
      return renderSubAdmins();
    }

    if (section === 'users') {
      adminView.innerHTML = '<p>Users page - Add User button should appear here</p>';
    } else if (section === 'teachers') {
      adminView.innerHTML = '<p>Assign Teachers page - Add Teacher button should appear here</p>';
    } else if (section === 'dashboard') {
      // Fetch dashboard data from API
      adminView.innerHTML = '<div class="spinner"><span class="spinner"></span> Loading dashboard...</div>';
      try {
        var r = await NN.api('/api/admin/dashboard');
        if (!r.ok) {
          adminView.innerHTML = '<p>Administrator login required.</p>';
          return;
        }
        var d = r.data;
        var counts = d.counts || {};
        var openReports = counts.openReports || 0;
        var mostDownloaded = (d.charts && d.charts.mostDownloaded) ? d.charts.mostDownloaded : [];
        var recentDownloads = (d.charts && d.charts.recentDownloads) ? d.charts.recentDownloads : [];

        // ── Redesigned dashboard ──
        var activityCols = (d.charts && d.charts.activity7 ? d.charts.activity7 : []).map(function (dd) {
          var total = (dd.logins || 0) + (dd.actions || 0) + (dd.downloads || 0);
          var maxTotal = 1;
          for (var i = 0; i < (d.charts.activity7 || []).length; i++) { var x = d.charts.activity7[i]; maxTotal = Math.max(maxTotal, (x.logins || 0) + (x.actions || 0) + (x.downloads || 0)); }
          var h = Math.max(4, Math.round(total / maxTotal * 100));
          return '<div class="chart-col"><div class="chart-stack"><div class="chart-bar" style="height: ' + h + '%"><span>' + total + '</span></div></div><small>' + dd.label + '</small><em>' + (dd.logins + dd.actions) + ' acts</em></div>';
        }).join('');
        var mostRows = mostDownloaded.map(function (n) {
          var max = Math.max(1, mostDownloaded[0] ? mostDownloaded[0].downloads : 1);
          return '<li class="bar-row"><div class="bar-label"><b>' + (n.title || '') + '</b><small>' + (n.teacher || '') + '</small></div><div class="bar-track"><span style="width: ' + Math.min(100, (n.downloads / max) * 100) + '%"></span></div><span class="bar-value">' + (n.downloads || 0) + '</span></li>';
        }).join('');
        var downloadRows = recentDownloads.map(function (r) { return '<tr><td>' + (r.student || '') + '</td><td>' + (r.title || '') + '</td><td>' + String(r.downloaded_at || '').slice(0,10) + '</td></tr>'; }).join('');
        var activityRows = (d.activity || []).slice(0, 10).map(function (a) { return '<li><span><b>' + a.action + '</b> <small class="muted">' + a.actor_role + ' #' + a.actor_id + '</small></span><time>' + String(a.created_at || '').slice(0,16) + '</time></li>'; }).join('');

        // Redesigned dashboard: hero strip, stat cards, charts, feeds.
        adminView.innerHTML = `
          <div class="admin-card" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; background:linear-gradient(120deg, var(--navy), var(--blue-deep)); border:0; padding:20px 22px;">
            <div style="flex:1; min-width:240px;">
              <div style="font-size:.72rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--yellow); margin-bottom:4px;">APALINK · Command Centre</div>
              <h2 style="margin:0 0 4px; color:#fff; font-size:1.3rem; letter-spacing:-.02em;">Live school overview</h2>
              <p style="margin:0; color:#C7D3EA; font-size:.88rem;">Students, teachers, notes, timetables and activity — across the school(s) you oversee.</p>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.7rem; font-weight:800; color:var(--yellow); line-height:1;">${counts.students}</div>
              <div style="font-size:.72rem; color:#C7D3EA; font-weight:700; letter-spacing:.08em;">STUDENTS</div>
            </div>
          </div>
          <div class="admin-stats">
            <div class="admin-stat"><div class="ic">${NN.icon('users')}</div><div><div class="n">${counts.students}</div><div class="l">Students</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('user-check')}</div><div><div class="n">${counts.activeStudents}</div><div class="l">Active Students</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('graduation-cap')}</div><div><div class="n">${counts.teachers}</div><div class="l">Teachers</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('file-text')}</div><div><div class="n">${counts.notes}</div><div class="l">Notes</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('upload')}</div><div><div class="n">${counts.files}</div><div class="l">Files</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('download')}</div><div><div class="n">${counts.downloads}</div><div class="l">Downloads</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('megaphone')}</div><div><div class="n">${counts.announcements}</div><div class="l">Announcements</div></div></div>
            <div class="admin-stat"><div class="ic">${NN.icon('shield')}</div><div><div class="n">${openReports}</div><div class="l">Open reports</div></div></div>
          </div>
          <div class="admin-grid-2" style="margin-top:16px">
            <div class="admin-card"><div class="card-head"><h2>Activity (7 days)</h2><span class="badge">Live</span></div>
              <div class="chart-bars">${activityCols}</div>
              <p class="chart-note">Logins, actions and downloads over the last 7 days.</p>
            </div>
            <div class="admin-card"><div class="card-head"><h2>Most downloaded</h2><span class="badge">Top 8</span></div>
              <ul class="bar-list">${mostRows}</ul>
            </div>
          </div>
          <div class="admin-grid-2" style="margin-top:16px">
            <div class="admin-card"><div class="card-head"><h2>Recent downloads</h2><span class="badge">Latest</span></div>
              <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Student</th><th>Note</th><th>When</th></tr></thead><tbody>${downloadRows}</tbody></table></div>
            </div>
            <div class="admin-card"><div class="card-head"><h2>Live activity</h2><span class="badge">Newest</span></div>
              <ul class="plain-list" id="adminActivity">${activityRows}</ul>
            </div>
          </div>`;
      } catch (e) {
        adminView.innerHTML = '<p>Failed to load dashboard data.</p>';
      }
    } else {
      adminView.innerHTML = '<p>Section: ' + section + '</p>';
    }

    // Re-attach event listeners after content load
    attachUserTeacherHandlers();
  }

  // Render the Users page with Add User button and users table
  function renderUsersPage() {
    return '<div id="usersPage"><p>Users page content</p></div>';
  }

  // Render the Teachers/Assign Teachers page
  function renderTeachersPage() {
    return '<div id="teachersPage"><p>Teachers page content</p></div>';
  }

  // Render the Dashboard page
  function renderDashboard() {
    return '<div>Dashboard</div>';
  }

  // ---------- Sub-admins (whole-app super administrator only) ----------
  var subAdmins = [];
  var subSchools = [];

  async function loadSubAdminData() {
    try {
      var sr = await NN.api('/api/admin/school-admins');
      if (sr.ok) subAdmins = sr.data.admins || [];
    } catch (e) { subAdmins = []; }
    try {
      var ss = await NN.api('/api/schools');
      var arr = Array.isArray(ss.data) ? ss.data : (ss.data.schools || []);
      subSchools = (arr || []).filter(function (s) { return s && s.isActive; }).map(function (s) { return { id: s.id, name: s.name, district: s.district }; });
    } catch (e) { subSchools = []; }
  }

  async function renderSubAdmins() {
    var adminView = document.getElementById('adminView');
    await loadSubAdminData();
    var subs = (subAdmins || []).filter(function (a) { return !a.isSuper; });
    var html =
      '<div class="admin-card">' +
        '<div class="card-head"><h2>Sub-admins</h2><span class="badge">' + (subAdmins ? subAdmins.length : 0) + ' total</span></div>' +
        '<p class="muted" style="margin:0 0 14px">Whole-app administrator console. Assign a school administrator — they sign in with their school access code (1st password) and their own administrator password (2nd password).</p>' +
        '<div class="admin-grid-2">' +
          '<div class="admin-card" style="box-shadow:none"><div class="card-head"><h2>School administrators</h2><span class="badge">' + subs.length + '</span></div>' +
            '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Administrator</th><th>School</th><th>Access code</th><th>Status</th><th></th></tr></thead><tbody>' +
            (subs.length ? subs.map(function (a) {
              return '<tr><td><b>' + (a.fullName || '') + '</b><small class="muted"> @' + (a.username || '') + '</small></td><td>' + (a.schoolName || '') + '</td><td><code>' + (a.schoolCode || '') + '</code></td><td>' + (a.isActive ? 'Active' : 'Inactive') + '</td><td><button class="btn btn-ghost btn-sm" data-subdel="' + a.id + '">Deactivate</button></td></tr>';
            }).join('') : '<tr><td colspan="5" class="muted">No school administrators yet.</td></tr>') +
            '</tbody></table></div></div>' +
          '</div>' +
          '<div class="admin-card" style="box-shadow:none"><div class="card-head"><h2>Assign sub-admin</h2><span class="badge">New</span></div>' +
            '<form id="subAdminForm" novalidate>' +
              '<div class="field"><label for="subName">Full name *</label><input id="subName" name="fullName" type="text" required placeholder="e.g. APADE School Administrator" autocomplete="off"></div>' +
              '<div class="row2">' +
                '<div class="field"><label for="subUsername">Username *</label><input id="subUsername" name="username" type="text" required placeholder="e.g. apadeadmin" autocomplete="off"></div>' +
                '<div class="field"><label for="subPassword">Administrator password *</label><input id="subPassword" name="password" type="password" required minlength="6" placeholder="min. 6 characters" autocomplete="new-password"></div>' +
              '</div>' +
              '<div class="field"><label for="subSchool">School *</label><select id="subSchool" name="schoolId" required>' +
                '<option value="">Choose a school…</option>' +
                subSchools.map(function (s) { return '<option value="' + s.id + '">' + s.name + ' — ' + s.district + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="modal-actions"><button class="btn btn-primary" type="submit"><span data-icon="shield"></span> Create sub-admin</button></div>' +
            '</form>' +
          '</div>' +
        '</div>';
    adminView.innerHTML = html;
    attachSubAdminHandlers();
  }

  function attachSubAdminHandlers() {
    var form = document.getElementById('subAdminForm');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = (document.getElementById('subName') || {}).value || '';
        var username = (document.getElementById('subUsername') || {}).value || '';
        var password = (document.getElementById('subPassword') || {}).value || '';
        var schoolId = (document.getElementById('subSchool') || {}).value;
        if (!name || !username || !password || !schoolId) { showAlert('Please complete all fields.', 'error'); return; }
        var r = await NN.api('/api/admin/school-admins', { method: 'POST', body: JSON.stringify({ fullName: name, username: username, password: password, schoolId: Number(schoolId) }) });
        if (!r.ok) { showAlert((r.data && r.data.error) || 'Failed to create sub-admin.', 'error'); return; }
        showAlert('Sub-admin created for the chosen school.', 'info');
        try { document.getElementById('subAdminForm').reset(); } catch (e2) {}
        await renderSubAdmins();
      });
    }
    var adminViewEl = document.getElementById('adminView');
    if (adminViewEl && !adminViewEl.dataset.subBound) {
      adminViewEl.dataset.subBound = '1';
      adminViewEl.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-subdel]');
        if (!btn) return;
        var id = Number(btn.getAttribute('data-subdel'));
        var r = await NN.api('/api/admin/school-admins/' + id, { method: 'DELETE' });
        if (!r.ok) { showAlert((r.data && r.data.error) || 'Failed to deactivate sub-admin.', 'error'); return; }
        showAlert('Sub-admin deactivated.', 'info');
        await renderSubAdmins();
      });
    }
  }

  // Attach event handlers for user/teacher actions
  function attachUserTeacherHandlers() {
    // Add User button handler
    var addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
      addUserBtn.addEventListener('click', function () {
        showAlert('Add User form - under development', 'info');
        loadUsers();
      });
    }

    // Add Teacher button handler
    var addTeacherBtn = document.getElementById('addTeacherBtn');
    if (addTeacherBtn) {
      addTeacherBtn.addEventListener('click', function () {
        showAlert('Add Teacher form - under development', 'info');
        loadTeachers();
      });
    }

    // Role change handler (delegated — register once only)
    var adminViewEl = document.getElementById('adminView');
    if (adminViewEl && !adminViewEl.dataset.roleBound) {
      adminViewEl.dataset.roleBound = '1';
      adminViewEl.addEventListener('click', function (e) {
        var b = e.target.closest('.role-change');
        if (b) {
          var role = b.dataset.role;
          var id = b.dataset.id;
          showAlert('Role change requested for ' + role + ' - ID ' + id, 'info');
        }
      });
    }

    // Delete button color handler
    document.querySelectorAll('.del-user').forEach(function (btn) {
      btn.classList.add('btn-danger');
    });

    // Edit button color handler
    document.querySelectorAll('.edit-teacher').forEach(function (btn) {
      btn.classList.add('btn-success');
    });

    // Activate button color handler
    document.querySelectorAll('.activate-teacher').forEach(function (btn) {
      btn.classList.add('btn-orange');
    });
  }

  // Mobile sidebar toggle (hamburger + overlay) — safe on every admin page.
  (function () {
    function initAdminMenu() {
      var menu = document.getElementById('adminMenu');
      var side = document.getElementById('adminSide');
      var overlay = document.getElementById('adminOverlay');
      if (!menu || !side || menu.dataset.bound) return;
      menu.dataset.bound = '1';
      function close() { side.classList.remove('open'); if (overlay) overlay.classList.remove('show'); }
      menu.addEventListener('click', function () {
        side.classList.toggle('open');
        if (overlay) overlay.classList.toggle('show', side.classList.contains('open'));
      });
      if (overlay) overlay.addEventListener('click', close);
      side.querySelectorAll('a.anav').forEach(function (a) { a.addEventListener('click', close); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdminMenu);
    else initAdminMenu();
  })();

