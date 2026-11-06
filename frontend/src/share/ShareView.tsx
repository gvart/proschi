import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Copy, Eye, Network, Play, RotateCcw } from 'lucide-react';
import { parse, type SourceLoc } from '../dsl';
import { filesResolver } from '../playground/imports';
import { encodeShareHash } from '../playground/share';
import { ApiError, apiEnabled } from '../services/api';
import { fetchSharedDocument, shareTokenFromPath, type SharedDocument } from '../services/documentShares';
import { useAccount } from '../practice/useAccount';
import AccountMenu from '../practice/AccountMenu';
import Header from '../design/Header';
import Tabs from '../design/Tabs';
import CodeEditor, { type CodeEditorHandle } from '../components/Playground/CodeEditor';
import { field, outlineButton, primaryButton, subBar } from '../components/Playground/ui';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayback } from '../components/UseCases/UseCasePlayback';
import { PLAYBACK_EDGE_TYPES } from '../components/UseCases/playbackView';
import ViewTabs from '../components/Analysis/ViewTabs';
import type { View } from '../components/Analysis/view';
import { useSimulation } from '../components/Analysis/useSimulation';
import PaneLoading from '../components/PaneLoading';

const ResultsPanel = lazy(() => import('../components/Analysis/ResultsPanel'));
const HldView = lazy(() => import('../components/Hld/HldView'));

/** The page is served at /share/<token>, so the site root is one folder up. */
const SITE_ROOT = '../';
const NO_IDS: string[] = [];

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; doc: SharedDocument };

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * A live share link's page (/share/<token>, docs/SHARING.md): the owner's
 * diagram as last saved to their account, read-only, for anyone with the
 * link. The code cannot be edited; the diagram plays its use cases and the
 * Results and HLD tabs run the simulation. Signed in, "Make a copy" opens it
 * in the editor as a diagram of one's own.
 */
