/**
 * `proschi fmt` rewrites .proschi files in the canonical layout; with
 * `--check` it only reports the files that are not formatted (for CI).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { format } from './proschi';

export const FMT_USAGE = `  proschi fmt [--check] <file|dir>...`;

export const FMT_HELP = `fmt     Rewrites files in the canonical layout and lists the ones it changed.
        With --check, writes nothing, lists the files that would change and
        exits with 1 if there are any.`;

/**
 * Runs `proschi fmt`. `collectFiles` is the directory search of `check`, so
 * both commands see the same files.
 */
export function runFmt(
  args: string[],
  collectFiles: (paths: string[]) => string[],
  out: (s: string) => void,
  err: (s: string) => void,
): number {
  let check = false;
  const paths: string[] = [];
  for (const arg of args) {
    if (arg === '--check') check = true;
    else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}`);
      return 2;
    } else paths.push(arg);
  }
  if (paths.length === 0) {
    err(`Usage:\n${FMT_USAGE}`);
    return 2;
  }

  let changed = 0;
  try {
    for (const file of collectFiles(paths)) {
      const source = readFileSync(file, 'utf8');
      const formatted = format(source);
      if (formatted === source) continue;
      if (!check) writeFileSync(file, formatted);
      out(displayPath(file));
      changed++;
    }
  } catch (e) {
    err(String((e as Error).message));
    return 2;
  }
  return check && changed > 0 ? 1 : 0;
}

/** Relative to the working directory when the file is inside it, else as given. */
function displayPath(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
}
