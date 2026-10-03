/**
 * Shared pieces of the SVG renderers: escaping, a text width estimate (there
 * is no browser to measure with), colours and the font stack. Everything is
 * written as presentation attributes, so the SVGs need no stylesheet and work
 * under a strict Content-Security-Policy.
 */

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const COLORS = {
  background: '#ffffff',
  text: '#1f2937',
  muted: '#6b7280',
  line: '#64748b',
  border: '#cbd5e1',
  group: '#94a3b8',
  groupFill: '#f8fafc',
  noteFill: '#fef9c3',
  noteBorder: '#eab308',
  error: '#dc2626',
  badge: '#334155',
  par: '#7c3aed',
};

/** Accent (border) colour of a node, by component type. */
export const ACCENT: Record<string, string> = {
  service: '#2563eb',
  database: '#059669',
  queue: '#d97706',
  external: '#7c3aed',
  serverless: '#ea580c',
  compute: '#0891b2',
  container: '#0284c7',
  storage: '#65a30d',
  cache: '#db2777',
  cdn: '#0d9488',
};

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Rough advance width of `text` in the system sans-serif font, in px. */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const c of text) {
    if ("il.,:;|!'`ijtf ()[]{}".includes(c)) em += 0.32;
    else if ('mwMW@%'.includes(c)) em += 0.86;
    else if (c >= 'A' && c <= 'Z') em += 0.68;
    else if (c.charCodeAt(0) > 0x2e7f) em += 1;
    else em += 0.56;
  }
  return em * size * (bold ? 1.07 : 1);
}

/** Cuts `text` so it fits `max` px, ending with an ellipsis. */
export function fit(text: string, max: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= max) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Splits `text` into at most `maxLines` lines of at most `max` px. */
export function wrap(text: string, max: number, size: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, size) > max) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fit(`${lines[maxLines - 1]} …`, max, size);
  }
  return lines.map((l) => fit(l, max, size));
}

export interface TextOptions {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
}

export function text(x: number, y: number, content: string, o: TextOptions = {}): string {
  const attrs = [
    `x="${r(x)}"`,
    `y="${r(y)}"`,
    `font-size="${o.size ?? 13}"`,
    o.weight ? `font-weight="${o.weight}"` : '',
    `fill="${o.fill ?? COLORS.text}"`,
    o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
    o.family ? `font-family="${o.family}"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${content.startsWith('<tspan') ? content : esc(content)}</text>`;
}

/** Rounds coordinates to one decimal so the output stays small and stable. */
export function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The outer `<svg>` element with a white background, so it reads well in dark viewers too. */
export function svgDocument(width: number, height: number, title: string, body: string[], defs = ''): string {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img">`,
    `<title>${esc(title)}</title>`,
    defs ? `<defs>${defs}</defs>` : '',
    `<rect width="100%" height="100%" fill="${COLORS.background}"/>`,
    ...body,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** An arrowhead marker; `open` draws a chevron instead of a filled triangle. */
export function marker(id: string, color: string, open = false): string {
  const shape = open
    ? `<path d="M1,1 L9,5 L1,9" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
    : `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/>`;
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">${shape}</marker>`;
}
