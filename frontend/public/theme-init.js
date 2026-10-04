// Runs in <head> before first paint, as a plain script (the pages' CSP allows
// no inline scripts): applies the saved theme so the page never flashes the
// wrong one, and keeps following the system while no theme is chosen.
// src/design/theme.ts changes the choice later; keep the two in step.
(function () {
  var root = document.documentElement;
  var colors = { light: '#FFF8E7', dark: '#141318' };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() {
    try {
      var saved = localStorage.getItem('proschi.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch (e) {
      return 'system';
    }
  }
  function apply() {
    var p = pref();
    var theme = p === 'system' ? (media && media.matches ? 'dark' : 'light') : p;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-pref', p);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors[theme]);
  }
  root.classList.add('ps-js');
  apply();
  if (media && media.addEventListener) {
    media.addEventListener('change', function () {
      if (root.getAttribute('data-theme-pref') === 'system') apply();
    });
  }
})();
