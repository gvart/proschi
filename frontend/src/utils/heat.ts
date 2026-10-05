/** Fill for a utilisation: calm paper, then yellow, pink, red; grey when down. Shared by the editor's overlay and the Arcade. */
export function heat(u: number | undefined, down = false): string {
  if (down) return 'rgb(var(--c-muted) / 0.35)';
  if (u === undefined || u < 0.4) return 'rgb(var(--c-surface))';
  if (u < 0.7) return 'rgb(var(--c-yellow) / 0.45)';
  if (u < 0.9) return 'rgb(var(--c-yellow))';
  if (u < 1) return 'rgb(var(--c-pink))';
  return 'rgb(var(--c-fail))';
}
