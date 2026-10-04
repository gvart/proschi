/**
 * Parts of the editor and practice pages load on first use. After a deploy,
 * a page opened earlier asks for chunk files that no longer exist; reload it
 * (at most every 10 s, so an offline page does not loop) to get the new ones.
 */
const KEY = 'proschi.chunkReloadAt';

window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
