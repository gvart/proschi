// Where the header and footer link to. Paths are relative to the site root;
// `siteHref` prefixes them with the page's way back to it ('./' or '../'),
// so the links work under any sub-path, like the rest of the build.

export type SitePage = 'home' | 'editor' | 'practice' | 'docs' | 'blog' | 'pricing';

export interface SiteLink {
  label: string;
  /** A path from the site root, or an absolute URL. */
  href: string;
  /** The page this link is "you are here" for. */
  page?: SitePage;
  /** Marked out in the header, for what the site wants found first. */
  accent?: boolean;
  /** Opens the feedback dialog (src/feedback/links.ts); `href` is the fallback. */
  feedback?: boolean;
}

export const GITHUB_URL = 'https://github.com/gvart/proschi';
/** How to contribute (CONTRIBUTING.md at the repository root), and its section on problems. */
export const CONTRIBUTING_URL = `${GITHUB_URL}/blob/main/CONTRIBUTING.md`;
export const CONTRIBUTE_PROBLEM_URL = `${CONTRIBUTING_URL}#adding-a-new-problem`;
/** A new issue from .github/ISSUE_TEMPLATE/problem-idea.md, for an idea without the code. */
export const SUGGEST_PROBLEM_URL = `${GITHUB_URL}/issues/new?template=problem-idea.md`;
/** The practice hub: the problem list, with the hub's sections (src/practice/hub/). */
export const PRACTICE_HREF = 'practice/';
/** The interview prep roadmap: a tab of the practice hub (src/practice/roadmap.ts). */
export const ROADMAP_HREF = 'practice/#/roadmap';
/** Daily review of the practice cards: a tab of the practice hub (src/practice/review/). */
export const DAILY_REVIEW_HREF = 'practice/#/review';
/** The review cards' static pages, one per topic and card (plugins/cardPages.ts). */
export const REVIEW_CARDS_HREF = 'practice/cards/';
/** The daily challenge: a tab of the practice hub (src/practice/challenge/). */
export const DAILY_CHALLENGE_HREF = 'practice/#/challenge';
/** The Arcade, Scale or Fail: a tab of the practice hub (src/game/ui/ArcadeRoute.tsx). */
export const ARCADE_HREF = 'practice/#/arcade';

/**
 * The header's links; the editor is its call to action instead. Practice is
 * one hub (the problems, the roadmap, daily review, the challenge, the Arcade
 * and progress are its tabs), marked current on every one of its addresses.
 */
/**
 * Whether the build has paid plans (VITE_BILLING=true), so the pricing page
 * exists (vite.config.ts). Also read from the environment, for the header
 * and footer that plugins/siteShell.ts renders at build time in Node.
 */
export const PRICING_ON =
  import.meta.env?.VITE_BILLING === 'true' || (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_BILLING === 'true';

/** Whether the build has accounts (VITE_ACCOUNTS=true), so feedback can be sent; read like PRICING_ON. */
export const ACCOUNTS_ON =
  import.meta.env?.VITE_ACCOUNTS === 'true' || (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_ACCOUNTS === 'true';

/** The pricing page (src/pricing/), linked only in builds that have it. */
export const PRICING_LINK: SiteLink = { label: 'Pricing', href: 'pricing/', page: 'pricing' };

export const NAV: SiteLink[] = [
  { label: 'Docs', href: 'docs/', page: 'docs' },
  { label: 'Practice', href: PRACTICE_HREF, page: 'practice', accent: true },
  { label: 'Blog', href: 'blog/', page: 'blog' },
  ...(PRICING_ON ? [PRICING_LINK] : []),
  { label: 'GitHub', href: GITHUB_URL },
];

export const EDITOR_LINK: SiteLink = { label: 'Open the editor', href: 'app/', page: 'editor' };

export const FOOTER_COLUMNS: { title: string; links: SiteLink[] }[] = [
  {
    title: 'Practice',
    links: [
      { label: 'Problems', href: PRACTICE_HREF },
      { label: 'Interview roadmap', href: ROADMAP_HREF },
      { label: 'Daily review', href: DAILY_REVIEW_HREF },
      { label: 'Daily challenge', href: DAILY_CHALLENGE_HREF },
      { label: 'Arcade: Scale or Fail', href: ARCADE_HREF },
      { label: 'Review cards', href: REVIEW_CARDS_HREF },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Editor', href: 'app/' },
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
      { label: 'Blog', href: 'blog/' },
      ...(PRICING_ON ? [PRICING_LINK] : []),
      { label: 'Contribute', href: CONTRIBUTING_URL },
      { label: 'Issues', href: `${GITHUB_URL}/issues` },
      // Opens the dialog; without JavaScript, Settings, which has Contact us.
      ...(ACCOUNTS_ON ? [{ label: 'Send feedback', href: 'practice/#/me', feedback: true }] : []),
      { label: 'Privacy', href: 'docs/privacy/' },
      { label: 'Terms', href: 'docs/terms/' },
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
