import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { Status } from './progress';
import type { Problem } from './types';

const DIFFICULTY_STYLE: Record<Problem['difficulty'], string> = {
  easy: 'text-green-700 bg-green-50 border-green-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  hard: 'text-red-700 bg-red-50 border-red-200',
};

export function DifficultyBadge({ difficulty }: { difficulty: Problem['difficulty'] }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_STYLE[difficulty]}`}>{difficulty}</span>;
}

export function StatusIcon({ status }: { status: Status }) {
  if (status === 'solved') return <CheckCircle2 size={16} className="flex-shrink-0 text-green-600" aria-label="Solved" />;
  if (status === 'attempted') return <CircleDot size={16} className="flex-shrink-0 text-amber-500" aria-label="Attempted" />;
  return <Circle size={16} className="flex-shrink-0 text-gray-300" aria-label="To do" />;
}
