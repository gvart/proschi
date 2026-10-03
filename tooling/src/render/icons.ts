import { renderToStaticMarkup } from 'react-dom/server';
import { getComponentTypeColor, getTechStackIcon } from '../../../frontend/src/utils/iconMapping';
import { CANVAS_FONT, TAILWIND_HEX } from '../../../frontend/src/utils/canvasColors';
import type { DiagramNode } from '../proschi';

/**
 * The canvas's icons and colours as static SVG: the same react-icons and
 * lucide glyphs `getTechStackIcon()` gives ComponentNode, rendered once per
 * tech stack with react-dom/server.
 */

export { CANVAS_FONT, TAILWIND_HEX };

const markup = new Map<string, string>();

/** The icon tile's colour for a component type (`getComponentTypeColor()` as hex). */
export function typeColor(type: DiagramNode['type']): string {
  return TAILWIND_HEX[getComponentTypeColor(type)] ?? TAILWIND_HEX['bg-gray-500'];
}

/**
 * The icon of `techStack` as a nested `<svg>` at (x, y), `size` px square,
 * drawn in `color`. Class and style attributes are dropped, so the result
 * works under a strict Content-Security-Policy.
 */
export function techIcon(techStack: string, x: number, y: number, size: number, color: string): string {
  let svg = markup.get(techStack);
  if (svg === undefined) {
    const html = renderToStaticMarkup(getTechStackIcon(techStack as DiagramNode['techStack']));
    const end = html.indexOf('>');
    // Only the outer tag's sizing and classes go; children keep their own attributes.
    const open = html.slice(0, end).replace(/\s(class|style|height|width)="[^"]*"/g, '').replace(/^<svg/, '<svg ICON_ATTRS');
    svg = open + html.slice(end);
    markup.set(techStack, svg);
  }
  return svg.replace('ICON_ATTRS', `x="${x}" y="${y}" width="${size}" height="${size}" color="${color}"`);
}
