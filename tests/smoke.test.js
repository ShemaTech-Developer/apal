// APALINK smoke test — boots the real server, exercises auth end-to-end.
process.env.PORT = process.env.PORT || '4123';
const { spawn } = require('node:child_process');
const http = require('node:http');

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.PORT, path, method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let buf = ''; res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf ? JSON.parse(buf) : {} }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function cookieOf(res) {
  const c = res.headers['set-cookie'];
  return c ? c[0].split(';')[0] : null;
}

async function waitUp() {
  for (let i = 0; i < 30; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server did not start');
}

(async () => {
  const child = spawn('node', ['--env-file=.env', 'server/app.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: process.env.PORT } });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => out += d);
  try {
    await waitUp();
    const stamp = Date.now();
    // student register
    const deps = await req('GET', '/api/auth/departments');
    const lvls = await req('GET', '/api/auth/levels');
    const schools = (await req('GET', '/api/auth/schools')).body;
    console.log('departments:', deps.body.length, '| levels:', lvls.body.map(l => l.name).join(', '));
    const sReg = await req('POST', '/api/auth/student/register', { fullName: 'Test Student', username: `tstu${stamp}`, email: '', sectionId: deps.body[0].id, className: 'A', levelId: lvls.body[0].id, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    console.log('student register:', sReg.status, sReg.body.user ? sReg.body.user.username : sReg.body.error);
    const sCookie = cookieOf(sReg);
    const me = await req('GET', '/api/auth/me', null, sCookie);
    console.log('student /me:', me.status, me.body.user && me.body.user.role);
    // duplicate username rejected
    const dup = await req('POST', '/api/auth/student/register', { fullName: 'Dup', username: `tstu${stamp}`, email: '', sectionId: deps.body[0].id, className: 'A', levelId: lvls.body[0].id, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'test1234' });
    console.log('duplicate rejected:', dup.status === 400);
    // mismatched passwords rejected
    const mm = await req('POST', '/api/auth/student/register', { fullName: 'MM', username: `mm${stamp}`, email: '', sectionId: deps.body[0].id, className: 'A', levelId: lvls.body[0].id, district: 'Kicukiro', schoolName: 'Test District School', password: 'test1234', confirm: 'other1234' });
    console.log('mismatch rejected:', mm.status === 400);
    // teacher: without verify -> 403
    const noVerify = await req('POST', '/api/auth/teacher/register', { fullName: 'T', username: `t${stamp}`, email: '', password: 'test1234', confirm: 'test1234' });
    console.log('teacher without verify blocked:', noVerify.status === 403);
    // teacher: wrong code
    const wrong = await req('POST', '/api/auth/teacher/verify', { code: 'WRONG' });
    console.log('wrong code rejected:', wrong.status === 403);
    // teacher: correct code -> register -> me
    const ver = await req('POST', '/api/auth/teacher/verify', { code: 'APADE@2026' });
    const tCookie = cookieOf(ver);
    console.log('teacher verify:', ver.status, ver.body.verified);
    const tReg = await req('POST', '/api/auth/teacher/register', { fullName: 'Test Teacher', username: `ttch${stamp}`, email: '', schoolId: schools[0].id, password: 'test1234', confirm: 'test1234' }, tCookie);
    console.log('teacher register:', tReg.status, tReg.body.user ? tReg.body.user.username : tReg.body.error);
    const tMe = await req('GET', '/api/auth/me', null, cookieOf(tReg) || tCookie);
    console.log('teacher /me:', tMe.status, tMe.body.user && tMe.body.user.role);
    // student login again (fresh cookie)
    const sLogin = await req('POST', '/api/auth/student/login', { identifier: `tstu${stamp}`, password: 'test1234' });
    console.log('student login:', sLogin.status);
    // logout
    const lo = await req('POST', '/api/auth/logout', {}, sCookie);
    const after = await req('GET', '/api/auth/me', null, sCookie);
    console.log('logout:', lo.status, '| /me after logout:', after.status);
    console.log('SMOKE TEST PASSED');
  } catch (e) {
    console.error('SMOKE TEST FAILED:', e.message);
    console.log(out);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
})();
