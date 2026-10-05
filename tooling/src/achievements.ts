/**
 * `proschi achievements check`: the practice achievements, one JSON file
 * (frontend/src/practice/achievements.json). The format and the check come
 * from frontend/src/learn/achievements.ts, the same code the Worker and the
 * practice page evaluate the badges with.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkAchievements, type AchievementViolation } from '../../frontend/src/learn/achievements';
import { readTopics, CardFileError } from '../../frontend/src/learn/cards';
import type { ProblemInfo } from '../../frontend/src/learn/mastery';
import { readProblemMd, PROBLEM_MD } from '../../frontend/src/practice/problemFiles';
import { ROADMAP } from '../../frontend/src/practice/roadmapStages';
import { displayPath } from './imports';

export const ACHIEVEMENTS_USAGE = `  proschi achievements check [--format text|github|json] [--problems <dir>] [--cards <dir>] [file]`;

export const ACHIEVEMENTS_HELP = `achievements
        Practice achievements, one JSON file (frontend/src/learn/achievements.ts
        has the format). check validates it (default: the repository's
        frontend/src/practice/achievements.json when run inside it): unique ids,
        known icons, tiers and rule kinds, each rule with exactly its fields,
        tags of practice problems (from --problems, or the problems folder
        next to the file), topics from the cards' tags.json (--cards, or the
        cards folder next to it), roadmap stages that exist, and counts the
        problems can reach. Exits with 1 on any violation.`;

/** Where the achievements live in this repository. */
export const REPO_ACHIEVEMENTS = join('frontend', 'src', 'practice', 'achievements.json');

/** The repository's achievements file, looking up from `cwd`; undefined outside the repository. */
export function findAchievementsFile(cwd = process.cwd()): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, REPO_ACHIEVEMENTS);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Each problem folder's id, difficulty and tags, from its problem.md; folders that do not read are left to `proschi problem check`. */
function problemsIn(dir: string): ProblemInfo[] {
  const out: ProblemInfo[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, PROBLEM_MD);
    if (!entry.isDirectory() || entry.name.startsWith('.') || !existsSync(file)) continue;
    try {
      const { difficulty, tags } = readProblemMd(entry.name, readFileSync(file, 'utf8'));
      out.push({ id: entry.name, difficulty, tags });
    } catch {
      // Reported by `proschi problem check`.
    }
  }
  return out;
}

/** The line of an entry's `"id": "<id>"` in the file, for annotations. */
function lineOf(text: string, v: AchievementViolation): number | undefined {
  if (v.id === undefined) return undefined;
  const needle = `"id": ${JSON.stringify(v.id)}`;
  // A repeated id is reported at its repetition.
  const at = v.message.startsWith('Duplicate id') ? text.lastIndexOf(needle) : text.indexOf(needle);
  return at < 0 ? undefined : text.slice(0, at).split('\n').length;
}

const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');

interface Parsed {
  style: 'text' | 'github' | 'json';
  problems?: string;
  cards?: string;
  file?: string;
}

function parseArgs(args: string[], err: (s: string) => void): Parsed | undefined {
  const parsed: Parsed = { style: 'text' };
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format') {
      const value = args[++i];
      if (value !== 'text' && value !== 'github' && value !== 'json') {
        err(`Unknown format '${value ?? ''}'; use text, github or json`);
        return undefined;
      }
      parsed.style = value;
    } else if (arg === '--problems' || arg === '--cards') {
      const value = args[++i];
      if (!value) {
        err(`Expected a directory after ${arg}`);
        return undefined;
      }
      parsed[arg === '--problems' ? 'problems' : 'cards'] = value;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${ACHIEVEMENTS_USAGE}`);
      return undefined;
    } else paths.push(arg);
  }
  if (paths.length > 1) {
    err(`Give one achievements file\n\nUsage:\n${ACHIEVEMENTS_USAGE}`);
    return undefined;
  }
  parsed.file = paths[0];
  return parsed;
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

function achievementsCheck(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const parsed = parseArgs(args, err);
  if (!parsed) return 2;
  const file = parsed.file ? resolve(cwd, parsed.file) : findAchievementsFile(cwd);
  if (!file) {
    err(`Not inside the Proschi repository; give the achievements file\n\nUsage:\n${ACHIEVEMENTS_USAGE}`);
    return 2;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    err(`No such file: ${parsed.file ?? file}`);
    return 2;
  }
  // The problems and cards folders: given, else next to the file (the repository's layout).
  const problemsDir = parsed.problems ? resolve(cwd, parsed.problems) : join(dirname(file), 'problems');
  const cardsDir = parsed.cards ? resolve(cwd, parsed.cards) : join(dirname(file), 'cards');
  for (const [flag, dir] of [['--problems', problemsDir], ['--cards', cardsDir]] as const) {
    if (!isDir(dir)) {
      err(`No such directory: ${dir}${parsed[flag === '--problems' ? 'problems' : 'cards'] ? '' : ` (give ${flag} <dir>)`}`);
      return 2;
    }
  }

  const text = readFileSync(file, 'utf8');
  let topics: string[];
  try {
    topics = readTopics(readFileSync(join(cardsDir, 'tags.json'), 'utf8')).map((t) => t.id);
  } catch (e) {
    err(e instanceof CardFileError ? `${join(displayPath(cardsDir), 'tags.json')}: ${e.detail}` : String(e));
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    err(`${displayPath(file)}: not valid JSON: ${(e as Error).message}`);
    return 1;
  }
  const { violations } = checkAchievements(raw, { problems: problemsIn(problemsDir), topics, stages: ROADMAP.map((s) => s.id) });
  const count = Array.isArray(raw) ? raw.length : 0;

  const shown = displayPath(file);
  const where = (v: AchievementViolation) => (v.id !== undefined ? `"${v.id}"` : v.index !== undefined ? `entry ${v.index + 1}` : '');
  if (parsed.style === 'json') out(JSON.stringify({ file: shown, achievements: count, violations }, null, 2));
  else if (parsed.style === 'github') {
    const lines = violations.map((v) => `::error file=${shown},line=${lineOf(text, v) ?? 1},title=proschi achievements::${escape(`${where(v) ? `${where(v)}: ` : ''}${v.message}`)}`);
    if (lines.length) out(lines.join('\n'));
  } else {
    const lines = violations.map((v) => {
      const line = lineOf(text, v);
      return `${shown}${line ? `:${line}` : ''}: ${where(v) ? `${where(v)}: ` : ''}${v.message}`;
    });
    lines.push(`${count} achievement${count === 1 ? '' : 's'}: ${violations.length ? `${violations.length} violation(s)` : 'no violations'}`);
    out(lines.join('\n'));
  }
  return violations.length ? 1 : 0;
}

export function runAchievements(args: string[], out: (s: string) => void, err: (s: string) => void, cwd = process.cwd()): number {
  const [sub, ...rest] = args;
  if (sub === 'check') return achievementsCheck(rest, out, err, cwd);
  err(`${sub ? `Unknown achievements command '${sub}'\n\n` : ''}Usage:\n${ACHIEVEMENTS_USAGE}`);
  return 2;
}
