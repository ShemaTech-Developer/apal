// APALINK — modern school notes app. Yellow + white, light mode.
// Auth: username+password (hashed), shared via Supabase apalink_users when configured.
// Rules: Teachers only publish. Students see only their section + level.
const SECTIONS=['Computer Systems and Architecture','Software Development','Networking and Internet Technologies','Electronics and Telecommunication','Professional Accounting','Multimedia Production','Tourism and Hospitality','Food and Beverage Operations','Building and Construction Services','Mathematics and Sciences Stream One','Mathematics and Sciences Stream Two'];
const LEVELS=['Level 3','Level 4','Level 5','Senior 4','Senior 5','Senior 6'];
const SCHOOL_PASSWORD='APADE@2026';
const SAMPLE=[
 {id:'n1',title:'OSI Model Explained',subject:'Networking and Internet Technologies',level:'Level 4',author:'Teacher',date:'2026-01-10',size:'4 KB',downloads:42,views:80,description:'7 layers with everyday examples.',content:'OSI: Physical, Data Link, Network, Transport, Session, Presentation, Application. IP moves packets, TCP makes them reliable.'},
 {id:'n2',title:'Quadratic Equations',subject:'Mathematics and Sciences Stream One',level:'Level 4',author:'Teacher',date:'2026-01-12',size:'4 KB',downloads:35,views:60,description:'Formula and discriminant worked examples.',content:'ax2+bx+c=0, D=b2-4ac. Roots x=(-b±√D)/2a. Example x2-5x+6=0 gives 2 and 3.'},
 {id:'n3',title:'SDLC Basics',subject:'Software Development',level:'Level 3',author:'Teacher',date:'2026-01-15',size:'5 KB',downloads:28,views:51,description:'Requirements to maintenance.',content:'SDLC: Requirements, Design, Code, Test, Deploy, Maintain.'},
 {id:'n4',title:'Cell Structure',subject:'Mathematics and Sciences Stream Two',level:'Senior 4',author:'Teacher',date:'2026-01-18',size:'5 KB',downloads:22,views:40,description:'Nucleus, mitochondria and more.',content:'Nucleus controls, mitochondria release energy, membrane controls entry.'}
];
const UK='apalink_users_v1', SK='apalink_session_v1', NK='apalink_notes_v1', FK='apalink_favs_v1';
const $=s=>document.querySelector(s);
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function loadUsers(){try{return JSON.parse(localStorage.getItem(UK)||'[]')}catch(e){return[]}}
function saveUsers(u){localStorage.setItem(UK,JSON.stringify(u))}
function loadNotes(){try{const s=JSON.parse(localStorage.getItem(NK)||'[]');return [...s,...SAMPLE]}catch(e){return [...SAMPLE]}}
let notes=loadNotes(), favs={}; try{favs=JSON.parse(localStorage.getItem(FK)||'{}')}catch(e){}
let activeDept='All', query='', sortMode='newest', typeFilter='all', previewId=null;
async function hash(pw){if(crypto&&crypto.subtle){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw+'apalink-salt'));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}let h=0;for(let i=0;i<pw.length;i++){h=(h<<5)-h+pw.charCodeAt(i);h|=0}return 'weak'+Math.abs(h)+'_'+pw.length}
function me(){const s=localStorage.getItem(SK);return s?loadUsers().find(u=>u.username===s)||null:null}
function canUpload(){const u=me();return !!u&&(u.role==='teacher'||u.role==='admin')}
function studentDept(){const u=me();return u&&u.role==='student'?u.department:''}
function studentLevel(){const u=me();return u&&u.role==='student'?u.level:''}
// Supabase shared (notes + users) — configured in supabase-config.js
let sb=null, shared=false;
(function(){try{const c=window.APALINK_SUPABASE;if(c&&c.url&&!c.url.includes('YOUR')&&window.supabase){sb=window.supabase.createClient(c.url,c.anonKey);shared=true}}catch(e){}})();
async function fetchShared(){
  $('#sharedStatus').textContent=shared?'🌐 Loading shared library…':'🌐 Per-browser mode — connect Supabase (see README) for shared notes.';
  if(!shared)return;
  try{const {data,error}=await sb.from('apalink_notes').select('*').order('created_at',{ascending:false}); if(error)throw error;
    const remote=(data||[]).map(r=>({id:r.id,title:r.title,subject:r.subject,level:r.level||'',author:r.author,levelClass:r.level_class||'',tags:r.tags||'',description:r.description||'',date:r.created_at,size:r.filesize,filename:r.filename,public_url:r.public_url,storage_path:r.storage_path,downloads:r.downloads||0,views:r.views||0,remote:true}));
    notes=[...remote,...notes.filter(n=>!n.remote&&!SAMPLE.some(s=>s.id===n.id))];
    $('#sharedStatus').innerHTML=`🌐 <b>Shared library connected:</b> ${remote.length} note(s) from everyone · 50 MB max`;
    renderFilters();render();
  }catch(e){$('#sharedStatus').textContent='⚠️ Shared library could not load — check supabase-config.js + run apalink-setup.sql';}
}
async function sharedUser(un){if(!shared)return null;try{const {data}=await sb.from('apalink_users').select('*').eq('username',un).maybeSingle();return data||null}catch(e){return null}}
async function sharedSaveUser(u){if(!shared)return;try{await sb.from('apalink_users').upsert({username:u.username,display_name:u.displayName,class_name:u.className||'',department:u.department||'',level:u.level||'',pass_hash:u.passHash,role:u.role||'',created_at:u.created},{onConflict:'username'})}catch(e){console.warn(e)}}
// ---- Page routing (real pages, not scrolling) ----
const AUTH_PAGES=['page-welcome','page-login','page-register','page-teacherGate','page-teacherReg'];
function showAuth(id){$('#authShell').hidden=false;$('#appShell').hidden=true;AUTH_PAGES.forEach(p=>$('#'+p).hidden=(p!==id));window.scrollTo(0,0);}
function showApp(page){$('#authShell').hidden=true;$('#appShell').hidden=false;document.querySelectorAll('#appShell .page').forEach(el=>el.hidden=(el.dataset.page!==page));document.querySelectorAll('.sidebar nav button').forEach(b=>b.classList.toggle('active',b.dataset.nav===page));window.scrollTo(0,0);if(page==='upload')updatePublishLock();}
document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{showApp(b.dataset.nav);$('#sidebar').classList.remove('open')}));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showApp(b.dataset.go)));
$('#burger').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
// ---- Auth flow ----
$('#chooseStudent').addEventListener('click',()=>showAuth('page-register'));
$('#chooseTeacher').addEventListener('click',()=>showAuth('page-teacherGate'));
$('#goLogin').addEventListener('click',()=>showAuth('page-login'));
$('#goRegister').addEventListener('click',()=>showAuth('page-register'));
$('#backLogin').addEventListener('click',()=>showAuth('page-login'));
$('#gateBack').addEventListener('click',()=>showAuth('page-welcome'));
$('#teacherBack').addEventListener('click',()=>showAuth('page-welcome'));
$('#gateForm').addEventListener('submit',e=>{e.preventDefault();const p=String(new FormData(e.target).get('schoolPass')||'');const err=$('#gateError');if(p!==SCHOOL_PASSWORD){err.textContent='Wrong school password. Students, choose Student instead.';err.hidden=false;return;}err.hidden=true;showAuth('page-teacherReg');toast('School password correct — welcome, Teacher 👩‍🏫');});
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target);const un=String(f.get('username')).trim().toLowerCase(),pw=String(f.get('password')).trim();const err=$('#loginError');err.hidden=true;const h=await hash(pw);
  let users=loadUsers(),u=users.find(x=>x.username===un); if(u&&u.passHash!==h)u=null;
  if(!u){const s=await sharedUser(un); if(s&&s.pass_hash===h){u={username:s.username,displayName:s.display_name,className:s.class_name,department:s.department,level:s.level,passHash:s.pass_hash,role:s.role,created:s.created_at};users.push(u);saveUsers(users);}}
  if(!u){err.textContent='Invalid username or password. Check spelling — or create an account.';err.hidden=false;return;}
  localStorage.setItem(SK,un);enterApp();
});
$('#createForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target);const un=String(f.get('username')).trim().toLowerCase(),pw=String(f.get('password')),cf=String(f.get('confirm'));const err=$('#createError');err.hidden=true;
  if(!/^[a-z0-9_]{3,24}$/.test(un)){err.textContent='Username 3–24 letters/numbers/_.';err.hidden=false;return}
  if(pw.length<6){err.textContent='Password at least 6 characters.';err.hidden=false;return}
  if(pw!==cf){err.textContent='Passwords do not match.';err.hidden=false;return}
  const users=loadUsers(); if(users.some(u=>u.username===un)){err.textContent='Username taken — try Login.';err.hidden=false;return}
  if(await sharedUser(un)){err.textContent='Username taken (shared). Try Login.';err.hidden=false;return}
  const nu={username:un,displayName:String(f.get('displayName')).trim(),department:String(f.get('department')),className:String(f.get('className')).trim(),level:String(f.get('level')),passHash:await hash(pw),role:'student',created:new Date().toISOString().slice(0,10)};
  users.push(nu);saveUsers(users);await sharedSaveUser(nu);
  localStorage.setItem(SK,un);enterApp();
});
$('#teacherForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target);const un=String(f.get('username')).trim().toLowerCase(),pw=String(f.get('password')),cf=String(f.get('confirm'));const err=$('#teacherError');err.hidden=true;
  if(!/^[a-z0-9_]{3,24}$/.test(un)){err.textContent='Username 3–24 letters/numbers/_.';err.hidden=false;return}
  if(pw.length<6||pw!==cf){err.textContent='Passwords must match and be 6+ characters.';err.hidden=false;return}
  const users=loadUsers(); if(users.some(u=>u.username===un)){err.textContent='Username taken.';err.hidden=false;return}
  const nu={username:un,displayName:String(f.get('fullName')).trim(),passHash:await hash(pw),role:'teacher',teacherData:{teacherId:f.get('teacherId'),school:f.get('school')||'APADE School',subjects:f.get('subjects')},created:new Date().toISOString().slice(0,10)};
  users.push(nu);saveUsers(users);await sharedSaveUser(nu);
  localStorage.setItem(SK,un);enterApp();
});
function enterApp(){const u=me();if(!u){showAuth('page-login');return;}
  $('#avatarLetter').textContent=(u.displayName||u.username).charAt(0).toUpperCase();$('#navUsername').textContent=u.username;
  $('#navRole').textContent=u.role==='admin'?'🛡️ Admin':u.role==='teacher'?'👩‍🏫 Teacher':`🎓 ${u.level||''} · ${u.className||''}`;
  $('#topBadge').textContent=u.role==='teacher'?'Teacher':u.role==='admin'?'Admin':(u.department||'Student');
  const deptSel=$('#uploadForm [name="subject"]'); if(deptSel)deptSel.innerHTML=SECTIONS.map(s=>`<option>${esc(s)}</option>`).join('');
  showApp(u.role==='teacher'||u.role==='admin'?'upload':'home'); renderFilters();render();renderMine();updatePublishLock();}
