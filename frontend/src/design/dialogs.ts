// The design system's confirm, prompt, copy and toast dialogs, in place of
// the browser's window.confirm, window.prompt and window.alert (which the
// lint config bans). Call them from any event handler: the first call mounts
// one host for the page (DialogHost), so there is no provider to place.
//
//   if (!(await confirm({ title: 'Delete "Checkout"?', body: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
//   const name = await prompt({ title: 'Rename', label: 'Display name', defaultValue: node.name });
//   notify({ title: 'Sorry, the image could not be exported.', tone: 'danger' });
//   await copyText(url, { title: 'Copy this share link' });
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DialogHost from './DialogHost';
import { addToast, openDialog, removeToast, type ConfirmOptions, type CopyOptions, type NotifyOptions, type PromptOptions } from './dialogStore';

export type { ConfirmOptions, CopyOptions, DialogTone, NotifyOptions, PromptOptions, ToastTone } from './dialogStore';

let mounted = false;

function mountHost() {
  if (mounted) return;
  mounted = true;
  const host = document.createElement('div');
  host.dataset.dialogRoot = '';
  document.body.append(host);
  createRoot(host).render(createElement(DialogHost));
}

/** Asks a yes-or-no question: true when confirmed, false when cancelled (Cancel, Escape or the backdrop). */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  mountHost();
  return new Promise((resolve) => openDialog({ kind: 'confirm', options, resolve }));
}

/** Asks for a line of text: the value, or null when cancelled. With `confirmText` it is a typed confirmation. */
export function prompt(options: PromptOptions): Promise<string | null> {
  mountHost();
  return new Promise((resolve) => openDialog({ kind: 'prompt', options, resolve }));
}

/** Shows `text` selected in a field to copy by hand, for when writing to the clipboard failed. Resolves when closed. */
export function copyFallback(text: string, options: CopyOptions = {}): Promise<void> {
  mountHost();
  return new Promise((resolve) => openDialog({ kind: 'copy', text, options, resolve }));
}

/** Copies `text` to the clipboard, or opens copyFallback when the browser refuses: true when it was copied. */
export async function copyText(text: string, options: CopyOptions = {}): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    await copyFallback(text, options);
    return false;
  }
}

/** Shows a toast in the corner (the bottom on phones); returns a function that dismisses it. */
export function notify(options: NotifyOptions): () => void {
  mountHost();
  const id = addToast(options);
  return () => removeToast(id);
}
