/**
 * The practice hub's sections. Each is a hash route of the practice page that
 * keeps its own address, so old links (`#/roadmap/<id>`, `#/review/<topic>`,
 * `#/challenge`, `#/arcade`, `#/arcade/daily`, `#/progress`) open inside the
 * hub with their section marked. `#/` is the hub's home: the problem list.
 *
 * The bar (PracticeHub.tsx) puts the problems first, groups the rest by what
 * they are for (HUB_GROUPS: interview prep, more practice) and ends with
 * progress.
 */

export type HubTab = 'problems' | 'roadmap' | 'review' | 'challenge' | 'arcade' | 'progress';

export interface HubTabLink {
  id: HubTab;
  label: string;
  href: string;
  /** One line under the label in its group's menu. */
  about?: string;
}

export const HUB_TABS: HubTabLink[] = [
  { id: 'problems', label: 'Problems', href: '#/' },
  { id: 'roadmap', label: 'Roadmap', href: '#/roadmap', about: 'The problems in order, from basics to interview level' },
  { id: 'review', label: 'Review cards', href: '#/review', about: 'A few flashcards a day, so concepts stick' },
  { id: 'challenge', label: 'Daily challenge', href: '#/challenge', about: 'Five quick questions, new every day' },
  { id: 'arcade', label: 'Arcade', href: '#/arcade', about: 'Scale or Fail, the system design game' },
  { id: 'progress', label: 'Progress', href: '#/progress' },
];

export interface HubGroup {
  id: 'prep' | 'more';
  label: string;
  /** Shorter, for phones. */
  short: string;
  tabs: HubTab[];
}

/** The bar's two menus. The mock interview joins interview prep (it opens on a problem, not a section). */
export const HUB_GROUPS: HubGroup[] = [
  { id: 'prep', label: 'Interview prep', short: 'Interview', tabs: ['roadmap'] },
  { id: 'more', label: 'More practice', short: 'More', tabs: ['review', 'challenge', 'arcade'] },
];

export const tabLink = (id: HubTab): HubTabLink => HUB_TABS.find((t) => t.id === id)!;

/** The problem the bar's "Mock interview" opens on: a classic first interview question. */
export const MOCK_PROBLEM = 'url-shortener';
export const mockInterviewHref = (problemId = MOCK_PROBLEM) => `#/${problemId}?interview=mock`;

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
