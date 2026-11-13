// APALINK E-Class room — live video teaching with a WebRTC mesh.
// Signaling travels over SSE (server → client) and POST (client → server);
// camera/mic permission is requested at join time.
(function () {
  var roomId = Number(new URLSearchParams(location.search).get('id'));
  var me = null, current = null, backHref = '/index.html', bellHref = '/pages/notifications.html';
  var localStream = null, screenStream = null, videoSender = null;
  var pcs = new Map();          // 'role:id' -> RTCPeerConnection
  var es = null;                // EventSource
  var micOn = true, camOn = true, sharing = false;
  var rosterTimer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function keyOf(role, id) { return role + ':' + id; }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function roleBadge(role) { return role === 'admin' ? 'Admin' : role === 'teacher' ? 'Teacher' : ''; }
  function timeHM(s) { var d = new Date(String(s || '').replace(' ', 'T') + (String(s || '').indexOf('Z') > -1 ? '' : '')); if (isNaN(d)) return String(s || ''); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  var rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // ---------- Toast / hint ----------
  function flash(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:60;background:#111A2E;border:1px solid rgba(255,255,255,.18);color:#E9EFF9;padding:10px 16px;border-radius:12px;font-size:.85rem;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // ---------- Back navigation ----------
  function goBack() { window.location.href = backHref; }
  $('leaveBtn').addEventListener('click', function () {
    NN.api('/api/eclasses/' + roomId + '/leave', { method: 'POST' }).catch(function () {}).then(goBack);
  });
  $('endCardBack').addEventListener('click', goBack);

  // ---------- Boot ----------
  if (!roomId || !window.NN) { showFatal('Class not found.'); return; }

  NN.api('/api/auth/me').then(function (r) {
    if (!r.ok || !r.data || !r.data.user) { showFatal('Please sign in first.'); return; }
    me = r.data.user;
    backHref = me.role === 'admin' ? '/pages/admin/classes.html' : me.role === 'teacher' ? '/pages/teacher/eclass.html' : '/pages/student/my-class.html';
    bellHref = me.role === 'admin' ? '/pages/admin/notifications.html' : '/pages/notifications.html';
    $('bellBtn').setAttribute('href', bellHref);
    // Chip
    $('topUserName').textContent = me.fullName || me.username || 'Account';
    $('topUserRole').textContent = me.role === 'admin' ? 'Administrator' : me.role === 'teacher' ? 'Teacher' : 'Student';
    if (me.avatar) {
      var img = document.createElement('img');
      img.src = '/api/settings/avatar/' + encodeURIComponent(me.avatar);
      img.alt = me.fullName || '';
      img.onerror = function () { $('topAvatar').textContent = initials(me.fullName || me.username); };
      $('topAvatar').textContent = ''; $('topAvatar').appendChild(img);
    } else {
      $('topAvatar').textContent = initials(me.fullName || me.username);
    }
    $('topAvatar').style.cssText += ';width:40px;height:40px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font-weight:800';
    // Bell badge
    NN.api('/api/notifications').then(function (n) {
      var c = (n.data && (n.data.unread || (n.data.notifications || []).filter(function (x) { return !x.isRead; }).length)) || 0;
      if (c > 0) { var b = $('bellBadge'); b.hidden = false; b.textContent = c; }
    }).catch(function () {});
    join();
  }).catch(function () { showFatal('Could not reach the server.'); });

  function showFatal(msg) {
    var g = $('videoGrid');
    if (g) g.innerHTML = '<div class="eclass-empty">' + esc(msg) + '</div>';
    $('rcTitle').textContent = 'Live class';
    $('rcSub').textContent = 'APALINK E-Class';
    ['micToggle', 'camToggle', 'screenShare', 'endClassBtn', 'chatSend'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
  }

  function join() {
    NN.api('/api/eclasses/' + roomId + '/join', { method: 'POST' }).then(function (r) {
      if (!r.ok) {
        var err = (r.data && r.data.error) || 'This class is not available.';
        var code = r.status || 0;
        var errCode = (r.data && r.data.code) || '';
        if (code === 400 && /ended/i.test(err)) return showEndCard('Class ended', 'The teacher has ended this live class.');
        if (errCode === 'early') return showEndCard('Class not started yet', err);
        if (errCode === 'late_end') return showEndCard('Class time is over', err);
        if (code === 403 && /removed/i.test(err)) return showEndCard('Removed from class', 'The teacher removed you from this class.');
        if (code === 404) return showFatal('This class could not be found.');
        showFatal(err);
        return;
      }
      if (r.data && r.data.pending) return waitApproval(r.data);
      start();
    }).catch(function () { showFatal('Could not reach the server.'); });
  }

  // ---- Late join: student sent a request, waits for the teacher's allow/deny ----
  var pollTimer = null;
  function waitApproval(info) {
    var g = $('videoGrid');
    if (g) g.innerHTML = '<div class="eclass-empty" id="waitingApproval">' +
      '<div style="font-size:2.2rem">⏳</div>' +
      '<h3 style="margin:8px 0 4px">Request sent — you are marked late</h3>' +
      '<p style="max-width:420px">The class started ' + esc(String(info.minutesLate || 0)) + ' minutes ago, so your join needs the teacher&#39;s approval. Please wait here…</p>' +
      '<small class="muted">You will enter automatically when the teacher allows you.</small></div>';
    flash('⏳ Join request sent to the teacher.');
    pollTimer = setInterval(function () {
      NN.api('/api/eclasses/' + roomId + '/mystatus').then(function (r) {
        if (!r.ok) return;
        var st = r.data && r.data.status;
        if (st === 'joined') {
          clearInterval(pollTimer); pollTimer = null;
          var g2 = $('videoGrid'); if (g2) g2.innerHTML = '';
          start();
        } else if (st === 'denied') {
          clearInterval(pollTimer); pollTimer = null;
          showEndCard('Request denied', 'The teacher denied your request to join this class. You cannot enter.');
        } else if (r.data && r.data.classStatus === 'ended') {
          clearInterval(pollTimer); pollTimer = null;
          showEndCard('Class ended', 'The teacher has ended this live class.');
        }
      }).catch(function () {});
    }, 4000);
  }

  function start() {
    NN.api('/api/eclasses/' + roomId).then(function (r) {
      if (!r.ok) { showFatal((r.data && r.data.error) || 'Class not found.'); return; }
      current = r.data;
      document.title = current.title + ' — Live class';
      renderHeader();
      var canManage = (me.role === 'admin' || (me.role === 'teacher' && current.teacher && current.teacher.id === me.id));
      $('endClassBtn').hidden = !canManage || current.status !== 'live';
      $('screenShare').hidden = !(me.role === 'teacher' && current.teacher.id === me.id) || current.status !== 'live';
      renderRoster(current.participants);
      loadChat();
      getMedia().then(function () {
        connectSSE();
      }, function () {
        flash('Camera/mic unavailable or blocked — you can still watch and chat.');
        connectSSE();
      });
    }).catch(function () { showFatal('Could not load this class.'); });
  }

  function renderHeader() {
    $('rcTitle').textContent = current.title;
    var c = current.class;
    $('rcSub').textContent = (current.subject ? current.subject + ' · ' : '') +
      (c.departmentCode || c.department) + ' · ' + c.level + (c.className ? ' · Class ' + c.className : '') +
      ' · ' + current.teacher.fullName +
      (current.startTime ? ' · 🕒 ' + current.startTime + '–' + (current.endTime || '…') : '');
    if (current.status === 'ended') { var p = $('livePill'); p.textContent = '■ Ended'; p.classList.add('ended'); }
  }

  // When the scheduled end time is reached, remind the teacher they can end the class.
  var endHinted = false;
  setInterval(function () {
    if (!current || current.status !== 'live' || !current.endTime || endHinted) return;
    var canManage = me.role === 'admin' || (me.role === 'teacher' && current.teacher && current.teacher.id === me.id);
    if (!canManage) return;
    var p = String(current.endTime).split(':');
    var end = new Date(); end.setHours(Number(p[0]), Number(p[1]), 0, 0);
    if (Date.now() >= end.getTime()) {
      endHinted = true;
      flash('⏰ Class time is over (' + current.endTime + ') — you can end the class now.');
    }
  }, 15000);

  // ---------- Local media ----------
  function getMedia() {
    return navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }).then(function (stream) {
          localStream = stream;
          cameraTrack = stream.getVideoTracks()[0] || null;
          addLocalTile();
          return stream;
        })
      : Promise.reject(new Error('no getUserMedia'));
  }

  function addLocalTile() {
    var tile = ensureTile(me.role, me.id, me.fullName || me.username, true);
    var video = tile.querySelector('video');
    video.muted = true;
    video.srcObject = localStream;
    if (cameraTrack) tile.querySelector('.tile-placeholder').style.display = 'none';
  }

  function ensureTile(role, id, name, isLocal) {
    var key = keyOf(role, id);
    var tile = document.getElementById('tile-' + role + '-' + id);
    if (tile) return tile;
    var waiting = $('waitingTile'); if (waiting) waiting.remove();
    tile = document.createElement('div');
    tile.className = 'eclass-tile' + (role === 'teacher' ? ' spotlight' : '');   // teacher's screen is bigger
    tile.id = 'tile-' + role + '-' + id;
    tile.innerHTML =
      '<div class="tile-placeholder"><span>' + esc(initials(name)) + '</span></div>' +
      '<video autoplay playsinline></video>' +
      '<div class="eclass-name">' + esc(name || 'User') + '</div>' +
      (roleBadge(role) ? '<div class="eclass-badge ' + esc(role) + '">' + esc(roleBadge(role)) + '</div>' : '') +
      (isLocal ? '<div class="eclass-you">You</div>' : '');
    $('videoGrid').appendChild(tile);
    return tile;
  }
  function removeTile(role, id) {
    var tile = document.getElementById('tile-' + role + '-' + id);
    if (tile) tile.remove();
    if (!$('videoGrid').children.length) {
      var w = document.createElement('div');
      w.className = 'eclass-empty'; w.id = 'waitingTile'; w.textContent = 'Waiting for participants…';
      $('videoGrid').appendChild(w);
    }
  }

  // ---------- WebRTC mesh ----------
  function sendSignal(to, type, payload) {
    return NN.api('/api/eclasses/' + roomId + '/signal', {
      method: 'POST',
      body: JSON.stringify({ toRole: to.role, toId: to.id, data: { type: type, payload: payload } }),
    });
  }
  function ensurePeer(peer) {
    var key = keyOf(peer.role, peer.id);
    if (pcs.has(key)) return pcs.get(key);
    var pc = new RTCPeerConnection(rtcConfig);
    pcs.set(key, pc);
    pc.onicecandidate = function (e) { if (e.candidate) sendSignal(peer, 'candidate', e.candidate).catch(function () {}); };
    pc.ontrack = function (e) {
      var tile = ensureTile(peer.role, peer.id, peer.fullName || peer.username, false);
      var video = tile.querySelector('video');
      if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
      video.play().catch(function () {});
      var ph = tile.querySelector('.tile-placeholder'); if (ph) ph.style.display = 'none';
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { /* roster refresh will fix the view */ }
    };
    if (localStream) {
      localStream.getTracks().forEach(function (t) {
        var sender = pc.addTrack(t, localStream);
        if (t.kind === 'video' && me.role === 'teacher' && current && current.teacher && current.teacher.id === me.id) videoSender = sender;
      });
    }
    return pc;
  }
  function closePeer(role, id) {
    var key = keyOf(role, id);
    var pc = pcs.get(key);
    if (pc) { try { pc.close(); } catch (e) {} pcs.delete(key); }
    removeTile(role, id);
  }
  function handleSignal(from, data) {
    if (!data || !data.type) return;
    var peer = from;
    var pc = ensurePeer(peer);
    if (data.type === 'offer') {
      pc.setRemoteDescription(new RTCSessionDescription(data.payload)).then(function () {
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer);
      }).then(function () {
        sendSignal(peer, 'answer', pc.localDescription);
      }).catch(function (err) { console.error('answer failed', err); });
    } else if (data.type === 'answer') {
      pc.setRemoteDescription(new RTCSessionDescription(data.payload)).catch(function (err) { console.error('setRemote answer failed', err); });
    } else if (data.type === 'candidate') {
      pc.addIceCandidate(new RTCIceCandidate(data.payload)).catch(function (err) { console.error('candidate failed', err); });
    }
  }

  // ---------- SSE room channel ----------
  function connectSSE() {
    es = new EventSource('/api/eclasses/' + roomId + '/stream');
    es.addEventListener('eclass', function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'peers') {
        (msg.peers || []).forEach(function (peer) {
          if (peer.role === me.role && peer.id === me.id) return;
          var pc = ensurePeer(peer);
          pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer);
          }).then(function () {
            sendSignal(peer, 'offer', pc.localDescription);
          }).catch(function (err) { console.error('offer failed', err); });
        });
      } else if (msg.type === 'joined') {
        if (!(msg.role === me.role && msg.id === me.id)) {
          ensureTile(msg.role, msg.id, msg.fullName || msg.username, false);
          scheduleRosterRefresh();
        }
      } else if (msg.type === 'left') {
        closePeer(msg.role, msg.id);
        scheduleRosterRefresh();
      } else if (msg.type === 'removed') {
        if (msg.role === me.role && msg.id === me.id) {
          teardown();
          showEndCard('Removed from class', 'The teacher removed you from this class.');
          return;
        }
        closePeer(msg.role, msg.id);
        scheduleRosterRefresh();
      } else if (msg.type === 'joinRequest') {
        if (msg.studentId !== me.id) flash('⏳ ' + (msg.fullName || 'A student') + ' is late and wants to join — check the People list.');
        scheduleRosterRefresh();
      } else if (msg.type === 'requestApproved' || msg.type === 'requestDenied') {
        scheduleRosterRefresh();
      } else if (msg.type === 'ended') {
        teardown();
        showEndCard('Class ended', 'The teacher has ended this live class.');
      } else if (msg.type === 'signal' && msg.to && msg.from) {
        if (msg.to.role === me.role && Number(msg.to.id) === me.id) handleSignal(msg.from, msg.data);
      } else if (msg.type === 'chat' && msg.message) {
        appendBubble(msg.message);
      }
    });
    es.onerror = function () { /* browser auto-reconnects; roster refreshes on events */ };
  }

  function teardown() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
    pcs.forEach(function (pc) { try { pc.close(); } catch (e) {} });
    pcs.clear();
    [localStream, screenStream].forEach(function (s) { if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); });
    localStream = screenStream = null;
    ['micToggle', 'camToggle', 'screenShare', 'endClassBtn', 'chatSend', 'chatInput'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
    var pill = $('livePill'); pill.textContent = '■ Ended'; pill.classList.add('ended');
  }
  function showEndCard(title, text) {
    var c = $('endCard'); c.hidden = false;
    c.querySelector('h2').textContent = title;
    $('endCardText').textContent = text;
  }

  // ---------- Roster ----------
  function scheduleRosterRefresh() {
    clearTimeout(rosterTimer);
    rosterTimer = setTimeout(refreshRoster, 300);
  }
  function refreshRoster() {
    NN.api('/api/eclasses/' + roomId).then(function (r) {
      if (!r.ok) return;
      current = r.data;
      renderRoster(current.participants);
      renderHeader();
      var host = current.participants.filter(function(p){ return p.role === 'teacher'; })[0];
      if (host) { var ht = document.getElementById('tile-teacher-' + host.id); if (ht) ht.classList.add('spotlight'); }
    }).catch(function () {});
  }
  function renderRoster(participants) {
    var canManage = me.role === 'admin' || (me.role === 'teacher' && current.teacher && current.teacher.id === me.id);
    var order = { teacher: 0, admin: 1, student: 2 };
    var all = participants || [];
    var rows = all.filter(function (p) { return p.status !== 'pending'; }).slice().sort(function (a, b) { return (order[a.role] || 9) - (order[b.role] || 9); });
    var pend = all.filter(function (p) { return p.status === 'pending'; });
    $('peopleCount').textContent = rows.length + (pend.length ? ' (+' + pend.length + ' waiting)' : '');
    var html = rows.map(function (p) {
      var isMe = (p.role === me.role && p.id === me.id);
      var canRemove = canManage && p.role === 'student' && !isMe;
      return '<li data-role="' + esc(p.role) + '" data-id="' + p.id + '">' +
        '<span class="ravatar r-' + esc(p.role) + '">' + esc(initials(p.fullName)) + '</span>' +
        '<span class="rmeta"><b>' + esc(p.fullName || p.username) + (isMe ? ' (You)' : '') + '</b><small>' +
          (p.role === 'teacher' ? 'Teacher · host' : p.role === 'admin' ? 'Administrator' : 'Student') + '</small></span>' +
        '<span class="ronline" title="In call"></span>' +
        (canRemove ? '<button class="rremove" data-remove="' + p.id + '" type="button">Remove</button>' : '') +
      '</li>';
    }).join('');
    if (pend.length) {
      html += '<li style="list-style:none;margin:6px 0 2px;font-size:.75rem;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">Waiting for approval (late)</li>';
      html += pend.map(function (p) {
        return '<li data-role="student" data-id="' + p.id + '">' +
          '<span class="ravatar r-student" style="opacity:.6">' + esc(initials(p.fullName)) + '</span>' +
          '<span class="rmeta"><b>' + esc(p.fullName || p.username) + '</b><small>⏳ Requested to join (late)</small></span>' +
          (canManage
            ? '<span style="display:flex;gap:6px">' +
                '<button class="btn btn-success" style="padding:5px 10px;font-size:.75rem" data-allow="' + p.id + '" type="button">Allow</button>' +
                '<button class="btn btn-danger" style="padding:5px 10px;font-size:.75rem" data-deny="' + p.id + '" type="button">Deny</button>' +
              '</span>'
            : '') +
        '</li>';
      }).join('');
      if (!canManage) html += '<li style="font-size:.78rem;color:var(--muted)">' + pend.length + ' late request(s) waiting for the teacher…</li>';
    }
    $('rosterList').innerHTML = html;
    $('rosterList').querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-remove'));
        if (!window.confirm('Remove this student from the live class?')) return;
        NN.api('/api/eclasses/' + roomId + '/remove', { method: 'POST', body: JSON.stringify({ role: 'student', userId: id }) })
          .then(function (r) { if (!r.ok) flash((r.data && r.data.error) || 'Could not remove.'); });
      });
    });
    function decide(btn) {
      var id = Number(btn.getAttribute('data-allow') || btn.getAttribute('data-deny'));
      var decision = btn.hasAttribute('data-allow') ? 'allow' : 'deny';
      NN.api('/api/eclasses/' + roomId + '/decide', { method: 'POST', body: JSON.stringify({ userId: id, decision: decision }) })
        .then(function (r) {
          if (!r.ok) { flash((r.data && r.data.error) || 'Could not decide.'); return; }
          flash(decision === 'allow' ? '✅ ' + ((r.data.student && r.data.student.fullName) || 'Student') + ' can now enter the class.' : '⛔ Join request denied.');
        });
    }
    $('rosterList').querySelectorAll('[data-allow]').forEach(function (b) { b.addEventListener('click', function () { decide(b); }); });
    $('rosterList').querySelectorAll('[data-deny]').forEach(function (b) { b.addEventListener('click', function () { decide(b); }); });
  }

  // ---------- Chat ----------
  function loadChat() {
    NN.api('/api/eclasses/' + roomId + '/messages').then(function (r) {
      if (!r.ok) return;
      $('chatList').innerHTML = '';
      (r.data || []).forEach(appendBubble);
      scrollChat();
    }).catch(function () {});
  }
  function appendBubble(m) {
    var mine = (m.author && m.author.role === me.role && m.author.id === me.id);
    var el = document.createElement('div');
    el.className = 'eclass-bubble' + (mine ? ' mine' : '');
    el.innerHTML = '<small>' + esc(m.author ? m.author.fullName : 'Someone') + (m.author && m.author.role === 'teacher' ? ' · Teacher' : m.author && m.author.role === 'admin' ? ' · Admin' : '') + '</small>' +
      esc(m.body) + '<div class="eclass-bubble-time">' + esc(timeHM(m.createdAt)) + '</div>';
    $('chatList').appendChild(el);
    scrollChat();
  }
  function scrollChat() { var c = $('chatList'); c.scrollTop = c.scrollHeight; }
  $('chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('chatInput');
    var body = input.value.trim();
    if (!body) return;
    $('chatSend').disabled = true;
    NN.api('/api/eclasses/' + roomId + '/messages', { method: 'POST', body: JSON.stringify({ body: body }) })
      .then(function (r) {
        $('chatSend').disabled = false;
        if (!r.ok) { flash((r.data && r.data.error) || 'Could not send.'); return; }
        input.value = '';
      })
      .catch(function () { $('chatSend').disabled = false; });
  });

  // ---------- Tabs ----------
  document.querySelectorAll('.eclass-tabs [data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.eclass-tabs [data-tab]').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $('panel-people').hidden = btn.dataset.tab !== 'people';
      $('panel-chat').hidden = btn.dataset.tab !== 'chat';
    });
  });

  // ---------- Controls ----------
  $('micToggle').addEventListener('click', function () {
    micOn = !micOn;
    if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = micOn; });
    this.classList.toggle('off', !micOn);
    this.setAttribute('aria-pressed', String(micOn));
    this.innerHTML = '<span data-icon="' + (micOn ? 'mic' : 'mic-off') + '"></span>';
    if (window.NN && NN.paintIcons) NN.paintIcons(document);
  });
  $('camToggle').addEventListener('click', function () {
    camOn = !camOn;
    if (localStream) localStream.getVideoTracks().forEach(function (t) { t.enabled = camOn; });
    this.classList.toggle('off', !camOn);
    this.setAttribute('aria-pressed', String(camOn));
    this.innerHTML = '<span data-icon="' + (camOn ? 'video' : 'video-off') + '"></span>';
    if (window.NN && NN.paintIcons) NN.paintIcons(document);
  });
  $('screenShare').addEventListener('click', function () {
    if (sharing) { stopShare(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { flash('Screen sharing is not supported in this browser.'); return; }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      screenStream = stream; sharing = true;
      var track = stream.getVideoTracks()[0];
      pcs.forEach(function (pc) {
        pc.getSenders().forEach(function (sender) {
          if (sender.track && sender.track.kind === 'video') sender.replaceTrack(track);
        });
      });
      // Show my shared screen locally too
      var localVideo = $('tile-' + me.role + '-' + me.id);
      if (localVideo) { var v = localVideo.querySelector('video'); v.muted = true; v.srcObject = stream; }
      $('screenShare').classList.add('off');
      $('screenShare').innerHTML = '<span data-icon="monitor"></span> Stop sharing';
      if (window.NN && NN.paintIcons) NN.paintIcons(document);
      track.onended = stopShare;
    }).catch(function () { flash('Screen share was cancelled or blocked.'); });
  });
  function stopShare() {
    sharing = false;
    if (screenStream) { screenStream.getTracks().forEach(function (t) { t.stop(); }); screenStream = null; }
    if (cameraTrack) {
      pcs.forEach(function (pc) {
        pc.getSenders().forEach(function (sender) {
          if (sender.track && sender.track.kind === 'video') sender.replaceTrack(cameraTrack);
        });
      });
      var localVideo = $('tile-' + me.role + '-' + me.id);
      if (localVideo && localStream) { var v = localVideo.querySelector('video'); v.srcObject = localStream; }
    }
    $('screenShare').classList.remove('off');
    $('screenShare').innerHTML = '<span data-icon="monitor"></span> Share screen';
    if (window.NN && NN.paintIcons) NN.paintIcons(document);
  }
  // End class (teacher/admin): choose "for everyone" or "for me only".
  // Students never see this button — their Leave always only leaves for themselves.
  $('endClassBtn').addEventListener('click', function () { $('endModal').hidden = false; });
  $('endForAllBtn').addEventListener('click', function () {
    $('endModal').hidden = true;
    NN.api('/api/eclasses/' + roomId + '/end', { method: 'POST' }).then(function () {});
  });
  $('endForMeBtn').addEventListener('click', function () {
    $('endModal').hidden = true;
    NN.api('/api/eclasses/' + roomId + '/leave', { method: 'POST' }).then(function () {
      teardown();
      var pill = $('livePill'); pill.textContent = '■ Left'; pill.classList.add('ended');
      showEndCard('You left the class', 'The class is still running for everyone else.');
    });
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]');
    if (c) { var m = document.getElementById(c.dataset.close); if (m) m.hidden = true; }
  });

  // Closing the tab = leaving the class
  window.addEventListener('beforeunload', function () {
    try {
      navigator.sendBeacon('/api/eclasses/' + roomId + '/leave', new Blob(['{}'], { type: 'application/json' }));
    } catch (e) {}
  });
})();
