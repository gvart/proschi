import type { Quantity } from './types';

/**
 * Reads the value of a `quantity` (or `number`) token: a number, an optional
 * magnitude (k, m, b) and an optional unit (docs/design/hld-and-practice.md
 * §1.1). Rates come back in requests per second and durations in
 * milliseconds. A number without a unit has no `unit`.
 */
export function parseQuantity(text: string): { value: number; unit?: Quantity['unit'] } | { error: string } {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(text.replace(/\s+/g, ''));
  if (!m) return { error: `'${text}' is not a number` };
  const number = Number(m[1]);
  const suffix = m[2];

  const unit = UNITS.get(suffix);
  if (suffix === '' || unit) return unit ? { value: round(number * unit.factor), unit: unit.unit } : { value: number };

  // `ms` is milliseconds, never mega-seconds: a whole unit wins over magnitude + unit.
  const magnitude = MAGNITUDES.get(suffix[0]);
  const rest = suffix.slice(1);
  const after = UNITS.get(rest);
  if (magnitude && (rest === '' || after)) {
    return after ? { value: round(number * magnitude * after.factor), unit: after.unit } : { value: round(number * magnitude) };
  }
  return { error: `Unknown unit '${suffix}' in '${text}'; use rps, rpm, rpd, ms, s, % or usd/month (with k, m or b for thousands, millions, billions)` };
}

/** Drops floating point noise such as 1.15k = 1149.9999999999998. */
const round = (n: number) => Number(n.toPrecision(12));

const MAGNITUDES = new Map([
  ['k', 1e3],
  ['m', 1e6],
  ['b', 1e9],
]);

const UNITS = new Map<string, { unit: Quantity['unit']; factor: number }>([
  ['rps', { unit: 'rps', factor: 1 }],
  ['rpm', { unit: 'rps', factor: 1 / 60 }],
  ['rpd', { unit: 'rps', factor: 1 / 86_400 }],
  ['ms', { unit: 'ms', factor: 1 }],
  ['s', { unit: 'ms', factor: 1000 }],
  ['%', { unit: '%', factor: 1 }],
  ['usd/month', { unit: 'usd/month', factor: 1 }],
]);