function logout(){localStorage.removeItem(SK);showAuth('page-login');}
$('#logoutBtn').addEventListener('click',logout);
$('#logout2')?.addEventListener('click',logout);
// ---- Notes ----
function extOf(n){const f=(n.filename||'').toLowerCase();return f.endsWith('.pdf')?'pdf':f.endsWith('.txt')||f.endsWith('.md')?'txt':f.endsWith('.doc')||f.endsWith('.docx')?'doc':f.endsWith('.ppt')||f.endsWith('.pptx')?'ppt':'other'}
function renderFilters(){const sd=studentDept();const list=sd?[sd]:['All',...SECTIONS];$('#filters').innerHTML=list.map(s=>`<button class="chip ${s===activeDept||s===sd?'active':''}" data-dept="${esc(s)}">${esc(s)}</button>`).join('');}
function filtered(){const q=query.toLowerCase(),sd=studentDept(),sl=studentLevel();
  return notes.filter(n=>{if(sd&&n.subject!==sd)return false; if(sl&&n.level&&n.level!==sl)return false; if(!sd&&activeDept!=='All'&&n.subject!==activeDept)return false; if(typeFilter!=='all'&&extOf(n)!==typeFilter)return false; if(q&&![n.title,n.subject,n.author,n.description].join(' ').toLowerCase().includes(q))return false; return true;})
  .sort((a,b)=>sortMode==='popular'?(b.downloads||0)-(a.downloads||0):sortMode==='az'?a.title.localeCompare(b.title):String(b.date).localeCompare(String(a.date)));}
