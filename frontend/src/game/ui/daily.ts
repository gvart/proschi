/**
 * The daily run played in this browser (signed out, or in a build without
 * accounts): its UTC day and score. Kept apart from the engine so the
 * practice hub's Today panel can read it without loading the game.
 */

export const DAILY_KEY = 'proschi.game.daily';

export function localDaily(): { day: string; score: number } | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DAILY_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return undefined;
    const { day, score } = value as { day?: unknown; score?: unknown };
    return typeof day === 'string' && typeof score === 'number' ? { day, score } : undefined;
  } catch {
    return undefined;
  }
}
