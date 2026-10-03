/**
 * Multi-file documents for the CLI and the language server: resolving
 * `import "path"` from the file system, and grouping the problems of a parse
 * by the file they occur in.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { parse, type Diagnostic, type Diagram, type ImportResolver, type ParseResult } from './proschi';
import { toRange, type Range } from './analysis';

/** Relative to the working directory when the file is inside it, else absolute. */
export function displayPath(file: string, cwd = process.cwd()): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs;
}

/**
 * Resolves imports relative to the importing file. `read` may supply the text
 * of a file (e.g. an unsaved editor buffer) before the disk is consulted;
 * `toPath` decides how resolved paths are spelled in diagnostics.
 */
export function fileResolver(
  read: (absolutePath: string) => string | undefined = () => undefined,
  toPath: (absolutePath: string) => string = (p) => p,
): ImportResolver {
  return (importPath, fromPath) => {
    const abs = resolve(fromPath ? dirname(fromPath) : process.cwd(), importPath);
    const text = read(abs) ?? (existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : undefined);
    return text === undefined ? undefined : { path: toPath(abs), source: text };
  };
}

/** Parses a file from disk, following its imports; paths in the result are relative to the working directory. */
export function parseFile(file: string): ParseResult {
  return parse(readFileSync(file, 'utf8'), { path: displayPath(file), resolve: fileResolver(undefined, (p) => displayPath(p)) });
}

export interface FileDiagnostics {
  file: string;
  diagnostics: Diagnostic[];
}

/**
 * Checks files and reports every problem under the file it occurs in. Each
 * checked file gets an entry; an imported file gets one when it has problems.
 * A file imported by several checked files has its problems reported once.
 * `extra` adds findings of other checks (OpenAPI) for the merged diagram;
 * those with `file` set are reported under that file too.
 */
export function checkFiles(files: string[], extra?: (file: string, diagram: Diagram) => Diagnostic[]): FileDiagnostics[] {
  const byFile = new Map<string, Diagnostic[]>();
  const seen = new Set<string>();
  for (const file of files) {
    const root = displayPath(file);
    if (!byFile.has(root)) byFile.set(root, []);
    const { diagram, diagnostics } = parseFile(file);
    for (const { file: where, ...d } of [...diagnostics, ...(extra?.(file, diagram) ?? [])]) {
      const target = where ?? root;
      const key = `${target}:${d.line}:${d.col}:${d.severity}:${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byFile.has(target)) byFile.set(target, []);
      byFile.get(target)!.push(d);
    }
  }
  return [...byFile].map(([file, diagnostics]) => ({ file, diagnostics: diagnostics.sort((x, y) => x.line - y.line || x.col - y.col) }));
}

/** Imported files reached through an import of the root document, the file itself included. */
function reachableFrom(result: ParseResult, start: string): Set<string> {
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    for (const i of result.imports ?? []) {
      if (i.loc.file === file && i.resolved !== undefined && !reached.has(i.resolved)) {
        reached.add(i.resolved);
        queue.push(i.resolved);
      }
    }
  }
  return reached;
}

/**
 * The root document's own problems, plus an error on each of its imports
 * whose file (or a file it imports in turn) has errors, since an editor shows
 * one file's diagnostics at a time.
 */
export function ownDiagnostics(result: ParseResult): Diagnostic[] {
  const own = result.diagnostics.filter((d) => d.file === undefined);
  for (const i of result.imports ?? []) {
    if (i.loc.file !== undefined || i.resolved === undefined) continue;
    const files = reachableFrom(result, i.resolved);
    const errors = result.diagnostics.filter((d) => d.severity === 'error' && d.file !== undefined && files.has(d.file)).length;
    if (errors) own.push({ severity: 'error', message: `'${basename(i.path)}' has ${errors} error${errors === 1 ? '' : 's'}`, ...i.loc });
  }
  return own.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** Links from the root document's import paths (inside the quotes) to the files they resolved to. */
export function importLinks(result: ParseResult): { range: Range; target: string }[] {
  return (result.imports ?? [])
    .filter((i) => i.loc.file === undefined && i.resolved !== undefined)
    .map((i) => {
      const range = toRange(i.loc);
      return {
        range: { start: { ...range.start, character: range.start.character + 1 }, end: { ...range.end, character: Math.max(range.start.character + 1, range.end.character - 1) } },
        target: i.resolved!,
      };
    });
}
