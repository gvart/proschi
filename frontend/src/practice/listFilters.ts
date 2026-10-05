import type { Problem } from './types';
import type { Status } from './progress';

/** The problem list's filters: '' is "any". */
export interface Filters {
  difficulty: '' | Problem['difficulty'];
  tag: string;
  company: string;
  status: '' | Status;
}

export const NO_FILTERS: Filters = { difficulty: '', tag: '', company: '', status: '' };

export const STATUS_LABEL: Record<Status, string> = { todo: 'To do', attempted: 'Attempted', solved: 'Solved' };

export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The active filters as chips, in the panel's order: each with its label and the field it clears. */
export function activeFilters(filters: Filters): { key: keyof Filters; label: string }[] {
  const out: { key: keyof Filters; label: string }[] = [];
  if (filters.difficulty) out.push({ key: 'difficulty', label: `Difficulty: ${capitalize(filters.difficulty)}` });
  if (filters.tag) out.push({ key: 'tag', label: `Tag: ${filters.tag}` });
  if (filters.company) out.push({ key: 'company', label: `Company: ${filters.company}` });
  if (filters.status) out.push({ key: 'status', label: `Status: ${STATUS_LABEL[filters.status]}` });
  return out;
}
