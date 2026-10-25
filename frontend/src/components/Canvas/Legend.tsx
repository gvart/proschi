import type { CSSProperties } from 'react';
import { cssTint } from '../../dsl/palette';
import type { LegendEntry } from '../../dsl/types';
import './canvas.css';

/**
 * The `legend` block, drawn in the canvas's top-right corner: one row per entry, with a
 * swatch in the entry's fill, border color and dash. The image export copies
 * this element next to the diagram (exportDiagram.ts).
 */
export default function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className="pc-legend" role="list" aria-label="Legend">
      <div className="pc-legend__title">Legend</div>
      {entries.map((entry) => (
        <div key={entry.id} className="pc-legend__row" role="listitem">
          <span className="pc-legend__swatch" style={swatchStyle(entry)} aria-hidden="true" />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  );
}

function swatchStyle(entry: LegendEntry): CSSProperties {
  const tint = entry.color ? cssTint(entry.color) : undefined;
  return {
    ...(tint ? { background: tint.fill, borderColor: tint.line } : {}),
    ...(entry.dash ? { borderStyle: entry.dash } : {}),
  };
}