export default function ShareView() {
  const account = useAccount(() => undefined);
  const [loaded, setLoaded] = useState<Loaded>(() =>
    !apiEnabled ? { status: 'error', message: 'Share links open on proschi.app.' } : shareTokenFromPath(window.location.pathname) ? { status: 'loading' } : { status: 'error', message: 'This share link is not complete; ask its owner for it again.' },
  );

  useEffect(() => {
    const token = shareTokenFromPath(window.location.pathname);
    if (!apiEnabled || !token) return;
    let cancelled = false;
    fetchSharedDocument(token).then(
      (doc) => !cancelled && setLoaded({ status: 'ready', doc }),
      (e: unknown) => {
        if (cancelled) return;
        const gone = e instanceof ApiError && e.status === 404;
        setLoaded({ status: 'error', message: gone ? 'This share link does not work any more: its owner revoked it, or the diagram is gone.' : 'Could not load the diagram; try again in a moment.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded.status === 'ready') document.title = `${loaded.doc.title} · Shared · Proschi`;
  }, [loaded]);

  return (
    <div className="h-[100dvh] flex flex-col bg-paper text-ink">
      <Header base={SITE_ROOT} compact siteNav={false} actions={<AccountMenu account={account} base={SITE_ROOT} />}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="min-w-0 truncate text-sm font-bold">{loaded.status === 'ready' ? loaded.doc.title : 'Shared diagram'}</h1>
          <span className="inline-flex flex-none items-center gap-1 rounded border-bw-1 border-ink/40 px-1.5 py-0.5 text-xs font-semibold text-muted">
            <Eye size={12} aria-hidden="true" />
            Read-only
          </span>
          {loaded.status === 'ready' && account.state.status === 'signed-in' && (
            <a className={`${primaryButton} ml-auto flex-none`} href={`${SITE_ROOT}app/${encodeShareHash(loaded.doc.source, undefined, loaded.doc.imports)}`}>
              <Copy size={16} />
              <span>Make a copy</span>
            </a>
          )}
        </div>
      </Header>
      {loaded.status === 'ready' ? (
        <Shared doc={loaded.doc} />
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p role={loaded.status === 'error' ? 'alert' : 'status'} className="max-w-md text-sm">
            {loaded.status === 'error' ? loaded.message : 'Loading the diagram…'}
          </p>
          {loaded.status === 'error' && (
            <a className={outlineButton} href={`${SITE_ROOT}app/`}>
              Open the Proschi editor
            </a>
          )}
        </main>
      )}
    </div>
  );
}

function Shared({ doc }: { doc: SharedDocument }) {
  const editorRef = useRef<CodeEditorHandle>(null);
  const parsed = useMemo(() => parse(doc.source, { path: doc.name, resolve: filesResolver(doc.imports ?? {}, doc.name) }), [doc]);
  const diagram = parsed.diagram;
  const simulation = useSimulation(diagram);
  const { nodes, edges, settled } = useDiagramLayout(diagram);
  const [view, setView] = useState<View>('diagram');
  const [pane, setPane] = useState<'code' | 'diagram'>('diagram');

  const scenarios = useMemo(
    () =>
      diagram.useCases.flatMap((u) =>
        u.scenarios
          .filter((s) => s.steps.length > 0)
          .map((s) => ({ key: `${u.id}/${s.id}`, label: u.scenarios.length > 1 ? `${u.name} › ${s.name}` : u.name, played: { id: `${u.id}/${s.id}`, name: u.name, steps: s.steps, condition: s.condition } })),
      ),
    [diagram],
  );
  const [selected, setSelected] = useState(0);
  // Bumped by Play, so pressing it again starts over.
  const [run, setRun] = useState(0);
  const current = scenarios[Math.min(selected, scenarios.length - 1)];
  const played = useMemo(() => (run > 0 && current ? { ...current.played, id: `${current.key}#${run}` } : undefined), [current, run]);

  const select = (loc: SourceLoc) => {
    if (loc.file !== undefined) return;
    setPane('code');
    editorRef.current?.select(loc.line, loc.col, loc.length, false);
  };
  const phone = window.matchMedia('(max-width: 767px)').matches;

  return (
    <>
      <p className={`${subBar} px-3 py-1.5 text-xs text-muted`}>
        Shared with you by link, read-only. It shows the diagram as its owner last saved it, on {dateOf(doc.updatedAt)}.
      </p>
      <div className="md:hidden bg-surface">
        <Tabs
          label="View"
          idPrefix="share-pane"
          fill
          value={pane}
          onChange={setPane}
          items={[
            { id: 'code', label: 'Code', icon: <Code2 size={16} /> },
            { id: 'diagram', label: 'Diagram', icon: <Network size={16} /> },
          ]}
        />
      </div>
      <main className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Code" className={`min-h-0 flex-1 md:border-r-bw-1 md:border-ink ${pane === 'code' ? '' : 'max-md:hidden'}`}>
          <CodeEditor ref={editorRef} value={doc.source} onChange={() => undefined} diagnostics={parsed.diagnostics} nodeIds={NO_IDS} readOnly />
        </section>
        <section aria-label="Diagram and simulation" className={`flex min-h-0 flex-1 flex-col ${pane === 'diagram' ? '' : 'max-md:hidden'}`}>
          <ViewTabs view={view} onChange={setView} results={simulation.results} />
          {view === 'diagram' && current && (
            <div className={`${subBar} flex items-center gap-2 px-3 py-1.5`}>
              {scenarios.length > 1 ? (
                <select
                  aria-label="Scenario"
                  value={selected}
                  onChange={(e) => {
                    setSelected(Number(e.target.value));
                    if (run > 0) setRun((n) => n + 1);
                  }}
                  className={`${field} min-w-0 flex-1 sm:max-w-xs`}
                >
                  {scenarios.map((s, i) => (
                    <option key={s.key} value={i}>
                      {s.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.label}</span>
              )}
              <button type="button" className={primaryButton} onClick={() => setRun((n) => n + 1)}>
                {played ? <RotateCcw size={16} /> : <Play size={16} />}
                <span>{played ? 'Replay' : 'Play'}</span>
              </button>
            </div>
          )}
          <div id={`view-panel-${view}`} className="relative min-h-0 flex-1 bg-paper">
            <Suspense fallback={<PaneLoading />}>
              {view === 'results' ? (
                <ResultsPanel diagram={diagram} analysis={simulation.analysis} results={simulation.results} onSelect={select} />
              ) : view === 'hld' ? (
                <HldView diagram={diagram} nodes={nodes} edges={edges} analysis={simulation.analysis} results={simulation.results} onOpenResults={() => setView('results')} />
              ) : (
                <UseCasePlayback useCase={played} nodes={nodes} edges={edges} onBack={() => setRun(0)} showHeader={false} autoPlay>
                  {(pv) => <DiagramCanvas nodes={pv.nodes} edges={pv.edges} edgeTypes={PLAYBACK_EDGE_TYPES} fitKey={`${pane}:${settled}`} legend={diagram.legend} compact={phone} />}
                </UseCasePlayback>
              )}
            </Suspense>
          </div>
        </section>
      </main>
    </>
  );
}
