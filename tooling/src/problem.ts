/**
 * `proschi problem check` and `proschi problem new`: practice problems as
 * folders of plain files (docs/PRACTICE.md). The folder format and the rules
 * come from frontend/src/practice (problemFiles.ts, validate.ts), the same
 * code the practice page and its tests use.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProblemFolderError, WRONG_DIR, problemFromFiles } from '../../frontend/src/practice/problemFiles';
import { validateProblem, type ProblemReport, type Violation } from '../../frontend/src/practice/validate';
import { displayPath } from './imports';
import { problemTemplate } from './problemTemplate';

export const PROBLEM_USAGE = `  proschi problem check [--format text|github|json] [dir]
  proschi problem new <id> [--dir <problems dir>]`;

export const PROBLEM_HELP = `problem Practice problems, one folder each (docs/PRACTICE.md).
        check validates every problem folder in dir (default: the repository's
        frontend/src/practice/problems when run inside it): front matter, the
        given (no errors, canonical format), the solution (no diagnostics,
        canonical, passes every test), the starter (fails a test) and each
        wrong/ design (fails every test its "# expect-fail:" lines name),
        interview.md (each good question's fact is in the statement's Scale
        or Constraints; estimates are numbers with a range) and guided.md
        (valid checks that the reference solution passes).
        Exits with 1 on any violation.
        new scaffolds a folder that already passes check, with TODOs.`;

/** Where the problems live in this repository. */
export const REPO_PROBLEMS = join('frontend', 'src', 'practice', 'problems');

/** The repository's problems directory, looking up from `cwd`; undefined outside the repository. */
export function findProblemsDir(cwd = process.cwd()): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, REPO_PROBLEMS);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The files of one problem folder keyed by their path in it: top-level files, and the files of its subfolders as `sub/name`. */
export function readProblemFolder(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) files[entry.name] = readFileSync(join(folder, entry.name), 'utf8');
    else if (entry.isDirectory()) {
      for (const sub of readdirSync(join(folder, entry.name), { withFileTypes: true })) {
        if (!sub.name.startsWith('.')) files[`${entry.name}/${sub.name}`] = sub.isFile() ? readFileSync(join(folder, entry.name, sub.name), 'utf8') : '';
      }
    }
  }
  return files;
}

export interface FolderReport extends ProblemReport {
  /** The problem folder, as given or relative to the working directory. */
  folder: string;
  /** False when the folder could not be read into a problem (then only `violations` is filled). */
  loaded: boolean;
}

