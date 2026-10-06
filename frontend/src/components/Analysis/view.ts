/** The editor's right-hand views (ViewTabs.tsx). */
export type View = 'diagram' | 'results' | 'hld';

/**
 * The view a name stands for, as in `?view=`. The Analysis and Tests tabs
 * were merged into Results, so links using the old names land there.
 */
export function parseView(name: string | null | undefined): View | undefined {
  switch (name) {
    case 'diagram':
    case 'results':
    case 'hld':
      return name;
    case 'analysis':
    case 'tests':
      return 'results';
    default:
      return undefined;
  }
}
