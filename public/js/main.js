// APALINK shared frontend helpers.
(function () {
  window.NN = {
    api: function (path, opts) {
      opts = opts || {};
      return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
    },
    showError: function (el, msg) {
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
    },
    clearError: function (el) { if (el) el.classList.remove('show'); },
    setLoading: function (btn, on, label) {
      if (!btn) return;
      btn.disabled = !!on;
      btn.innerHTML = on ? '<span class="spinner"></span> ' + (label || 'Please wait') : (btn.dataset.label || btn.textContent);
      if (on) btn.dataset.label = btn.textContent;
    },
  };
  // Show/hide password toggles (data-toggle-target on button)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-toggle-target]');
    if (!btn) return;
    var input = document.getElementById(btn.dataset.toggleTarget);
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  });

  // Theme bootstrap (immediate local fallback; server prefs sync on dashboards).
  try { var t = localStorage.getItem('nn-theme') || 'light'; if (t === 'dark') document.documentElement.dataset.theme = 'dark'; else document.documentElement.dataset.theme = t; } catch (e) {}

  window.NN.applyPrefs = function (prefs) {
    var theme = prefs.theme || 'light';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.font = prefs.fontSize || 'medium';
    document.documentElement.dataset.motion = prefs.motion === 'reduced' ? 'reduced' : (prefs.motion === 'full' ? 'full' : 'system');
    document.documentElement.dataset.accent = prefs.accent || 'yellow';
    try { localStorage.setItem('nn-theme', theme); } catch (e) {}
  };
})();
