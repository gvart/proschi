import { renderToStaticMarkup } from 'react-dom/server';
import Footer from './Footer';
import Header from './Header';
import type { SitePage } from './site';

export type ShellSlot = 'header' | 'footer';

/**
 * The header or footer as static HTML, for the pages that are not React
 * (plugins/siteShell.ts puts it in place of <!--shell:header--> and
 * <!--shell:footer-->). enhance.ts wires up the theme toggle, menu and
 * magnetic button afterwards.
 */
export function renderShell(slot: ShellSlot, { base, current }: { base: string; current?: SitePage }): string {
  return renderToStaticMarkup(slot === 'header' ? <Header base={base} current={current} /> : <Footer base={base} />);
}
