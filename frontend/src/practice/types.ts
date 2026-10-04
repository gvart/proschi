/**
 * A practice problem (docs/design/hld-and-practice.md §5.3). One file per
 * problem in ./problems, listed in ./problems/index.ts; see docs/PRACTICE.md.
 */
export interface Problem {
  /** URL slug, e.g. url-shortener. */
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** caching, queues, consistency, … */
  tags: string[];
  /** Markdown. */
  statement: string;
  /** Proschi: traffic, requirements, tests and fixed nodes (e.g. the client); read-only in the editor. */
  given: string;
  /** Starts with: import "problem.proschi" */
  starter: string;
  /** Reference solution; CI checks it passes every test. */
  solution: string;
  hints: string[];
}

export const DIFFICULTIES: Problem['difficulty'][] = ['easy', 'medium', 'hard'];
