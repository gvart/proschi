import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * The set-up wizard's controls (Setup.tsx): a radio group of large cards or
 * small chips (arrow keys move and choose, Tab lands on the chosen one, as a
 * native radio group), a switch, and the "2 of 4" progress.
 */

export interface RadioOption<T> {
  value: T;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** A small label beside the title, such as "Free". */
  tag?: ReactNode;
  disabled?: boolean;
  testId?: string;
}

interface RadioGroupProps<T> {
  label: string;
  options: readonly RadioOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  variant?: 'card' | 'chip';
  className?: string;
}

export function RadioGroup<T>({ label, options, value, onChange, variant = 'card', className }: RadioGroupProps<T>) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const checkedAt = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = checkedAt >= 0 ? checkedAt : enabled[0];

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.indexOf(i);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={className ?? (variant === 'card' ? 'grid gap-3' : 'flex flex-wrap gap-2')}>
      {options.map((o, i) => {
        const checked = i === checkedAt;
        const common = {
          ref: (el: HTMLButtonElement | null) => void (refs.current[i] = el),
          type: 'button' as const,
          role: 'radio',
          'aria-checked': checked,
          disabled: o.disabled,
          tabIndex: i === tabStop ? 0 : -1,
          onClick: () => onChange(o.value),
          onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
          'data-testid': o.testId,
        };
        if (variant === 'chip') {
          return (
            <button
              key={String(o.value)}
              {...common}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-sm border-bw-1 px-3 py-1.5 text-sm font-semibold transition-colors duration-d1 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-surface text-ink hover:border-ink'}`}
            >
              {o.icon}
              {o.title}
            </button>
          );
        }
        return (
          <button
            key={String(o.value)}
            {...common}
            aria-labelledby={`${id}-${i}-t`}
            aria-describedby={o.description ? `${id}-${i}-d` : undefined}
            className={`group flex w-full items-start gap-4 rounded-brutal border-bw-2 p-4 text-left transition-[translate,box-shadow,border-color,background-color] duration-d1 ease-out-brutal disabled:cursor-not-allowed disabled:opacity-55 sm:p-5 ${
              checked ? 'border-ink bg-pop-yellow/20 shadow-brutal-md' : 'border-ink/25 bg-surface enabled:hover:border-ink enabled:hover:shadow-brutal-sm'
            }`}
          >
            {o.icon && (
              <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-bw-1 border-ink transition-colors duration-d1 ${checked ? 'bg-pop-yellow text-on-accent' : 'bg-paper text-ink'}`}>
                {o.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span id={`${id}-${i}-t`} className="font-display text-lg font-bold leading-tight text-ink">
                  {o.title}
                </span>
                {o.tag}
              </span>
              {o.description && (
                <span id={`${id}-${i}-d`} className="mt-1 block text-sm leading-snug text-ink/75">
                  {o.description}
                </span>
              )}
            </span>
            <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-bw-1 border-ink transition-colors duration-d1 ${checked ? 'bg-ink text-paper' : 'bg-surface text-transparent'}`}>
              <Check size={14} strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small tag on a card: "Free", "Recommended". */
export function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'accent' }) {
  return (
    <span className={`rounded-sm border-bw-1 border-ink px-1.5 py-px text-[11px] font-bold uppercase tracking-[0.06em] ${tone === 'accent' ? 'bg-pop-yellow text-on-accent' : 'bg-paper text-ink'}`}>
      {children}
    </span>
  );
}

/** An on/off switch; `label` is its name for a screen reader. */
export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (on: boolean) => void; label: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} data-testid={testId} className="inline-flex items-center rounded-full p-1">
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-bw-1 border-ink transition-colors duration-d1 ${checked ? 'bg-pop-yellow' : 'bg-paper'}`}>
        <span className={`absolute h-4 w-4 rounded-full border-bw-1 border-ink bg-surface transition-[left] duration-d1 ease-out-brutal ${checked ? 'left-[21px]' : 'left-[3px]'}`} />
      </span>
    </button>
  );
}

/** Where the wizard is: "Step 2 of 4" and a dot per step. */
export function StepDots({ at, of }: { at: number; of: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted" data-testid="setup-progress">
        Step {at + 1} of {of}
      </span>
      <span aria-hidden="true" className="flex items-center gap-1.5">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={`h-2 rounded-full border-bw-1 border-ink transition-[width,background-color] duration-d2 ease-out-brutal ${i === at ? 'w-6 bg-pop-yellow' : i < at ? 'w-2 bg-ink' : 'w-2 bg-transparent opacity-40'}`} />
        ))}
      </span>
    </div>
  );
}
