import type { ReactNode } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { outlineButton, primaryButton } from '../../components/Playground/ui';
import { canOpen, STAGES, stageAt, type StageId, type StageNotes } from './flow';

export interface StageNext {
  label: string;
  onClick: () => void;
  /** The stage's own thinking is done: Next is the loud button. */
  primary: boolean;
}

interface StageBarProps {
  notes: StageNotes;
  /** The stage on screen. */
  shown: StageId;
  hasLesson: boolean;
  onOpen: (stage: StageId) => void;
  next?: StageNext;
  /** The stage's tools (Design: Run tests, Show code, the full editor). */
  tools?: ReactNode;
  /** Phones: Design partner's button, at the bar's end. */
  partner?: ReactNode;
  phone: boolean;
}

/**
 * The rail of stages over a practice problem (P50): Lesson · Clarify ·
 * Estimate · Design · Wrap-up. Every stage up to the furthest reached opens
 * (self-paced, so earlier notes stay editable); later ones wait. On the
 * right, the stage's tools and its Next; on phones Next sits in a bar at the
 * foot of the screen (StageFoot).
 */
export default function StageBar({ notes, shown, hasLesson, onOpen, next, tools, partner, phone }: StageBarProps) {
  const stages = STAGES.filter((s) => hasLesson || s.id !== 'lesson');
  const reachedAt = stageAt(notes.reached);
  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2 border-b-bw-1 border-ink bg-surface px-2 sm:px-3" data-testid="stage-bar">
      <nav aria-label="Steps" className="min-w-0 flex-1 overflow-x-auto">
        <ol className="flex items-center gap-1">
          {stages.map((s, i) => {
            const on = s.id === shown;
            const open = canOpen(notes, s.id);
            const done = s.id !== 'lesson' && stageAt(s.id) < reachedAt && !on;
            const look = on ? 'border-ink bg-pop-yellow text-on-accent' : open ? 'border-ink/40 text-ink hover:border-ink hover:bg-paper' : 'border-ink/15 text-muted';
            const named = on || !phone;
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="h-px w-2 bg-ink/25 sm:w-3" />}
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  disabled={!open}
                  aria-current={on ? 'step' : undefined}
                  aria-label={s.label}
                  title={open ? s.label : `${s.label}: after the steps before it`}
                  className={`flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-full border-bw-1 px-2.5 py-0.5 text-xs font-semibold disabled:cursor-default ${look}`}
                >
                  {done ? <Check size={11} aria-hidden="true" /> : <span className="font-mono">{i + 1}</span>}
                  <span className={named ? '' : 'sr-only'}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {tools}
      {!phone && next && (
        <button type="button" onClick={next.onClick} className={`${next.primary ? primaryButton : outlineButton} shrink-0`} data-testid="stage-next">
          {next.label}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
      {partner}
    </div>
  );
}

/** Phones: the stage's Next at the foot of the screen, in thumb reach. */
export function StageFoot({ next }: { next: StageNext }) {
  return (
    <div className="shrink-0 border-t-bw-1 border-ink bg-surface px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="stage-foot">
      <button type="button" onClick={next.onClick} className={`${next.primary ? primaryButton : outlineButton} w-full justify-center`} data-testid="stage-next">
        {next.label}
        <ArrowRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
