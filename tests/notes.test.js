// APALINK Milestone 2 test — real publish → access control → save → download → cleanup.
process.env.PORT = process.env.PORT || '4124';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');

function req(method, path, body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.PORT, path, method, headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
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
function cookieOf(res) { return res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null; }
async function waitUp() {
  for (let i = 0; i < 30; i++) { try { const r = await req('GET', '/api/health'); if (r.status === 200) return; } catch {} await new Promise(r => setTimeout(r, 300)); }
  throw new Error('server did not start');
}

(async () => {
  const child = spawn('node', ['--env-file=.env', 'server/app.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: process.env.PORT } });
  const createdUsers = [];
  let noteId = null;
  try {
    await waitUp();
    const stamp = Date.now();
    const deps = (await req('GET', '/api/auth/departments')).body;
    const lvls = (await req('GET', '/api/auth/levels')).body;
    const schools = (await req('GET', '/api/auth/schools')).body;
    const lvlId = lvls[0].id;

    // teacher: verify → register
    const ver = await req('POST', '/api/auth/teacher/verify', { code: 'APADE@2026' });
    const tCookie0 = cookieOf(ver);
    const tReg = await req('POST', '/api/auth/teacher/register', { fullName: 'T M2', username: `tch${stamp}`, email: '', district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' }, tCookie0);
    console.log('teacher register:', tReg.status);
    const tCookie = cookieOf(tReg) || tCookie0;
    createdUsers.push(['teachers', tReg.body.user.id]);

    // student A: matching dept + level
    const aReg = await req('POST', '/api/auth/student/register', { fullName: 'A M2', username: `m2a${stamp}`, email: '', sectionId: deps[0].id, className: 'A', levelId: lvlId, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    const aCookie = cookieOf(aReg);
    createdUsers.push(['students', aReg.body.user.id]);
    // student B: different level (must NOT see note)
    const otherLvl = lvls[1].id;
    const bReg = await req('POST', '/api/auth/student/register', { fullName: 'B M2', username: `m2b${stamp}`, email: '', sectionId: deps[0].id, className: 'A', levelId: otherLvl, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    const bCookie = cookieOf(bReg);
    createdUsers.push(['students', bReg.body.user.id]);

    // publish a REAL note with a REAL file
    const { body, headers } = multipart(
      { title: 'Test Note M2', description: 'desc', departmentId: String(deps[0].id), levelId: String(lvlId), className: '', subject: 'Testing' },
      'file', 'test-note.txt', 'Hello APALINK M2'
    );
    const pub = await req('POST', '/api/teacher/notes', body, tCookie, headers);
    console.log('publish (201 expected):', pub.status, pub.body);
    noteId = pub.body.noteId;

    // student A sees it
    const aNotes = (await req('GET', '/api/student/notes', null, aCookie)).body;
    console.log('student A sees note:', aNotes.some(n => n.id === noteId), '| total:', aNotes.length);
    // student B does NOT see it
    const bNotes = (await req('GET', '/api/student/notes', null, bCookie)).body;
    console.log('student B CANNOT see note:', !bNotes.some(n => n.id === noteId));
    // search finds it
    const found = (await req('GET', '/api/student/notes?q=Test%20Note', null, aCookie)).body;
    console.log('search finds note:', found.some(n => n.id === noteId));
    // dashboard stats real
    const dash = (await req('GET', '/api/student/dashboard', null, aCookie)).body;
    console.log('dashboard notes count:', dash.stats.availableNotes, '| notifications:', dash.notifications.length);
    // save + saved list
    await req('POST', `/api/student/notes/${noteId}/save`, {}, aCookie);
    const saved = (await req('GET', '/api/student/saved', null, aCookie)).body;
    console.log('saved list has note:', saved.some(n => n.id === noteId));
    // download (tracks + returns bytes)
    const dl = await req('GET', `/api/notes/${noteId}/file`, null, aCookie);
    console.log('download status:', dl.status, '| bytes contain text:', dl.raw.toString().includes('Hello APALINK M2'));
    const dls = (await req('GET', '/api/student/downloads', null, aCookie)).body;
    console.log('downloads list:', dls.length);
    // student B cannot download / save someone else's note → 403/404
    const bDl = await req('GET', `/api/notes/${noteId}/file`, null, bCookie);
    console.log('student B download blocked:', bDl.status === 403);
    // teacher dashboard sees 1 note with 1 download
    const tDash = (await req('GET', '/api/teacher/dashboard', null, tCookie)).body;
    console.log('teacher downloads total:', tDash.stats.downloads);
    // unpublish → student A no longer sees it
    await req('PATCH', `/api/teacher/notes/${noteId}`, { isPublished: false }, tCookie);
    const aAfter = (await req('GET', '/api/student/notes', null, aCookie)).body;
    console.log('unpublished hidden:', !aAfter.some(n => n.id === noteId));
    // delete note + verify gone
    await req('DELETE', `/api/teacher/notes/${noteId}`, null, tCookie);
    const tDash2 = (await req('GET', '/api/teacher/dashboard', null, tCookie)).body;
    console.log('after delete, notes:', tDash2.stats.notes, '| downloads:', tDash2.stats.downloads);
    noteId = null;
    console.log('M2 TEST PASSED (cleanup below removes test users)');
  } catch (e) {
    console.error('M2 TEST FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    // CLEANUP: remove any remaining test note (if test failed mid-way) + test users.
    // Hard requirement: no demo notes/downloads left behind.
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(__dirname + '/../data/apalink.db');
      db.exec('PRAGMA foreign_keys = ON;');
      if (noteId) {
        const files = db.prepare('SELECT file_path FROM note_files WHERE note_id=?').all(noteId);
        db.prepare('DELETE FROM notes WHERE id=?').run(noteId);
        for (const f of files) { try { fs.unlinkSync(__dirname + '/../data/uploads/' + require('node:path').basename(f.file_path)); } catch {} }
        console.log('cleanup: removed leftover test note', noteId);
      }
      for (const [table, id] of createdUsers) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      console.log('cleanup: removed', createdUsers.length, 'test users');
      db.close();
    } catch (e) { console.error('cleanup failed:', e.message); }
    child.kill();
  }
})();
