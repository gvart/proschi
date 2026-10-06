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
  /**
   * The company whose published system the problem is based on (its "Based
   * on" section), e.g. Twitter. Says nothing about that company's interviews.
   */
  company?: string;
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
  /**
   * Bumped when a change to the problem can change whether a design solves it,
   * or its cost or p99; absent means 1. The server's global stats count only
   * solves of the current version.
   */
  version?: number;
  /**
   * The lesson from lesson.md (Markdown): the concepts behind the problem,
   * read before trying it (lesson.ts has the required sections).
   */
  lesson?: string;
  /**
   * interview.md (Markdown): interview mode's clarifying questions and
   * estimates (modes/interviewFile.ts reads it).
   */
  interview?: string;
  /** guided.md (Markdown): guided mode's steps and checkpoints (modes/guidedFile.ts reads it). */
  guided?: string;
  /** Plausible wrong designs from wrong/*.proschi, each failing the tests it names. */
  wrong?: WrongDesign[];
}

export interface WrongDesign {
  /** File name without .proschi. */
  name: string;
  source: string;
  /** Names of the tests it must fail, from its `# expect-fail: <name>` lines. */
  expectFail: string[];
  /** The mistake it makes, from its `# mistake:`, `# explain:`, `# lesson:` and `# cards:` lines (mistakes.ts). */
  mistake?: Mistake;
}

/** A known mistake: what a learner whose run fails like a wrong design is shown. */
export interface Mistake {
  /** One line, e.g. "Cache misses that never fill the cache". */
  title: string;
  /** Two or three sentences: what breaks, and what to do instead. */
  explain: string;
  /** The id of a heading in the problem's lesson, e.g. cache-aside-lazy-loading. */
  lesson?: string;
  /** Ids of review cards that train the idea. */
  cards: string[];
}

export const DIFFICULTIES: Problem['difficulty'][] = ['easy', 'medium', 'hard'];
