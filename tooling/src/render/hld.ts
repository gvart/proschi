/**
 * `proschi render --format hld-md|hld-html`: the high-level design document
 * (docs/design/hld-and-practice.md §4). The document model and both writers
 * live in frontend/src/hld, shared with the web editor's HLD view; the HTML
 * here also carries the architecture and sequence SVGs.
 */
import { buildHld, hldToHtml, hldToMarkdown, type Diagram } from '../proschi';
import type { RenderedDiagram } from './index';

export function renderHldMarkdown(diagram: Diagram): string {
  return hldToMarkdown(buildHld(diagram));
}

export function renderHldHtml(diagram: Diagram, rendered: RenderedDiagram): string {
  return hldToHtml(buildHld(diagram), {
    architecture: rendered.architecture,
    scenarios: Object.fromEntries(rendered.scenarios.map((s) => [s.slug, s.svg])),
  });
}
