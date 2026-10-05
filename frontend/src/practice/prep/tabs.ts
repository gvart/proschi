/**
 * The interview prep hub's sections, in the order its tabs show them. Each is
 * a hash route of the practice page that keeps its own address, so old links
 * (`#/review`, `#/review/<topic>`, `#/challenge`, `#/progress`,
 * `#/roadmap/<id>`) open
 * inside the hub. The problem list (`#/`) is Practice, outside it.
 */

export type PrepTab = 'roadmap' | 'review' | 'challenge' | 'progress';

export interface PrepTabLink {
  id: PrepTab;
  label: string;
  href: string;
}

export const PREP_TABS: PrepTabLink[] = [
  { id: 'roadmap', label: 'Roadmap', href: '#/roadmap' },
  { id: 'review', label: 'Daily review', href: '#/review' },
  { id: 'challenge', label: 'Challenge', href: '#/challenge' },
  { id: 'progress', label: 'Progress', href: '#/progress' },
];

/**
 * The hub's tab for a route (the hash without `#/`), or undefined for a page
 * outside the hub. `#/roadmap/<id>` belongs to the roadmap: a guide, or the
 * roadmap itself shown in place of a locked problem (a problem opened from
 * the roadmap is the problem page, which PracticeApp decides first).
 */
export function prepTabOf(route: string): PrepTab | undefined {
  const [head] = route.split('/');
  return PREP_TABS.find((t) => t.id === head)?.id;
}
