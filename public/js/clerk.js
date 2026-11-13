// Clerk AI — floating APALINK assistant. Self-contained: injects its own styles,
// greets the user by name, and answers questions about the platform via /api/clerk.
(function () {
  if (document.getElementById('clerkFab') || !window.NN) return;

  // ---------- Styles (theme-aware: works in light and dark mode) ----------
  var css = `
  .clerk-fab { position: fixed; right: 22px; bottom: 22px; width: 56px; height: 56px; border-radius: 50%; border: 0; background: var(--navy); color: #fff; display: grid; place-items: center; cursor: pointer; z-index: 9999; box-shadow: 0 10px 26px rgba(15,44,94,.35); transition: transform .15s ease, box-shadow .15s ease; }
  .clerk-fab:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 14px 32px rgba(15,44,94,.45); }
  .clerk-fab:active { transform: scale(.97); }
  .clerk-fab .clerk-fab-logo { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; display: block; pointer-events: none; }
  .clerk-panel { position: fixed; right: 22px; bottom: 90px; width: 372px; max-width: calc(100vw - 44px); height: 500px; max-height: calc(100vh - 120px); background: var(--card); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 24px 70px rgba(15,44,94,.28); z-index: 9999; display: flex; flex-direction: column; overflow: hidden; }
  .clerk-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--navy); color: #fff; }
  .clerk-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--yellow); color: #241D00; display: grid; place-items: center; font-weight: 800; font-size: .95rem; flex: none; }
  .clerk-headtxt { flex: 1; min-width: 0; }
  .clerk-headtxt b { display: block; font-size: .95rem; letter-spacing: -.01em; }
  .clerk-headtxt small { opacity: .72; font-size: .72rem; }
  .clerk-close { background: transparent; border: 0; color: #fff; font-size: 1.35rem; line-height: 1; cursor: pointer; padding: 4px 9px; border-radius: 8px; }
  .clerk-close:hover { background: rgba(255,255,255,.16); }
  .clerk-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-soft); }
  .clerk-msg { max-width: 86%; padding: 9px 12px; border-radius: 14px; font-size: .87rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .clerk-msg.clerk { align-self: flex-start; background: var(--card); border: 1px solid var(--line); color: var(--ink); border-bottom-left-radius: 4px; }
  .clerk-msg.user { align-self: flex-end; background: var(--navy); color: #fff; border-bottom-right-radius: 4px; }
  .clerk-msg.clerk.error { border-color: #E8B4B4; color: #C92A2A; }
  .clerk-typing { padding: 6px 14px; font-size: .78rem; color: var(--muted); display: flex; align-items: center; gap: 7px; }
  .clerk-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); display: inline-block; animation: clerkBlink 1.2s infinite; font-style: normal; }
  .clerk-typing i:nth-child(2) { animation-delay: .2s; }
  .clerk-typing i:nth-child(3) { animation-delay: .4s; }
  @keyframes clerkBlink { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
  .clerk-input { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line); background: var(--card); }
  .clerk-input input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 999px; padding: 10px 14px; font: inherit; font-size: .87rem; background: var(--card); color: var(--ink); outline: none; }
  .clerk-input input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
  .clerk-input button { width: 42px; height: 42px; border-radius: 50%; border: 0; background: var(--navy); color: #fff; cursor: pointer; display: grid; place-items: center; flex: none; transition: background .15s ease; }
  .clerk-input button:hover { background: var(--blue-deep); }
  .clerk-input button:disabled { opacity: .45; cursor: default; }
  .clerk-input button .ico { width: 18px; height: 18px; }
  .clerk-suggests { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 2px; background: var(--bg-soft); border-top: 1px solid var(--line); }
  .clerk-suggests[hidden] { display: none; }
  .clerk-suggest { border: 1px solid var(--line); background: var(--card); color: var(--navy); font-family: inherit; font-size: .76rem; font-weight: 600; line-height: 1.3; padding: 6px 12px; border-radius: 999px; cursor: pointer; transition: all .15s ease; }
  .clerk-suggest:hover { border-color: var(--blue); background: var(--blue-soft); color: var(--navy); transform: translateY(-1px); }
  .clerk-suggest:active { transform: translateY(0); }
  .clerk-hbtn { background: transparent; border: 0; color: #fff; font-size: 1rem; line-height: 1; cursor: pointer; padding: 6px 8px; border-radius: 8px; }
  .clerk-hbtn:hover { background: rgba(255,255,255,.16); }
  .clerk-hbtn.off { opacity: .55; }
  .clerk-doc { display: flex; align-items: center; gap: 8px; margin: 8px 12px 0; padding: 8px 10px; background: var(--blue-soft); border: 1px solid var(--line); border-radius: 10px; font-size: .78rem; font-weight: 600; color: var(--navy); }
  .clerk-doc .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clerk-doc button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: .85rem; padding: 2px 6px; border-radius: 6px; }
  .clerk-doc button:hover { background: rgba(0,0,0,.08); color: var(--danger); }
  .clerk-input .side { width: 38px; height: 42px; border: 0; background: transparent; border-radius: 12px; cursor: pointer; font-size: 1.05rem; line-height: 1; flex: none; display: grid; place-items: center; }
  .clerk-input .side:hover { background: var(--bg-soft); }
  .clerk-input .side:disabled { opacity: .4; cursor: default; }
  .clerk-input .side.listening { background: #D64545; color: #fff; animation: clerkPulse 1.2s infinite; }
  .clerk-input .side svg, .clerk-hbtn svg { display: block; }
  .clerk-input .side svg { width: 18px; height: 18px; }
  .clerk-hbtn svg { width: 16px; height: 16px; }
  @keyframes clerkPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(214,69,69,.5); } 50% { box-shadow: 0 0 0 6px rgba(214,69,69,0); } }
  @media (max-width: 560px) { .clerk-panel { right: 12px; left: 12px; bottom: 84px; width: auto; } .clerk-fab { right: 14px; bottom: 14px; } }
  `;
  var style = document.createElement('style');
  style.setAttribute('data-clerk', '');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- State (per-user history: logging in/out switches conversations) ----------
  var messages = [];
  var identityKey = 'guest';
  function storageKey() { return 'clerk.chat.v1.' + identityKey; }
  function loadHistory() {
    try { messages = JSON.parse(localStorage.getItem(storageKey()) || '[]'); } catch (e) { messages = []; }
    if (!Array.isArray(messages)) messages = [];
  }
  function save() {
    try { localStorage.setItem(storageKey(), JSON.stringify(messages.slice(-60))); } catch (e) {}
  }
  // Resolve the signed-in identity once; history and greeting follow from it.
  var mePromise = NN.api('/api/auth/me').then(function (r) {
    identityKey = (r.ok && r.data && r.data.user) ? (r.data.user.role + ':' + r.data.user.id) : 'guest';
    loadHistory();
    return r;
  }).catch(function () { return null; });

  // ---------- DOM ----------
  // ---------- Crisp vector symbols (no emoji glyphs in controls) ----------
  var IC = function (paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  var ICONS = {
    attach: IC('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    mic: IC('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
    soundOn: IC('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
    soundOff: IC('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  };

  var fab = document.createElement('button');
  fab.id = 'clerkFab';
  fab.className = 'clerk-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open Clerk AI — ask anything about APALINK');
  fab.title = 'Clerk AI — ask anything about APALINK';
  fab.innerHTML = '<img class="clerk-fab-logo" src="/assets/images/clerk/clerk-logo.png" alt="" />';
  document.body.appendChild(fab);

  var panel = document.createElement('div');
  panel.id = 'clerkPanel';
  panel.className = 'clerk-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="clerk-head">' +
      '<div class="clerk-avatar">C</div>' +
      '<div class="clerk-headtxt"><b>Clerk AI</b><small>APALINK assistant · online</small></div>' +
      (window.speechSynthesis ? '<button class="clerk-hbtn" id="clerkSpeakBtn" type="button" title="Voice replies on/off">' + ICONS.soundOn + '</button>' : '') +
      '<button class="clerk-close" id="clerkClose" type="button" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="clerk-body" id="clerkBody"></div>' +
    '<div class="clerk-doc" id="clerkDoc" hidden><span>📄</span><span class="name" id="clerkDocName"></span><button type="button" id="clerkDocRemove" title="Remove file">✕</button></div>' +
    '<div class="clerk-suggests" id="clerkSuggests" hidden></div>' +
    '<div class="clerk-typing" id="clerkTyping" hidden><i></i><i></i><i></i> Clerk is thinking…</div>' +
    '<form class="clerk-input" id="clerkForm">' +
      '<input type="file" id="clerkFile" hidden accept=".pdf,.txt,.md,.csv,.json,.log,.html,.xml,.srt,.vtt,application/pdf,text/plain">' +
      '<button type="button" class="side" id="clerkAttach" title="Attach a PDF or text file — I can summarize it and answer questions about it">' + ICONS.attach + '</button>' +
      '<button type="button" class="side" id="clerkMic" title="Speak your question — I keep listening until you press again" hidden>' + ICONS.mic + '</button>' +
      '<input id="clerkText" type="text" placeholder="Ask Clerk about APALINK…" autocomplete="off" maxlength="2000" aria-label="Message Clerk AI">' +
      '<button type="submit" aria-label="Send" data-icon-wrap><span data-icon="send"></span></button>' +
    '</form>';
  document.body.appendChild(panel);
  if (NN.paintIcons) NN.paintIcons(panel);
  if (NN.paintIcons) NN.paintIcons(fab);

  var body = document.getElementById('clerkBody');
  var form = document.getElementById('clerkForm');
  var input = document.getElementById('clerkText');
  var typing = document.getElementById('clerkTyping');
  var sendBtn = form.querySelector('button[type="submit"]');

  // ---------- Voice (text-to-speech) & attached document state ----------
  var TTS_OK = 'speechSynthesis' in window;
  var speakOn = false;
  try { speakOn = localStorage.getItem('clerk.voice.v1') === '1'; } catch (e) {}
  var currentDoc = null; // { name, text } — stays attached for follow-up questions

  function pickVoice() {
    if (!TTS_OK) return null;
    var voices = speechSynthesis.getVoices();
    var pref = voices.filter(function (v) { return /en[-_](US|GB)/i.test(v.lang); });
    var best = null;
    for (var i = 0; i < pref.length; i++) {
      if (/Google US English|Natural|Aria|Jenny|Zira|Samantha/i.test(pref[i].name)) { best = pref[i]; break; }
    }
    return best || pref[0] || voices[0] || null;
  }
  // Rough Kinyarwanda detector — enough to pick the right speech engine behaviour.
  var RW_WORDS = /\b(urakoze|murakoze|muraho|amakuru|ni meze|yego|oyego|ndabasha|ubishobora|murabwire|ubutumwa|igitekerezo|ishuri|umunyeshuri|umwarimu|amasomo|isomo|umwana|umubyeyi|murakoze cyane|urabesa|ibitekerezo|birakwiye|neza|cyane|murbe|mwezi|itangwa|amafaranga)\b/i;
  function speak(text) {
    if (!TTS_OK || !speakOn) return;
    var plain = String(text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return;
    // Pronounce the platform name the way Rwandans say it.
    plain = plain.replace(/apalink/gi, 'Apa-Link');
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(plain);
      var isRw = RW_WORDS.test(plain);
      if (isRw) {
        // Kinyarwanda: use a rw voice if the device has one; otherwise the default voice reads it as written.
        u.lang = 'rw-RW';
        var rw = speechSynthesis.getVoices().filter(function (v) { return /^rw/i.test(v.lang); })[0];
        if (rw) u.voice = rw; else { var dv = pickVoice(); if (dv) u.voice = dv; }
      } else {
        var v = pickVoice();
        if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      }
      u.rate = 1.02; u.pitch = 1;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function stopSpeaking() { if (TTS_OK) { try { speechSynthesis.cancel(); } catch (e) {} } }
  function refreshSpeakBtn() {
    var b = document.getElementById('clerkSpeakBtn');
    if (!b) return;
    b.innerHTML = speakOn ? ICONS.soundOn : ICONS.soundOff;
    b.title = speakOn ? 'Voice replies are ON — click to mute' : 'Voice replies are OFF — click to hear Clerk speak';
    b.classList.toggle('off', !speakOn);
  }
  function setDoc(doc) {
    currentDoc = doc;
    var chip = document.getElementById('clerkDoc');
    var nameEl = document.getElementById('clerkDocName');
    if (!chip || !nameEl) return;
    if (doc) { nameEl.textContent = doc.name + ' (' + Math.round((doc.text || '').length / 100) / 10 + 'k chars read)'; chip.hidden = false; }
    else { chip.hidden = true; nameEl.textContent = ''; }
  }

  function scrollBottom() { body.scrollTop = body.scrollHeight; }
  // Escape HTML, then render the AI's light markdown (**bold**, *italic*) safely.
  function fmt(text) {
    var s = String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
    return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  }
  function addBubble(role, text, isError) {
    var el = document.createElement('div');
    el.className = 'clerk-msg ' + (role === 'user' ? 'user' : 'clerk' + (isError ? ' error' : ''));
    el.innerHTML = fmt(text);
    body.appendChild(el);
    scrollBottom();
  }
  function renderHistory() {
    body.innerHTML = '';
    messages.forEach(function (m) { addBubble(m.role, m.text); });
  }
  function setTyping(on) {
    typing.hidden = !on;
    sendBtn.disabled = on;
    scrollBottom();
  }

  // ---------- Suggestion chips (fresh conversations only) ----------
  var SUGGESTIONS = {
    student: [
      'How do I download a note?',
      'When is my timetable updated?',
      'How do I join a live class?',
    ],
    teacher: [
      'How do I publish a note?',
      'How do I start a live class?',
      'How do I see download stats?',
    ],
    admin: [
      'How do I assign a teacher?',
      'How do I read the reports?',
      'How do I add an announcement?',
    ],
    default: [
      'What is APALINK?',
      'How do I download notes?',
    ],
  };
  function renderSuggests() {
    var box = document.getElementById('clerkSuggests');
    if (!box) return;
    // Only offer chips when the conversation is still fresh (just the greeting).
    var fresh = messages.length <= 1;
    if (open && fresh) { box.hidden = false; } else { box.hidden = true; return; }
    var list = SUGGESTIONS[(identityKey || '').split(':')[0]] || SUGGESTIONS.default;
    box.innerHTML = '';
    list.slice(0, 3).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'clerk-suggest';
      b.textContent = q;
      b.addEventListener('click', function () { input.value = q; doSend(); });
      box.appendChild(b);
    });
  }

  // ---------- Greeting ----------
  var greeted = false;
  function greet(name) {
    if (greeted) return;
    greeted = true;
    var hi = name ? ('Hi ' + name + ', how can I help you today?') : 'Hi there, how can I help you today?';
    messages.push({ role: 'clerk', text: hi });
    save();
    addBubble('clerk', hi);
  }

  // ---------- Open / close ----------
  var open = false;
  fab.addEventListener('click', function () {
    open = !open;
    panel.hidden = !open;
    if (open) {
      renderHistory();
      if (!messages.length) {
        setTyping(true);
        mePromise.then(function (r) {
          setTyping(false);
          var name = (r && r.ok && r.data && r.data.user && String(r.data.user.fullName || '').split(/\s+/)[0]) || null;
          greet(name);
          renderSuggests();
        });
      } else {
        scrollBottom();
        renderSuggests();
      }
      setTimeout(function () { input.focus(); }, 60);
    }
  });
  document.getElementById('clerkClose').addEventListener('click', function () {
    open = false;
    panel.hidden = true;
    stopSpeaking();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) { open = false; panel.hidden = true; stopSpeaking(); }
  });

  // ---------- Ask ----------
  function doSend() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    stopSpeaking();
    var suggests = document.getElementById('clerkSuggests');
    if (suggests) suggests.hidden = true;
    messages.push({ role: 'user', text: text });
    save();
    addBubble('user', text);
    setTyping(true);
    NN.api('/api/clerk', {
      method: 'POST',
      body: JSON.stringify({
        message: text,
        history: messages.slice(-11, -1).map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text }; }),
        page: location.pathname,
        doc: currentDoc ? { name: currentDoc.name, text: currentDoc.text } : undefined,
      }),
    }).then(function (r) {
      setTyping(false);
      if (!r.ok) {
        var err = (r.data && r.data.error) || 'Something went wrong — please try again.';
        messages.push({ role: 'clerk', text: err });
        save();
        addBubble('clerk', err, true);
      } else {
        messages.push({ role: 'clerk', text: r.data.reply });
        save();
        addBubble('clerk', r.data.reply);
        speak(r.data.reply);
      }
    }).catch(function () {
      setTyping(false);
      var err = 'Clerk AI could not reach the server. Please try again.';
      messages.push({ role: 'clerk', text: err });
      save();
      addBubble('clerk', err, true);
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    doSend();
  });

  // ---------- Attach a document (📎) ----------
  var fileInput = document.getElementById('clerkFile');
  var attachBtn = document.getElementById('clerkAttach');
  attachBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      addBubble('clerk', 'That file is too large (max 15 MB). 😅', true);
      return;
    }
    stopSpeaking();
    setTyping(true);
    var fd = new FormData();
    fd.append('file', f);
    fetch('/api/clerk/file', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        setTyping(false);
        if (!r.ok) {
          addBubble('clerk', (r.d && r.d.error) || 'I could not read that file. 😅', true);
          return;
        }
        currentDoc = { name: r.d.name, text: r.d.text };
        setDoc(currentDoc);
        messages.push({ role: 'clerk', text: r.d.summary });
        save();
        addBubble('clerk', r.d.summary);
        speak(r.d.summary);
      })
      .catch(function () {
        setTyping(false);
        addBubble('clerk', 'I could not reach the server to read that file. 😅', true);
      });
  });
  document.getElementById('clerkDocRemove').addEventListener('click', function () { setDoc(null); });

  // ---------- Voice replies (🔊) ----------
  var speakBtn = document.getElementById('clerkSpeakBtn');
  if (speakBtn) {
    refreshSpeakBtn();
    speakBtn.addEventListener('click', function () {
      speakOn = !speakOn;
      try { localStorage.setItem('clerk.voice.v1', speakOn ? '1' : '0'); } catch (e) {}
      if (!speakOn) stopSpeaking();
      else speak('Voice replies are on. 👋');
      refreshSpeakBtn();
    });
    if (speakOn) speak('Clerk AI here. Voice replies are on.');
  }

  // ---------- Speak your question (🎤 → continuous, stops only when you press again) ----------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var micBtn = document.getElementById('clerkMic');
  // Voice input mishears the brand; normalise common variants back to APALINK.
  function fixTranscript(t) {
    return String(t).replace(/\b(apa[\s-]*link|appa[\s-]*link|apalink|a[\s-]*pa[\s-]*link|apalinks)\b/gi, 'APALINK');
  }
  if (SR && micBtn) {
    micBtn.hidden = false;
    var rec = null, listening = false, wantListening = false, finalBuf = '';
    function micIdle() {
      listening = false; wantListening = false;
      micBtn.classList.remove('listening');
      micBtn.title = 'Speak your question — I keep listening until you press again';
    }
    micBtn.addEventListener('click', function () {
      if (listening) { wantListening = false; try { rec.stop(); } catch (e) {} return; }
      wantListening = true;
      finalBuf = input.value ? input.value.trim() + ' ' : '';
      rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;        // keep going through pauses until the user stops it
      rec.interimResults = true;    // show words as they are spoken
      rec.maxAlternatives = 1;
      rec.onresult = function (ev) {
        var fin = '', interim = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (r.isFinal) fin += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        if (fin) finalBuf += fixTranscript(fin);
        input.value = (finalBuf + fixTranscript(interim)).trim();
      };
      rec.onend = function () {
        // Browser cut us off (silence timeout) — restart unless the user stopped it.
        if (wantListening) { try { rec.start(); return; } catch (e) {} }
        micIdle();
      };
      rec.onerror = function (ev) {
        if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) wantListening = false;
      };
      try { rec.start(); listening = true; micBtn.classList.add('listening'); micBtn.title = 'Listening… press 🎙 again to stop'; } catch (e) { micIdle(); }
    });
  }
})();
