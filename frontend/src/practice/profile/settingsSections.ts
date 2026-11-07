/** The settings page's sections (`#/me`), in page order: the side list and the phone's jump menu follow it. */
export const SECTIONS = [
  { id: 'plan', title: 'Plan & billing' },
  { id: 'profile', title: 'Profile' },
  { id: 'learning', title: 'Learning' },
  { id: 'notifications', title: 'Notifications' },
  { id: 'accounts', title: 'Connected accounts' },
  { id: 'data', title: 'Data & privacy' },
  { id: 'danger', title: 'Danger zone' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** The element id of a section, the target of the side list's entries. */
export const sectionAnchor = (id: SectionId) => `settings-${id}`;
