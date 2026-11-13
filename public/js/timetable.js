// APALINK timetables — student weekly grid, teacher schedule, admin management.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function entryBlock(e) {
    var label = e.isBreak ? 'Break' : esc(e.subject || '(lesson)');
    var detail = e.teacher_name ? esc(e.teacher_name) : (e.teacherName || '');
    return '<div class="tt-lesson' + (e.isBreak ? ' break' : '') + '"><span class="time">' + esc(e.start_time || e.start || '') + ' – ' + esc(e.end_time || e.end || '') + '</span><b>' + label + '</b>' +
      (detail ? '<span>' + detail + '</span>' : '') +
      (e.classroom ? '<br><span>' + NN.icon('school') + ' ' + esc(e.classroom) + '</span>' : '') + '</div>';
  }
  function weeklyGrid(entries) {
    return '<div class="tt-grid">' + DAYS.map(function (d, day) {
      var list = entries.filter(function (e) { return Number(e.day_of_week !== undefined ? e.day_of_week : e.day) === day; });
      return '<div class="tt-day"><h4>' + d + '</h4>' + (list.length ? list.map(entryBlock).join('') : '<p class="muted" style="font-size:.82rem;margin:0">No lessons</p>') + '</div>';
    }).join('') + '</div>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var view = document.body.dataset.view;
    if (!view) return;

    // ---- Student timetable ----
    if (view === 's-timetable') {
      NN.api('/api/student/timetable').then(function (r) {
        if (!r.ok) return;
        $('ttWelcome').textContent = 'Your Timetable';
        var d = r.data;
        if (!d.document) {
          $('ttWelcome').textContent = 'My Timetable';
          $('ttSub').textContent = 'No timetable published for your class yet.';
          $('ttBody').innerHTML = '<div class="empty"><span class="big">' + NN.icon('calendar', 26) + '</span><h3>No timetable yet</h3><p>Your administrator has not published a timetable for your class. Check back soon.</p></div>';
          return;
        }
        $('ttSub').textContent = d.document.title + ' · ' + d.document.department + ' · ' + d.document.level + (d.document.className ? ' · Class ' + d.document.className : '') + (d.document.period ? ' · ' + d.document.period : '');
        var html = '<section class="panel"><h2>Today — ' + DAYS[new Date().getDay()] + '</h2><div>' +
          (d.today.length ? d.today.map(entryBlock).join('') : '<p class="muted">No lessons today.</p>') + '</div></section>';
        html += '<section class="panel"><h2>Weekly timetable</h2>' + (d.entries.length ? weeklyGrid(d.entries) : '') +
          (d.document.fileName ? '<p style="margin-top:14px"><a class="btn btn-ghost" href="/api/timetables/docs/' + d.document.id + '/file?mode=preview" target="_blank">' + NN.icon('eye') + ' Preview timetable file</a> <a class="btn btn-primary" href="/api/timetables/docs/' + d.document.id + '/file" download>' + NN.icon('download') + ' Download</a></p>' : '') +
          '</section>';
        if (d.upcoming.length) html += '<section class="panel"><h2>Coming up</h2><ul class="plain-list">' + d.upcoming.map(function (e) {
          return '<li><span><b>' + esc(e.subject || '') + '</b> · ' + DAYS[Number(e.day_of_week)] + ' ' + esc(e.start_time) + '</span><span class="muted">' + esc(e.teacher_name || '') + '</span></li>';
        }).join('') + '</ul></section>';
        $('ttBody').innerHTML = html;
      });
      return;
    }

    // ---- Teacher schedule ----
    if (view === 't-schedule') {
      NN.api('/api/teacher/schedule').then(function (r) {
        if (!r.ok) return;
        var rows = r.data;
        if (!rows.length) {
          $('ttBody').innerHTML = '<div class="empty"><span class="big">' + NN.icon('calendar', 26) + '</span><h3>No lessons assigned yet</h3><p>The administrator has not assigned you to any timetable lessons yet.</p></div>';
          return;
        }
        $('ttBody').innerHTML = '<section class="panel"><h2>Teaching schedule — ' + rows.length + ' lessons</h2>' + weeklyGrid(rows) + '</section>' +
          '<section class="panel"><h2>By day</h2><ul class="plain-list">' + rows.map(function (l) {
            return '<li><span><b>' + DAYS[Number(l.day)] + '</b> · ' + esc(l.subject || '') + ' · ' + esc(l.start) + '–' + esc(l.end) + '</span><span class="muted">' + esc(l.department) + ' · ' + esc(l.level) + (l.className ? ' · Class ' + esc(l.className) : '') + ' · ' + esc(l.classroom) + '</span></li>';
          }).join('') + '</ul></section>';
      });
      return;
    }

    // ---- Admin timetable management ----
    if (view === 'a-timetable') {
      var depsP = NN.api('/api/auth/departments'), lvlsP = NN.api('/api/auth/levels');
      var periodsP = NN.api('/api/admin/periods'), teachersP = NN.api('/api/admin/teachers');
      Promise.all([depsP, lvlsP, periodsP, teachersP]).then(function (res) {
        res[0].data.forEach(function (d) { var o = document.createElement('option'); o.value = d.id; o.textContent = d.name; $('department').appendChild(o); });
        res[1].data.forEach(function (l) { var o = document.createElement('option'); o.value = l.id; o.textContent = l.name; $('level').appendChild(o); });
        res[2].data.forEach(function (p) { var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; $('period').appendChild(o); });
        res[3].data.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.fullName; $('entryTeacher').appendChild(o); });
        loadList();
      });

      $('newPeriodForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('newPeriodName').value.trim(); if (!name) return;
        NN.api('/api/admin/periods', { method: 'POST', body: JSON.stringify({ name: name }) }).then(function (r) {
          if (r.ok) { var o = document.createElement('option'); o.value = r.data.period.id; o.textContent = r.data.period.name; $('period').appendChild(o); $('newPeriodName').value = ''; }
        });
      });

      function loadList() {
        NN.api('/api/admin/timetables').then(function (r) {
          if (!r.ok) return;
          $('docList').innerHTML = r.data.length
            ? r.data.map(function (d) {
              return '<li><span><b>' + esc(d.title) + '</b>' + (d.isPublished ? ' <span class="badge">Published</span>' : '') + (d.isArchived ? ' <span class="badge">Archived</span>' : '') +
                '<br><small class="muted">' + esc(d.department) + ' · ' + esc(d.level) + (d.className ? ' · Class ' + esc(d.className) : '') + (d.period ? ' · ' + esc(d.period) : '') + ' · ' + d.entryCount + ' entries</small></span>' +
                '<span><button class="btn btn-ghost" data-open="' + d.id + '">Manage</button></span></li>';
            }).join('')
            : '<li class="muted">No timetables yet — create one above.</li>';
          $('docList').querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { openDoc(b.dataset.open); }); });
        });
      }

      function openDoc(id) {
        window.location.hash = 'doc-' + id;
        NN.api('/api/admin/timetables/' + id).then(function (r) {
          if (!r.ok) return;
          var d = r.data;
          $('editTitle').textContent = d.title + ' — ' + d.department + ' · ' + d.level + (d.className ? ' · Class ' + d.className : '');
          $('docId').value = d.id;
          $('docActions').innerHTML =
            '<button class="btn btn-primary" id="pubBtn">' + (d.isPublished ? 'Unpublish' : 'Publish') + '</button>' +
            '<button class="btn btn-ghost" id="arcBtn">Archive</button>' +
            '<button class="btn btn-ghost" id="delBtn">Delete</button>' +
            (d.fileName ? '<a class="btn btn-ghost" href="/api/timetables/docs/' + d.id + '/file?mode=preview" target="_blank">Preview file</a>' : '');
          $('pubBtn').addEventListener('click', function () {
            var path = d.isPublished ? '/api/admin/timetables/' + d.id + '/unpublish' : '/api/admin/timetables/' + d.id + '/publish';
            NN.api(path, { method: 'POST' }).then(function (rr) {
              if (rr.ok) { alert('Done. Students notified: ' + (rr.data.notifiedStudents || 0) + ', teachers: ' + (rr.data.notifiedTeachers || 0) + (rr.data.replaced ? ', replaced ' + rr.data.replaced + ' previous' : '')); location.reload(); }
              else alert(rr.data.error || 'Failed');
            });
          });
          $('arcBtn').addEventListener('click', function () { if (confirm('Archive this timetable?')) NN.api('/api/admin/timetables/' + d.id + '/archive', { method: 'POST' }).then(function () { location.reload(); }); });
          $('delBtn').addEventListener('click', function () { if (confirm('Delete this timetable permanently?')) NN.api('/api/admin/timetables/' + d.id, { method: 'DELETE' }).then(function () { location.reload(); }); });
          var grid = $('entriesGrid');
          grid.innerHTML = d.entries.length ? weeklyGrid(d.entries) : '<p class="muted">No entries yet — add lessons below.</p>';
          grid.querySelectorAll('.tt-lesson').forEach(function () {});
          $('entriesList').innerHTML = d.entries.length ? d.entries.map(function (e) {
            return '<li><span><b>' + DAYS[Number(e.day_of_week)] + '</b> ' + esc(e.subject || 'Break') + ' · ' + esc(e.start_time) + '–' + esc(e.end_time) + ' · ' + esc(e.teacher_name) + ' · ' + esc(e.classroom) + '</span><button class="btn btn-ghost" data-delentry="' + e.id + '">Remove</button></li>';
          }).join('') : '<li class="muted">No lessons yet.</li>';
          $('entriesList').querySelectorAll('[data-delentry]').forEach(function (b) {
            b.addEventListener('click', function () { NN.api('/api/admin/timetables/' + d.id + '/entries/' + b.dataset.delentry, { method: 'DELETE' }).then(function () { openDoc(d.id); }); });
          });
        });
      }
      if (window.location.hash.startsWith('#doc-')) openDoc(window.location.hash.slice(5));

      $('uploadForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, btn = f.querySelector('button[type=submit]');
        NN.clearError($('uploadError'));
        btn.disabled = true;
        fetch('/api/admin/timetables', { method: 'POST', body: new FormData(f) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
          .then(function (r) {
            btn.disabled = false;
            if (!r.ok) { NN.showError($('uploadError'), r.data.error || 'Upload failed.'); return; }
            f.reset(); loadList(); openDoc(r.data.id);
          });
      });

      $('entryForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, docId = $('docId').value;
        if (!docId) { alert('Select a timetable first (Manage).'); return; }
        var body = {
          dayOfWeek: Number(f.elements.dayOfWeek.value), subject: f.elements.subject.value,
          teacherId: f.elements.teacherId.value || null, teacherName: f.elements.teacherName.value,
          classroom: f.elements.classroom.value, startTime: f.elements.startTime.value, endTime: f.elements.endTime.value,
          isBreak: f.elements.isBreak.checked, override: $('override').checked,
        };
        function showConflicts(r) {
          $('entryError').classList.remove('show');
          var box = $('entryError');
          box.textContent = (r.data.error || 'Conflict') + ' ' + (r.data.conflicts || []).map(function (c) { return c.message; }).join(' ');
          box.classList.add('show');
        }
        NN.api('/api/admin/timetables/' + docId + '/entries', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
          if (r.status === 409) { showConflicts(r); return; }
          if (!r.ok) { NN.showError($('entryError'), r.data.error || 'Save failed.'); return; }
          f.reset(); $('override').checked = false; $('entryError').classList.remove('show');
          openDoc(docId);
        });
      });
    }
  });
})();
