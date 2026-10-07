/**
 * The practice hub's sections, in the order its bar shows them. Each is a
 * hash route of the practice page that keeps its own address, so old links
 * (`#/roadmap/<id>`, `#/review/<topic>`, `#/challenge`, `#/arcade`,
 * `#/arcade/daily`, `#/progress`) open inside the hub with their tab marked.
 * `#/` is the hub's home: the Today panel and the problem list.
 */

export type HubTab = 'problems' | 'roadmap' | 'review' | 'challenge' | 'arcade' | 'progress';

export interface HubTabLink {
  id: HubTab;
  label: string;
  href: string;
}

export const HUB_TABS: HubTabLink[] = [
  { id: 'problems', label: 'Problems', href: '#/' },
  { id: 'roadmap', label: 'Roadmap', href: '#/roadmap' },
  { id: 'review', label: 'Review', href: '#/review' },
  { id: 'challenge', label: 'Challenge', href: '#/challenge' },
  { id: 'arcade', label: 'Arcade', href: '#/arcade' },
  { id: 'progress', label: 'Progress', href: '#/progress' },
];

/**
 * The hub's tab for a route (the hash without `#/`), or undefined for a page
 * outside the hub (a problem, the account page, a profile). The empty route
 * is the problem list. `#/roadmap/<id>` belongs to the roadmap: a guide, or
 * the roadmap itself shown in place of a locked problem (a problem opened
 * from the roadmap is the problem page, which PracticeApp decides first).
 */
export function hubTabOf(route: string): HubTab | undefined {
  if (route === '') return 'problems';
  const [head] = route.split('/');
  if (head === 'problems') return undefined;
  return HUB_TABS.find((t) => t.id === head)?.id;
}
