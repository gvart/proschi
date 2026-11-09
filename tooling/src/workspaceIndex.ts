/**
 * An index of the `.proschi` files in the workspace folders, for the language
 * server's rename and find references: which local files each file imports or
 * uses as a system's `from` file. Built on first use and kept fresh from
 * watched-file events. It only narrows the files worth analysing; the
 * analysis decides what changes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { isRemoteSpec } from '../../frontend/src/dsl/imports';
import { MAX_IMPORT_BYTES } from './imports';

export const MAX_INDEXED_FILES = 2000;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist']);
// `import "…"` and a system's `from "…"`; a match in a comment or string only adds a file to analyse.
const REFERENCE = /(?:^|[\s{;])(?:import|from)\s+"([^"\\\n]*)"/g;

/** The local files `text` (the file at `path`) imports or names as a system's `from`. */
export function localReferences(path: string, text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REFERENCE)) {
    const spec = m[1];
    if (!spec || isRemoteSpec(spec) || /^[\\/]/.test(spec) || /^[A-Za-z]:/.test(spec)) continue;
    out.add(resolve(dirname(path), spec));
  }
  return [...out];
}

export class WorkspaceIndex {
  /** File -> the local files it references; undefined until the first scan. */
  private refs: Map<string, string[]> | undefined;
  private over = false;

  constructor(
    private readonly roots: string[],
    private readonly maxFiles = MAX_INDEXED_FILES,
  ) {}

  /** True when the workspace has more `.proschi` files than the cap; the index is then empty. */
  get overCap(): boolean {
    this.scan();
    return this.over;
  }

  /** Every indexed file that reaches `path` through imports or system `from` files, directly or not. */
  dependents(path: string): string[] {
    const refs = this.scan();
    const found = new Set<string>();
    const queue = [path];
    while (queue.length) {
      const target = queue.pop()!;
      for (const [file, list] of refs) {
        if (file !== path && !found.has(file) && list.includes(target)) {
          found.add(file);
          queue.push(file);
        }
      }
    }
    return [...found];
  }

  /** A watched `.proschi` file was created, changed or deleted. Before the first scan there is nothing to update. */
  changed(path: string, deleted: boolean) {
    const refs = this.refs;
    if (!refs || this.over) return;
    if (deleted) {
      refs.delete(path);
      // A deleted folder comes as one event.
      for (const file of [...refs.keys()]) if (file.startsWith(path + sep)) refs.delete(file);
      return;
    }
    if (!this.inRoots(path) || path.split(sep).some((part) => SKIPPED_DIRS.has(part))) return;
    const text = read(path);
    if (text === undefined) refs.delete(path);
    else if (refs.has(path) || refs.size < this.maxFiles) refs.set(path, localReferences(path, text));
    else this.over = true;
  }

  private inRoots(path: string): boolean {
    return this.roots.some((root) => path.startsWith(root + sep));
  }

  private scan(): Map<string, string[]> {
    if (this.refs) return this.refs;
    const files: string[] = [];
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length > this.maxFiles) return;
        // Symbolic links are not followed: neither isDirectory nor isFile is true for them.
        if (e.isDirectory() && !SKIPPED_DIRS.has(e.name)) walk(join(dir, e.name));
        else if (e.isFile() && e.name.endsWith('.proschi')) files.push(join(dir, e.name));
      }
    };
    for (const root of this.roots) walk(root);
    this.refs = new Map();
    this.over = files.length > this.maxFiles;
    if (this.over) return this.refs;
    for (const file of files) {
      const text = read(file);
      if (text !== undefined) this.refs.set(file, localReferences(file, text));
    }
    return this.refs;
  }
}

/** The file's text, or undefined when it is gone or too large to be imported. */
function read(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_IMPORT_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
