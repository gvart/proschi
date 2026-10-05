/**
 * One moment at a time: when a celebration appears (a session's summary, a
 * first solve, with its burst of confetti), other pop-ups such as the
 * new-badge toast wait until it has had its moment instead of landing on top
 * of it.
 */

/** How long a celebration keeps the stage: the burst (about 1.2 s) and a beat after it. */
export const CELEBRATION_MS = 1600;

let quietUntil = 0;

/** A celebration just appeared. */
export function announceCelebration(ms = CELEBRATION_MS): void {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}

/** Milliseconds until a celebration that just appeared is done (0 when none is). */
export function celebrationWait(): number {
  return Math.max(0, quietUntil - Date.now());
}
