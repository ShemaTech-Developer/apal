// APALINK Milestone 5 test — schools/registration, announcements, global search,
// activity history, admin charts + direct messaging, and admin file access.
process.env.PORT = process.env.PORT || '4128';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function req(method, p, body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.PORT, path: p, method, headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString()); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : buf.toString(), raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function multipart(fields, fileField, fileName, fileContent) {
  const boundary = '----nn' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`));
  parts.push(Buffer.from(fileContent));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}
const cookieOf = (res) => res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null;
async function waitUp() {
  for (let i = 0; i < 40; i++) { try { const r = await req('GET', '/api/health'); if (r.status === 200 && r.body.milestone >= 5) return; } catch {} await new Promise(r => setTimeout(r, 300)); }
  throw new Error('server did not start / wrong milestone');
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name + (extra !== undefined ? ' — ' + extra : ''));
  else { console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); failures++; }
}

(async () => {
  const child = spawn('node', ['--env-file=.env', 'server/app.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: process.env.PORT } });
  const createdUsers = [];
  const announcementIds = [];
  let noteId = null;
  let testSchoolId = null;

  try {
    await waitUp();
    const stamp = Date.now();
    const deps = (await req('GET', '/api/auth/departments')).body;
    const lvls = (await req('GET', '/api/auth/levels')).body;

    // ---------------- schools + districts ----------------
    const districts = (await req('GET', '/api/auth/districts')).body;
    const schools = (await req('GET', '/api/auth/schools')).body;
    check('Rwanda districts served', Array.isArray(districts) && districts.length >= 20, districts.length + ' districts');
    check('school catalogue served', Array.isArray(schools) && schools.length >= 40, schools.length + ' schools');
    check('schools carry a district', schools.every(s => s.district && s.name));
    const schoolA = schools[0];
    const schoolB = schools.find(s => s.id !== schoolA.id);
    check('two distinct schools available', !!schoolB, schoolA.name + ' / ' + (schoolB && schoolB.name));

    // ---------------- registration with school ----------------
    const aReg = await req('POST', '/api/auth/student/register', {
      fullName: 'M5 Student A', username: `m5a${stamp}`, email: '', sectionId: deps[0].id,
      className: 'A', levelId: lvls[0].id, district: schoolA.district, schoolName: schoolA.name, password: 'test1234', confirm: 'test1234',
    });
    const saCookie = cookieOf(aReg); const aId = aReg.body.user && aReg.body.user.id;
    if (aId) createdUsers.push(['students', aId]);
    check('student registers with a school', aReg.status === 201 && aReg.body.user.schoolId === schoolA.id, aReg.body.user && aReg.body.user.schoolName);

    const bReg = await req('POST', '/api/auth/student/register', {
      fullName: 'M5 Student B', username: `m5b${stamp}`, email: '', sectionId: deps[0].id,
      className: 'A', levelId: lvls[0].id, district: schoolB.district, schoolName: schoolB.name, password: 'test1234', confirm: 'test1234',
    });
    const sbCookie = cookieOf(bReg); const bId = bReg.body.user && bReg.body.user.id;
    if (bId) createdUsers.push(['students', bId]);
    check('second student gets a different school', bReg.status === 201 && bReg.body.user.schoolId === schoolB.id);

    const meA = (await req('GET', '/api/auth/me', null, saCookie)).body.user;
    check('/me exposes school + district', meA.schoolName === schoolA.name && meA.district === schoolA.district);

    const badSchool = await req('POST', '/api/auth/student/register', {
      fullName: 'M5 Bad School', username: `m5x${stamp}`, email: '', sectionId: deps[0].id,
      className: 'A', levelId: lvls[0].id, district: 'Kicukiro', schoolName: 'ZZ', password: 'test1234', confirm: 'test1234',
    });
    check('invalid school rejected', badSchool.status === 400);

    // ---------------- users: teacher + admin ----------------
    const ver = await req('POST', '/api/auth/teacher/verify', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' });
    const tCookie0 = cookieOf(ver);
    const tReg = await req('POST', '/api/auth/teacher/register', {
      fullName: 'M5 Teacher', username: `m5t${stamp}`, email: '', district: schoolA.district, schoolName: schoolA.name, password: 'test1234', confirm: 'test1234',
    }, tCookie0);
    const tCookie = cookieOf(tReg) || tCookie0;
    const tId = tReg.body.user && tReg.body.user.id;
    if (tId) createdUsers.push(['teachers', tId]);
    check('teacher registered with a school', tReg.status === 201 && tReg.body.user.schoolId === schoolA.id, tReg.body.user && tReg.body.user.schoolName);

    const schoolCheck = await req('POST', '/api/auth/admin/verify-school', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' });
    const schoolCookie = cookieOf(schoolCheck);
    check('admin school password accepted', schoolCheck.status === 200);

    const admin = await req('POST', '/api/auth/admin/login', {
      identifier: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || '@dministr@tion',
    }, schoolCookie);
    const adCookie = cookieOf(admin);
    check('admin login', admin.status === 200);

    // ---------------- announcements ----------------
    const globalAnn = await req('POST', '/api/admin/announcements', {
      title: `M5 Global Notice ${stamp}`, body: 'Everyone should read this school update.',
      category: 'general', audience: 'all', isPinned: true,
    }, adCookie);
    if (globalAnn.body && globalAnn.body.id) announcementIds.push(globalAnn.body.id);
    check('admin creates global announcement', globalAnn.status === 201 && globalAnn.body.isPinned);

    const schoolAnn = await req('POST', '/api/admin/announcements', {
      title: `M5 School A Notice ${stamp}`, body: 'Only students at school A see this.',
      category: 'academic', audience: 'students', schoolId: schoolA.id,
    }, adCookie);
    if (schoolAnn.body && schoolAnn.body.id) announcementIds.push(schoolAnn.body.id);
    check('admin creates school-specific announcement', schoolAnn.status === 201 && schoolAnn.body.schoolId === schoolA.id);

    const teacherAnn = await req('POST', '/api/admin/announcements', {
      title: `M5 Teachers Notice ${stamp}`, body: 'Teachers-only staff message.',
      category: 'urgent', audience: 'teachers',
    }, adCookie);
    if (teacherAnn.body && teacherAnn.body.id) announcementIds.push(teacherAnn.body.id);
    check('admin creates teachers-only announcement', teacherAnn.status === 201);

    const teacherSchoolAnn = await req('POST', '/api/admin/announcements', {
      title: `M5 Teacher School A Notice ${stamp}`, body: 'Staff update for the teachers at school A.',
      category: 'general', audience: 'teachers', schoolId: schoolA.id,
    }, adCookie);
    if (teacherSchoolAnn.body && teacherSchoolAnn.body.id) announcementIds.push(teacherSchoolAnn.body.id);
    check('admin creates school-specific teacher announcement', teacherSchoolAnn.status === 201 && teacherSchoolAnn.body.schoolId === schoolA.id);

    const aAnns = (await req('GET', '/api/announcements', null, saCookie)).body;
    const titles = aAnns.map(x => x.title);
    check('student sees global + own-school announcements',
      titles.includes(globalAnn.body.title) && titles.includes(schoolAnn.body.title));
    check('student does not see teachers-only announcement', !titles.includes(teacherAnn.body.title));

    const bTitles = (await req('GET', '/api/announcements', null, sbCookie)).body.map(x => x.title);
    check('student at another school does not see school A notice',
      bTitles.includes(globalAnn.body.title) && !bTitles.includes(schoolAnn.body.title));

    const tTitles = (await req('GET', '/api/announcements', null, tCookie)).body.map(x => x.title);
    check('teacher sees global + teachers-only, not students-only',
      tTitles.includes(globalAnn.body.title) && tTitles.includes(teacherAnn.body.title) && !tTitles.includes(schoolAnn.body.title));
    check('teacher sees announcements for their own school',
      tTitles.includes(teacherSchoolAnn.body.title));

    const notifA = (await req('GET', '/api/notifications', null, saCookie)).body.notifications;
    check('announcement notification delivered', notifA.some(n => n.type === 'announcements' && n.title.includes(globalAnn.body.title)));

    const unpub = await req('PATCH', `/api/admin/announcements/${schoolAnn.body.id}`, { isPublished: false }, adCookie);
    const aAfterUnpub = (await req('GET', '/api/announcements', null, saCookie)).body.map(x => x.title);
    check('unpublished announcement hidden from students', unpub.status === 200 && !aAfterUnpub.includes(schoolAnn.body.title));

    // ---------------- global search + note + admin file access ----------------
    const { body: noteBody, headers: noteHeaders } = multipart(
      { title: `M5 Searchable Note ${stamp}`, description: 'search target', departmentId: String(deps[0].id), levelId: String(lvls[0].id), className: '', subject: 'Milestone5' },
      'file', 'm5-note.txt', 'Hello APALINK M5 admin preview'
    );
    const pub = await req('POST', '/api/teacher/notes', noteBody, tCookie, noteHeaders);
    noteId = pub.body.noteId;
    check('teacher publishes a note', pub.status === 201 && !!noteId);

    const searchA = (await req('GET', `/api/search?q=${encodeURIComponent('Searchable Note ' + stamp)}`, null, saCookie)).body;
    check('global search finds the note', searchA.notes.some(n => n.id === noteId));
    const searchPerson = (await req('GET', `/api/search?q=${encodeURIComponent(`m5b${stamp}`)}`, null, saCookie)).body;
    check('global search finds a person', searchPerson.users.some(u => u.id === bId && u.role === 'student'));
    const anonSearch = await req('GET', '/api/search?q=test');
    check('global search requires login', anonSearch.status === 401);

    const adminSearch = (await req('GET', `/api/search?q=${encodeURIComponent('Searchable Note ' + stamp)}`, null, adCookie)).body;
    check('admin search covers every note', adminSearch.notes.some(n => n.id === noteId));

    // student downloads the note (so admin charts have real download data)
    const dl = await req('GET', `/api/notes/${noteId}/file`, null, saCookie);
    check('student download works', dl.status === 200 && dl.raw.toString().includes('Hello APALINK M5'));

    const adminPreview = await req('GET', `/api/notes/${noteId}/file?mode=preview`, null, adCookie);
    check('admin can open any note file', adminPreview.status === 200 && adminPreview.raw.toString().includes('admin preview'));

    // ---------------- admin dashboard charts ----------------
    const dash = (await req('GET', '/api/admin/dashboard', null, adCookie)).body;
    check('dashboard activity chart has 7 days', Array.isArray(dash.charts.activity7) && dash.charts.activity7.length === 7);
    check('upload chart groups by file type', dash.charts.uploads && typeof dash.charts.uploads.pdf === 'number');
    check('most-downloaded list includes the note', dash.charts.mostDownloaded.some(n => n.id === noteId));
    check('who-downloaded list includes the student', dash.charts.recentDownloads.some(d => d.note_id === noteId && d.student === 'M5 Student A'));
    check('dashboard counts schools/announcements', dash.counts.schools >= 40 && dash.counts.announcements >= 1);

    // ---------------- admin <-> user direct messages ----------------
    const adminSend = await req('POST', `/api/admin/message-threads/student/${aId}`, { body: 'Hello from administration — M5 test.' }, adCookie);
    check('admin sends direct message', adminSend.status === 201 && adminSend.body.mine === true);

    const threads = (await req('GET', '/api/admin/message-threads', null, adCookie)).body;
    check('admin sees message thread', threads.some(t => t.user.id === aId && t.lastMessage.body.includes('M5 test')));

    const userThread = (await req('GET', '/api/messages/admin-thread', null, saCookie)).body;
    check('student receives admin message', userThread.unread >= 1 && userThread.messages.some(m => m.body.includes('M5 test')));
    await req('POST', '/api/messages/admin-thread/read', {}, saCookie);
    const userThread2 = (await req('GET', '/api/messages/admin-thread', null, saCookie)).body;
    check('student can mark admin thread read', userThread2.unread === 0);

    const reply = await req('POST', '/api/messages/admin-thread', { body: 'Thank you, understood.' }, saCookie);
    check('student replies to administration', reply.status === 201);
    const adminThread = (await req('GET', `/api/admin/message-threads/student/${aId}`, null, adCookie)).body;
    check('admin sees the student reply', adminThread.messages.some(m => m.body === 'Thank you, understood.' && m.mine === false));

    // ---------------- admin school catalogue ----------------
    const newSchool = await req('POST', '/api/admin/schools', {
      name: `M5 Test School ${stamp}`, district: 'Gasabo', sector: 'Test',
    }, adCookie);
    testSchoolId = newSchool.body && newSchool.body.id;
    check('admin adds a school', newSchool.status === 201 && !!testSchoolId);
    const toggle = await req('POST', `/api/admin/schools/${testSchoolId}/active`, { active: false }, adCookie);
    check('admin deactivates a school', toggle.status === 200);
    const catalogue = (await req('GET', '/api/admin/schools', null, adCookie)).body;
    check('school appears in admin catalogue', catalogue.some(s => s.id === testSchoolId && !s.isActive));

    // ---------------- activity history ----------------
    const activity = (await req('GET', '/api/settings/activity', null, saCookie)).body.activity;
    check('activity history lists own actions', activity.length >= 2 && activity.some(x => x.action === 'auth.login' || x.action === 'auth.register'));
    const firstId = activity[0].id;
    const delOne = await req('DELETE', `/api/settings/activity/${firstId}`, null, saCookie);
    const afterOne = (await req('GET', '/api/settings/activity', null, saCookie)).body.activity;
    check('user can delete one history entry', delOne.status === 200 && !afterOne.some(x => x.id === firstId));
    const delAll = await req('DELETE', '/api/settings/activity', null, saCookie);
    const afterAll = (await req('GET', '/api/settings/activity', null, saCookie)).body.activity;
    check('user can clear their history', delAll.status === 200 && afterAll.length === 0);
    const otherCantDelete = await req('DELETE', `/api/settings/activity/${firstId}`, null, sbCookie);
    check('another user cannot delete your history', otherCantDelete.status === 404);

    // Audit trail preserved in DB while the user's view is empty.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'apalink.db'));
    const hidden = db.prepare('SELECT COUNT(*) c FROM activity_log WHERE actor_role=? AND actor_id=? AND hidden_by_user=1').get('student', aId).c;
    db.close();
    check('admin audit log still keeps hidden entries', hidden >= 2, hidden + ' preserved');

    console.log(failures ? `\nM5 TEST FAILED (${failures} check${failures === 1 ? '' : 's'})` : '\nM5 TEST PASSED');
    if (failures) process.exitCode = 1;
  } catch (e) {
    console.error('M5 TEST FAILED:', e.message, e.stack);
    process.exitCode = 1;
  } finally {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'apalink.db'));
      db.exec('PRAGMA foreign_keys = ON;');
      if (noteId) {
        const files = db.prepare('SELECT file_path FROM note_files WHERE note_id=?').all(noteId);
        db.prepare('DELETE FROM note_downloads WHERE note_id=?').run(noteId);
        db.prepare('DELETE FROM notes WHERE id=?').run(noteId);
        for (const f of files) { try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'uploads', path.basename(f.file_path))); } catch {} }
      }
      for (const id of announcementIds) db.prepare('DELETE FROM announcements WHERE id=?').run(id);
      for (const [table, id] of createdUsers) {
        db.prepare('DELETE FROM notifications WHERE recipient_id=?').run(id);
        db.prepare('DELETE FROM user_preferences WHERE user_id=?').run(id);
        db.prepare('DELETE FROM saved_notes WHERE student_id=?').run(id);
        db.prepare('DELETE FROM note_downloads WHERE student_id=?').run(id);
        db.prepare('DELETE FROM admin_messages WHERE user_id=?').run(id);
        db.prepare('DELETE FROM activity_log WHERE actor_id=?').run(id);
        db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      }
      if (testSchoolId) db.prepare('DELETE FROM schools WHERE id=?').run(testSchoolId);
      /* eslint-disable no-unused-vars */
      const _created = createdUsers.length, _anns = announcementIds.length;
      console.log(`cleanup: removed ${_created} test users, ${_anns} announcements, ${testSchoolId ? 1 : 0} test school`);
      db.close();
    } catch (e) { console.error('cleanup failed:', e.message); }
    child.kill();
  }
})();
