import { defaultEngine } from '../../../frontend/src/hld/engine';
import { parseInterview, redactedStatement } from '../../../frontend/src/practice/modes/interviewFile';
import type { Problem } from '../../../frontend/src/practice/types';
import { parseSolution, runTests } from '../../../frontend/src/practice/workspace';
import { modelSummary, reviewTests } from '../../../frontend/src/review/request';
import type { ReviewTests } from '../../../frontend/src/review/contract';
import { findProblem } from '../verify';
import { interviewFiles } from './interviewFiles.gen';

/**
 * The problem context of an AI interview: everything the interviewer knows
 * about the problem, rendered once into one stable block of text that every
 * request of the session sends first and caches (prompt caching is a byte
 * prefix match, so it must never change within a session).
 *
 * The files come the way verify.ts gets them: scripts/problems.mjs bundles
 * each problem folder into src/problems.gen.ts (findProblem), and writes the
 * two reader files the interviewer needs, interview.md and the lesson's
 * "In the interview" section, into ./interviewFiles.gen.ts.
 */

export type TopicKind = 'clarify' | 'estimate' | 'followup';

/** Something the candidate can cover: a good clarifying question, an estimate, a likely follow-up. */
export interface Topic {
  id: string;
  kind: TopicKind;
  label: string;
  /** A clarify topic's fact as problem.md words it (interview.md `fact`): its numbers tell when a reply revealed it (src/ai/facts.ts). */
  source?: string;
}

export interface ProblemContext {
  problem: Problem;
  /** The cached block. */
  text: string;
  topics: Topic[];
  /** What the candidate sees at the start: the statement without Scale and Constraints. */
  shownStatement: string;
}

/** A rough token count (about 4 characters a token for English and code), for budgets and the size test. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);

const contexts = new Map<string, ProblemContext | undefined>();

/** The context of a bundled problem, built once per isolate; undefined for an unknown id. */
export function problemContext(id: string): ProblemContext | undefined {
  if (!contexts.has(id)) {
    const problem = findProblem(id);
    const files = Object.prototype.hasOwnProperty.call(interviewFiles, id) ? interviewFiles[id] : undefined;
    contexts.set(id, problem && files ? buildContext(problem, files) : undefined);
  }
  return contexts.get(id);
}

/** The `## <title>` section of Markdown without its heading, up to the next level-2 heading outside a code fence. */
export function h2Section(source: string, title: string): string {
  const out: string[] = [];
  let inside = false;
  let fence = false;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.startsWith('## ')) {
      if (inside) break;
      inside = line.slice(3).trim() === title;
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n').trim();
}

/** The follow-up questions of the lesson's "In the interview" section: the bold or italic lead of each bullet, quotes dropped. */
export function followUps(lessonInterview: string): string[] {
  return [...lessonInterview.matchAll(/^- (?:\*\*(.+?)\*\*|\*(?!\*)(.+?)\*)/gm)].map((m) => (m[1] ?? m[2]).replace(/^["“]|["”]$/g, '').trim());
}

const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(3)).toLocaleString('en-US') : String(n));

/** The reference design as a few lines: components, connections, decisions and what it measures. */
export function referenceSummary(problem: Problem): string {
  const parsed = parseSolution(problem, problem.solution);
  const summary = modelSummary(parsed.diagram, parsed.diagnostics);
  const run = runTests(parsed, defaultEngine);
  const lines = [
    `Components: ${summary.nodes.map((n) => `${n.name} [${n.tech}]${n.replicas && n.replicas > 1 ? ` x${n.replicas}` : ''}`).join('; ')}`,
    `Connections: ${summary.edges.map((e) => `${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ''}`).join('; ')}`,
    ...(summary.decisions.length ? [`Decisions: ${summary.decisions.join('; ')}`] : []),
    `It passes ${run.passed} of ${run.results.length} tests` +
      (run.metrics?.costUsd !== undefined ? `, costs about $${fmt(run.metrics.costUsd)} a month` : '') +
      (run.metrics?.p99Ms !== undefined ? `, worst p99 ${fmt(run.metrics.p99Ms)} ms` : '') +
      '. Other designs can pass too.',
  ];
  return lines.join('\n');
}

export function buildContext(problem: Problem, files: { interview: string; lessonInterview: string }): ProblemContext {
  const { interview } = parseInterview(files.interview);
  const shownStatement = redactedStatement(problem.statement);
  const hidden = ['Scale', 'Constraints'].map((t) => `### ${t}\n${h2Section(problem.statement, t)}`).join('\n\n');
  const topics: Topic[] = [];
  const questions = interview.questions.map((q, i) => {
    if (!q.good) return `- (weak) ${q.question}\n  Why it is weak: ${q.answer}`;
    const id = `q${i + 1}`;
    topics.push({ id, kind: 'clarify', label: q.question, ...(q.fact ? { source: q.fact } : {}) });
    return `- [${id}] ${q.question}\n  Answer: ${q.answer}`;
  });
  const estimates = interview.estimates.map((e, i) => {
    const id = `e${i + 1}`;
    topics.push({ id, kind: 'estimate', label: e.question });
    return `- [${id}] ${e.question}\n  Answer: ${fmt(e.answer)} ${e.unit} (accept ${fmt(e.low)} to ${fmt(e.high)}; the right order of magnitude ${fmt(e.answer / 10)} to ${fmt(e.answer * 10)})\n  Worked: ${e.solution}`;
  });
  const followups = followUps(files.lessonInterview).map((f, i) => {
    const id = `f${i + 1}`;
    topics.push({ id, kind: 'followup', label: f });
    return `- [${id}] ${f}`;
  });
  const text = [
    `<problem id="${problem.id}" title="${problem.title}" difficulty="${problem.difficulty}">`,
    `<statement_shown>\nWhat the candidate sees: the statement without its Scale and Constraints.\n\n${shownStatement}\n</statement_shown>`,
    `<hidden_facts>\nReveal a fact only when a question asks for it.\n\n${hidden}\n</hidden_facts>`,
    `<clarifying_questions>\nGood questions (with your answer) and weak ones (with why). The candidate does not see this list.\n${questions.join('\n')}\n</clarifying_questions>`,
    `<estimates>\nBack-of-the-envelope questions for the Estimate phase, with accepted ranges.\n${estimates.join('\n')}\n</estimates>`,
    `<given>\nThe problem's fixed file (problem.proschi): traffic, requirements and the tests the server runs on the design.\n${problem.given.trim()}\n</given>`,
    `<interview_guidance>\nHow a strong candidate presents this problem, and the follow-ups to ask in the Design and Wrap-up phases.\n${files.lessonInterview}\n\nFollow-up topics:\n${followups.join('\n')}\n</interview_guidance>`,
    `<reference_design>\nOne design that solves it. Never show or describe it to the candidate; use it to judge.\n${referenceSummary(problem)}\n</reference_design>`,
    `</problem>`,
  ].join('\n\n');
  return { problem, text, topics, shownStatement };
}

/** The server's own test run of a design (P6): the model is given these, never the page's results. */
export interface DesignGrade extends ReviewTests {
  /** The first parse errors, when the design has errors. */
  errors: string[];
}

export function gradeDesign(problem: Problem, source: string): DesignGrade {
  const parsed = parseSolution(problem, source);
  const errors = parsed.diagnostics
    .filter((d) => d.severity === 'error' && d.file === undefined)
    .slice(0, 5)
    .map((d) => `line ${d.line}: ${d.message}`);
  return { ...reviewTests(runTests(parsed, defaultEngine)), errors };
}
