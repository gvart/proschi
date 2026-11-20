import { HTTP_METHODS } from '../../dsl/parser';

/**
 * A step label in the parts the Flows composer edits apart (docs/USE-CASES.md):
 * `x200 ~2MB POST /orders header Authorization {"id": 1}` is the fan-out,
 * the payload size, the operation with its argument, the headers and the
 * rest (a description and the payload). The language reads the same order.
 */
export interface LabelParts {
  /** `x<N>`: calls per request. */
  fanOut?: number;
  /** `~<size>` as written, e.g. `2MB`. */
  size?: string;
  /** The size was written before the fan-out (either order reads the same); kept so an edit leaves it. */
  sizeFirst?: boolean;
  /** The operation and its argument: `SELECT orders`, `POST /orders`. */
  head: string;
  /** `header A, B`, only after an HTTP method and path. */
  headers: string[];
  /** What follows: a description and a payload (`{…}`, `[…]`, `<…>`, or `json|xml|text …`). */
  tail: string;
}

const HTTP = /^([A-Z]+)\s+(\S+)\s*([\s\S]*)$/;
const HEADERS = /^header\s+([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)(?=\s|$)\s*([\s\S]*)$/;

/** True when `head` is an HTTP method and a path, so it may take headers. */
export function isHttpHead(head: string): boolean {
  const m = HTTP.exec(head.trim());
  return !!m && HTTP_METHODS.includes(m[1]) && !m[3];
}

/** Success first, then redirects, client and server errors; informational last. */
export const statusRank = (s: number) => (s < 200 ? 1000 + s : s);

export function splitLabel(label: string): LabelParts {
  let rest = label.trim();
  const parts: LabelParts = { head: '', headers: [], tail: '' };
  for (;;) {
    const fan = /^x(\d+)(?=\s|$)\s*/.exec(rest);
    const size = /^~(\S+)\s*/.exec(rest);
    if (fan && parts.fanOut === undefined) parts.fanOut = Number(fan[1]);
    else if (size && parts.size === undefined) {
      parts.size = size[1];
      if (parts.fanOut === undefined) parts.sizeFirst = true;
    }
    else break;
    rest = rest.slice((fan ?? size)![0].length);
  }
  const http = HTTP.exec(rest);
  if (http && HTTP_METHODS.includes(http[1])) {
    parts.head = `${http[1]} ${http[2]}`;
    const clause = HEADERS.exec(http[3]);
    parts.headers = clause ? clause[1].split(',').map((h) => h.trim()) : [];
    parts.tail = (clause ? clause[2] : http[3]).trim();
    return parts;
  }
  // The payload starts at the first bracket after a space, or at a json/xml/text keyword.
  const body = rest.search(/(^|\s)([{[<]|(json|xml|text)\s+[{[<"]?)/i);
  parts.head = (body === -1 ? rest : rest.slice(0, body)).trim();
  parts.tail = body === -1 ? '' : rest.slice(body).trim();
  return parts;
}

export function composeLabel(parts: LabelParts): string {
  const headers = parts.headers.length && isHttpHead(parts.head) ? `header ${parts.headers.join(', ')}` : '';
  const fan = parts.fanOut !== undefined && parts.fanOut >= 1 ? `x${Math.floor(parts.fanOut)}` : '';
  const size = parts.size ? `~${parts.size}` : '';
  return [...(parts.sizeFirst ? [size, fan] : [fan, size]), parts.head.trim(), headers, parts.tail.trim()].filter(Boolean).join(' ');
}
