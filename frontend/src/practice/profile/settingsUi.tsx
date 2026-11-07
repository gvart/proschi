import type { ReactNode } from 'react';
import { outlineButton } from '../../components/Playground/ui';
import { sectionAnchor, type SectionId } from './settingsSections';

/**
 * The building blocks of the settings page (`#/me`, AccountRoute.tsx): a
 * section (a heading, a one-line description and one light card), the rows
 * inside it (label and help on the left, the control on the right), the
 * switch, and the inline "are you sure" every destructive action asks.
 */

export function Section({ id, title, description, danger = false, children }: { id: SectionId; title: string; description: ReactNode; danger?: boolean; children: ReactNode }) {
  const heading = `${sectionAnchor(id)}-title`;
  return (
    <section id={sectionAnchor(id)} aria-labelledby={heading} data-settings-section={id} className="scroll-mt-36 min-[900px]:scroll-mt-24">
      <h2 id={heading} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
        {title}
      </h2>
      <p className="mt-1 max-w-[65ch] text-sm text-muted">{description}</p>
      <div
        className={`mt-3 divide-y rounded-brutal border-bw-1 bg-surface ${danger ? 'divide-red-700/25 border-red-700 dark:divide-red-400/25 dark:border-red-400' : 'divide-ink/15 border-ink'}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: `label` (a heading, or a <label> when `htmlFor` names the
 * control) and `help` on the left, `control` on the right (below on
 * phones), and `children` under both, e.g. a confirmation or a form.
 */
export function Row({
  label,
  labelId,
  htmlFor,
  help,
  control,
  inline = false,
  children,
}: {
  label: ReactNode;
  /** The label's id, for a control labelled by it. */
  labelId?: string;
  htmlFor?: string;
  help?: ReactNode;
  control?: ReactNode;
  /** Keeps a small control (a switch) on the right on phones too. */
  inline?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className={`flex gap-3 sm:items-center sm:justify-between sm:gap-6 ${inline ? 'flex-row items-start justify-between' : 'flex-col sm:flex-row'}`}>
        <div className="min-w-0 max-w-[65ch] flex-1">
          {htmlFor ? (
            <label id={labelId} htmlFor={htmlFor} className="cursor-pointer text-sm font-semibold text-ink">
              {label}
            </label>
          ) : (
            <h3 id={labelId} className="text-sm font-semibold text-ink">
              {label}
            </h3>
          )}
          {help && <div className="mt-0.5 text-sm text-muted">{help}</div>}
        </div>
        {control && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** A checkbox drawn as a switch (with role="switch"): a pill, yellow when on. */
export const switchInput =
  "relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border-bw-1 border-ink bg-paper transition-colors duration-d1 before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-ink before:transition-transform before:duration-d1 before:content-[''] checked:bg-pop-yellow checked:before:translate-x-5 checked:before:bg-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButton = `${outlineButton} !border-red-700 !text-red-700 dark:!border-red-400 dark:!text-red-300`;

/** The second click of a destructive action: `question`, the red `yes`, and Cancel. */
export function Confirm({ question, yes, onYes, onCancel }: { question: string; yes: string; onYes: () => void; onCancel: () => void }) {
  return (
    <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-sm bg-red-700/5 p-3 text-sm text-ink dark:bg-red-400/10">
      <span className="mr-1 basis-full font-semibold sm:basis-auto">{question}</span>
      <button type="button" className={dangerButton} onClick={onYes}>
        {yes}
      </button>
      <button type="button" className={outlineButton} onClick={onCancel}>
        Cancel
      </button>
    </p>
  );
}
