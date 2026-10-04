// Tailwind class strings for the editor's and practice's toolbars, on the
// design tokens (src/design/tokens.css): quiet until hovered, then the same
// lift-onto-a-hard-shadow as the design system's buttons.

const lift =
  'transition-[transform,box-shadow,background-color,border-color] duration-d1 hover:-translate-x-px hover:-translate-y-px active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none';

/** A borderless toolbar button: shows its edge and shadow on hover. */
export const toolButton = `inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-2 sm:py-1.5 rounded border-bw-1 border-transparent text-ink hover:border-ink hover:bg-surface hover:shadow-brutal-sm ${lift}`;

/** An outlined toolbar button (Share, Back to diagram). */
export const outlineButton = `inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 sm:py-1.5 rounded border-bw-1 border-ink bg-surface text-ink shadow-brutal-sm hover:shadow-brutal-md ${lift}`;

/** The one loud button of a bar (Play, Run tests). */
export const primaryButton = `inline-flex items-center gap-1.5 text-sm font-bold px-3 py-2 sm:py-1.5 rounded border-bw-1 border-ink bg-pop-yellow text-on-accent shadow-brutal-sm hover:shadow-brutal-md ${lift}`;

/** A square icon-only toolbar button. */
export const iconButton = `inline-flex items-center justify-center w-9 h-9 rounded border-bw-1 border-transparent text-ink hover:border-ink hover:bg-surface hover:shadow-brutal-sm aria-pressed:bg-pop-yellow aria-pressed:text-on-accent aria-pressed:border-ink ${lift}`;

/** Native selects and inputs. */
export const field = 'text-sm rounded border-bw-1 border-ink bg-surface text-ink px-2 py-2 sm:py-1.5 disabled:text-muted disabled:border-ink/30';

/** A bar under the header (tabs, scenarios, captions). */
export const subBar = 'bg-surface border-b-bw-1 border-ink';

/** Small uppercase label, like "Scenarios". */
export const eyebrow = 'text-[11px] font-bold uppercase tracking-[0.08em] text-muted';