/** Checks every problem folder below `dir`, sorted by folder name. */
export function checkProblems(dir: string): FolderReport[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort()
    .map((id) => {
      const folder = displayPath(join(dir, id));
      try {
        const problem = problemFromFiles(id, readProblemFolder(join(dir, id)));
        return { folder, loaded: true, ...validateProblem(problem) };
      } catch (e) {
        if (!(e instanceof ProblemFolderError)) throw e;
        const violation: Violation = { file: e.file ?? '.', message: e.detail, ...(e.line ? { line: e.line } : {}) };
        return { folder, loaded: false, id, tests: 0, starterFails: [], wrong: [], violations: [violation] };
      }
    });
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ');
const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');

export function formatProblemReports(dir: string, reports: FolderReport[], style: 'text' | 'github' | 'json'): string {
  if (style === 'json') return JSON.stringify({ dir: displayPath(dir), problems: reports }, null, 2);
  const lines: string[] = [];
  const where = (r: FolderReport, v: Violation) => (v.file === '.' ? r.folder : join(r.folder, v.file));
  for (const r of reports) {
    if (style === 'github') {
      for (const v of r.violations) lines.push(`::error file=${where(r, v)},line=${v.line ?? 1},title=proschi problem ${r.id}::${escape(v.message)}`);
      continue;
    }
    const ok = r.violations.length === 0;
    const wrong = r.wrong.length === 1 ? '1 wrong design' : `${r.wrong.length} wrong designs`;
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const modes = `${r.interview ? `, interview (${n(r.interview.questions, 'question')}, ${n(r.interview.estimates, 'estimate')})` : ''}${r.guided !== undefined ? `, guided (${n(r.guided, 'step')})` : ''}`;
    lines.push(`${ok ? '✓' : '✗'} ${r.id}${r.loaded ? `: ${r.tests} tests, the starter fails ${r.starterFails.length}, ${wrong}${modes}` : ''}`);
    for (const v of r.violations) lines.push(`    ${where(r, v)}${v.line ? `:${v.line}` : ''}: ${v.message}`);
    for (const w of r.wrong) {
      if (w.missing.length) continue; // reported above
      lines.push(`    ${WRONG_DIR}/${w.name}: fails ${quote(w.expectFail)}${w.alsoFails.length ? `; also fails ${quote(w.alsoFails)}` : ''}`);
    }
  }
  if (style === 'text') {
    const violations = reports.reduce((n, r) => n + r.violations.length, 0);
    const wrong = reports.reduce((n, r) => n + r.wrong.length, 0);
    const bad = reports.filter((r) => r.violations.length).length;
    lines.push(
      `${reports.length} problem${reports.length === 1 ? '' : 's'}, ${wrong} wrong design${wrong === 1 ? '' : 's'}: ${violations ? `${violations} violation(s) in ${bad} problem${bad === 1 ? '' : 's'}` : 'no violations'}`,
    );
  }
  return lines.join('\n');
}

function problemCheck(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  let style: 'text' | 'github' | 'json' = 'text';
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format') {
      const value = args[++i];
      if (value !== 'text' && value !== 'github' && value !== 'json') {
        err(`Unknown format '${value ?? ''}'; use text, github or json`);
        return 2;
      }
      style = value;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${PROBLEM_USAGE}`);
      return 2;
    } else paths.push(arg);
  }
  if (paths.length > 1) {
    err(`Give one problems directory\n\nUsage:\n${PROBLEM_USAGE}`);
    return 2;
  }
  const dir = paths[0] ? resolve(cwd, paths[0]) : findProblemsDir(cwd);
  if (!dir) {
    err(`Not inside the Proschi repository; give the problems directory\n\nUsage:\n${PROBLEM_USAGE}`);
    return 2;
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`No such directory: ${paths[0] ?? dir}`);
    return 2;
  }
  const reports = checkProblems(dir);
  if (reports.length === 0) {
    err(`No problem folders in ${displayPath(dir)}`);
    return 1;
  }
  const text = formatProblemReports(dir, reports, style);
  if (text) out(text);
  return reports.some((r) => r.violations.length > 0) ? 1 : 0;
}

function problemNew(args: string[], out: (s: string) => void, err: (s: string) => void, cwd: string): number {
  let dirArg: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir') {
      dirArg = args[++i];
      if (!dirArg) {
        err('Expected a directory after --dir');
        return 2;
      }
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${PROBLEM_USAGE}`);
      return 2;
    } else ids.push(arg);
  }
  if (ids.length !== 1) {
    err(`Usage:\n${PROBLEM_USAGE}`);
    return 2;
  }
  const id = ids[0];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    err(`The id '${id}' must be lowercase words joined by "-", e.g. url-shortener (it is the folder name and the URL)`);
    return 2;
  }
  const dir = dirArg ? resolve(cwd, dirArg) : (findProblemsDir(cwd) ?? resolve(cwd, 'problems'));
  const folder = join(dir, id);
  if (existsSync(folder)) {
    err(`${displayPath(folder)} already exists`);
    return 1;
  }
  const files = problemTemplate(id);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
  const shown = displayPath(folder);
  out(`Created ${shown}/
  ${Object.keys(files).join('\n  ')}

It already passes \`proschi problem check\`; now make it your problem:
  1. problem.md: title, summary, difficulty, tags, hints, and the statement
     (name every use case in bold and spell out the scenario names).
  2. given.proschi: the fixed nodes, the traffic, the requirements and the
     tests that encode the key insight. Capacity overrides go here only.
  3. solution.proschi: a good answer that passes every test; starter.proschi:
     a small valid start that fails at least one.
  4. Calibrate: set the latency, cost and availability limits between the
     reference design and brute-force designs, and prove it with wrong/
     designs that start with "# expect-fail: <test name>".
  5. Run: proschi problem check ${displayPath(dir)}`);
  return 0;
}

export function runProblem(args: string[], out: (s: string) => void, err: (s: string) => void, cwd = process.cwd()): number {
  const [sub, ...rest] = args;
  if (sub === 'check') return problemCheck(rest, out, err, cwd);
  if (sub === 'new') return problemNew(rest, out, err, cwd);
  err(`${sub ? `Unknown problem command '${sub}'\n\n` : ''}Usage:\n${PROBLEM_USAGE}`);
  return 2;
}
