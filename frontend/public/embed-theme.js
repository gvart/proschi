// The embed page's theme, before first paint, as a plain script (the page's
// CSP allows no inline scripts): ?theme=light or ?theme=dark, chosen by the
// page that embeds the diagram; otherwise the reader's system theme (the
// tokens' prefers-color-scheme), never the theme saved on proschi.app.
(function () {
  var root = document.documentElement;
  var theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  root.classList.add('ps-js');
})();
