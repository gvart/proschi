/**
 * `proschi game check|lock|sim`: the content of Scale or Fail, the system
 * design roguelite (docs/GAME.md). The format, the rules and the checks come
 * from frontend/src/game/engine, the same code the Arcade page and the Worker
 * run.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { checkGame, LOCK_FILE, playScript, type GameCheck, type ScriptedRun } from '../../frontend/src/game/engine/check';
import { readContent } from '../../frontend/src/game/engine/content';
import { readTopics } from '../../frontend/src/learn/cards';
import { displayPath } from './imports';
import { findCardsDir } from './cards';
import { findProblemsDir } from './problem';

export const GAME_USAGE = `  proschi game check [--format text|github|json] [dir]
  proschi game lock [dir]
  proschi game sim <scenario> [--run <file.json>] [--seed <seed>] [--ascension <n>] [dir]`;

export const GAME_HELP = `game    Scale or Fail, the system design game (docs/GAME.md).
        check validates the content folder (default: the repository's
        frontend/src/game/content): components, perks, cards, events and
        scenarios; ids listed in ids.lock; review cards, topics and practice
        problems they refer to; requirement lines that parse; and the
        scripted runs: every reference.json must clear all waves, every
        wrong/*.json must fail by its wave, and doing nothing must lose.
        Exits with 1 on any violation.
        lock adds new ids to ids.lock.
        sim plays a scenario's reference run (or --run) and prints every
        wave: traffic, cost, revenue, score, Trust and what broke.`;

export const REPO_GAME = join('frontend', 'src', 'game', 'content');

export function findGameDir(cwd = process.cwd()): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, REPO_GAME);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Every file below `dir`, keyed by its path in it with `/` separators. */
export function readGameFolder(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(dir, full).split('\\').join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

/** Review cards, topics and problems the content refers to: from the repository around `dir`, else around `cwd`. */
function cardContext(dir: string, cwd: string): { cards: Set<string>; topics: Set<string>; problems: Set<string> } {
  const cardsDir = findCardsDir(dir) ?? findCardsDir(cwd);
  const problemsDir = findProblemsDir(dir) ?? findProblemsDir(cwd);
  const cards = new Set<string>();
  const topics = new Set<string>();
  if (cardsDir) {
    for (const topic of readdirSync(cardsDir, { withFileTypes: true })) {
      if (!topic.isDirectory()) continue;
      for (const f of readdirSync(join(cardsDir, topic.name))) if (f.endsWith('.md')) cards.add(f.slice(0, -3));
    }
    const tags = join(cardsDir, 'tags.json');
    if (existsSync(tags)) for (const t of readTopics(readFileSync(tags, 'utf8'))) topics.add(t.id);
  }
  const problems = new Set(problemsDir ? readdirSync(problemsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
  return { cards, topics, problems };
}

const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');

export function formatGameCheck(dir: string, check: GameCheck, style: 'text' | 'github' | 'json'): string {
  const shown = displayPath(dir);
  if (style === 'json') return JSON.stringify({ dir: shown, scenarios: check.content.scenarios.length, runs: check.runs, violations: check.violations }, null, 2);
  if (style === 'github') return check.violations.map((v) => `::error file=${join(shown, v.file)},line=${v.line ?? 1},title=proschi game::${escape(v.message)}`).join('\n');
  const lines = check.violations.map((v) => `${join(shown, v.file)}${v.line ? `:${v.line}` : ''}: ${v.message}`);
  for (const r of check.runs) lines.push(`  ${r.scenario}/${r.name}: ${r.outcome ?? 'running'} after ${r.waves} wave(s), score ${r.score}, ${Math.round(r.ms)} ms`);
  const c = check.content;
  lines.push(
    `${c.scenarios.length} scenario(s), ${c.components.length} components, ${c.cards.length} cards, ${c.events.length} events, ${c.perks.length} perks: ` +
      (check.violations.length ? `${check.violations.length} violation(s)` : 'no violations'),
  );
  return lines.join('\n');
}

interface Args {
  style: 'text' | 'github' | 'json';
  dir?: string;
  positional: string[];
  run?: string;
  seed?: string;
  ascension?: number;
}

function parseArgs(args: string[], err: (s: string) => void): Args | undefined {
  const a: Args = { style: 'text', positional: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined) err(`Expected a value after ${arg}`);
      return v;
    };
    if (arg === '--format') {
      const v = value();
      if (v !== 'text' && v !== 'github' && v !== 'json') {
        err(`Unknown format '${v ?? ''}'; use text, github or json`);
        return undefined;
      }
      a.style = v;
    } else if (arg === '--run') {
      a.run = value();
      if (a.run === undefined) return undefined;
    } else if (arg === '--seed') {
      a.seed = value();
      if (a.seed === undefined) return undefined;
    } else if (arg === '--ascension') {
      const v = Number(value());
      if (!Number.isInteger(v) || v < 0) {
        err('--ascension takes a whole number from 0');
        return undefined;
      }
      a.ascension = v;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${GAME_USAGE}`);
      return undefined;
    } else a.positional.push(arg);
  }
  return a;
}

function resolveDir(dirArg: string | undefined, cwd: string, err: (s: string) => void): string | undefined {
  const dir = dirArg ? resolve(cwd, dirArg) : findGameDir(cwd);
  if (!dir) {
    err(`Not inside the Proschi repository; give the game content directory\n\nUsage:\n${GAME_USAGE}`);
    return undefined;
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`No such directory: ${dirArg ?? dir}`);
    return undefined;
  }
  return dir;
}

function gameCheck(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const a = parseArgs(args, err);
  if (!a) return 2;
  if (a.positional.length > 1) {
    err(`Give one content directory\n\nUsage:\n${GAME_USAGE}`);
    return 2;
  }
  const dir = resolveDir(a.positional[0], cwd, err);
  if (!dir) return 2;
  const check = checkGame(readGameFolder(dir), cardContext(dir, cwd));
  const text = formatGameCheck(dir, check, a.style);
  if (text) out(text);
  return check.violations.length ? 1 : 0;
}

/** The ids a content folder publishes, as ids.lock lists them. */
export function contentIds(files: Record<string, string>): string[] {
  const { content } = readContent(files);
  const ids = [
    ...content.components.map((c) => `component:${c.id}`),
    ...content.features.map((f) => `feature:${f.id}`),
    ...content.perks.map((p) => `perk:${p.id}`),
    ...content.cards.map((c) => `card:${c.id}`),
    ...content.events.map((e) => `event:${e.id}`),
    ...content.scenarios.map((s) => `scenario:${s.id}`),
  ];
  // Files that do not read yet still get their ids: the id is the file or folder name.
  for (const path of Object.keys(files)) {
    let m = /^cards\/([^/]+)\.md$/.exec(path);
    if (m) ids.push(`card:${m[1]}`);
    m = /^events\/([^/]+)\.md$/.exec(path);
    if (m) ids.push(`event:${m[1]}`);
    m = /^scenarios\/([^/]+)\/scenario\.json$/.exec(path);
    if (m) ids.push(`scenario:${m[1]}`);
  }
  return [...new Set(ids)];
}

const LOCK_HEADER = '# Every id Scale or Fail has published. Ids are never removed: progress and replays refer to them.\n# Add new ones with `proschi game lock`.\n';

function gameLock(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const a = parseArgs(args, err);
  if (!a) return 2;
  const dir = resolveDir(a.positional[0], cwd, err);
  if (!dir) return 2;
  const lockPath = join(dir, LOCK_FILE);
  const existing = existsSync(lockPath)
    ? readFileSync(lockPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [];
  const ids = contentIds(readGameFolder(dir));
  const added = ids.filter((id) => !existing.includes(id)).sort();
  const all = [...new Set([...existing, ...ids])].sort();
  const text = LOCK_HEADER + all.join('\n') + '\n';
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) writeFileSync(lockPath, text);
  out(added.length ? `Added ${added.length} id${added.length === 1 ? '' : 's'} to ${displayPath(lockPath)}:\n  ${added.join('\n  ')}` : `${displayPath(lockPath)} already lists every id`);
  return 0;
}

function gameSim(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  const a = parseArgs(args, err);
  if (!a) return 2;
  const [scenario, dirArg] = a.positional;
  if (!scenario) {
    err(`Give a scenario id\n\nUsage:\n${GAME_USAGE}`);
    return 2;
  }
  const dir = resolveDir(dirArg, cwd, err);
  if (!dir) return 2;
  const files = readGameFolder(dir);
  const { content, errors } = readContent(files);
  if (errors.length) {
    err(errors.map((e) => e.message).join('\n'));
    return 1;
  }
  if (!content.scenarios.some((s) => s.id === scenario)) {
    err(`No scenario '${scenario}'; there are ${content.scenarios.map((s) => s.id).join(', ')}`);
    return 2;
  }
  const runPath = a.run ? resolve(cwd, a.run) : undefined;
  const text = runPath ? (existsSync(runPath) ? readFileSync(runPath, 'utf8') : undefined) : files[`scenarios/${scenario}/reference.json`];
  if (text === undefined) {
    err(runPath ? `No such file: ${a.run}` : `Scenario '${scenario}' has no reference.json; give one with --run`);
    return 2;
  }
  let run: ScriptedRun;
  try {
    run = JSON.parse(text) as ScriptedRun;
  } catch (e) {
    err(`Not valid JSON: ${(e as Error).message}`);
    return 2;
  }
  if (a.seed !== undefined) run.seed = a.seed;
  if (a.ascension !== undefined) run.ascension = a.ascension;
  let game;
  try {
    game = playScript(content, scenario, run);
  } catch (e) {
    err((e as Error).message);
    return 1;
  }
  const s = game.state;
  const pad = (v: string | number, n: number) => String(v).padStart(n);
  out(`${'wave'.padEnd(26)} ${pad('cost', 7)} ${pad('revenue', 8)} ${pad('points', 8)} ${pad('trust', 6)}  what broke`);
  for (const h of s.history) {
    const kinds = new Map<string, number>();
    for (const b of h.breaches) kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1);
    const label = `${h.wave + 1}${h.name ? ` ${h.name}` : ''}${h.boss ? ' (boss)' : ''}`.slice(0, 26).padEnd(26);
    const events = h.events.length ? ` [${h.events.map((e) => e.id).join(', ')}]` : '';
    out(
      `${label} ${pad(`$${h.cost}`, 7)} ${pad(`$${h.revenue}`, 8)} ${pad(h.points + h.leanBonus + h.bossBonus, 8)} ${pad(h.trustDelta, 6)}  ${[...kinds].map(([k, n]) => `${k}×${n}`).join(' ') || 'clean'}${events}`,
    );
    if (h.worst) out(`${' '.repeat(27)}${h.worst.message}`);
  }
  out(`\n${s.outcome ?? s.phase}: score ${s.score}, cash $${Math.round(s.cash)}, Trust ${s.trust}, cards ${s.hand.join(', ') || 'none'}`);
  return 0;
}

export function runGame(args: string[], out: (s: string) => void, err: (s: string) => void, cwd = process.cwd()): number {
  const [sub, ...rest] = args;
  if (sub === 'check') return gameCheck(rest, out, err, cwd);
  if (sub === 'lock') return gameLock(rest, out, err, cwd);
  if (sub === 'sim') return gameSim(rest, out, err, cwd);
  err(`${sub ? `Unknown game command '${sub}'\n\n` : ''}Usage:\n${GAME_USAGE}`);
  return 2;
}
