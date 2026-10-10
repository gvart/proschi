import { renderToStaticMarkup } from 'react-dom/server';
import { getTechStackIcon } from '../../../frontend/src/utils/iconMapping';
import type { DiagramNode } from '../proschi';

/**
 * The canvas's icons as static SVG: the same react-icons and lucide glyphs
 * `getTechStackIcon()` gives ComponentNode, rendered once per tech stack with
 * react-dom/server.
 */

const markup = new Map<string, string>();

/**
 * The icon of `techStack` as a nested `<svg>` at (x, y), `size` px square,
 * drawn in `color`; `type` picks the icon of a tech that has none of its own. Class and style attributes are dropped, so the result
 * works under a strict Content-Security-Policy.
 */
export function techIcon(techStack: string, x: number, y: number, size: number, color: string, type?: DiagramNode['type']): string {
  const key = `${techStack}\u0000${type ?? ''}`;
  let svg = markup.get(key);
  if (svg === undefined) {
    // A tech without an icon of its own (a generic or unknown one) gets its component type's.
    const html = renderToStaticMarkup(getTechStackIcon(techStack, type));
    const end = html.indexOf('>');
    // Only the outer tag's sizing and classes go; children keep their own attributes.
    const open = html.slice(0, end).replace(/\s(class|style|height|width)="[^"]*"/g, '').replace(/^<svg/, '<svg ICON_ATTRS');
    svg = open + html.slice(end);
    markup.set(key, svg);
  }
  return svg.replace('ICON_ATTRS', `x="${x}" y="${y}" width="${size}" height="${size}" color="${color}"`);
}
