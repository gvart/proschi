import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const PREFIX = '#code=';

/** Encodes a document into a URL hash, like mermaid.live. Nothing leaves the browser. */
export function encodeShareHash(source: string): string {
  return PREFIX + compressToEncodedURIComponent(source);
}

/** Returns the document stored in a `#code=` hash, or null if there is none or it is corrupt. */
export function decodeShareHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const source = decompressFromEncodedURIComponent(hash.slice(PREFIX.length));
    return source ? source : null;
  } catch {
    return null;
  }
}

export function shareUrl(source: string, location: Pick<Location, 'origin' | 'pathname' | 'search'>): string {
  return `${location.origin}${location.pathname}${location.search}${encodeShareHash(source)}`;
}