function cardHTML(n){return `<article class="card"><button class="fav ${favs[n.id]?'active':''}" data-fav="${n.id}">⭐</button><div><span class="subject">${esc(n.subject)}</span> <span class="meta">${esc(n.level||'')}</span></div><h3>${esc(n.title)}</h3><div class="meta">By ${esc(n.author)} · ${esc(n.date)} · ${esc(n.size)}</div><p class="desc">${esc(n.description||'')}</p><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="mini" data-preview="${n.id}">👁 Preview</button><button class="mini" data-share="${n.id}">📤 Share</button><button class="download" data-download="${n.id}">Download ↓</button></div></article>`}
function render(){const list=filtered();const sd=studentDept();const banner=$('#deptBanner');banner.hidden=!sd;if(sd)banner.innerHTML=`🎓 <b>${esc(sd)}</b> · ${esc(studentLevel())} — only notes for your section & level (${esc(me()?.className||'')})`;
  $('#resultText').textContent=`Showing ${list.length} of ${notes.length} notes`;$('#emptyState').hidden=list.length!==0;$('#notesGrid').innerHTML=list.map(cardHTML).join('');
  $('#stNotes').textContent=notes.length;$('#stSubjects').textContent=new Set(notes.map(n=>n.subject)).size;$('#stDownloads').textContent=notes.reduce((a,n)=>a+(n.downloads||0),0);$('#stUsers').textContent=loadUsers().length;
  $('#homeStats').innerHTML=`<span>📄 ${notes.length} notes</span><span>📚 ${new Set(notes.map(n=>n.subject)).size} sections</span><span>⬇️ ${notes.reduce((a,n)=>a+(n.downloads||0),0)} downloads</span>`;
  $('#topList').innerHTML=[...notes].sort((a,b)=>(b.downloads||0)-(a.downloads||0)).slice(0,4).map(n=>`<li>${esc(n.title)} — ${n.downloads||0}</li>`).join('');
  $('#deptChart').innerHTML=SECTIONS.map(d=>{const c=notes.filter(n=>n.subject===d).length;return `<div style="margin:8px 0"><b>${esc(d)}</b> (${c})<div style="height:10px;background:#f3f4f6;border-radius:99px"><i style="display:block;height:100%;width:${Math.min(100,c*20)}%;background:var(--yellow);border-radius:99px"></i></div></div>`}).join('');
  renderFavs();renderMine();}
