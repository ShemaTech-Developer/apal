// APALINK image slider — crossfade every 3s, reduced-motion + error fallback.
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.photo-panel .slide'));
  var dotsBox = document.querySelector('.dots');
  if (!slides.length) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0, timer = null, dots = [];

  slides.forEach(function (slide, i) {
    var img = slide.querySelector('img');
    var fail = function () { slide.remove(); slides.splice(i < idx ? idx - 1 : i, 1); };
    if (img && img.complete && img.naturalWidth === 0) fail();
    if (img) img.addEventListener('error', fail);
  });
  slides = Array.prototype.slice.call(document.querySelectorAll('.photo-panel .slide'));
  if (!slides.length) return;

  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle('active', k === idx); });
    dots.forEach(function (d, k) { d.classList.toggle('active', k === idx); });
  }
  if (dotsBox) {
    dots = slides.map(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Show image ' + (i + 1));
      b.addEventListener('click', function () { show(i); restart(); });
      dotsBox.appendChild(b);
      return b;
    });
  }
  function restart() {
    if (timer) clearInterval(timer);
    if (!reduce && slides.length > 1) timer = setInterval(function () { show(idx + 1); }, 3000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (timer) clearInterval(timer); } else restart();
  });
  show(0);
  restart();
})();
