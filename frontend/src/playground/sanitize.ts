/**
 * Checks for data that comes from outside the code: share links, localStorage,
 * backup files. Each reader returns only well-formed values and drops the rest,
 * so a corrupted or crafted value can neither crash the app nor pollute
 * prototypes.
 */

/** Keys that would reach an object's prototype if assigned with `obj[key] = …`. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Longest file path accepted in an imports map. */
export const MAX_PATH_LENGTH = 512;

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Whether `key` is safe to use as a property name of a plain object. */
export const isSafeKey = (key: string): boolean => !UNSAFE_KEYS.has(key);

/**
 * A map of file path → source: string values only, non-empty paths of sane
 * length, no prototype keys. Returns undefined when nothing valid is left.
 */
export function fileMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [path, source] of Object.entries(value)) {
    if (typeof source !== 'string' || !path || path.length > MAX_PATH_LENGTH || !isSafeKey(path)) continue;
    out[path] = source;
    count++;
  }
  return count ? out : undefined;
}
