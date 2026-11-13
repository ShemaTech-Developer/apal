// APALINK auth frontend — all forms call the backend API. No passwords or codes here.
(function () {
  function $(id) { return document.getElementById(id); }

  async function populateSelects() {
    var deptSel = $('section'), lvlSel = $('level');
    var depts = await NN.api('/api/auth/departments');
    var lvls = await NN.api('/api/auth/levels');
    if (deptSel && depts.ok) depts.data.forEach(function (d) {
      var o = document.createElement('option'); o.value = d.id; o.textContent = d.name; deptSel.appendChild(o);
    });
    if (lvlSel && lvls.ok) lvls.data.forEach(function (l) {
      var o = document.createElement('option'); o.value = l.id; o.textContent = l.name; lvlSel.appendChild(o);
    });
  }

  async function handle(formId, errId, fn) {
    var form = $(formId); if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      NN.clearError($(errId));
      NN.setLoading(btn, true);
      try { await fn(form); } catch (err) { NN.showError($(errId), err.message || 'Something went wrong.'); }
      NN.setLoading(btn, false);
    });
  }

  function val(form, name) { return (form.elements[name] ? form.elements[name].value : '').trim(); }

  function requireVerification(errId, data) {
    if (data && data.needsVerification) {
      sessionStorage.removeItem('nnTeacherVerified');
      NN.showError($(errId), 'Verification expired. Please enter the school access code again.');
      setTimeout(function () { window.location.href = 'teacher-verify.html'; }, 1200);
      return true;
    }
    return false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    populateSelects();

    // Student login
    handle('studentLoginForm', 'loginError', async function (form) {
      var r = await NN.api('/api/auth/student/login', { method: 'POST', body: JSON.stringify({
        identifier: val(form, 'identifier'), password: val(form, 'password'), remember: form.elements.remember.checked,
      }) });
      if (!r.ok) return NN.showError($('loginError'), r.data.error || 'Login failed.');
      window.location.href = 'student/overview.html';
    });

    // Student register
    handle('studentRegisterForm', 'registerError', async function (form) {
      var r = await NN.api('/api/auth/student/register', { method: 'POST', body: JSON.stringify({
        fullName: val(form, 'fullName'), username: val(form, 'username'), email: val(form, 'email'),
        sectionId: val(form, 'section'), className: val(form, 'className'), levelId: val(form, 'level'),
        password: val(form, 'password'), confirm: val(form, 'confirm'),
      }) });
      if (!r.ok) return NN.showError($('registerError'), r.data.error || 'Registration failed.');
      window.location.href = 'student/overview.html';
    });

    // Teacher verification (code goes to backend only)
    handle('teacherVerifyForm', 'verifyError', async function (form) {
      var r = await NN.api('/api/auth/teacher/verify', { method: 'POST', body: JSON.stringify({ code: val(form, 'code') }) });
      if (!r.ok) return NN.showError($('verifyError'), r.data.error || 'Verification failed.');
      sessionStorage.setItem('nnTeacherVerified', '1');
      var dest = sessionStorage.getItem('nnTeacherNext') || 'teacher-login.html';
      sessionStorage.removeItem('nnTeacherNext');
      window.location.href = dest;
    });

    // Teacher login (backend enforces verification)
    handle('teacherLoginForm', 'teacherLoginError', async function (form) {
      var r = await NN.api('/api/auth/teacher/login', { method: 'POST', body: JSON.stringify({
        identifier: val(form, 'identifier'), password: val(form, 'password'), remember: form.elements.remember.checked,
      }) });
      if (!r.ok && requireVerification('teacherLoginError', r.data)) return;
      if (!r.ok) return NN.showError($('teacherLoginError'), r.data.error || 'Login failed.');
      window.location.href = 'teacher/overview.html';
    });

    // Teacher register (backend enforces verification)
    handle('teacherRegisterForm', 'teacherRegisterError', async function (form) {
      var r = await NN.api('/api/auth/teacher/register', { method: 'POST', body: JSON.stringify({
        fullName: val(form, 'fullName'), username: val(form, 'username'), email: val(form, 'email'),
        password: val(form, 'password'), confirm: val(form, 'confirm'),
      }) });
      if (!r.ok && requireVerification('teacherRegisterError', r.data)) return;
      if (!r.ok) return NN.showError($('teacherRegisterError'), r.data.error || 'Registration failed.');
      window.location.href = 'teacher/overview.html';
    });

    // Logout (home.html)
    var logout = $('logoutBtn');
    if (logout) logout.addEventListener('click', async function () {
      await NN.api('/api/auth/logout', { method: 'POST' });
      window.location.href = 'index.html';
    });

    // Home: show who is logged in
    var who = $('who');
    if (who) NN.api('/api/auth/me').then(function (r) {
      if (!r.ok) { window.location.href = 'index.html'; return; }
      var u = r.data.user;
      var extra = u.role === 'student'
        ? ' — Student'
        : ' — Teacher';
      who.textContent = 'Signed in as ' + u.fullName + ' (' + u.username + ')' + extra;
    });
  });
})();
