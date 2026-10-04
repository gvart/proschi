import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
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
