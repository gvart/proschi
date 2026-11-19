/**
 * `proschi render --format hld-md|hld-html`: the high-level design document
 * (docs/design/hld-and-practice.md §4). The document model and both writers
 * live in frontend/src/hld, shared with the web editor's HLD view; the HTML
 * here also carries the architecture and sequence SVGs, and its page takes the
 * colours of the render theme they are drawn in.
 */
import { buildHld, hldToHtml, hldToMarkdown, type Diagram, type HldPageTheme } from '../proschi';
import type { RenderedDiagram } from './index';
import { SKETCH, type RenderTheme } from './theme';

export function renderHldMarkdown(diagram: Diagram): string {
  return hldToMarkdown(buildHld(diagram));
}

/** The HLD page's colours in `theme`: its html page's, with what a document adds. */
export function hldPage(theme: RenderTheme): HldPageTheme {
  const { light, dark, figure, document } = theme.page;
  return { light: `${light} ${document.light}`, dark: `${dark} ${document.dark}`, figure };
}

/** `theme` must be the one `rendered` was drawn in, so the page matches its figures. */
export function renderHldHtml(diagram: Diagram, rendered: RenderedDiagram, theme: RenderTheme = SKETCH): string {
  const figures = { architecture: rendered.architecture, scenarios: Object.fromEntries(rendered.scenarios.map((s) => [s.slug, s.svg])) };
  return hldToHtml(buildHld(diagram), figures, hldPage(theme));
}
