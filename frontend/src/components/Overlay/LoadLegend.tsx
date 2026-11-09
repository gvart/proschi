import { useEffect, useState } from 'react';
import { loadJson, saveJson } from '../../services/storage';
import { formatMs } from '../../sim/format';
import type { CriticalPathOverlay } from '../../sim/overlay';
import { heat } from '../../utils/heat';
import '../Canvas/canvas.css';

/** Whether this viewer keeps the legend open; unset until the first view, which shows it open (folded on phones). */
const OPEN_KEY = 'proschi.canvas.loadLegend';

/** The bands of `heat`, by the utilisation each starts at. */
const BANDS = [
  { u: 0, label: '0' },
  { u: 0.4, label: '40' },
  { u: 0.7, label: '70' },
  { u: 0.9, label: '90' },
  { u: 1, label: '100%' },
];

/**
 * What the load overlay's colours and marks mean: the utilisation scale that
 * nodes and the edges into them share, the bold p99 path and the bottleneck
 * ring. A small card that folds to one line: open on the first view, then
 * folded unless the viewer opens it again (remembered).
 */
export default function LoadLegend({ critical, folded }: { critical?: CriticalPathOverlay; folded: boolean }) {
  const [stored] = useState(() => loadJson<boolean | null>(OPEN_KEY, null));
  /** Open or folded by this viewer (remembered), else nothing yet. */
  const [chosen, setChosen] = useState<boolean | null>(stored);
  // Open on the first view where there is room for it (not on a phone or in a narrow pane), then folded until opened.
  const open = chosen ?? !folded;
  // Seen once: from the next view on it starts folded, until opened again.
  useEffect(() => {
    if (stored === null) saveJson(OPEN_KEY, false);
  }, [stored]);
  return (
    <details
      className="pc-legend pc-load-legend"
      open={open}
      aria-label="Load legend"
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        setChosen(next);
        saveJson(OPEN_KEY, next);
      }}
    >
      <summary className="pc-legend__title">Load</summary>
      <div className="pc-load-legend__scale" aria-hidden="true">
        {BANDS.map((b) => (
          <span key={b.u} className="pc-load-legend__band">
            <span className="pc-load-legend__swatch" style={{ background: heat(b.u) }} />
            {b.label}
          </span>
        ))}
      </div>
      <p className="sr-only">Nodes and the connections into them turn pale yellow from 40% of capacity, yellow at 70%, pink at 90% and red at 100%.</p>
      {critical && (
        <div className="pc-legend__row">
          <span className="pc-load-legend__path" aria-hidden="true" />
          <span>
            p99 path of “{critical.useCase}”: {formatMs(critical.p99Ms)}
          </span>
        </div>
      )}
      <div className="pc-legend__row">
        <span className="pc-load-legend__ring" aria-hidden="true" />
        <span>Bottleneck: at 70% or more</span>
      </div>
      <div className="pc-legend__row pc-load-legend__note">Edges: requests · the latency they add</div>
    </details>
  );
}
