/** How sharing went: the system's share sheet, the clipboard, dismissed, or neither worked. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Copies text, with a fallback for pages where the Clipboard API is not allowed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * The system's share sheet where there is one (phones, some desktops), else
 * the clipboard. The text carries its own link, so it is shared as text only:
 * a separate `url` would be added twice by some targets.
 */
export async function shareText(text: string, title = 'Proschi'): Promise<ShareOutcome> {
  const data = { title, text };
  if (typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      // Dismissed by the reader; any other failure falls back to copying.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}
