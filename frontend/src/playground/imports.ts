import { joinImportPath, mapResolver, type ImportResolver, type ParseResult } from '../dsl';
import { fileNameOf, type SavedDiagram } from './documents';

/**
 * The files the imports of `current` can see: every other saved diagram under
 * its file name (the most recently changed one wins when names clash), then
 * the files that came with the share link it was opened from.
 */
export function importableFiles(docs: SavedDiagram[], current: SavedDiagram): Record<string, string> {
  const files: Record<string, string> = {};
  const others = docs.filter((d) => d.id !== current.id).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const doc of others) files[fileNameOf(doc)] = doc.source;
  return { ...files, ...current.imports };
}

/** Resolves imports against `files`; the root document itself resolves too, so a cycle back to it is reported. */
export function filesResolver(files: Record<string, string>, rootPath: string): ImportResolver {
  const resolve = mapResolver(files);
  return (importPath, fromPath) => {
    if (joinImportPath(fromPath, importPath) === rootPath) return { path: rootPath, source: '' };
    return resolve(importPath, fromPath);
  };
}

/** The imported files a parse actually read, path → source, e.g. to put them in a share link. */
export function usedImports(result: ParseResult, files: Record<string, string>, rootPath: string): Record<string, string> {
  const used: Record<string, string> = {};
  for (const { resolved } of result.imports ?? []) {
    if (resolved !== undefined && resolved !== rootPath && Object.prototype.hasOwnProperty.call(files, resolved)) used[resolved] = files[resolved];
  }
  return used;
}
