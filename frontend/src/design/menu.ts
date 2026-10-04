/**
 * The header's phone menu is a <details>, so it opens without JavaScript; this
 * closes it on a click outside, on Escape (returning focus to its button) and
 * after following one of its links. Returns the cleanup function.
 */
export function bindMenu(details: HTMLDetailsElement): () => void {
  const summary = details.querySelector('summary');
  const close = () => {
    details.open = false;
  };
  const onPointer = (e: PointerEvent) => {
    if (details.open && !details.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !details.open) return;
    close();
    summary?.focus();
  };
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('a')) close();
  };
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  details.addEventListener('click', onClick);
  return () => {
    document.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('keydown', onKey);
    details.removeEventListener('click', onClick);
  };
}
