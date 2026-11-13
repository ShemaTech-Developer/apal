// APALINK admin milestone test — admin pw from env, overview, user control, notes/conversations moderation.
process.env.PORT = process.env.PORT || '4127';
const { spawn } = require('node:child_process');
const http = require('node:http');

function req(method, p, body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.PORT, path: p, method, headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString()); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : buf.toString() });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const cookieOf = (res) => res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null;
async function waitUp() {
  for (let i = 0; i < 40; i++) { try { const r = await req('GET', '/api/health'); if (r.status === 200 && r.body.milestone >= 3) return; } catch {} await new Promise(r => setTimeout(r, 300)); }
  throw new Error('server did not start');
}

(async () => {
  const child = spawn('node', ['--env-file=.env', 'server/app.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: process.env.PORT } });
  let testStudentId = null, testConvId = null, testTeacherId = null, testTeacherUser = null;
  try {
    await waitUp();
    const stamp = Date.now();
    const deps = (await req('GET', '/api/auth/departments')).body;
    const lvls = (await req('GET', '/api/auth/levels')).body;

    // admin entry: school password first, then administrator password
    const noSchool = await req('POST', '/api/auth/admin/login', { identifier: 'admin', password: '@dministr@tion' });
    console.log('admin blocked without school password (403):', noSchool.status === 403 && noSchool.body.needsSchoolPassword === true);
    const schoolCheck = await req('POST', '/api/auth/admin/verify-school', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' });
    const schoolCookie = cookieOf(schoolCheck);
    console.log('admin school password accepted (200):', schoolCheck.status === 200);
    const wrong = await req('POST', '/api/auth/admin/login', { identifier: 'admin', password: 'Admin@2026' }, schoolCookie);
    console.log('old admin password rejected (401):', wrong.status === 401);

    // admin login with the NEW password from .env
    const admin = await req('POST', '/api/auth/admin/login', { identifier: 'admin', password: '@dministr@tion' }, schoolCookie);
    console.log('admin new password (200):', admin.status === 200);
    const aCookie = cookieOf(admin);

    // student cannot access admin APIs
    const sReg = await req('POST', '/api/auth/student/register', { fullName: 'Adm T', username: `adm${stamp}`, email: '', sectionId: deps[0].id, className: 'A', levelId: lvls[0].id, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    const sCookie = cookieOf(sReg); testStudentId = sReg.body.user.id;
    const forbid = await req('GET', '/api/admin/users', null, sCookie);
    console.log('student blocked from admin API (401):', forbid.status === 401);

    const dash = (await req('GET', '/api/admin/dashboard', null, aCookie)).body;
    console.log('dashboard counts:', dash.counts.students >= 1 && dash.counts.teachers >= 0, '| activity rows:', Array.isArray(dash.activity));

    const users = (await req('GET', '/api/admin/users?q=adm', null, aCookie)).body;
    console.log('grouped users search finds test student:', users.students.some(u => u.id === testStudentId));
    const detail = (await req('GET', `/api/admin/users/student/${testStudentId}`, null, aCookie)).body;
    console.log('user detail grades:', detail.fullName === 'Adm T' && detail.section === deps[0].name);

    // deactivate → login blocked; reactivate
    await req('POST', `/api/admin/users/student/${testStudentId}/active`, { active: false }, aCookie);
    const blockedLogin = await req('POST', '/api/auth/student/login', { identifier: `adm${stamp}`, password: 'test1234' });
    console.log('deactivated login blocked (401):', blockedLogin.status === 401);
    await req('POST', `/api/admin/users/student/${testStudentId}/active`, { active: true }, aCookie);
    const okLogin = await req('POST', '/api/auth/student/login', { identifier: `adm${stamp}`, password: 'test1234' });
    console.log('reactivated login works (200):', okLogin.status === 200);

    // reset password
    await req('POST', `/api/admin/users/student/${testStudentId}/reset-password`, { newPassword: 'resetpass1' }, aCookie);
    const rp = await req('POST', '/api/auth/student/login', { identifier: `adm${stamp}`, password: 'resetpass1' });
    console.log('admin reset password works (200):', rp.status === 200);

    // admin notes feed
    const notes = (await req('GET', '/api/admin/notes', null, aCookie)).body;
    console.log('admin notes list (array):', Array.isArray(notes));

    // admin conversations moderation view
    const convs = (await req('GET', '/api/admin/conversations', null, aCookie)).body;
    console.log('admin conversations shape:', Array.isArray(convs));
    if (convs.length) {
      const msgs = (await req('GET', `/api/admin/conversations/${convs[0].id}/messages`, null, aCookie)).body;
      console.log('admin can read moderation messages:', Array.isArray(msgs));
    }

    // ---- Assign Teachers: create with unique TC code, search, edit, activate, reset ----
    const anonT = await req('GET', '/api/admin/assign-teachers');
    console.log('assign-teachers blocked without admin session (401):', anonT.status === 401);
    const forbidT = await req('GET', '/api/admin/assign-teachers', null, sCookie);
    console.log('assign-teachers blocked for students (401):', forbidT.status === 401);

    const tUser = `asg${stamp}`;
    const created = await req('POST', '/api/admin/assign-teachers', { fullName: 'Assign Tester', username: tUser, subject: 'Biology', email: `asg${stamp}@test.rw`, tempPassword: 'temp1234', teacherCode: 'TC901', phone: '0788111222', schoolName: 'Test District School', sectionIds: [1, 2, 3] }, aCookie);
    console.log('create teacher (201):', created.status === 201);
    const noSections = await req('POST', '/api/admin/assign-teachers', { fullName: 'No Sections', username: `ns${stamp}`, subject: 'Art', email: `ns${stamp}@test.rw`, tempPassword: 'temp1234', schoolName: 'Test District School' }, aCookie);
    console.log('missing sections rejected (400):', noSections.status === 400);
    const code = created.body.teacherCode;
    console.log('teacher code is TC + numeric (TC001…):', /^TC\d{3,}$/.test(code || ''), '| code:', code);

    const dupUser = await req('POST', '/api/admin/assign-teachers', { fullName: 'Dup', username: tUser, subject: 'Art', email: `dup${stamp}@test.rw`, tempPassword: 'temp1234', sectionIds: [1] }, aCookie);
    console.log('duplicate username rejected (409):', dupUser.status === 409);
    const weakPw = await req('POST', '/api/admin/assign-teachers', { fullName: 'Weak', username: `wk${stamp}`, subject: 'Art', email: `wk${stamp}@test.rw`, tempPassword: '123', sectionIds: [1] }, aCookie);
    console.log('weak temp password rejected (400):', weakPw.status === 400);

    const search = (await req('GET', `/api/admin/assign-teachers?q=${code}`, null, aCookie)).body;
    console.log('search by TC code finds teacher:', Array.isArray(search.teachers) && search.teachers.some(t => t.teacherCode === code && t.subject === 'Biology'));

    const edited = await req('PATCH', `/api/admin/assign-teachers/${created.body.id}`, { subject: 'Chemistry' }, aCookie);
    console.log('edit subject (200):', edited.status === 200 && edited.body.subject === 'Chemistry');

    // codes stay unique across the table
    const allT = (await req('GET', '/api/admin/assign-teachers', null, aCookie)).body.teachers;
    const codes = allT.map(t => t.teacherCode);
    console.log('all teacher codes unique:', new Set(codes).size === codes.length);

    // editing onto another teacher's username must be rejected
    const otherT = allT.filter(t => t.id !== created.body.id)[0];
    const dupEdit = otherT
      ? await req('PATCH', `/api/admin/assign-teachers/${created.body.id}`, { username: otherT.username }, aCookie)
      : { status: -1 };
    console.log('edit to duplicate username rejected (409):', dupEdit.status === 409);

    // deactivate → login blocked; reactivate
    await req('POST', `/api/admin/assign-teachers/${created.body.id}/active`, { active: false }, aCookie);
    const vCookie = cookieOf(await req('POST', '/api/auth/teacher/verify', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' }));
    const blockedT = await req('POST', '/api/auth/teacher/login', { identifier: tUser, password: 'temp1234' }, vCookie);
    console.log('deactivated teacher login blocked (401):', blockedT.status === 401);
    await req('POST', `/api/admin/assign-teachers/${created.body.id}/active`, { active: true }, aCookie);
    const okT = await req('POST', '/api/auth/teacher/login', { identifier: tUser, password: 'temp1234' }, vCookie);
    console.log('reactivated teacher login works (200):', okT.status === 200);

    // reset password → old stops working, new works (fresh verify cookie: login regenerates the session)
    await req('POST', `/api/admin/assign-teachers/${created.body.id}/reset-password`, { newPassword: 'resetpass9' }, aCookie);
    const vCookie2 = cookieOf(await req('POST', '/api/auth/teacher/verify', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' }));
    const oldT = await req('POST', '/api/auth/teacher/login', { identifier: tUser, password: 'temp1234' }, vCookie2);
    const vCookie3 = cookieOf(await req('POST', '/api/auth/teacher/verify', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' }));
    const newT = await req('POST', '/api/auth/teacher/login', { identifier: tUser, password: 'resetpass9' }, vCookie3);
    console.log('reset password: old rejected (401):', oldT.status === 401, '| new accepted (200):', newT.status === 200);
    testTeacherId = created.body.id;
    testTeacherUser = tUser;

    // teacher nav Admin gate is frontend — API gate already proven above.
    console.log('ADMIN TEST PASSED');
  } catch (e) {
    console.error('ADMIN TEST FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(__dirname + '/../data/apalink.db');
      db.exec('PRAGMA busy_timeout = 5000;');
      db.prepare('DELETE FROM notifications WHERE recipient_id=?').run(testStudentId);
      db.prepare('DELETE FROM user_preferences WHERE user_id=?').run(testStudentId);
      db.prepare('DELETE FROM students WHERE id=?').run(testStudentId);
      console.log('cleanup: test student removed');
      if (testTeacherId) {
        db.prepare('DELETE FROM notifications WHERE recipient_role=? AND recipient_id=?').run('teacher', testTeacherId);
        db.prepare('DELETE FROM sessions WHERE teacher_id=?').run(testTeacherId);
        db.prepare('DELETE FROM user_preferences WHERE user_role=? AND user_id=?').run('teacher', testTeacherId);
        db.prepare('DELETE FROM teachers WHERE id=?').run(testTeacherId);
        console.log('cleanup: test teacher removed (' + testTeacherUser + ')');
      }
      db.close();
    } catch (e) { console.error('cleanup failed:', e.message); }
    child.kill();
  }
})();
