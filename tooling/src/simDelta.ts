/**
 * The simulation half of a design diff as text and JSON
 * (frontend/src/sim/delta.ts), for `proschi diff` (designDiff.ts) and
 * `proschi versions diff` (versions.ts).
 */
import { deltaRows, type DeltaRow, type DesignDelta, type ParseResult } from './proschi';

const MARK = { better: 'better', worse: 'worse', same: '' } as const;

/** The change without the `before→after` the table already shows: `+$650/mo`, `✓ now passes`, `saturated`. */
const note = (change: string) => (change === 'same' ? '' : change.replace(/^[^,]*→[^,]*(, )?/, ''));

function table(title: string, rows: DeltaRow[]): string[] {
  if (!rows.length) return [];
  const cells = rows.map((r) => [r.label, r.before, '→', r.after, note(r.change), MARK[r.tone]]);
  const widths = cells[0].map((_, i) => Math.max(...cells.map((c) => c[i].length)));
  return [title, ...cells.map((c) => `  ${c.map((x, j) => (j === c.length - 1 ? x : x.padEnd(widths[j]))).join('  ')}`.trimEnd())];
}

/** The simulation half as text, or '' when the change moves none of its numbers. */
export function formatDelta(delta: DesignDelta): string {
  const rows = deltaRows(delta);
  const moved = [...rows.headline, ...rows.useCases].some((r) => r.change !== 'same') || rows.checks.length > 0 || rows.utilization.length > 0;
  if (!moved) return '';
  const { before, after } = delta.checks;
  const lines = [
    ...table('Simulation', rows.headline),
    ...(before.total + after.total > 0 ? [`  Checks: ${before.passed} of ${before.total} pass → ${after.passed} of ${after.total} pass`] : []),
  ];
  for (const [title, list] of [
    ['Checks that changed', rows.checks],
    ['Per use case', rows.useCases],
    ['Load that moved', rows.utilization],
  ] as const) {
    const t = table(title, list);
    if (t.length) lines.push('', ...t);
  }
  return lines.join('\n');
}

/** The delta for --json: the numbers, without the structural diff it carries (printed beside it). */
export const deltaJson = ({ diff: _diff, ...rest }: DesignDelta) => (void _diff, rest);

/** Warns on stderr about a side that has errors: the diff covers what parsed. */
export function warnErrors(sides: [string, ParseResult][], err: (s: string) => void): void {
  for (const [what, r] of sides) {
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
    if (errors) err(`warning: ${what} has ${errors} error(s); the diff covers what parsed`);
  }
}
