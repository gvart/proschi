/** Number formatting shared by test messages, the panels and the CLI. */

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** `950 rps`, `12.5k rps`, `1.2m rps` */
export function formatRps(rps: number): string {
  if (!Number.isFinite(rps)) return '∞ rps';
  if (rps >= 1e6) return `${trim(rps / 1e6, 1)}m rps`;
  if (rps >= 1e3) return `${trim(rps / 1e3, 1)}k rps`;
  return `${trim(rps, rps < 10 ? 2 : 0)} rps`;
}

/** A use case's traffic: `20k rps`, or with a peak `avg 20k · peak 60k rps`. */
export function formatTraffic(rps: number, avgRps?: number): string {
  if (avgRps === undefined || avgRps === rps) return formatRps(rps);
  return `avg ${formatRps(avgRps).replace(/ rps$/, '')} · peak ${formatRps(rps)}`;
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

/** A wait that may be long: `4.5 ms`, `12 s`, `4.2 min`, `3.1 h`; `∞` when it grows without bound. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms < 1000) return formatMs(ms);
  if (ms < 60_000) return `${trim(ms / 1000, ms < 10_000 ? 1 : 0)} s`;
  if (ms < 3_600_000) return `${trim(ms / 60_000, 1)} min`;
  return `${trim(ms / 3_600_000, 1)} h`;
}

/** A count of messages: `950`, `12.5k`, `3.6M`. */
export function formatCount(n: number): string {
  if (n >= 1e9) return `${trim(n / 1e9, 1)}B`;
  if (n >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (n >= 1e3) return `${trim(n / 1e3, 1)}k`;
  return trim(n, 0);
}

/** A queue with a drain rate, as inlay hints show it: `lag 0.8 ms`, or `backlog +3.6M/h` when its consumers fall behind. */
export function formatQueue(q: { backlogPerHour: number; lagMs: number }): string {
  return q.backlogPerHour > 0 ? `backlog +${formatCount(q.backlogPerHour)}/h` : `lag ${formatDuration(q.lagMs)}`;
}

/** `$1,250/month` */
export function formatUsd(usd: number): string {
  return `$${Math.round(usd).toLocaleString('en-US')}/month`;
}
