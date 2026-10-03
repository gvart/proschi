import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const PREFIX = '#code=';

/** Which use case, scenario and 1-based step a link should open in playback. */
export interface PlaybackTarget {
  useCase: string;
  /** Scenario id; left out for use cases without alt branches. */
  scenario?: string;
  step: number;
}

export interface ShareLink {
  source: string;
  playback?: PlaybackTarget;
  /** Imported files (path → source), so the link renders without them. */
  imports?: Record<string, string>;
}

/**
 * Encodes a document (and optionally a playback position) into a URL hash, like
 * mermaid.live. Nothing leaves the browser. The compressed alphabet never
 * contains '&', so extra parameters can follow it. Imported files travel along
 * as compressed JSON in `&imports=`, keeping the link self-contained.
 */
export function encodeShareHash(source: string, playback?: PlaybackTarget, imports?: Record<string, string>): string {
  let code = PREFIX + compressToEncodedURIComponent(source);
  if (imports && Object.keys(imports).length) code += `&imports=${compressToEncodedURIComponent(JSON.stringify(imports))}`;
  if (!playback) return code;
  const scenario = playback.scenario ? `&alt=${encodeURIComponent(playback.scenario)}` : '';
  return `${code}&uc=${encodeURIComponent(playback.useCase)}${scenario}&step=${playback.step}`;
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

  // Read before URLSearchParams, which would turn the '+' of the compressed alphabet into spaces.
  const imports = decodeImports(rest.find((p) => p.startsWith('imports='))?.slice('imports='.length));
  const params = new URLSearchParams(rest.filter((p) => !p.startsWith('imports=')).join('&'));
  const useCase = params.get('uc');
  const step = Number(params.get('step') ?? '1');
  const extra = imports ? { imports } : {};
  if (!useCase) return { source, ...extra };
  const scenario = params.get('alt');
  return {
    source,
    ...extra,
    playback: { useCase, ...(scenario ? { scenario } : {}), step: Number.isInteger(step) && step > 0 ? step : 1 },
  };
}

function decodeImports(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(decompressFromEncodedURIComponent(value) ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string');
    return entries.length ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

export function decodeShareHash(hash: string): string | null {
  return decodeShareLink(hash)?.source ?? null;
}

export function shareUrl(
  source: string,
  location: Pick<Location, 'origin' | 'pathname' | 'search'>,
  playback?: PlaybackTarget,
  imports?: Record<string, string>,
): string {
  return `${location.origin}${location.pathname}${location.search}${encodeShareHash(source, playback, imports)}`;
}
