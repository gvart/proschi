/**
 * A practice problem (docs/design/hld-and-practice.md §5.3). Each problem is a
 * folder of plain files in ./problems/<id>/, read by ./problemFiles.ts; see
 * docs/PRACTICE.md.
 */
export interface Problem {
  /** URL slug and folder name, e.g. url-shortener. */
  id: string;
  title: string;
  /** One line for lists, e.g. on the landing page. */
  summary: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** caching, queues, consistency, … */
  tags: string[];
  /** Position within its difficulty, before the title decides; absent sorts after any number. */
  order?: number;
  /** Markdown. */
  statement: string;
  /** Proschi: traffic, requirements, tests and fixed nodes (e.g. the client); read-only in the editor. */
  given: string;
  /** Starts with: import "problem.proschi" */
  starter: string;
  /** Reference solution; CI checks it passes every test. */
  solution: string;
  hints: string[];
  /** Plausible wrong designs from wrong/*.proschi, each failing the tests it names. */
  wrong?: WrongDesign[];
}

export interface WrongDesign {
  /** File name without .proschi. */
  name: string;
  source: string;
  /** Names of the tests it must fail, from its `# expect-fail: <name>` lines. */
  expectFail: string[];
}

export const DIFFICULTIES: Problem['difficulty'][] = ['easy', 'medium', 'hard'];
