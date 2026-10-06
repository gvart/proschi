import { useEffect, useState } from 'react';
import LiveExample from '../docs/LiveExample';
import { titleOf } from '../playground/documents';
import { ApiError } from '../services/api';
import { fetchShare } from '../services/shares';
import { embedTarget } from './target';

/**
 * The read-only embed page (/embed/), for an <iframe> on other sites: the
 * diagram, its use cases to play, and a link that opens it in the editor.
 * No editor, no CodeMirror: the docs' live example, filling the frame.
 * `?s=<id>` reads a short link (GET /api/shares/<id>); `#code=…` carries the
 * diagram itself. `?theme=light|dark` is read by public/embed-theme.js.
 */

/** From /embed/ to the site root. */
const SITE_ROOT = '../';

type Shown = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; source: string; imports?: Record<string, string>; title: string; editorHref?: string };

function initial(): Shown {
  const target = embedTarget(window.location.search, window.location.hash);
  if (target.kind === 'error') return { status: 'error', message: target.message };
  if (target.kind === 'short') return { status: 'loading' };
  return { status: 'ready', source: target.source, imports: target.imports, title: titleOf(target.source) };
}

export default function Embed() {
  const [shown, setShown] = useState<Shown>(initial);

  useEffect(() => {
    const target = embedTarget(window.location.search, window.location.hash);
    if (target.kind !== 'short') return;
    let cancelled = false;
    fetchShare(target.id).then(
      (share) => {
        if (!cancelled) setShown({ status: 'ready', source: share.source, imports: share.imports, title: share.title, editorHref: `${SITE_ROOT}app/?s=${share.id}` });
      },
      (error: unknown) => {
        if (cancelled) return;
        const gone = error instanceof ApiError && error.status === 404;
        setShown({ status: 'error', message: gone ? 'This diagram’s short link was deleted.' : 'Could not load the diagram; try again in a moment.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shown.status === 'ready') document.title = `${shown.title} · Proschi`;
  }, [shown]);

  if (shown.status !== 'ready') {
    return (
      <main className="embed embed--message">
        <p role={shown.status === 'error' ? 'alert' : 'status'}>{shown.status === 'error' ? shown.message : 'Loading the diagram…'}</p>
        <a className="ps-btn ps-btn--sm" href={`${SITE_ROOT}app/`} target="_blank" rel="noopener">
          Proschi
        </a>
      </main>
    );
  }
  return (
    <main className="embed">
      <LiveExample
        source={shown.source}
        imports={shown.imports}
        siteRoot={SITE_ROOT}
        editorHref={shown.editorHref}
        title={shown.title}
        openLabel="Open in Proschi"
        newTab
      />
    </main>
  );
}
