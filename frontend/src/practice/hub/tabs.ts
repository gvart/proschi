/**
 * The practice hub's sections. Each is a hash route of the practice page that
 * keeps its own address, so old links (`#/roadmap/<id>`, `#/review/<topic>`,
 * `#/challenge`, `#/arcade`, `#/arcade/daily`, `#/progress`) open inside the
 * hub with their section marked. `#/` is the hub's home: the problem list.
 *
 * The bar (PracticeHub.tsx) is flat: Roadmap (the guided path), All problems
 * (the open list), Mock interview (its set-up), one Daily menu (HUB_GROUPS:
 * review cards, the daily challenge, the Arcade) and Progress at the end.
 */

export type HubTab = 'roadmap' | 'problems' | 'interview' | 'review' | 'challenge' | 'arcade' | 'progress';

export interface HubTabLink {
  id: HubTab;
  label: string;
  /** Shorter, for phones (the full label stays its accessible name). */
  short?: string;
  href: string;
  /** One line under the label in its group's menu. */
  about?: string;
}

export const HUB_TABS: HubTabLink[] = [
  { id: 'roadmap', label: 'Roadmap', href: '#/roadmap' },
  { id: 'problems', label: 'All problems', short: 'Problems', href: '#/' },
  { id: 'interview', label: 'Mock interview', short: 'Mock', href: '#/interview' },
  { id: 'review', label: 'Review cards', href: '#/review', about: 'A few flashcards a day, so concepts stick' },
  { id: 'challenge', label: 'Daily challenge', href: '#/challenge', about: 'Five quick questions, new every day' },
  { id: 'arcade', label: 'Arcade', href: '#/arcade', about: 'Scale or Fail, the system design game' },
  { id: 'progress', label: 'Progress', href: '#/progress' },
];

/** The bar's links before its menu, in order (Progress comes after the menu). */
export const BAR_TABS: HubTab[] = ['roadmap', 'problems', 'interview'];

export interface HubGroup {
  id: 'daily';
  label: string;
  tabs: HubTab[];
}

/** The bar's one menu: the few minutes a day. */
export const HUB_GROUPS: HubGroup[] = [{ id: 'daily', label: 'Daily', tabs: ['review', 'challenge', 'arcade'] }];

export const tabLink = (id: HubTab): HubTabLink => HUB_TABS.find((t) => t.id === id)!;

/** The mock interview's set-up, which picks the problem (practice/interview). */
export const mockInterviewHref = () => '#/interview';

/**
 * The hub's tab for a route (the hash without `#/`), or undefined for a page
 * outside the hub (a problem, the account page, a profile, a mock interview's
 * room or result). The empty route is the problem list. `#/roadmap/<id>`
 * belongs to the roadmap: a guide, or the roadmap itself shown in place of a
 * locked problem (a problem opened from the roadmap is the problem page,
 * which PracticeApp decides first). `#/interview` is the mock interview's
 * set-up; `#/interview/<id>` its room, which stays bare.
 */
export function hubTabOf(route: string): HubTab | undefined {
  if (route === '') return 'problems';
  const [head, rest] = route.split('/');
  if (head === 'problems' || (head === 'interview' && rest !== undefined)) return undefined;
  return HUB_TABS.find((t) => t.id === head)?.id;
}
