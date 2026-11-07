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
