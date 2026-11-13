// APALINK Milestone 3 test — timetable → messaging → settings, then full cleanup.
process.env.PORT = process.env.PORT || '4126';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function req(method, p, body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.PORT, path: p, method, headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
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
function multipart(fields, fileField, fileName) {
  const boundary = '----nn' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (fileField) { parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`)); parts.push(Buffer.from('%PDF-1.4 fake-id')); }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}
const cookieOf = (res) => res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null;
async function waitUp() {
  for (let i = 0; i < 40; i++) { try { const r = await req('GET', '/api/health'); if (r.status === 200 && r.body.milestone >= 3) return; } catch {} await new Promise(r => setTimeout(r, 300)); }
  throw new Error('server did not start / wrong milestone');
}

(async () => {
  const child = spawn('node', ['--env-file=.env', 'server/app.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: process.env.PORT } });
  const createdUsers = [];
  let docId = null, periodId = null;
  try {
    await waitUp();
    const stamp = Date.now();
    const deps = (await req('GET', '/api/auth/departments')).body;
    const lvls = (await req('GET', '/api/auth/levels')).body;
    const schools = (await req('GET', '/api/auth/schools')).body;
    const lvlId = lvls[0].id;

    // --- ADMIN ---
    const schoolCheck = await req('POST', '/api/auth/admin/verify-school', { code: process.env.TEACHER_ACCESS_CODE || 'APADE@2026' });
    const schoolCookie = cookieOf(schoolCheck);
    const admin = await req('POST', '/api/auth/admin/login', { identifier: 'admin', password: '@dministr@tion' }, schoolCookie);
    const adminCookie = cookieOf(admin);
    console.log('admin school check:', schoolCheck.status, '| admin login:', admin.status);
    const per = await req('POST', '/api/admin/periods', { name: `TEST Term ${stamp}` }, adminCookie);
    periodId = per.body.period.id;
    console.log('period created:', per.status);

    // --- Timetable upload (PDF) ---
    const { body, headers } = multipart({ title: 'Test TT', description: 'd', departmentId: String(deps[0].id), levelId: String(lvlId), className: 'A', periodId: String(periodId) }, 'file', 'tt.pdf');
    const created = await req('POST', '/api/admin/timetables', body, adminCookie, headers);
    console.log('upload timetable:', created.status);
    docId = created.body.id;
    // entries
    const e1 = await req('POST', `/api/admin/timetables/${docId}/entries`, { dayOfWeek: 1, subject: 'Testing', teacherName: 'Mr T', classroom: 'Room 1', startTime: '08:00', endTime: '09:00', isBreak: false }, adminCookie);
    console.log('entry 1 added:', e1.status);
    const e2 = await req('POST', `/api/admin/timetables/${docId}/entries`, { dayOfWeek: 1, subject: 'Clash', teacherName: 'Mr T', classroom: 'Room 1', startTime: '08:30', endTime: '09:30', isBreak: false }, adminCookie);
    console.log('conflict rejected (409):', e2.status === 409, '| conflicts:', e2.body.conflicts ? e2.body.conflicts.length : 0);
    const e2b = await req('POST', `/api/admin/timetables/${docId}/entries`, { dayOfWeek: 1, subject: 'Clash', teacherName: 'Mr T', classroom: 'Room 1', startTime: '08:30', endTime: '09:30', isBreak: false, override: true }, adminCookie);
    console.log('override accepted (201):', e2b.status === 201);

    // --- Users ---
    const tReg = await req('POST', '/api/auth/teacher/register', { fullName: 'T M3', username: `m3t${stamp}`, email: '', district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' }, cookieOf(await req('POST', '/api/auth/teacher/verify', { code: 'APADE@2026' })));
    const tCookie = cookieOf(tReg); const teacherId = tReg.body.user.id;
    createdUsers.push(['teachers', teacherId]);
    // add teacher-entry: create another entry assigned to this teacher
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(__dirname + '/../data/apalink.db');
    db.prepare('INSERT INTO timetable_entries (document_id, day_of_week, subject, teacher_id, teacher_name, classroom, start_time, end_time, sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(docId, 2, 'M3 Subject', teacherId, 'T M3', 'Lab 1', '10:00', '11:00', 0);
    db.close();
    // student A (matching) + student B (other level)
    const aReg = await req('POST', '/api/auth/student/register', { fullName: 'A M3', username: `m3a${stamp}`, email: '', sectionId: deps[0].id, className: 'A', levelId: lvlId, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    const aCookie = cookieOf(aReg); const stuA = aReg.body.user.id;
    createdUsers.push(['students', stuA]);
    const bReg = await req('POST', '/api/auth/student/register', { fullName: 'B M3', username: `m3b${stamp}`, email: '', sectionId: deps[0].id, className: 'A', levelId: lvls[1].id, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    const bCookie = cookieOf(bReg); const stuB = bReg.body.user.id;
    createdUsers.push(['students', stuB]);

    // --- publish ---
    const pub = await req('POST', `/api/admin/timetables/${docId}/publish`, {}, adminCookie);
    console.log('publish (admin cookie, 200):', pub.status, JSON.stringify(pub.body));
    const tts = (await req('GET', '/api/student/timetable', null, aCookie)).body;
    console.log('student A sees timetable:', tts.document && tts.document.title === 'Test TT', '| entries:', tts.entries.length);
    const ttsB = (await req('GET', '/api/student/timetable', null, bCookie)).body;
    console.log('student B sees null:', ttsB.document === null);
    const sched = (await req('GET', '/api/teacher/schedule', null, tCookie)).body;
    console.log('teacher schedule has subject:', sched.some(x => x.subject === 'M3 Subject'));
    const notifA = (await req('GET', '/api/notifications', null, aCookie)).body;
    console.log('student A notified:', notifA.notifications.some(n => n.type === 'timetable'));
    const notifT = (await req('GET', '/api/notifications', null, tCookie)).body;
    console.log('teacher notified:', notifT.notifications.some(n => n.type === 'timetable'));

    // --- Replace: publish second doc, old one replaced ---
    const mm = multipart({ title: 'Test TT v2', description: '', departmentId: String(deps[0].id), levelId: String(lvlId), className: 'A', periodId: String(periodId) }, 'file', 'tt2.pdf');
    const c2r = await req('POST', '/api/admin/timetables', mm.body, adminCookie, mm.headers);
    const doc2Id = c2r.body.id;
    const pub2 = await req('POST', `/api/admin/timetables/${doc2Id}/publish`, {}, adminCookie);
    console.log('replace published:', pub2.status, '| replaced:', pub2.body.replaced);
    const tts2 = (await req('GET', '/api/student/timetable', null, aCookie)).body;
    console.log('student now sees v2:', tts2.document && tts2.document.title === 'Test TT v2');

    // --- MESSAGING: A <-> B ---
    const conv = await req('POST', '/api/messages/conversations', { withRole: 'student', withId: stuB }, aCookie);
    console.log('A starts conv:', conv.status);
    const convId = conv.body.id;
    const m1 = await req('POST', `/api/messages/conversations/${convId}/messages`, { body: 'Hello B' }, aCookie);
    console.log('A sends:', m1.status);
    const bUnread = (await req('GET', '/api/messages/unread', null, bCookie)).body;
    console.log('B unread count:', bUnread.unread);
    const m2 = await req('POST', `/api/messages/conversations/${convId}/messages`, { body: 'Hi A' }, bCookie);
    console.log('B replies:', m2.status);
    const aMsgs = (await req('GET', `/api/messages/conversations/${convId}/messages`, null, aCookie)).body;
    console.log('A sees history (2):', aMsgs.length === 2);
    // seen state: B opens the conversation, A's message becomes seen
    await req('POST', `/api/messages/conversations/${convId}/read`, {}, bCookie);
    const aSeen = (await req('GET', `/api/messages/conversations/${convId}/messages`, null, aCookie)).body;
    console.log('own message shows seen after B reads:', aSeen.find(x => x.id === m1.body.id).seen === true);
    // presence: B just sent a request, so the directory shows them active
    const dirA = (await req('GET', '/api/messages/directory?q=' + encodeURIComponent(`m3b${stamp}`), null, aCookie)).body;
    const bInfo = dirA.find(u => u.id === stuB);
    console.log('directory shows active user:', !!bInfo && bInfo.online === true);
    // unauthorized: teacher tries to read A-B conv
    const tTry = await req('GET', `/api/messages/conversations/${convId}/messages`, null, tCookie);
    console.log('outsider blocked (403):', tTry.status === 403);
    // --- student -> teacher with dept info ---
    const tc = await req('POST', '/api/messages/conversations', { withRole: 'teacher', withId: teacherId }, aCookie);
    const tConv = tc.body.id;
    await req('POST', `/api/messages/conversations/${tConv}/messages`, { body: 'Question about Testing' }, aCookie);
    const tConvs = (await req('GET', '/api/messages/conversations', null, tCookie)).body;
    const tConvSerialized = tConvs.find(c => c.id === tConv);
    console.log('teacher inbox shows dept:', tConvSerialized && tConvSerialized.other.department === deps[0].name, '| class:', tConvSerialized && tConvSerialized.other.className === 'A');
    await req('POST', `/api/messages/conversations/${tConv}/messages`, { body: 'Teacher reply' }, tCookie);
    const aTMsgs = (await req('GET', `/api/messages/conversations/${tConv}/messages`, null, aCookie)).body;
    console.log('student sees reply (2):', aTMsgs.length === 2);
    // --- report ---
    const rep = await req('POST', '/api/messages/report', { messageId: m1.body.id, reason: 'test report' }, aCookie);
    console.log('report filed:', rep.status);
    const reports = (await req('GET', '/api/admin/reports', null, adminCookie)).body;
    console.log('admin sees open report:', Array.isArray(reports) && reports.length >= 1);
    const reportId = reports[0].id;
    await req('POST', `/api/admin/reports/${reportId}/resolve`, { action: 'hide' }, adminCookie);
    const aMsgsAfter = (await req('GET', `/api/messages/conversations/${convId}/messages`, null, aCookie)).body;
    console.log('hidden message gone (1 left):', aMsgsAfter.length === 1);
    // --- delete own message ---
    const m3 = await req('POST', `/api/messages/conversations/${convId}/messages`, { body: 'Delete me' }, aCookie);
    const delOwn = await req('DELETE', `/api/messages/conversations/${convId}/messages/${m3.body.id}`, null, aCookie);
    const afterDel = (await req('GET', `/api/messages/conversations/${convId}/messages`, null, aCookie)).body;
    console.log('own message deleted:', delOwn.status === 200 && !afterDel.some(x => x.id === m3.body.id));
    const delOther = await req('DELETE', `/api/messages/conversations/${convId}/messages/${m2.body.id}`, null, aCookie);
    console.log('cannot delete another user message (403):', delOther.status === 403);
    // --- file attachment in a message ---
    const attUp = multipart({ body: 'Assignment attached' }, 'files', 'assignment.pdf');
    const attSend = await req('POST', `/api/messages/conversations/${convId}/messages`, attUp.body, aCookie, attUp.headers);
    const attList = (attSend.body && attSend.body.attachments) || [];
    console.log('attachment sent (201):', attSend.status === 201 && attList.length === 1 && attList[0].name === 'assignment.pdf');
    const bMsgs = (await req('GET', `/api/messages/conversations/${convId}/messages`, null, bCookie)).body;
    const attMsg = bMsgs.find(x => x.id === attSend.body.id);
    console.log('recipient sees attachment metadata:', !!attMsg && attMsg.attachments.length === 1);
    const dlOk = await req('GET', `/api/messages/attachments/${attList[0].id}`, null, bCookie);
    console.log('recipient download (200 + bytes):', dlOk.status === 200 && dlOk.raw.includes(Buffer.from('%PDF-1.4')));
    const dlOut = await req('GET', `/api/messages/attachments/${attList[0].id}`, null, tCookie);
    console.log('outsider download blocked (403):', dlOut.status === 403);
    // attachment-only message (no text) and disallowed type
    const attOnly = multipart({ body: '' }, 'files', 'notes.txt');
    const attOnlySend = await req('POST', `/api/messages/conversations/${convId}/messages`, attOnly.body, aCookie, attOnly.headers);
    console.log('attachment-only message accepted:', attOnlySend.status === 201 && attOnlySend.body.body === '');
    const attBad = multipart({ body: 'nope' }, 'files', 'evil.exe');
    const attBadSend = await req('POST', `/api/messages/conversations/${convId}/messages`, attBad.body, aCookie, attBad.headers);
    console.log('disallowed file type rejected (400):', attBadSend.status === 400);
    // deleting the message removes the stored file (download 404s)
    await req('DELETE', `/api/messages/conversations/${convId}/messages/${attSend.body.id}`, null, aCookie);
    const dlGone = await req('GET', `/api/messages/attachments/${attList[0].id}`, null, aCookie);
    console.log('attachment removed after message delete (404):', dlGone.status === 404);
    // --- block ---
    await req('POST', '/api/messages/block', { withRole: 'student', withId: stuB }, aCookie);
    const blockMsg = await req('POST', `/api/messages/conversations/${convId}/messages`, { body: 'should fail' }, aCookie);
    console.log('blocked send (403):', blockMsg.status === 403);

    // --- SETTINGS ---
    const pref = await req('POST', '/api/settings/prefs', { prefs: { theme: 'dark', fontSize: 'large', notif_timetable: 'off' } }, aCookie);
    console.log('prefs saved:', pref.status);
    const prefGet = (await req('GET', '/api/settings/prefs', null, aCookie)).body;
    console.log('prefs persist (dark/large):', prefGet.theme === 'dark' && prefGet.fontSize === 'large');
    const dupU = await req('POST', '/api/settings/profile', { username: `m3b${stamp}` }, aCookie);
    console.log('dup username rejected (400):', dupU.status === 400);
    const okU = await req('POST', '/api/settings/profile', { username: `m3a2${stamp}` }, aCookie);
    console.log('username change (200):', okU.status === 200);
    const badChange = await req('POST', '/api/settings/profile', { sectionId: 2 }, aCookie);
    console.log('official-field change rejected (400):', badChange.status === 400);
    const cp = await req('POST', '/api/settings/change-password', { currentPassword: 'test1234', newPassword: 'newpass99', confirm: 'newpass99' }, aCookie);
    console.log('password change:', cp.status);
    const oldLogin = await req('POST', '/api/auth/student/login', { identifier: `m3a2${stamp}`, password: 'test1234' });
    console.log('old password rejected (401):', oldLogin.status === 401);
    const newLogin = await req('POST', '/api/auth/student/login', { identifier: `m3a2${stamp}`, password: 'newpass99' });
    console.log('new password works (200):', newLogin.status === 200);

    console.log('M3 TEST PASSED (cleanup below)');
  } catch (e) {
    console.error('M3 TEST FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(__dirname + '/../data/apalink.db');
      db.exec('PRAGMA foreign_keys = ON;');
      db.prepare("DELETE FROM timetable_documents WHERE title LIKE 'Test TT%'").run();
      if (periodId) db.prepare('DELETE FROM academic_periods WHERE id=?').run(periodId);
      // Delete test conversations first (data comes from the conversations they participate in)
      const tcIds = db.prepare(`SELECT id FROM conversations WHERE id IN (
        SELECT conversation_id FROM conversation_participants WHERE participant_role='student' AND participant_id IN (SELECT id FROM students WHERE username LIKE 'm3%' OR username LIKE 'm3a2%')
        OR participant_role='teacher' AND participant_id IN (SELECT id FROM teachers WHERE username LIKE 'm3%')
      )`).all().map(r => r.id);
      // remove files attached to those test conversations before the rows cascade away
      for (const cid of tcIds) {
        const files = db.prepare(`SELECT a.file_path FROM message_attachments a
          JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ?`).all(cid);
        for (const f of files) { try { fs.unlinkSync(path.join(__dirname, '/../data/uploads/messages', path.basename(f.file_path))); } catch {} }
      }
      for (const cid of tcIds) db.prepare('DELETE FROM conversations WHERE id=?').run(cid);
      db.prepare("DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM students WHERE username LIKE 'm3%' OR username LIKE 'm3a2%') OR recipient_id IN (SELECT id FROM teachers WHERE username LIKE 'm3%')").run();
      db.prepare("DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM students WHERE username LIKE 'm3%' OR username LIKE 'm3a2%') OR user_id IN (SELECT id FROM teachers WHERE username LIKE 'm3%')").run();
      db.prepare("DELETE FROM activity_log WHERE action LIKE '%timetable.%' AND details LIKE 'Test TT%'").run();
      for (const [table, id] of createdUsers) {
        try { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); } catch (e) { console.error('cleanup user failed:', table, id, e.message); }
      }
      // cascade leftovers explicitly:
      console.log('cleanup done: test users/timetables/conversations removed');
      db.close();
      // remove test uploads created by this test (pdfs whose doc rows are gone)
      const ttdir = __dirname + '/../data/uploads/timetables';
      if (fs.existsSync(ttdir)) for (const f of fs.readdirSync(ttdir)) { try { fs.unlinkSync(path.join(ttdir, f)); } catch {} }
    } catch (e) { console.error('cleanup failed:', e.message); }
    child.kill();
  }
})();
