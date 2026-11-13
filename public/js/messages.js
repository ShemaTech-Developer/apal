// APALINK messages — find people, direct chats, presence, seen state and message delete.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function timeOf(s) { return String(s || '').replace('T', ' ').slice(5, 16); }
  function dayOf(s) { return String(s || '').replace('T', ' ').slice(0, 10); }
  function initial(name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; }
  function detailOf(u) {
    if (!u) return '';
    return u.role === 'student'
      ? [u.department, u.level, u.className ? 'Class ' + u.className : ''].filter(Boolean).join(' · ')
      : 'Teacher';
  }
  function presenceDot(online) { return '<span class="presence-dot' + (online ? ' on' : '') + '" aria-hidden="true"></span>'; }
  function fmtSize(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function isImage(name, mime) {
    return String(mime || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(String(name || ''));
  }
  function fileBadge(name) {
    var ext = (String(name || '').split('.').pop() || 'file').toUpperCase();
    if (ext.length > 5) ext = 'FILE';
    return '<span class="att-ic" aria-hidden="true">' + esc(ext) + '</span>';
  }

  var currentId = null, currentOther = null, currentAdmin = false;
  var pollTimer = null, stream = null, me = null, blocked = new Set();
  var adminThread = { messages: [], unread: 0 };
  var lastMarkedIncomingId = 0, dirTimer = null;
  var pendingFiles = [];
  var MAX_FILES = 5, MAX_SIZE = 20 * 1024 * 1024;
  var ALLOWED_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|json|zip|png|jpe?g|gif|webp|mp3|mp4)$/i;

  // ---------------- Find people ----------------
  function loadDirectory() {
    var q = $('dirSearch');
    var params = new URLSearchParams();
    if (q && q.value.trim()) params.set('q', q.value.trim());
    fetch('/api/messages/directory' + (params.toString() ? '?' + params : ''))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var box = $('directory');
        if (!Array.isArray(list)) list = [];
        if (!list.length) {
          box.innerHTML = '<div class="people-empty"><span>' + NN.icon('search', 26) + '</span><p>No one found. Try another name or username.</p></div>';
          return;
        }
        box.innerHTML = list.slice(0, 12).map(function (u) {
          var key = u.role + ':' + u.id;
          var isBlocked = blocked.has(key);
          return '<button type="button" class="person-item' + (isBlocked ? ' is-blocked' : '') + '" data-msgwith="' + key + '"' + (isBlocked ? ' disabled' : '') + '>' +
            '<span class="avatar-wrap"><span class="avatar">' + esc(initial(u.fullName)) + '</span>' + presenceDot(u.online) + '</span>' +
            '<span class="person-copy"><b>' + esc(u.fullName) + '</b><small>' + esc(u.username) + ' · ' + esc(detailOf(u)) + '</small>' +
            '<small class="person-status' + (u.online ? ' on' : '') + '">' + (u.online ? '● Active now' : '○ Offline') + '</small></span>' +
            (isBlocked ? '<span class="badge">Blocked</span>' : '<span class="person-go">Message →</span>') +
            '</button>';
        }).join('');
      });
  }

  // ---------------- Conversations ----------------
  function adminItemHtml() {
    if (!adminThread.messages.length) return '';
    var last = adminThread.messages[adminThread.messages.length - 1];
    return '<button type="button" class="conv-item admin-conv' + (currentAdmin ? ' active' : '') + '" data-admin-thread="1">' +
      '<span class="avatar-wrap"><span class="avatar admin-avatar">' + NN.icon('school') + '</span></span>' +
      '<span class="conv-copy"><b>School Administration</b><span class="preview">' + esc((last.mine ? 'You: ' : '') + last.body) + '</span>' +
      '<small class="conv-sub">Official messages</small></span>' +
      '<span class="conv-side">' + (adminThread.unread ? '<span class="unread-dot">' + adminThread.unread + '</span>' : '') +
      '<span class="time">' + esc(timeOf(last.createdAt)) + '</span></span></button>';
  }

  function convItemHtml(c) {
    var other = c.other || {};
    var sub = detailOf(other);
    var preview = c.lastMessage
      ? ((c.lastMessage.fromMe ? 'You: ' : '') + (c.lastMessage.body || (c.lastMessage.attachment ? 'Attachment · ' + c.lastMessage.attachment : '')))
      : sub;
    var ticks = c.lastMessage && c.lastMessage.fromMe ? (c.lastMessage.seen ? ' ✓✓' : ' ✓') : '';
    return '<button type="button" class="conv-item' + (c.id === currentId && !currentAdmin ? ' active' : '') + '" data-conv="' + c.id + '">' +
      '<span class="avatar-wrap"><span class="avatar">' + esc(initial(other.fullName)) + '</span>' + presenceDot(other.online) + '</span>' +
      '<span class="conv-copy"><b>' + esc(other.fullName || 'Unknown') + '</b>' +
      '<span class="preview">' + esc(preview) + ticks + '</span><small class="conv-sub">' + esc(sub) + '</small></span>' +
      '<span class="conv-side">' + (c.unread ? '<span class="unread-dot">' + c.unread + '</span>' : '') +
      '<span class="time">' + esc(timeOf(c.lastMessage ? c.lastMessage.createdAt : c.createdAt)) + '</span></span></button>';
  }

  function loadConversations() {
    fetch('/api/messages/conversations')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) list = [];
        var box = $('convList');
        var adminItem = adminItemHtml();
        $('chatCount').textContent = String(list.length + (adminThread.messages.length ? 1 : 0));
        if (!list.length) {
          box.innerHTML = adminItem || '<div class="chats-empty"><span>' + NN.icon('message-square', 26) + '</span><p>No chats yet. Find someone above to start talking.</p></div>';
        } else {
          box.innerHTML = adminItem + list.map(convItemHtml).join('');
        }
        if (currentId && !currentAdmin) {
          var active = list.find(function (x) { return String(x.id) === String(currentId); });
          if (active && active.other) updateChatPresence(active.other);
        }
        var ai = box.querySelector('[data-admin-thread]');
        if (ai) ai.addEventListener('click', openAdminThread);
        box.querySelectorAll('[data-conv]').forEach(function (el) {
          el.addEventListener('click', function () {
            var c = list.find(function (x) { return String(x.id) === el.dataset.conv; });
            if (c) openConversation(c);
          });
        });
      });
  }

  // ---------------- Chat header + presence ----------------
  function updateChatPresence(other) {
    var detail = detailOf(other);
    var online = !!(other && other.online);
    $('chatStatus').textContent = (detail ? detail + ' · ' : '') + (online ? 'Active now' : 'Offline');
    $('chatStatus').classList.toggle('online', online);
    var dot = $('chatDot');
    if (dot) { dot.hidden = false; dot.classList.toggle('on', online); }
  }

  function setAttachVisible(on) {
    var btn = $('attachBtn'), hint = $('attachHint');
    if (btn) btn.style.display = on ? '' : 'none';
    if (!on) clearPending();
    else renderPending();
    if (hint) hint.style.display = on ? '' : 'none';
  }

  function renderHeader(conv) {
    currentAdmin = false;
    currentOther = conv.other || null;
    var other = conv.other || {};
    $('chatAvatar').textContent = initial(other.fullName);
    $('chatTitle').textContent = other.fullName || 'Unknown';
    updateChatPresence(other);
    var blockedHere = blocked.has(other.role + ':' + other.id);
    $('blockBtn').textContent = blockedHere ? 'Unblock' : 'Block';
    $('blockBtn').style.display = currentOther ? '' : 'none';
    setAttachVisible(true);
  }

  function openConversation(conv) {
    currentId = conv.id;
    currentAdmin = false;
    lastMarkedIncomingId = 0;
    document.querySelector('.msg-layout').classList.add('mobile-chat');
    renderHeader(conv);
    loadMessages();
    loadConversations();
    var input = $('msgInput');
    if (input) input.focus();
  }

  // ---------------- Messages ----------------
  function markRead() {
    if (!currentId || currentAdmin) return;
    NN.api('/api/messages/conversations/' + currentId + '/read', { method: 'POST' }).then(function () {
      loadConversations();
    }).catch(function () {});
  }

  function loadMessages() {
    if (!currentId || currentAdmin) return;
    fetch('/api/messages/conversations/' + currentId + '/messages')
      .then(function (r) { return r.json(); })
      .then(function (msgs) {
        if (!Array.isArray(msgs)) msgs = [];
        var box = $('msgBody');
        var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
        var html = '', lastDay = '', maxIncoming = 0;
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i];
          var d = dayOf(m.createdAt);
          if (d !== lastDay) { html += '<div class="day-sep"><span>' + esc(d) + '</span></div>'; lastDay = d; }
          if (!m.mine && m.id > maxIncoming) maxIncoming = m.id;
          var status = m.mine
            ? '<span class="seen-mark' + (m.seen ? ' seen' : '') + '">' + (m.seen ? '✓✓ Seen' : '✓ Sent') + '</span>'
            : '';
          var action = m.mine
            ? '<button type="button" class="msg-act" data-delmsg="' + m.id + '" title="Delete this message" aria-label="Delete this message">' + NN.icon('trash-2') + '</button>'
            : '<button type="button" class="msg-act report" data-report="' + m.id + '">Report</button>';
          var atts = attachmentsHtml(m);
          var text = m.body ? '<span class="bubble-text">' + esc(m.body) + '</span>' : '';
          html += '<div class="bubble ' + (m.mine ? 'mine' : 'other') + (m.body || atts ? '' : ' only-stamp') + '" data-msg="' + m.id + '">' +
            atts + text +
            '<span class="stamp"><span class="msg-time">' + esc(timeOf(m.createdAt)) + '</span>' + status + action + '</span></div>';
        }
        box.innerHTML = msgs.length ? html : '<div class="empty msg-empty"><span class="big">' + NN.icon('message-square', 26) + '</span><h3>No messages yet</h3><p>Say hello and start the conversation.</p></div>';
        if (nearBottom) box.scrollTop = box.scrollHeight;
        if (maxIncoming && maxIncoming > lastMarkedIncomingId) {
          lastMarkedIncomingId = maxIncoming;
          markRead();
        }
      });
  }

  // ---------------- School Administration thread ----------------
  function loadAdminThread() {
    return fetch('/api/messages/admin-thread').then(function (r) { return r.json(); }).then(function (data) {
      adminThread = data || { messages: [], unread: 0 };
      if (currentAdmin) renderAdminMessages();
    }).catch(function () {});
  }

  function renderAdminMessages() {
    var box = $('msgBody');
    $('chatAvatar').innerHTML = NN.icon('school', 22);
    $('chatTitle').textContent = 'School Administration';
    $('chatStatus').textContent = 'Official messages from your school';
    $('chatStatus').classList.remove('online');
    var dot = $('chatDot'); if (dot) dot.hidden = true;
    if (!adminThread.messages.length) {
      box.innerHTML = '<div class="empty msg-empty"><span class="big">' + NN.icon('school', 26) + '</span><h3>No messages from administration yet</h3><p>Official notes from the school will appear here.</p></div>';
      return;
    }
    var html = '', lastDay = '';
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    for (var i = 0; i < adminThread.messages.length; i++) {
      var m = adminThread.messages[i];
      var d = dayOf(m.createdAt);
      if (d !== lastDay) { html += '<div class="day-sep"><span>' + esc(d) + '</span></div>'; lastDay = d; }
      var status = m.mine ? '<span class="seen-mark' + (m.seen ? ' seen' : '') + '">' + (m.seen ? '✓✓ Seen' : '✓ Sent') + '</span>' : '';
      html += '<div class="bubble ' + (m.mine ? 'mine' : 'other') + '">' +
        (!m.mine ? '<b class="bubble-author">School Administration</b>' : '') +
        '<span class="bubble-text">' + esc(m.body) + '</span>' +
        '<span class="stamp"><span class="msg-time">' + esc(timeOf(m.createdAt)) + '</span>' + status + '</span></div>';
    }
    box.innerHTML = html;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function openAdminThread() {
    currentAdmin = true; currentId = null; currentOther = null;
    lastMarkedIncomingId = 0;
    document.querySelector('.msg-layout').classList.add('mobile-chat');
    $('blockBtn').style.display = 'none';
    setAttachVisible(false); // attachments are only for direct conversations
    renderAdminMessages();
    fetch('/api/messages/admin-thread/read', { method: 'POST' }).then(function () {
      adminThread.unread = 0;
      loadAdminThread().then(loadConversations);
    });
  }

  async function startConversation(withRole, withId) {
    var r = await NN.api('/api/messages/conversations', { method: 'POST', body: JSON.stringify({ withRole: withRole, withId: withId }) });
    if (!r.ok) { alert(r.data.error || 'Could not start conversation.'); return; }
    openConversation(r.data);
  }

  // ---------------- Realtime + polling ----------------
  function startRealtime() {
    try {
      stream = new EventSource('/api/messages/stream', { withCredentials: true });
      stream.onmessage = function (e) {
        try { var data = JSON.parse(e.data); } catch (err) { return; }
        if (data.type === 'admin-message') { loadAdminThread().then(loadConversations); return; }
        if (data.type === 'message' || data.type === 'read' || data.type === 'unread' || data.type === 'notification' || data.type === 'message-delete') {
          loadConversations();
          if (currentId && !currentAdmin) loadMessages();
        }
      };
      stream.onerror = function () { /* polling fallback keeps everything fresh */ };
    } catch (e) {}
  }

  function loadBlocks() {
    return fetch('/api/messages/blocks').then(function (r) { return r.json(); }).then(function (list) {
      blocked = new Set(list.map(function (u) { return u.role + ':' + u.id; }));
    });
  }

  // ---------------- Composer attachments ----------------
  function renderPending() {
    var box = $('attachPreview');
    if (!box) return;
    box.hidden = pendingFiles.length === 0;
    box.innerHTML = pendingFiles.map(function (f, i) {
      return '<span class="file-chip">' + fileBadge(f.name) +
        '<span class="chip-copy"><b>' + esc(f.name) + '</b><small>' + fmtSize(f.size) + '</small></span>' +
        '<button type="button" class="chip-x" data-rmfile="' + i + '" aria-label="Remove ' + esc(f.name) + '">×</button></span>';
    }).join('');
    var hint = $('attachHint');
    if (hint) hint.textContent = pendingFiles.length
      ? pendingFiles.length + ' of ' + MAX_FILES + ' files ready · 20 MB each max'
      : 'Attach up to 5 files · images, PDF, Word, Excel, slides, ZIP · 20 MB each';
  }

  function addFiles(list) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (pendingFiles.length >= MAX_FILES) { alert('You can attach up to ' + MAX_FILES + ' files per message.'); break; }
      if (!ALLOWED_EXT.test(f.name)) { alert('That file type is not allowed: ' + f.name); continue; }
      if (f.size > MAX_SIZE) { alert('"' + f.name + '" is larger than 20 MB.'); continue; }
      if (pendingFiles.some(function (x) { return x.name === f.name && x.size === f.size; })) continue;
      pendingFiles.push(f);
    }
    renderPending();
  }

  function clearPending() { pendingFiles = []; renderPending(); }

  function attachmentsHtml(m) {
    var list = Array.isArray(m.attachments) ? m.attachments : [];
    if (!list.length) return '';
    return '<span class="att-files">' + list.map(function (a) {
      if (isImage(a.name, a.mime)) {
        return '<a class="att-img" href="' + esc(a.url) + '?inline=1" target="_blank" rel="noopener" title="' + esc(a.name) + '">' +
          '<img src="' + esc(a.url) + '?inline=1" alt="' + esc(a.name) + '" loading="lazy"></a>';
      }
      return '<a class="att-file" href="' + esc(a.url) + '" download title="Download ' + esc(a.name) + '">' +
        fileBadge(a.name) +
        '<span class="att-meta"><b>' + esc(a.name) + '</b><small>' + fmtSize(a.size) + '</small></span></a>';
    }).join('') + '</span>';
  }

  // ---------------- Page wiring ----------------
  document.addEventListener('DOMContentLoaded', function () {
    NN.api('/api/auth/me').then(function (r) {
      if (!r.ok) { window.location.href = 'student-login.html'; return; }
      me = r.data.user;
      loadBlocks().then(function () {
        loadAdminThread().then(function () { loadConversations(); });
        loadDirectory();
        startRealtime();
        pollTimer = setInterval(function () {
          loadConversations();
          if (currentId && !currentAdmin) loadMessages();
          loadAdminThread();
        }, 5000);
        setInterval(loadDirectory, 15000);

        // Deep link from global search: /pages/messages.html?with=role:id
        var withParam = new URLSearchParams(window.location.search).get('with');
        if (withParam && withParam.indexOf(':') > -1) {
          var parts = withParam.split(':');
          if (['student', 'teacher'].includes(parts[0]) && Number(parts[1])) {
            startConversation(parts[0], Number(parts[1]));
            try { history.replaceState({}, '', window.location.pathname); } catch (e) {}
          }
        }
      });

      $('dirSearch').addEventListener('input', function () {
        clearTimeout(dirTimer);
        dirTimer = setTimeout(loadDirectory, 180);
      });

      $('directory').addEventListener('click', function (e) {
        var person = e.target.closest('[data-msgwith]');
        if (!person || person.disabled) return;
        var p = person.dataset.msgwith.split(':');
        startConversation(p[0], Number(p[1]));
      });

      // Inline delete (own messages) and report (received messages).
      $('msgBody').addEventListener('click', function (e) {
        var del = e.target.closest('[data-delmsg]');
        if (del) {
          var hasAtt = !!del.closest('.bubble').querySelector('.att-files');
          var ask = 'Delete this message for everyone?' + (hasAtt ? ' Its attached files will be removed too.' : '');
          if (!confirm(ask)) return;
          NN.api('/api/messages/conversations/' + currentId + '/messages/' + del.dataset.delmsg, { method: 'DELETE' })
            .then(function (res) {
              if (!res.ok) return alert(res.data.error || 'Could not delete this message.');
              loadMessages(); loadConversations();
            });
          return;
        }
        var rep = e.target.closest('[data-report]');
        if (rep) {
          var reason = prompt('Why are you reporting this message?');
          if (!reason) return;
          NN.api('/api/messages/report', { method: 'POST', body: JSON.stringify({ messageId: Number(rep.dataset.report), reason: reason }) })
            .then(function () { alert('Thanks — the administrator will review it.'); });
        }
      });

      // Attachments: pick files, preview chips, remove before sending.
      if ($('attachBtn')) {
        setAttachVisible(false);
        $('attachBtn').addEventListener('click', function () { $('fileInput').click(); });
        $('fileInput').addEventListener('change', function () { addFiles(this.files || []); this.value = ''; });
        $('attachPreview').addEventListener('click', function (e) {
          var x = e.target.closest('[data-rmfile]');
          if (!x) return;
          pendingFiles.splice(Number(x.dataset.rmfile), 1);
          renderPending();
        });
      }

      $('sendForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var ta = $('msgInput');
        var body = ta.value.trim();
        if (!body && !pendingFiles.length) return;
        if (!currentId && !currentAdmin) { alert('Choose a conversation first.'); return; }
        if (currentAdmin && pendingFiles.length) { alert('Attachments can only be added to a direct conversation.'); return; }
        var btn = $('sendBtn');
        var hasFiles = pendingFiles.length > 0;
        btn.disabled = true; btn.textContent = hasFiles ? 'Uploading…' : 'Sending…';
        var url = currentAdmin ? '/api/messages/admin-thread' : '/api/messages/conversations/' + currentId + '/messages';
        var r;
        try {
          if (currentAdmin || !hasFiles) {
            r = await NN.api(url, { method: 'POST', body: JSON.stringify({ body: body }) });
          } else {
            var fd = new FormData();
            fd.append('body', body);
            pendingFiles.forEach(function (f) { fd.append('files', f, f.name); });
            var resp = await fetch(url, { method: 'POST', body: fd });
            var data = null; try { data = await resp.json(); } catch (err) {}
            r = { ok: resp.ok, status: resp.status, data: data || {} };
          }
        } finally {
          btn.disabled = false; btn.textContent = 'Send';
        }
        if (!r.ok) { alert(r.data.error || 'Could not send.'); return; }
        ta.value = ''; ta.style.height = 'auto';
        clearPending();
        if (currentAdmin) loadAdminThread().then(loadConversations);
        else { loadMessages(); loadConversations(); }
      });

      $('msgInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('sendForm').requestSubmit(); }
      });
      $('msgInput').addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      $('blockBtn').addEventListener('click', function () {
        if (currentAdmin || !currentOther) return;
        var key = currentOther.role + ':' + currentOther.id;
        var unblocking = blocked.has(key);
        if (!unblocking && !confirm('Block ' + currentOther.fullName + '? You will not be able to message each other.')) return;
        fetch('/api/messages/block', { method: unblocking ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withRole: currentOther.role, withId: currentOther.id }) })
          .then(function () {
            loadBlocks().then(function () {
              loadDirectory(); loadConversations();
              $('blockBtn').textContent = unblocking ? 'Block' : 'Unblock';
            });
          });
      });

      $('backBtn').addEventListener('click', function () {
        document.querySelector('.msg-layout').classList.remove('mobile-chat');
        currentId = null; currentAdmin = false; currentOther = null; lastMarkedIncomingId = 0;
        clearPending();
        loadConversations();
      });

      window.addEventListener('focus', function () {
        loadConversations();
        if (currentId && !currentAdmin) loadMessages();
        loadDirectory();
      });
    });
  });
})();
