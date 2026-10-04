import { useMemo, useState } from 'react';
import { parse } from '../dsl';
import { encodeShareHash, type PlaybackTarget } from '../playground/share';
import DiagramCanvas from '../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../components/Diagram/useDiagramLayout';
import { UseCasePlayer } from '../components/UseCases/UseCasePlayback';
import './live.css';

interface LiveExampleProps {
  source: string;
  /** The way from this page to the site root, for the editor link. */
  siteRoot: string;
}

/**
 * A docs example come alive: the diagram the code above it draws, a picker for
 * its scenarios, Play to run one over the diagram, and a link that opens the
 * code in the editor. Nothing is saved: the editor gets the code in the link.
 */
export default function LiveExample({ source, siteRoot }: LiveExampleProps) {
  const diagram = useMemo(() => parse(source).diagram, [source]);
  const { nodes, edges } = useDiagramLayout(diagram);
  const scenarios = useMemo(
    () =>
      diagram.useCases.flatMap((u) =>
        u.scenarios
          .filter((s) => s.steps.length > 0)
          .map((s) => ({
            key: `${u.id}/${s.id}`,
            label: u.scenarios.length > 1 ? `${u.name} › ${s.name}` : u.name,
            target: { useCase: u.id, ...(u.scenarios.length > 1 ? { scenario: s.id } : {}), step: 1 } as PlaybackTarget,
            played: { id: `${u.id}/${s.id}`, name: u.name, steps: s.steps, condition: s.condition },
          })),
      ),
    [diagram],
  );
  const [selected, setSelected] = useState(0);
  // Bumped by Play, so pressing it again restarts the player.
  const [run, setRun] = useState(0);
  const current = scenarios[Math.min(selected, scenarios.length - 1)];
  const playing = run > 0 && current;
  const editor = `${siteRoot}app/${encodeShareHash(source, playing ? current.target : undefined)}`;
  const label = `Diagram of the example${playing ? `, playing ${current.label}` : ''}`;

  return (
    <div className="live__island">
      <div className="live__bar">
        {scenarios.length > 1 && (
          <label className="live__pick">
            <span className="live__pick-label">Scenario</span>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(Number(e.target.value));
                if (run > 0) setRun((n) => n + 1);
              }}
            >
              {scenarios.map((s, i) => (
                <option key={s.key} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {scenarios.length === 1 && <span className="live__pick-label live__single">{current.label}</span>}
        <span className="live__spacer" />
        {current && (
          <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => setRun((n) => n + 1)}>
            <svg className="ps-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5v14l11-7z" fill="currentColor" />
            </svg>
            {playing ? 'Replay' : 'Play'}
          </button>
        )}
        <a className="ps-btn ps-btn--sm" href={editor}>
          Open in editor
          <svg className="ps-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
      <div className={`live__stage ps-light ${playing ? 'live__stage--playing' : ''}`} role="region" aria-label={label}>
        {playing ? (
          <UseCasePlayer
            key={`${current.key}#${run}`}
            useCase={current.played}
            nodes={nodes}
            edges={edges}
            onBack={() => setRun(0)}
            showHeader={false}
            autoPlay
          />
        ) : (
          <DiagramCanvas nodes={nodes} edges={edges} compact />
        )}
      </div>
    </div>
  );
}
