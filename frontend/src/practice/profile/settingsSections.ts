import { showsUpgrade, type FeatureState } from '../../components/featureState';

/** The settings page's sections (`#/me`), in page order: the side list and the phone's jump menu follow it. */
export const SECTIONS = [
  { id: 'plan', title: 'Plan & billing' },
  { id: 'profile', title: 'Profile' },
  { id: 'learning', title: 'Learning' },
  { id: 'exports', title: 'Exports & certificate' },
  { id: 'notifications', title: 'Notifications' },
  { id: 'accounts', title: 'Connected accounts' },
  { id: 'data', title: 'Data & privacy' },
  { id: 'danger', title: 'Danger zone' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** The element id of a section, the target of the side list's entries. */
export const sectionAnchor = (id: SectionId) => `settings-${id}`;

/** Whether a paid row for `state` shows (Exports & certificate, ExportsSection.tsx): on, still loading, or with the way to the plan. */
export const shownRow = (state: FeatureState) => state.ok || state.loading || showsUpgrade(state);

/** Whether Exports & certificate has a row for these answers: AccountRoute leaves it and its entry in the side list out otherwise. */
export const exportsShown = (states: FeatureState[]) => states.some(shownRow);