function renderFavs(){const list=notes.filter(n=>favs[n.id]);$('#favGrid').innerHTML=list.map(cardHTML).join('');$('#favEmpty').hidden=list.length!==0;}
function renderMine(){const u=me();const box=$('#teacherMine');if(!canUpload()){box.hidden=true;return}box.hidden=false;const mine=notes.filter(n=>n.author===u?.username||n.author===u?.displayName||n.uploaded);$('#myNotesList').innerHTML=mine.length?mine.map(n=>`<div class="note-row" style="display:flex;justify-content:space-between;padding:10px;border:1px solid var(--line);border-radius:12px;margin:6px 0"><span><b>${esc(n.title)}</b> <small class="meta">${esc(n.subject)} · ${esc(n.level||'')}</small></span><span><button class="mini" data-preview="${n.id}">Preview</button> <button class="mini" data-download="${n.id}">Download</button> <button class="mini" data-del="${n.id}">Delete</button></span></div>`).join(''):'<p class="meta">No published notes yet.</p>';}
function updatePublishLock(){const u=me(),upl=canUpload();$('#studentLock').hidden=upl;$('#uploadForm').querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=!upl);$('#publishRoleText').textContent=upl?`Publishing as ${u.role==='admin'?'Admin':'Teacher'} — choose section & level for your students.`:`Student view — ${u?.department||''} · ${u?.level||''}. Publishing is for teachers.`;}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function download(id){const n=notes.find(x=>x.id===id);if(!n)return;n.downloads=(n.downloads||0)+1;render();if(n.public_url){window.open(n.public_url,'_blank');return}if(n.dataUrl){const a=document.createElement('a');a.href=n.dataUrl;a.download=n.filename;a.click()}else{const b=new Blob([n.content||n.title],{type:'text/plain'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=n.filename||'apalink.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}toast('Downloading: '+n.title)}
function openPreview(id){const n=notes.find(x=>x.id===id);if(!n)return;previewId=id;$('#previewTitle').textContent=n.title;let body=n.public_url?`<iframe src="${esc(n.public_url)}" style="width:100%;height:52vh;border:1px solid var(--line);border-radius:12px"></iframe>`:n.content?`<pre style="white-space:pre-wrap;background:var(--soft);padding:14px;border-radius:12px">${esc(n.content)}</pre>`:`<p>Use Download to open this file.</p>`;$('#previewBody').innerHTML=`<p class="meta">${esc(n.subject)} · ${esc(n.level||'')} · ${esc(n.author)}</p>`+body;$('#previewModal').hidden=false;}
document.addEventListener('click',e=>{
  const d=e.target.closest('[data-download]');if(d)download(d.dataset.download);
  const p=e.target.closest('[data-preview]');if(p)openPreview(p.dataset.preview);
  const f=e.target.closest('[data-fav]');if(f){favs[f.dataset.fav]=!favs[f.dataset.fav];if(!favs[f.dataset.fav])delete favs[f.dataset.fav];localStorage.setItem(FK,JSON.stringify(favs));render();}
  const c=e.target.closest('[data-dept]');if(c){activeDept=c.dataset.dept;renderFilters();render();}
  const del=e.target.closest('[data-del]');if(del&&confirm('Delete this note for everyone?')){const n=notes.find(x=>x.id===del.dataset.del);notes=notes.filter(x=>x.id!==del.dataset.del);if(shared&&n?.remote){sb.from('apalink_notes').delete().eq('id',n.id);if(n.storage_path)sb.storage.from('apalinks').remove([n.storage_path]);}render();toast('Deleted');}
  if(e.target.closest('[data-close]'))$('#previewModal').hidden=true;
});
$('#searchInput').addEventListener('input',e=>{query=e.target.value;render();});
$('#sortSelect').addEventListener('change',e=>{sortMode=e.target.value;render()});
$('#typeSelect').addEventListener('change',e=>{typeFilter=e.target.value;render()});
$('#clearBtn').addEventListener('click',()=>{query='';$('#searchInput').value='';activeDept='All';typeFilter='all';renderFilters();render()});
$('#fileInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)$('#fileInfo').textContent=`${f.name} · ${(f.size/1024/1024).toFixed(1)} MB`;});
$('#uploadForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canUpload()){toast('🔒 Only teachers can publish.');return}
  const f=new FormData(e.target),file=f.get('file');const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(['exe','bat','sh','js','dll'].includes(ext)){toast('Blocked file type for safety');return}
  if(file.size>50*1024*1024){toast('File larger than 50 MB');return}
  const btn=e.target.querySelector('button[type="submit"]');btn.textContent='Publishing…';btn.disabled=true;
  const now=new Date().toISOString().slice(0,10);const sizeStr=file.size>1048576?(file.size/1048576).toFixed(1)+' MB':(file.size/1024).toFixed(1)+' KB';
  let note={id:'u'+Date.now(),title:f.get('title'),subject:f.get('subject'),level:f.get('level'),author:f.get('author'),levelClass:f.get('levelClass')||'',tags:f.get('tags')||'',description:f.get('description'),date:now,size:sizeStr,filename:file.name,downloads:0,views:0,uploaded:true};
  try{
    if(shared){const path=`${Date.now()}-${file.name.replace(/[^\w.-]+/g,'_')}`;const {error}=await sb.storage.from('apalinks').upload(path,file);if(error)throw error;const {data:pub}=sb.storage.from('apalinks').getPublicUrl(path);
      await sb.from('apalink_notes').insert({id:note.id,title:note.title,subject:note.subject,level:note.level,author:note.author,level_class:note.levelClass,tags:note.tags,description:note.description,filename:note.filename,filesize:sizeStr,mimetype:file.type,storage_path:path,public_url:pub.publicUrl,created_at:now});
      note.public_url=pub.publicUrl;note.storage_path=path;note.remote=true;toast('Published to shared library! 🌐');
    }else{note.dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(file)});toast('Published in this browser (connect Supabase for shared)');}
  }catch(err){toast('Upload failed: '+err.message)}
  notes.unshift(note);localStorage.setItem(NK,JSON.stringify(notes.filter(n=>n.uploaded)));render();e.target.reset();btn.textContent='Publish Note →';btn.disabled=false;showApp('notes');
});
// AI
const KNOW={osi:'OSI 7 layers: Physical, Data Link, Network, Transport, Session, Presentation, Application. IP moves packets, TCP makes them reliable.',quadratic:'ax²+bx+c=0, D=b²-4ac, roots (-b±√D)/2a.',photosynthesis:'Plants use sunlight+water+CO₂ → glucose+oxygen in chloroplasts.',sdlc:'Requirements → Design → Code → Test → Deploy → Maintain.',ohm:'V=I×R, P=V×I.',cell:'Nucleus controls, mitochondria make energy, membrane controls entry.'};
function aiReply(q){const l=q.toLowerCase(),n=notes.find(x=>x.id===$('#aiNoteSelect').value)||notes[0];
  if(l.includes('summar'))return n?`📝 ${n.title} (${n.subject} · ${n.level||''})\n${(n.content||n.description||'').slice(0,500)}\n\nKey: ${n.description}`:'Pick a note first.';
  if(l.includes('quiz'))return n?`🧠 Quiz from ${n.title}: Fill the blank — “${(n.content||n.description||'').slice(0,80)}…” Think, then ask answer: …`:'No notes yet.';
  if(l.includes('solve')&&/x\^2|x²/.test(l)){const nums=l.match(/-?\d+\.?\d*/g)?.map(Number)||[];if(nums.length>=3){const[a,b,c]=nums,D=b*b-4*a*c;return D<0?'No real roots (D<0)':`Roots: ${((-b+Math.sqrt(D))/(2*a)).toFixed(2)} and ${((-b-Math.sqrt(D))/(2*a)).toFixed(2)}`}}
  for(const k in KNOW)if(l.includes(k))return '💡 '+KNOW[k];
  const hit=notes.find(x=>(x.title+' '+x.subject+' '+x.description).toLowerCase().includes(l.split(' ').find(w=>w.length>3)||''));
  return hit?`📚 From ${hit.title}: ${hit.description} — open the note to read more.`:'Ask: summarize, explain OSI, solve x^2-5x+6=0, or quiz me.';}
function aiAdd(t,w){const d=document.createElement('div');d.className='ai-msg '+w;d.textContent=t;$('#aiMessages').append(d);$('#aiMessages').scrollTop=1e6}
$('#aiBtn').addEventListener('click',()=>{const p=$('#aiPanel');p.hidden=!p.hidden;$('#aiNoteSelect').innerHTML=notes.map(n=>`<option value="${n.id}">${esc(n.title)}</option>`).join('');if(!$('#aiMessages').children.length)aiAdd('Hi! 👋 I\'m APALINK AI. Try summarize, what is OSI?, solve x^2-5x+6=0, quiz me.','bot');});
$('#aiClose').addEventListener('click',()=>$('#aiPanel').hidden=true);
$('#aiForm').addEventListener('submit',e=>{e.preventDefault();const v=$('#aiInput').value.trim();if(!v)return;aiAdd(v,'user');$('#aiInput').value='';setTimeout(()=>aiAdd(aiReply(v),'bot'),400)});
$('#previewAI').addEventListener('click',()=>{$('#aiNoteSelect').value=previewId;$('#previewModal').hidden=true;$('#aiPanel').hidden=false;aiAdd(aiReply('summarize'),'bot')});
$('#previewDownload').addEventListener('click',()=>{download(previewId);$('#previewModal').hidden=true});
// Admin page (inside app)
function renderAdmin(){const u=me();const adm=u&&(u.role==='admin');$('#adminDenied').hidden=adm;$('#adminBody').hidden=!adm;if(!adm)return;$('#aUsers').textContent=loadUsers().length;$('#aNotes').textContent=notes.filter(n=>n.remote).length;$('#adminUsers').innerHTML=loadUsers().map(x=>`<div class="note-row" style="display:flex;justify-content:space-between;padding:10px;border:1px solid var(--line);border-radius:12px;margin:6px 0"><span><b>${esc(x.displayName||x.username)}</b> <small class="meta">@${esc(x.username)} · ${esc(x.role||'student')}</small></span></div>`).join('')||'<p class="meta">No users yet.</p>';$('#adminFiles').innerHTML=notes.filter(n=>n.remote).map(n=>`<div class="note-row" style="display:flex;justify-content:space-between;padding:10px;border:1px solid var(--line);border-radius:12px;margin:6px 0"><span><b>${esc(n.title)}</b> <small class="meta">${esc(n.subject)} · ${esc(n.level||'')}</small></span><button class="mini" data-del="${n.id}">Delete</button></div>`).join('')||'<p class="meta">No shared files yet.</p>';}
// Hook admin into nav rendering
const _showApp=showApp; // patch: render admin when opening admin page
document.querySelectorAll('[data-nav="admin"]').forEach(b=>b.addEventListener('click',()=>setTimeout(renderAdmin,50)));
// Init
if(me())enterApp();else showAuth('page-welcome');
fetchShared(); renderFilters(); render();
if('serviceWorker' in navigator && location.protocol.startsWith('http')){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));}
