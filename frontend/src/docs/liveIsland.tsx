import { createRoot } from 'react-dom/client';
import LiveExample from './LiveExample';

/** Decodes the base64 UTF-8 source plugins/docsSite.ts put on the figure. */
export function decodeSource(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

/** Turns a `<figure data-live>` into a live example below its code. Loaded on demand by main.ts. */
export function mountLiveExample(figure: HTMLElement, siteRoot: string): void {
  const source = decodeSource(figure.dataset.source ?? '');
  const slot = document.createElement('div');
  slot.className = 'live__slot';
  figure.append(slot);
  figure.classList.add('is-live');
  createRoot(slot).render(<LiveExample source={source} siteRoot={siteRoot} />);
}
