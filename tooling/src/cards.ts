/**
 * `proschi cards check` and `proschi cards lock`: the practice cards, one
 * Markdown file each (docs/CARDS.md). The format and the checks come from
 * frontend/src/learn (cards.ts, cardCheck.ts), the same code the practice
 * page and its tests use.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkCardFiles, LOCK_FILE, type CardCheck, type CardViolation } from '../../frontend/src/learn/cardCheck';
import { cardFromFile, readLock, writeLock, CardFileError } from '../../frontend/src/learn/cards';
import { displayPath } from './imports';
import { findProblemsDir } from './problem';

export const CARDS_USAGE = `  proschi cards check [--format text|github|json] [--problems <dir>] [dir]
  proschi cards lock [dir]`;

export const CARDS_HELP = `cards   Practice cards, one Markdown file each (docs/CARDS.md).
        check validates the cards folder (default: the repository's
        frontend/src/practice/cards when run inside it): every card's front
        matter and sections, unique ids listed in ids.lock, no card deleted
        from it, topics from tags.json, related problems that exist (from
        --problems, or the problems folder next to the cards), text that fits a
        phone, and no two cards that ask nearly the same thing.
        Exits with 1 on any violation.
        lock adds the ids of new cards to ids.lock.`;

/** Where the cards live in this repository. */
export const REPO_CARDS = join('frontend', 'src', 'practice', 'cards');

/** The repository's cards directory, looking up from `cwd`; undefined outside the repository. */
export function findCardsDir(cwd = process.cwd()): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, REPO_CARDS);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The files of a cards folder keyed by their path in it: top-level files and `<topic>/<file>`. */
export function readCardsFolder(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) files[entry.name] = readFileSync(join(dir, entry.name), 'utf8');
    else if (entry.isDirectory()) {
      for (const sub of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
        if (!sub.name.startsWith('.')) files[`${entry.name}/${sub.name}`] = sub.isFile() ? readFileSync(join(dir, entry.name, sub.name), 'utf8') : '';
      }
    }
  }
  return files;
}

/** The problem ids for checking `related`: the folders of `problemsDir`. */
function problemIdsIn(problemsDir: string): string[] {
  return readdirSync(problemsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');

export function formatCardCheck(dir: string, check: CardCheck, style: 'text' | 'github' | 'json'): string {
  const shown = displayPath(dir);
  const where = (v: CardViolation) => join(shown, v.file);
  if (style === 'json') {
    return JSON.stringify({ dir: shown, cards: check.cards.length, topics: check.topics.length, violations: check.violations }, null, 2);
  }
  if (style === 'github') {
    return check.violations.map((v) => `::error file=${where(v)},line=${v.line ?? 1},title=proschi cards::${escape(v.message)}`).join('\n');
  }
  const lines = check.violations.map((v) => `${where(v)}${v.line ? `:${v.line}` : ''}: ${v.message}`);
  const counts = new Map<string, number>();
  for (const c of check.cards) counts.set(c.topic, (counts.get(c.topic) ?? 0) + 1);
  const byType = new Map<string, number>();
  for (const c of check.cards) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const sample = check.cards.filter((c) => c.decks.includes('sample') && !c.retired).length;
  lines.push(
    `${check.cards.length} card${check.cards.length === 1 ? '' : 's'} in ${counts.size} topic${counts.size === 1 ? '' : 's'} ` +
      `(${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')}; ${sample} in the sample deck): ` +
      `${check.violations.length ? `${check.violations.length} violation(s)` : 'no violations'}`,
  );
  return lines.join('\n');
}

interface Parsed {
  style: 'text' | 'github' | 'json';
  problems?: string;
  dir?: string;
}

function parseArgs(args: string[], err: (s: string) => void, allowFormat: boolean): Parsed | undefined {
  const parsed: Parsed = { style: 'text' };
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (allowFormat && arg === '--format') {
      const value = args[++i];
      if (value !== 'text' && value !== 'github' && value !== 'json') {
        err(`Unknown format '${value ?? ''}'; use text, github or json`);
        return undefined;
      }
      parsed.style = value;
    } else if (allowFormat && arg === '--problems') {
      parsed.problems = args[++i];
      if (!parsed.problems) {
        err('Expected a directory after --problems');
        return undefined;
      }
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${CARDS_USAGE}`);
      return undefined;
    } else paths.push(arg);
  }
  if (paths.length > 1) {
    err(`Give one cards directory\n\nUsage:\n${CARDS_USAGE}`);
    return undefined;
  }
  parsed.dir = paths[0];
  return parsed;
}

function resolveDir(dirArg: string | undefined, cwd: string, err: (s: string) => void): string | undefined {
  const dir = dirArg ? resolve(cwd, dirArg) : findCardsDir(cwd);
  if (!dir) {
    err(`Not inside the Proschi repository; give the cards directory\n\nUsage:\n${CARDS_USAGE}`);
    return undefined;
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`No such directory: ${dirArg ?? dir}`);
    return undefined;
  }
  return dir;
}

function cardsCheck(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const parsed = parseArgs(args, err, true);
  if (!parsed) return 2;
  const dir = resolveDir(parsed.dir, cwd, err);
  if (!dir) return 2;
  // Related problems: --problems, else the problems folder next to the cards (the repository's layout).
  const besideCards = join(dir, '..', 'problems');
  const problemsDir = parsed.problems ? resolve(cwd, parsed.problems) : existsSync(besideCards) ? besideCards : findProblemsDir(cwd);
  if (parsed.problems && !(existsSync(problemsDir!) && statSync(problemsDir!).isDirectory())) {
    err(`No such directory: ${parsed.problems}`);
    return 2;
  }
  const check = checkCardFiles(readCardsFolder(dir), problemsDir ? { problemIds: problemIdsIn(problemsDir) } : {});
  const text = formatCardCheck(dir, check, parsed.style);
  if (text) out(text);
  return check.violations.length ? 1 : 0;
}

function cardsLock(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const parsed = parseArgs(args, err, false);
  if (!parsed) return 2;
  const dir = resolveDir(parsed.dir, cwd, err);
  if (!dir) return 2;
  const files = readCardsFolder(dir);
  const ids: string[] = [];
  for (const file of Object.keys(files)) {
    if (!/^[^/]+\/[^/]+\.md$/.test(file)) continue;
    try {
      ids.push(cardFromFile(file, files[file]).id);
    } catch (e) {
      if (!(e instanceof CardFileError)) throw e;
      // A card that does not read yet still gets its id locked: the id is its file name.
      ids.push(file.slice(file.indexOf('/') + 1, -'.md'.length));
    }
  }
  const lockPath = join(dir, LOCK_FILE);
  const existing = existsSync(lockPath) ? readLock(readFileSync(lockPath, 'utf8')).ids : [];
  const added = [...new Set(ids)].filter((id) => !existing.includes(id)).sort();
  const text = writeLock(existing, ids);
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) writeFileSync(lockPath, text);
  out(added.length ? `Added ${added.length} id${added.length === 1 ? '' : 's'} to ${displayPath(lockPath)}:\n  ${added.join('\n  ')}` : `${displayPath(lockPath)} already lists every card`);
  return 0;
}

export function runCards(args: string[], out: (s: string) => void, err: (s: string) => void, cwd = process.cwd()): number {
  const [sub, ...rest] = args;
  if (sub === 'check') return cardsCheck(rest, out, err, cwd);
  if (sub === 'lock') return cardsLock(rest, out, err, cwd);
  err(`${sub ? `Unknown cards command '${sub}'\n\n` : ''}Usage:\n${CARDS_USAGE}`);
  return 2;
}
