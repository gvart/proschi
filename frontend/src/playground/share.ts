import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const PREFIX = '#code=';

/** Which use case, and which 1-based step of it, a link should open in playback. */
export interface PlaybackTarget {
  useCase: string;
  step: number;
}

export interface ShareLink {
  source: string;
  playback?: PlaybackTarget;
}

/**
 * Encodes a document (and optionally a playback position) into a URL hash, like
 * mermaid.live. Nothing leaves the browser. The compressed alphabet never
 * contains '&', so extra parameters can follow it.
 */
export function encodeShareHash(source: string, playback?: PlaybackTarget): string {
  const code = PREFIX + compressToEncodedURIComponent(source);
  if (!playback) return code;
  return `${code}&uc=${encodeURIComponent(playback.useCase)}&step=${playback.step}`;
}

/** Reads a `#code=` hash; returns null if there is none or it is corrupt. */
export function decodeShareLink(hash: string): ShareLink | null {
  if (!hash.startsWith(PREFIX)) return null;
  const [code, ...rest] = hash.slice(PREFIX.length).split('&');
  let source: string | null;
  try {
    source = decompressFromEncodedURIComponent(code);
  } catch {
    return null;
  }
  if (!source) return null;

  const params = new URLSearchParams(rest.join('&'));
  const useCase = params.get('uc');
  const step = Number(params.get('step') ?? '1');
  if (!useCase) return { source };
  return { source, playback: { useCase, step: Number.isInteger(step) && step > 0 ? step : 1 } };
}

export function decodeShareHash(hash: string): string | null {
  return decodeShareLink(hash)?.source ?? null;
}

export function shareUrl(source: string, location: Pick<Location, 'origin' | 'pathname' | 'search'>, playback?: PlaybackTarget): string {
  return `${location.origin}${location.pathname}${location.search}${encodeShareHash(source, playback)}`;
}
