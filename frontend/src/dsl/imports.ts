import type { ImportResolver } from './types';

/**
 * Helpers for resolving `import` paths without a file system, e.g. against
 * documents saved in the browser or files carried in a share link.
 */

/** Resolves `importPath` against the directory of `fromPath`, normalising `.` and `..`. */
export function joinImportPath(fromPath: string | undefined, importPath: string): string {
  const parts = importPath.startsWith('/') || !fromPath ? [] : fromPath.split('/').slice(0, -1);
  for (const part of importPath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * A resolver over a map of path → source. A path that is not in the map falls
 * back to the one file with the same name, if exactly one exists, since files
 * opened in the browser only know their own name.
 */
export function mapResolver(files: Record<string, string>): ImportResolver {
  const paths = Object.keys(files);
  return (importPath, fromPath) => {
    const path = joinImportPath(fromPath, importPath);
    if (Object.prototype.hasOwnProperty.call(files, path)) return { path, source: files[path] };
    const name = path.split('/').pop();
    const sameName = paths.filter((p) => p.split('/').pop() === name);
    return sameName.length === 1 ? { path: sameName[0], source: files[sameName[0]] } : undefined;
  };
}
