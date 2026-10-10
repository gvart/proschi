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
  // Cross-document view transitions (src/design/tokens.css) reject their
  // promises when the browser skips one (a resize mid-navigation, say), which
  // shows up as an uncaught error. Skipping is fine: the page just navigates.
  function quiet(e) {
    var t = e.viewTransition;
    if (!t) return;
    var noop = function () {};
    t.ready.catch(noop);
    t.finished.catch(noop);
    if (t.updateCallbackDone) t.updateCallbackDone.catch(noop);
  }
  window.addEventListener('pageswap', quiet);
  window.addEventListener('pagereveal', quiet);
})();
