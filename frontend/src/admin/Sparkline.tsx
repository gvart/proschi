const W = 120;
const H = 32;

/**
 * A stat tile's trend: the period before in the de-emphasis grey, this
 * period in the accent, on one y-scale from 0.
 * Decorative: the tile's value and change say the same in words.
 */
export default function Sparkline({ previous, current }: { previous: number[]; current: number[] }) {
  const values = [...previous, ...current];
  const n = values.length;
  if (n < 2) return null;
  const max = Math.max(1e-9, ...values);
  const x = (i: number) => (i / (n - 1)) * W;
  // 2px of air top and bottom, so the 2px stroke isn't cut.
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const line = (from: number, to: number) =>
    values
      .slice(from, to)
      .map((v, i) => `${x(from + i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
  const split = previous.length;
  return (
    <svg className="adm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {split > 0 && <polyline className="adm-spark__before" points={line(0, split + 1)} vectorEffect="non-scaling-stroke" />}
      <polyline className="adm-spark__now" points={line(Math.max(0, split), n)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
