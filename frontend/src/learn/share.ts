/**
 * Text to share results with: a daily Scale or Fail run, a first solve, a
 * badge. Pure and platform-neutral, so the web page and a future app word
 * them the same. Links are absolute (proschi.app), since the text is pasted
 * elsewhere; public profiles have addresses of their own, /u/<id> (the
 * Worker's src/profilePage.ts).
 */

export const SITE = 'https://proschi.app';

/** Opens today's daily run of Scale or Fail. */
export const ARCADE_DAILY_LINK = `${SITE}/practice/#/arcade/daily`;

/** A problem's own page (practice/<id>/, frontend/plugins/practicePages.ts). */
export const problemLink = (id: string): string => `${SITE}/practice/${encodeURIComponent(id)}/`;

/** A user's public profile (shown only when they opted in). */
export const profileLink = (userId: string): string => `${SITE}/u/${encodeURIComponent(userId)}`;

/** How a wave went: no breach, survived with breaches, or lost. */
export type WaveMark = 'clean' | 'hit' | 'lost';

export const WAVE_EMOJI: Record<WaveMark, string> = { clean: '🟩', hit: '🟨', lost: '🟥' };

/** A wave's mark from its summary (frontend/src/game/engine/run.ts WaveSummary). */
export function waveMark(wave: { clean: boolean; survived: boolean }): WaveMark {
  return !wave.survived ? 'lost' : wave.clean ? 'clean' : 'hit';
}

const thousands = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Proschi Scale or Fail · daily 2026-10-06
 * 🟩🟩🟨🟥
 * Score 12,340 · #7 today
 * https://proschi.app/practice/#/arcade/daily
 */
export function arcadeShareText(run: { day: string; waves: readonly WaveMark[]; score: number; rank?: number | null }): string {
  const marks = run.waves.map((w) => WAVE_EMOJI[w]).join('');
  const rank = run.rank != null && run.rank > 0 ? ` · #${run.rank} today` : '';
  return [`Proschi Scale or Fail · daily ${run.day}`, marks, `Score ${thousands(run.score)}${rank}`, ARCADE_DAILY_LINK].filter(Boolean).join('\n');
}

/** "Beat my score: 12,340 in today's Proschi Scale or Fail daily run. https://…" */
export function arcadeChallengeText(score: number): string {
  return `Beat my score: ${thousands(score)} in today’s Proschi Scale or Fail daily run. ${ARCADE_DAILY_LINK}`;
}

/** A ratio as a multiple: 0.8×, 1.3×, 12×, 0.05×. */
export function multiple(ratio: number): string {
  const digits = ratio >= 10 ? 0 : ratio >= 0.1 ? 1 : 2;
  return `${ratio.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}×`;
}

/** Milliseconds as the page shows them: 140 ms, 8.5 ms, 1.2 s. */
function ms(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')} s`;
  return `${n < 100 ? Math.round(n * 10) / 10 : Math.round(n)} ms`;
}

/**
 * I solved Ticket Booking on Proschi at 0.8× the reference cost and p99 140 ms
 * https://proschi.app/practice/ticket-booking/
 */
export function solveShareText(solve: { id: string; title: string; costUsd?: number; referenceCostUsd?: number; p99Ms?: number }): string {
  const parts: string[] = [];
  if (solve.costUsd !== undefined && solve.referenceCostUsd !== undefined && solve.referenceCostUsd > 0 && Number.isFinite(solve.costUsd)) {
    parts.push(`${multiple(solve.costUsd / solve.referenceCostUsd)} the reference cost`);
  }
  if (solve.p99Ms !== undefined && Number.isFinite(solve.p99Ms)) parts.push(`p99 ${ms(solve.p99Ms)}`);
  const how = parts.length === 2 ? ` at ${parts[0]} and ${parts[1]}` : parts[0]?.startsWith('p99') ? ` with ${parts[0]}` : parts.length ? ` at ${parts[0]}` : '';
  return `I solved ${solve.title} on Proschi${how}\n${problemLink(solve.id)}`;
}

/** I earned the “Hundred club” badge on Proschi\nhttps://proschi.app/u/<id> */
export function badgeShareText(badge: { title: string; userId: string }): string {
  return `I earned the “${badge.title}” badge on Proschi\n${profileLink(badge.userId)}`;
}

/** A public profile: "My system design practice on Proschi" for one's own, "<name> on Proschi" for someone else's, and the link. */
export function profileShareText(profile: { displayName: string; userId: string; own: boolean }): string {
  return `${profile.own ? 'My system design practice on Proschi' : `${profile.displayName} on Proschi`}\n${profileLink(profile.userId)}`;
}
