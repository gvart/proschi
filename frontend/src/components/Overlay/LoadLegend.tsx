import { formatMs } from '../../sim/format';
import type { CriticalPathOverlay } from '../../sim/overlay';
import { heat } from '../../utils/heat';
import '../Canvas/canvas.css';

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
 * ring. Folded on phones, where it would cover the diagram.
 */
export default function LoadLegend({ critical, folded }: { critical?: CriticalPathOverlay; folded: boolean }) {
  return (
    <details className="pc-legend pc-load-legend" open={!folded} aria-label="Load legend">
      <summary className="pc-legend__title">Utilisation</summary>
      <div className="pc-load-legend__scale" aria-hidden="true">
        {BANDS.map((b) => (
          <span key={b.u} className="pc-load-legend__band">
            <span className="pc-load-legend__swatch" style={{ background: heat(b.u) }} />
            {b.label}
          </span>
        ))}
      </div>
      <p className="sr-only">Nodes and the connections into them turn pale yellow from 40%, yellow at 70%, pink at 90% and red at 100% of capacity.</p>
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
        <span>Bottleneck: the busiest node</span>
      </div>
      <div className="pc-legend__row pc-load-legend__note">Edges: requests · the latency they add</div>
    </details>
  );
}
