/**
 * Links marked `data-feedback` (the footer's "Send feedback") open the
 * feedback dialog instead of following their address, which stays as the
 * fallback (Settings, where "Contact us" is). One listener on the document,
 * so static pages and React pages alike; the dialog loads on first use.
 */
let bound = false;

export function bindFeedbackLinks(doc: Document = document): void {
  if (bound) return;
  bound = true;
  doc.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.('[data-feedback]');
    if (!link) return;
    e.preventDefault();
    void import('./open').then((m) => m.openFeedback());
  });
}
