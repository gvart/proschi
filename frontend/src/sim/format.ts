/** Number formatting shared by test messages, the panels and the CLI. */

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** `950 rps`, `12.5k rps`, `1.2m rps` */
export function formatRps(rps: number): string {
  if (!Number.isFinite(rps)) return '∞ rps';
  if (rps >= 1e6) return `${trim(rps / 1e6, 1)}m rps`;
  if (rps >= 1e3) return `${trim(rps / 1e3, 1)}k rps`;
  return `${trim(rps, rps < 10 ? 2 : 0)} rps`;
}

/** `4.5 ms`, `41 ms`, `1200 ms` */
export function formatMs(ms: number): string {
  return `${trim(ms, ms < 100 ? 1 : 0)} ms`;
}

/**
 * A fraction as a percentage with enough nines to tell it apart from 100%:
 * `99.5%`, `99.95%`, `99.9993%`.
 */
export function formatAvailability(fraction: number): string {
  if (fraction >= 1) return '100%';
  const down = (1 - fraction) * 100;
  const digits = Math.min(6, Math.max(1, Math.ceil(-Math.log10(down)) + 1));
  return `${trim(Math.floor(fraction * 100 * 10 ** digits + 1e-6) / 10 ** digits, digits)}%`;
}

/** Utilisation: `42%`, `150%` */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** `$1,250/month` */
export function formatUsd(usd: number): string {
  return `$${Math.round(usd).toLocaleString('en-US')}/month`;
}
