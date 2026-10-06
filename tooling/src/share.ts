/**
 * `proschi share-link` prints a link that opens a file in the web editor, the
 * same `#code=` link the editor's *Share* button copies (frontend/src/playground/share.ts).
 * The files the document imports travel along in the link, keyed the way the
 * editor resolves them: relative to the document, which the editor knows only
 * by its name.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { encodeShareHash } from '../../frontend/src/playground/share';
import { joinImportPath } from '../../frontend/src/dsl/imports';
import { parse } from './proschi';

export const SHARE_USAGE = `  proschi share-link [--base <url>] <file>`;

export const DEFAULT_BASE = 'https://proschi.app/app/';

export const SHARE_HELP = `share-link
        Prints a link that opens the file (with the files it imports) in the
        web editor; nothing is uploaded, the diagram is in the link. --base
        sets the editor's address (default ${DEFAULT_BASE}).`;

/** The share link for a document, its imports read relative to `dir`. */
export function shareLink(source: string, name: string, dir: string, base = DEFAULT_BASE): string {
  const read: Record<string, string> = {};
  const result = parse(source, {
    path: name,
    resolve: (importPath, fromPath) => {
      const key = joinImportPath(fromPath, importPath);
      if (key === name) return { path: key, source: '' };
      const abs = resolve(dir, key);
      if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
      read[key] ??= readFileSync(abs, 'utf8');
      return { path: key, source: read[key] };
    },
  });
  const imports: Record<string, string> = {};
  for (const { resolved } of result.imports ?? []) {
    if (resolved !== undefined && resolved !== name && Object.prototype.hasOwnProperty.call(read, resolved)) imports[resolved] = read[resolved];
  }
  return base.replace(/#.*$/, '') + encodeShareHash(source, undefined, imports);
}

export function runShareLink(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  let base = DEFAULT_BASE;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base') {
      const value = args[++i];
      if (!value || !/^https?:\/\//.test(value)) {
        err(`Expected --base <http(s) url>, got '${value ?? ''}'`);
        return 2;
      }
      base = value;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${SHARE_USAGE}`);
      return 2;
    } else paths.push(arg);
  }
  if (paths.length !== 1) {
    err(`Usage:\n${SHARE_USAGE}`);
    return 2;
  }
  const [file] = paths;
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (e) {
    err(String((e as Error).message));
    return 2;
  }
  out(shareLink(source, basename(file), dirname(resolve(file)), base));
  return 0;
}
