import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LiveDemo from '../components/Demo/LiveDemo';
import { editorLink } from './links';

/** The hero's island: replaces the static poster in `host` with the live demo. */
export function mountDemo(host: HTMLElement, { still }: { still: boolean }): void {
  createRoot(host).render(
    <StrictMode>
      <LiveDemo editorHref={editorLink} still={still} />
    </StrictMode>,
  );
}
