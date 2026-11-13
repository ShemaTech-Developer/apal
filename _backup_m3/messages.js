// APALINK messages — conversation list, directory, SSE realtime + polling fallback.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function timeOf(s) { return String(s || '').replace('T', ' ').slice(5, 16); }

  var currentId = null, pollTimer = null, stream = null, me = null;

  function loadConversations() {
    var params = new URLSearchParams();
    var q = $('convSearch'); if (q && q.value.trim()) params.set('q', q.value.trim());
    var filter = $('inboxFilter'); if (filter && filter.value) params.set('filter', filter.value);
    var dept = $('deptFilter'); if (dept && dept.value) params.set('department', dept.value);
    fetch('/api/messages/conversations' + (params.toString() ? '?' + params : ''))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var box = $('convList');
        if (!list.length) { box.innerHTML = '<div class="empty"><span class="big">💬</span><h3>No conversations yet</h3><p>Find a classmate or teacher and say hello.</p></div>'; return; }
        box.innerHTML = list.map(function (c) {
          var other = c.other || {};
          var sub = other.role === 'student' ? [other.department, other.className ? 'Class ' + other.className : ''].filter(Boolean).join(' · ') : 'Teacher';
          return '<div class="conv-item' + (c.id === currentId ? ' active' : '') + '" data-conv="' + c.id + '">' +
            '<div class="avatar">' + esc((other.fullName || '?').charAt(0)) + '</div>' +
            '<div style="min-width:0"><b>' + esc(other.fullName || 'Unknown') + '</b><div class="preview">' + esc(c.lastMessage ? c.lastMessage.body : sub) + '</div><small class="muted">' + esc(sub) + '</small></div>' +
            '<span class="time">' + esc(timeOf(c.lastMessage ? c.lastMessage.createdAt : c.createdAt)) + '</span>' +
            (c.unread ? '<span class="unread-dot">' + c.unread + '</span>' : '') + '</div>';
        }).join('');
        box.querySelectorAll('[data-conv]').forEach(function (el) {
          el.addEventListener('click', function () { openConversation(Number(el.dataset.conv)); });
        });
      });
  }

  function loadMessages() {
    if (!currentId) return;
    fetch('/api/messages/conversations/' + currentId + '/messages')
      .then(function (r) { return r.json(); })
      .then(function (msgs) {
        var box = $('msgBody');
        box.innerHTML = msgs.length ? msgs.map(function (m) {
          return '<div class="bubble ' + (m.mine ? 'mine' : 'other') + '"><span>' + esc(m.body) + '</span><span class="stamp">' + esc(timeOf(m.createdAt)) + (m.mine ? ' · ✓✓' : '') +
            ' <button class="link" data-report="' + m.id + '" style="font-size:.68rem">Report</button></span></div>';
        }).join('') : '<div class="empty"><h3>No messages yet</h3><p>Say hello 👋</p></div>';
        box.scrollTop = box.scrollHeight;
        box.querySelectorAll('[data-report]').forEach(function (b) {
          b.addEventListener('click', function () {
            var reason = prompt('Why are you reporting this message?');
            if (!reason) return;
            fetch('/api/messages/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: Number(b.dataset.report), reason: reason }) })
              .then(function () { alert('Thanks — a teacher or the administrator will review it.'); });
          });
        });
        fetch('/api/messages/conversations/' + currentId + '/read', { method: 'POST' });
      });
  }

  function openConversation(id) {
    currentId = id;
    document.querySelector('.msg-layout').classList.add('mobile-chat');
    loadMessages(); loadConversations();
  }

  async function startConversation(withRole, withId) {
    var r = await NN.api('/api/messages/conversations', { method: 'POST', body: JSON.stringify({ withRole: withRole, withId: withId }) });
    if (!r.ok) { alert(r.data.error || 'Could not start conversation.'); return; }
    openConversation(r.data.id);
  }

  function loadDirectory() {
    var q = $('dirSearch'); var params = new URLSearchParams();
    if (q && q.value.trim()) params.set('q', q.value.trim());
    fetch('/api/messages/directory' + (params.toString() ? '?' + params : ''))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        $('directory').innerHTML = list.length ? list.map(function (u) {
          var detail = u.role === 'student' ? [u.department, u.level, u.className ? 'Class ' + u.className : ''].filter(Boolean).join(' · ') : 'Teacher';
          return '<div class="conv-item"><div class="avatar">' + esc((u.fullName || '?').charAt(0)) + '</div>' +
            '<div style="min-width:0"><b>' + esc(u.fullName) + '</b><small class="muted" style="display:block">' + esc(u.username) + ' · ' + esc(detail) + '</small></div>' +
            '<button class="btn btn-primary" style="margin-left:auto;padding:8px 12px" data-msgwith="' + u.role + ':' + u.id + '">Message</button></div>';
        }).join('') : '<div class="empty"><span class="big">🔎</span><h3>No one found</h3><p>Try a name or username.</p></div>';
        $('directory').querySelectorAll('[data-msgwith]').forEach(function (b) {
          b.addEventListener('click', function () { var p = b.dataset.msgwith.split(':'); startConversation(p[0], Number(p[1])); });
        });
      });
  }

  function startRealtime() {
    try {
      stream = new EventSource('/api/messages/stream', { withCredentials: true });
      stream.onmessage = function (e) {
        try { var data = JSON.parse(e.data); } catch (err) { return; }
        if (data.type === 'message' || data.type === 'read') { loadConversations(); if (currentId) loadMessages(); }
        if (data.type === 'unread' || data.type === 'notification') { /* badges refresh on next nav */ }
      };
      stream.onerror = function () { /* graceful fallback below */ };
    } catch (e) {}
  }
  function startPollingFallback() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { loadConversations(); if (currentId) loadMessages(); }, 5000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    NN.api('/api/auth/me').then(function (r) {
      if (!r.ok) { window.location.href = 'student-login.html'; return; }
      me = r.data.user;
      // Teacher inbox department filter from real departments.
      NN.api('/api/auth/departments').then(function (d) {
        var sel = $('deptFilter');
        if (sel && me.role === 'teacher') { sel.style.display = ''; d.data.forEach(function (x) { var o = document.createElement('option'); o.value = x.id; o.textContent = x.name; sel.appendChild(o); }); }
        else if (sel) sel.style.display = 'none';
      });
      loadConversations(); loadDirectory(); startRealtime(); startPollingFallback();
      ['convSearch', 'dirSearch', 'inboxFilter', 'deptFilter'].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener('input', function () { loadConversations(); loadDirectory(); });
        el.addEventListener('change', function () { loadConversations(); });
      });
      $('sendForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var ta = $('msgInput'); var body = ta.value.trim(); if (!body) return;
        if (!currentId) { alert('Choose a conversation first.'); return; }
        var btn = $('sendBtn'); btn.disabled = true; btn.textContent = 'Sending…';
        var r = await NN.api('/api/messages/conversations/' + currentId + '/messages', { method: 'POST', body: JSON.stringify({ body: body }) });
        btn.disabled = false; btn.textContent = 'Send';
        if (!r.ok) { alert(r.data.error || 'Could not send.'); return; }
        ta.value = ''; loadMessages(); loadConversations();
      });
      $('backBtn').addEventListener('click', function () {
        document.querySelector('.msg-layout').classList.remove('mobile-chat');
        currentId = null; loadConversations();
      });
    });
  });
})();
