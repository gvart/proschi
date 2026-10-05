import { FrontMatterError, parseFrontMatter, type FrontMatterValue } from './frontMatter';
import { DIFFICULTIES, type Problem, type WrongDesign } from './types';

/**
 * A problem folder as plain files (docs/PRACTICE.md), turned into a Problem.
 * Pure: the web page feeds it Vite's import.meta.glob, the CLI the file system.
 *
 *   <id>/problem.md          front matter + statement
 *   <id>/given.proschi
 *   <id>/starter.proschi
 *   <id>/solution.proschi
 *   <id>/lesson.md           optional: the lesson shown before the problem
 *   <id>/wrong/<name>.proschi
 */

export const PROBLEM_MD = 'problem.md';
export const GIVEN = 'given.proschi';
export const STARTER = 'starter.proschi';
export const SOLUTION = 'solution.proschi';
export const LESSON_MD = 'lesson.md';
export const WRONG_DIR = 'wrong';
const REQUIRED = [PROBLEM_MD, GIVEN, STARTER, SOLUTION];
const OPTIONAL = [LESSON_MD];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Names a problem folder cannot have: `problem` is the template of the static
 * problem pages (practice/problem/), `roadmap` and `approach` are practice
 * routes and pages of their own (practice/#/roadmap, practice/approach/).
 */
export const RESERVED_IDS = ['problem', 'roadmap', 'approach'];
const EXPECT_FAIL = /^#\s*expect-fail:\s*(.*?)\s*$/;

/** What is wrong with one problem folder; `file` is relative to the folder. */
export class ProblemFolderError extends Error {
  readonly folder: string;
  readonly file?: string;
  readonly line?: number;
  /** The message without the folder and file. */
  readonly detail: string;
  constructor(folder: string, message: string, file?: string, line?: number) {
    super(`problems/${folder}: ${file ? `${file}${line ? `:${line}` : ''}: ` : ''}${message}`);
    this.name = 'ProblemFolderError';
    this.detail = message;
    this.folder = folder;
    this.file = file;
    this.line = line;
  }
}

/** The `# expect-fail:` names at the top of a wrong design; the other leading comment lines are free text. */
export function expectFailLines(source: string): string[] {
  const names: string[] = [];
  for (const line of source.split('\n')) {
    if (!line.startsWith('#')) break;
    const m = line.match(EXPECT_FAIL);
    if (m) names.push(m[1]);
  }
  return names;
}

const FIELDS = ['title', 'summary', 'difficulty', 'tags', 'company', 'order', 'hints', 'version'];

export type ProblemMeta = Pick<Problem, 'title' | 'summary' | 'difficulty' | 'tags' | 'company' | 'order' | 'statement' | 'hints' | 'version'>;

/** Reads problem.md of folder `id`: the front matter fields and the statement. Throws ProblemFolderError. */
export function readProblemMd(id: string, text: string): ProblemMeta {
  const fail = (message: string, line?: number): never => {
    throw new ProblemFolderError(id, message, PROBLEM_MD, line);
  };
  let data: Record<string, FrontMatterValue>;
  let body: string;
  try {
    ({ data, body } = parseFrontMatter(text));
  } catch (e) {
    if (e instanceof FrontMatterError) return fail(e.message.replace(/^line \d+: /, ''), e.line);
    throw e;
  }
  for (const key of Object.keys(data)) if (!FIELDS.includes(key)) fail(`Unknown front matter field '${key}' (use ${FIELDS.join(', ')})`);
  const str = (key: string): string => {
    const v = data[key];
    if (typeof v !== 'string' || v.trim() === '') return fail(`'${key}' must be a non-empty string`);
    return v;
  };
  const list = (key: string): string[] => {
    const v = data[key];
    if (!Array.isArray(v) || v.length === 0) return fail(`'${key}' must be a list with at least one item`);
    return v;
  };
  const difficulty = str('difficulty') as Problem['difficulty'];
  if (!DIFFICULTIES.includes(difficulty)) fail(`'difficulty' must be one of ${DIFFICULTIES.join(', ')}`);
  const company = data.company === undefined ? undefined : str('company');
  const order = data.order;
  if (order !== undefined && typeof order !== 'number') fail("'order' must be a number");
  const version = data.version;
  if (version !== undefined && !(typeof version === 'number' && Number.isInteger(version) && version >= 1)) fail("'version' must be a whole number from 1");
  if (body === '') fail('The statement (the Markdown after the front matter) is empty');
  return {
    title: str('title'),
    summary: str('summary'),
    difficulty,
    tags: list('tags'),
    ...(company !== undefined ? { company } : {}),
    ...(typeof order === 'number' ? { order } : {}),
    statement: body,
    hints: list('hints'),
    ...(typeof version === 'number' ? { version } : {}),
  };
}

/**
 * Builds a Problem from the files of folder `id`, keyed by their path in the
 * folder (`problem.md`, `wrong/x.proschi`). Throws ProblemFolderError naming
 * the folder and file for a missing or unexpected file, or bad front matter.
 */
export function problemFromFiles(id: string, files: Record<string, string>): Problem {
  const fail = (message: string): never => {
    throw new ProblemFolderError(id, message);
  };
  if (!ID.test(id)) fail('The folder name is the problem id and must be lowercase words joined by "-", e.g. url-shortener');
  if (RESERVED_IDS.includes(id)) fail(`"${id}" is taken by a practice page; reserved ids: ${RESERVED_IDS.join(', ')}`);
  for (const name of REQUIRED) if (files[name] === undefined) fail(`Missing ${name}`);
  for (const name of Object.keys(files)) {
    const wrong = name.startsWith(`${WRONG_DIR}/`) ? name.slice(WRONG_DIR.length + 1) : undefined;
    if (!REQUIRED.includes(name) && !OPTIONAL.includes(name) && !(wrong && /^[a-z0-9][a-z0-9-]*\.proschi$/.test(wrong))) {
      fail(`Unexpected file ${name}: a problem folder holds ${REQUIRED.join(', ')}, optionally ${OPTIONAL.join(', ')}, and ${WRONG_DIR}/<name>.proschi (lowercase, digits and "-")`);
    }
  }
  const meta = readProblemMd(id, files[PROBLEM_MD]);
  const wrong: WrongDesign[] = Object.keys(files)
    .filter((name) => name.startsWith(`${WRONG_DIR}/`))
    .sort()
    .map((name) => ({ name: name.slice(WRONG_DIR.length + 1, -'.proschi'.length), source: files[name], expectFail: expectFailLines(files[name]) }));
  return {
    id,
    ...meta,
    given: files[GIVEN],
    starter: files[STARTER],
    solution: files[SOLUTION],
    ...(files[LESSON_MD] !== undefined ? { lesson: files[LESSON_MD] } : {}),
    ...(wrong.length ? { wrong } : {}),
  };
}

/** List order: by difficulty (easy first), then `order` (absent last), then title. */
export function compareProblems(a: Pick<Problem, 'difficulty' | 'order' | 'title'>, b: Pick<Problem, 'difficulty' | 'order' | 'title'>): number {
  return (
    DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) ||
    (a.order ?? Infinity) - (b.order ?? Infinity) ||
    a.title.localeCompare(b.title, 'en')
  );
}

export interface Catalog {
  problems: Problem[];
  /** Folders that could not be read; their problems are left out. */
  errors: ProblemFolderError[];
}

/**
 * Groups files keyed `<folder>/<path in folder>` by folder and builds every
 * problem, sorted for the list.
 */
export function catalogFromFiles(files: Record<string, string>): Catalog {
  const folders = new Map<string, Record<string, string>>();
  for (const [path, text] of Object.entries(files)) {
    const slash = path.indexOf('/');
    if (slash < 0) continue;
    const folder = path.slice(0, slash);
    if (!folders.has(folder)) folders.set(folder, {});
    folders.get(folder)![path.slice(slash + 1)] = text;
  }
  const problems: Problem[] = [];
  const errors: ProblemFolderError[] = [];
  for (const [folder, folderFiles] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      problems.push(problemFromFiles(folder, folderFiles));
    } catch (e) {
      if (e instanceof ProblemFolderError) errors.push(e);
      else throw e;
    }
  }
  return { problems: problems.sort(compareProblems), errors };
}
