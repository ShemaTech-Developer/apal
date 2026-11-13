// APALINK — top-right account chip for the admin console.
// Fills #topUser (avatar + full name + role) from the server session.
// Avatar: uploaded picture from /api/settings/avatar/<file>, otherwise initials.
(function () {
  var box = document.getElementById('topUser');
  if (!box || !window.NN) return;

  // Notifications bell sits right beside the username chip
  var top = box.closest('.admin-top') || box.parentNode;
  if (top && !document.getElementById('topBell')) {
    var bell = document.createElement('a');
    bell.className = 'top-bell';
    bell.id = 'topBell';
    bell.setAttribute('href', 'notifications.html');
    bell.setAttribute('aria-label', 'Notifications');
    bell.innerHTML = '<span style="display:inline-flex">' + NN.icon('bell', 17) + '</span>' +
      '<span id="topBellBadge" class="top-bell-badge" hidden></span>';
    top.insertBefore(bell, box);
    NN.api('/api/notifications').then(function (r) {
      var unread = (r.ok && r.data) ? (r.data.unread || 0) : 0;
      if (unread > 0) { var b = document.getElementById('topBellBadge'); if (b) { b.hidden = false; b.textContent = unread; } }
    }).catch(function () {});
  }

  var av = box.querySelector('.avatar');
  var nm = document.getElementById('topUserName');
  var rl = document.getElementById('topUserRole');

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function renderAvatar(u, name) {
    if (!av) return;
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
  }

  NN.api('/api/auth/me').then(function (r) {
    if (!r.ok || !r.data || !r.data.user) return;
    var u = r.data.user;
    var name = u.fullName || u.username || 'Administrator';
    renderAvatar(u, name);
    if (nm) nm.textContent = name;
    if (rl) rl.textContent = u.role === 'admin' ? 'Administrator' : u.role === 'teacher' ? 'Teacher' : 'Student';
  }).catch(function () { /* chip stays on its fallback initials/text */ });
})();

// Clerk AI — floating assistant available on every page.
(function () {
  if (document.getElementById('clerkFab')) return;
  var s = document.createElement('script');
  s.src = '/js/clerk.js';
  s.async = true;
  document.head.appendChild(s);
})();
