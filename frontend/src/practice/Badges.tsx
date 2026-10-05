import { Building2, CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { Status } from './progress';
import type { Problem } from './types';
import Badge from '../design/Badge';
import type { BadgeTone } from '../design/classes';

const DIFFICULTY_TONE: Record<Problem['difficulty'], BadgeTone> = { easy: 'pass', medium: 'yellow', hard: 'pink' };

export function DifficultyBadge({ difficulty }: { difficulty: Problem['difficulty'] }) {
  return <Badge tone={DIFFICULTY_TONE[difficulty]}>{difficulty}</Badge>;
}

export function StatusIcon({ status }: { status: Status }) {
  if (status === 'solved') return <CheckCircle2 size={16} className="flex-shrink-0 text-green-600 dark:text-green-400" aria-label="Solved" />;
  if (status === 'attempted') return <CircleDot size={16} className="flex-shrink-0 text-amber-500 dark:text-amber-400" aria-label="Attempted" />;
  return <Circle size={16} className="flex-shrink-0 text-ink/30" aria-label="To do" />;
}

/** Whose published system the problem is based on (problem.md `company`); not a claim about that company's interviews. */
function companyNote(company: string): string {
  return `Based on a system ${company} published`;
}

export function CompanyBadge({ company }: { company: string }) {
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-ink/60 bg-pop-blue/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink"
      title={companyNote(company)}
      data-company={company}
    >
      <Building2 size={11} aria-hidden="true" />
      <span className="sr-only">Based on a system published by </span>
      {company}
    </span>
  );
}
