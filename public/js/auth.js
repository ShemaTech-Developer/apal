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

    // Districts for registration; schools are typed by name, not picked from a list.
    var distSel = $('district'), schoolNameInput = $('schoolName');
    if (distSel) {
      var dists = await NN.api('/api/auth/districts');
      if (dists.ok) dists.data.forEach(function (d) {
        var o = document.createElement('option'); o.value = d; o.textContent = d; distSel.appendChild(o);
      });
      var schoolHint = $('teacherSchoolHint');
      if (schoolHint) {
        function refreshHint() {
          var name = (schoolNameInput && schoolNameInput.value || '').trim();
          if (!name) {
            schoolHint.textContent = 'Choose your district, then type the school where you teach.';
            schoolHint.classList.remove('is-set');
            return;
          }
          schoolHint.textContent = 'You will receive announcements and updates for ' + name + (distSel.value ? ', ' + distSel.value + ' District' : '') + '.';
          schoolHint.classList.add('is-set');
        }
        schoolNameInput && schoolNameInput.addEventListener('input', refreshHint);
        distSel.addEventListener('change', refreshHint);
      }
    }
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
      setTimeout(function () { window.location.href = 'student-login.html#teacher'; }, 1200);
      return true;
    }
    return false;
  }

  // ---------- Unified sign-in page (student / teacher tabs + discreet admin section) ----------
  function initUnifiedLogin() {
    var form = $('unifiedLoginForm');
    if (!form) return;
    var mode = 'student';
    var tabStudent = $('tabStudent'), tabTeacher = $('tabTeacher');
    var submitBtn = $('unifiedSubmit');
    var codeStep = $('teacherCodeStep');
    var registerLink = $('registerLink');

    function setMode(next) {
      mode = next;
      [tabStudent, tabTeacher].forEach(function (t) {
        var on = t.dataset.mode === mode;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      submitBtn.textContent = mode === 'teacher' ? 'Log in as teacher' : 'Log in as student';
      // registerLink is optional: pages may use their own create-account button instead.
      if (registerLink) {
        registerLink.innerHTML = mode === 'teacher'
          ? '<span class="muted">New teacher?</span><a class="link" href="teacher-register.html">Create a teacher account</a>'
          : '<span class="muted">New to APALINK?</span><a class="link" href="student-register.html">Create a student account</a>';
      }
      NN.clearError($('loginError'));
      var errBox = $('loginError');
      if (errBox) { errBox.className = 'alert error'; errBox.textContent = ''; }
      if (mode === 'student' && codeStep) { codeStep.hidden = true; form.hidden = false; }
    }
    tabStudent.addEventListener('click', function () { setMode('student'); });
    tabTeacher.addEventListener('click', function () { setMode('teacher'); });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var errBox = $('loginError');
      errBox.className = 'alert error';
      NN.clearError(errBox);
      NN.setLoading(submitBtn, true);
      try {
        var r = await NN.api(mode === 'teacher' ? '/api/auth/teacher/login' : '/api/auth/student/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: val(form, 'identifier'), password: val(form, 'password'),
            remember: form.elements.remember.checked,
          }),
        });
        if (!r.ok) {
          if (mode === 'teacher' && r.data && r.data.needsVerification) {
            // Server requires the school access code — show the step inline.
            form.hidden = true;
            codeStep.hidden = false;
            $('teacherCode').focus();
            return;
          }
          return NN.showError($('loginError'), r.data.error || 'Login failed.');
        }
        window.location.href = mode === 'teacher' ? 'teacher/overview.html' : 'student/overview.html';
      } catch (err) {
        NN.showError($('loginError'), err.message || 'Something went wrong.');
      } finally {
        NN.setLoading(submitBtn, false);
      }
    });

    // Inline school-code verification, then return to the sign-in form.
    var vForm = $('unifiedVerifyForm');
    if (vForm) vForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = vForm.querySelector('button[type=submit]');
      NN.clearError($('verifyError'));
      NN.setLoading(btn, true);
      try {
        var r = await NN.api('/api/auth/teacher/verify', { method: 'POST', body: JSON.stringify({ code: val(vForm, 'code') }) });
        if (!r.ok) return NN.showError($('verifyError'), r.data.error || 'Verification failed.');
        codeStep.hidden = true;
        form.hidden = false;
        NN.setLoading(btn, false);
        $('password').focus();
        NN.showError($('loginError'), '');
        var note = $('loginError');
        note.textContent = 'School code verified — sign in with your teacher account.';
        note.classList.add('show');
        note.classList.remove('error'); note.classList.add('success');
      } catch (err) {
        NN.setLoading(btn, false);
        NN.showError($('verifyError'), err.message || 'Something went wrong.');
      }
    });

    // Discreet administrator section (two existing server-checked steps).
    var adminToggle = $('adminAccessToggle'), adminBody = $('adminAccessBody');
    function openAdmin(open) {
      adminBody.hidden = !open;
      adminToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      adminToggle.classList.toggle('open', open);
      if (open) $('admSchoolCode').focus();
    }
    adminToggle.addEventListener('click', function () { openAdmin(adminBody.hidden); });

    function setAdminStep(n) {
      document.querySelectorAll('#adminSteps li').forEach(function (li) {
        var step = Number(li.dataset.step);
        li.classList.toggle('active', step <= n);
        li.classList.toggle('current', step === n);
      });
      $('adminSchoolForm').hidden = n !== 1;
      $('adminLoginForm').hidden = n !== 2;
      if (n === 2) $('admIdentifier').focus(); else $('admSchoolCode').focus();
    }
    $('adminSchoolForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]');
      NN.clearError($('adminSchoolError'));
      NN.setLoading(btn, true);
      NN.api('/api/auth/admin/verify-school', { method: 'POST', body: JSON.stringify({ code: $('admSchoolCode').value }) }).then(function (r) {
        NN.setLoading(btn, false);
        if (!r.ok) return NN.showError($('adminSchoolError'), r.data.error || 'School password is incorrect.');
        setAdminStep(2);
      });
    });
    $('adminLoginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]');
      NN.clearError($('adminError'));
      NN.setLoading(btn, true);
      NN.api('/api/auth/admin/login', { method: 'POST', body: JSON.stringify({
        identifier: $('admIdentifier').value, password: $('admPassword').value,
      }) }).then(function (r) {
        NN.setLoading(btn, false);
        if (!r.ok) {
          if (r.data && r.data.needsSchoolPassword) {
            setAdminStep(1);
            NN.showError($('adminSchoolError'), 'Your school-password check expired. Please enter it again.');
            openAdmin(true);
            return;
          }
          return NN.showError($('adminError'), r.data.error || 'Sign-in failed.');
        }
        window.location.href = 'admin/index.html';
      });
    });
    $('adminBackStep').addEventListener('click', function () {
      setAdminStep(1);
      $('admSchoolCode').value = '';
      $('admPassword').value = '';
    });
    setAdminStep(1);

    // Deep links: #access opens the admin section, #teacher selects the teacher tab.
    function applyHash() {
      if (window.location.hash === '#access') openAdmin(true);
      else if (window.location.hash === '#teacher') setMode('teacher');
    }
    applyHash();
    window.addEventListener('hashchange', applyHash);
  }

  document.addEventListener('DOMContentLoaded', function () {
    populateSelects();
    initUnifiedLogin();

    // Student login (legacy page handlers; no-ops when the form is absent)
    handle('studentLoginForm', 'loginError', async function (form) {
      var r = await NN.api('/api/auth/student/login', { method: 'POST', body: JSON.stringify({
        identifier: val(form, 'identifier'), password: val(form, 'password'), remember: form.elements.remember.checked,
      }) });
      if (!r.ok) return NN.showError($('loginError'), r.data.error || 'Login failed.');
      window.location.href = 'student/overview.html';
    });

    // Student register — district + typed school name
    handle('studentRegisterForm', 'registerError', async function (form) {
      if (!val(form, 'district')) return NN.showError($('registerError'), 'Please choose your district.');
      if (!(val(form, 'schoolName') || '').trim().match(/.{3,}/)) return NN.showError($('registerError'), 'Please type your school name.');
      var r = await NN.api('/api/auth/student/register', { method: 'POST', body: JSON.stringify({
        fullName: val(form, 'fullName'), username: val(form, 'username'), email: val(form, 'email'),
        district: val(form, 'district'), schoolName: val(form, 'schoolName'),
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
      var dest = sessionStorage.getItem('nnTeacherNext') || 'student-login.html#teacher';
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

    // Teacher register — district + typed school name + +250 phone
    handle('teacherRegisterForm', 'teacherRegisterError', async function (form) {
      if (!(val(form, 'schoolName') || '').trim().match(/.{3,}/)) return NN.showError($('teacherRegisterError'), 'Please type the school where you teach.');
      var rawPhone = (val(form, 'phone') || '').replace(/[\s-]/g, '');
      if (rawPhone && !/^(07\d{8}|2507\d{8}|\+2507\d{8})$/.test(rawPhone)) return NN.showError($('teacherRegisterError'), 'Phone must be a Rwandan number like 0788123456.');
      var r = await NN.api('/api/auth/teacher/register', { method: 'POST', body: JSON.stringify({
        fullName: val(form, 'fullName'), username: val(form, 'username'), email: val(form, 'email'),
        district: val(form, 'district'), schoolName: val(form, 'schoolName'),
        phone: rawPhone,
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
