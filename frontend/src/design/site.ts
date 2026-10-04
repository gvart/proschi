// Where the header and footer link to. Paths are relative to the site root;
// `siteHref` prefixes them with the page's way back to it ('./' or '../'),
// so the links work under any sub-path, like the rest of the build.

export type SitePage = 'home' | 'editor' | 'practice' | 'docs';

export interface SiteLink {
  label: string;
  /** A path from the site root, or an absolute URL. */
  href: string;
  /** The page this link is "you are here" for. */
  page?: SitePage;
}

export const GITHUB_URL = 'https://github.com/gvart/proschi';
/** The header's links; the editor is its call to action instead. */
export const NAV: SiteLink[] = [
  { label: 'Docs', href: 'docs/', page: 'docs' },
  { label: 'Practice', href: 'practice/', page: 'practice' },
  { label: 'GitHub', href: GITHUB_URL },
];

export const EDITOR_LINK: SiteLink = { label: 'Open the editor', href: 'app/', page: 'editor' };

export const FOOTER_COLUMNS: { title: string; links: SiteLink[] }[] = [
  {
    title: 'Make',
    links: [
      { label: 'Editor', href: 'app/' },
      { label: 'Practice', href: 'practice/' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Quickstart', href: 'docs/quickstart/' },
      { label: 'Language reference', href: 'docs/language/' },
      { label: 'How the simulation works', href: 'docs/model/' },
      { label: 'Editor support', href: 'docs/editors/' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'GitHub', href: GITHUB_URL },
      { label: 'Issues', href: `${GITHUB_URL}/issues` },
      { label: 'Privacy', href: 'docs/privacy/' },
      { label: 'MIT license', href: `${GITHUB_URL}/blob/main/LICENSE` },
    ],
  },
];

export function isExternal(href: string): boolean {
  return /^[a-z]+:/i.test(href);
}

/** `href` as seen from a page whose way back to the root is `base`. */
export function siteHref(base: string, href: string): string {
  return isExternal(href) ? href : `${base}${href}`;
}
