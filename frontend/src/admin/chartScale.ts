/** The admin charts' scales (Chart.tsx, Sparkline.tsx): clean y-axis ticks and the change between two periods. */

/**
 * The y-axis's top and its ticks, three clean numbers from 0: the smallest
 * step of 1, 2, 2.5 or 5 × 10ⁿ whose double covers `max`; whole numbers only
 * when every value is one (a count never gets a 0.5 tick).
 */
export function niceTicks(max: number, integers: boolean): number[] {
  if (!(max > 0)) return [0, integers ? 1 : 0.5, integers ? 2 : 1];
  const raw = max / 2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  if (integers) step = Math.max(1, Math.ceil(step));
  return [0, step, 2 * step];
}

/**
 * A line's axis: from 0 like a bar's, unless every value sits in the top
 * half of that (a level such as weekly actives), when the axis starts at a
 * clean number below the lowest value, so the line's movement shows. Bars
 * always start at 0: their length is the value.
 */
export function lineTicks(min: number, max: number, integers: boolean): number[] {
  // A flat line (no movement to show) keeps the axis from 0.
  if (!(min > max / 2) || max - min < max / 100) return niceTicks(max, integers);
  for (const candidate of niceSteps(max - min, integers)) {
    const low = Math.floor(min / candidate) * candidate;
    if (low + 2 * candidate >= max) return [low, low + candidate, low + 2 * candidate];
  }
  return niceTicks(max, integers);
}

/** Clean steps from about half of `span` upwards: 1, 2, 2.5 and 5 × 10ⁿ. */
function niceSteps(span: number, integers: boolean): number[] {
  const raw = Math.max(span, 1e-9) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((m) => m * magnitude).filter((s) => s >= raw && (!integers || Number.isInteger(s)));
  return steps.length ? steps : [Math.max(1, Math.ceil(raw))];
}

/** The relative change from `previous` to `current`, or null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** `days` from the end of `values`, and the same number before them: this period and the one before. */
export function periods<T>(values: T[], days: number): { current: T[]; previous: T[] } {
  return { current: values.slice(-days), previous: values.slice(-2 * days, -days) };
}

export const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);
