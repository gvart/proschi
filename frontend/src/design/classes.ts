// The class names behind the design components (styles in components.css), for
// React and for markup that is not React, like the static pages and islands.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type Accent = 'yellow' | 'pink' | 'blue' | 'lilac' | 'pass' | 'fail';
export type BadgeTone = Accent | 'neutral';

function join(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function buttonClass({ variant = 'secondary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return join('ps-btn', `ps-btn--${variant}`, size !== 'md' && `ps-btn--${size}`, className);
}

export function cardClass({ accent, interactive, className }: { accent?: Accent; interactive?: boolean; className?: string } = {}): string {
  return join('ps-card', accent && `ps-card--${accent}`, interactive && 'ps-card--interactive', className);
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

/** Props for the panel a <Tabs> tab controls: spread them on the element that shows `id`'s content. */
export function tabPanelProps(idPrefix: string, id: string) {
  return { role: 'tabpanel', id: `${idPrefix}-panel-${id}`, 'aria-labelledby': tabId(idPrefix, id), tabIndex: 0 } as const;
}

export function badgeClass({ tone = 'neutral', className }: { tone?: BadgeTone; className?: string } = {}): string {
  return join('ps-badge', `ps-badge--${tone}`, className);
}
