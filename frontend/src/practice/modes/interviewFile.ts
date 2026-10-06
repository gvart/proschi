import { parseNumber } from '../../learn/grade';
import { h2Headings } from '../lesson';
import { hasText, metaOf, numberedLines, readItem, splitAt, type FileIssue } from './mdItems';

/**
 * A problem's interview, `interview.md` in its folder (docs/PRACTICE.md,
 * "Interview mode"): the clarifying questions a candidate could ask, good
 * ones that reveal a number or a constraint the statement hides in
 * interview mode, weak ones with why they are weak, and back-of-the-envelope
 * estimates with accepted ranges. Pure, so the page, the tests and
 * `proschi problem check` share it.
 *
 *   ## Questions
 *
 *   ### How many redirects a second at peak?
 *   - kind: good
 *   - fact: 10k rps
 *
 *   10k redirects a second, 95% for codes opened recently.
 *
 *   ### Which language should it be written in?
 *   - kind: weak
 *
 *   An implementation detail: it changes nothing in the design.
 *
 *   ## Estimates
 *
 *   ### How many codes are created in a year?
 *   - answer: 3.2B
 *   - unit: codes
 *   - range: 1.5B to 6B
 *
 *   100/s × 86,400 s × 365 ≈ **3.2 billion**.
 */

/** The statement's sections that interview mode hides until "Reveal the rest". */
export const HIDDEN_SECTIONS = ['Scale', 'Constraints'] as const;

export interface ClarifyQuestion {
  question: string;
  good: boolean;
  /** Good questions: the words of problem.md's hidden sections the answer reveals. */
  fact?: string;
  /** Markdown: the interviewer's answer (good) or why the question is weak. */
  answer: string;
}

export interface EstimateQuestion {
  question: string;
  answer: number;
  unit: string;
  /** Accepted answers, inclusive: `range`, or the answer within a `tolerance` factor (2 when neither is given). */
  low: number;
  high: number;
  /** The tolerance factor when there is no explicit range; grading uses `low` and `high`. */
  tolerance: number;
  /** Markdown: the worked answer. */
  solution: string;
}

export interface Interview {
  questions: ClarifyQuestion[];
  estimates: EstimateQuestion[];
}

export const MIN_GOOD = 3;
export const MIN_WEAK = 2;
export const MAX_QUESTIONS = 12;
export const MAX_ESTIMATES = 4;
const DEFAULT_TOLERANCE = 2;

/** Reads interview.md. Never throws: what is wrong is in `issues`, and the items that could be read are in `interview`. */
export function parseInterview(text: string): { interview: Interview; issues: FileIssue[] } {
  const issues: FileIssue[] = [];
  const interview: Interview = { questions: [], estimates: [] };
  if (!text.trim()) return { interview, issues: [{ message: 'The interview is empty' }] };
  const { preamble, parts } = splitAt(numberedLines(text), 2);
  if (hasText(preamble)) issues.push({ message: 'Text before "## Questions"; the file holds only "## Questions" and "## Estimates"', line: preamble.find((l) => l.text.trim())?.line });
  const sections = new Map<string, (typeof parts)[number]>();
  for (const part of parts) {
    if (part.title !== 'Questions' && part.title !== 'Estimates') issues.push({ message: `Unknown section "## ${part.title}" (use "## Questions" and "## Estimates")`, line: part.line });
    else if (sections.has(part.title)) issues.push({ message: `"## ${part.title}" is given twice`, line: part.line });
    else sections.set(part.title, part);
  }
  if (parts.findIndex((p) => p.title === 'Estimates') >= 0 && parts.findIndex((p) => p.title === 'Estimates') < parts.findIndex((p) => p.title === 'Questions')) {
    issues.push({ message: '"## Questions" comes before "## Estimates"', line: sections.get('Estimates')?.line });
  }

  const questions = sections.get('Questions');
  if (!questions) issues.push({ message: 'Missing "## Questions"' });
  else {
    const { preamble: intro, parts: items } = splitAt(questions.lines, 3);
    if (hasText(intro)) issues.push({ message: 'Each question is a "### " heading; nothing goes between "## Questions" and the first one', line: intro.find((l) => l.text.trim())?.line });
    for (const part of items) {
      const item = readItem(part);
      const meta = metaOf(item, ['kind', 'fact'], issues);
      const kind = meta.get('kind')?.[0]?.value;
      const fact = meta.get('fact')?.[0]?.value;
      if (kind !== 'good' && kind !== 'weak') {
        issues.push({ message: `"${item.title}": start with "- kind: good" or "- kind: weak"`, line: item.line });
        continue;
      }
      if (kind === 'good' && !fact) issues.push({ message: `"${item.title}": a good question needs "- fact: …", the words of problem.md's Scale or Constraints it reveals`, line: item.line });
      if (kind === 'weak' && fact !== undefined) issues.push({ message: `"${item.title}": a weak question reveals nothing; remove "- fact"`, line: meta.get('fact')![0].line });
      if (!item.body) issues.push({ message: `"${item.title}": write ${kind === 'good' ? 'the answer it gets' : 'why it is a weak question'} under the settings`, line: item.line });
      if (item.title.length > 200) issues.push({ message: `"${item.title.slice(0, 40)}…": a question is at most 200 characters`, line: item.line });
      interview.questions.push({ question: item.title, good: kind === 'good', ...(kind === 'good' && fact ? { fact } : {}), answer: item.body });
    }
    const good = interview.questions.filter((q) => q.good).length;
    const weak = interview.questions.length - good;
    if (good < MIN_GOOD) issues.push({ message: `At least ${MIN_GOOD} good questions (there are ${good})`, line: questions.line });
    if (weak < MIN_WEAK) issues.push({ message: `At least ${MIN_WEAK} weak questions, with why they are weak (there are ${weak})`, line: questions.line });
    if (interview.questions.length > MAX_QUESTIONS) issues.push({ message: `At most ${MAX_QUESTIONS} questions (there are ${interview.questions.length})`, line: questions.line });
    const seen = new Set<string>();
    for (const q of interview.questions) {
      if (seen.has(q.question)) issues.push({ message: `The question "${q.question}" is asked twice` });
      seen.add(q.question);
    }
  }

  const estimates = sections.get('Estimates');
  if (!estimates) issues.push({ message: 'Missing "## Estimates"' });
  else {
    const { preamble: intro, parts: items } = splitAt(estimates.lines, 3);
    if (hasText(intro)) issues.push({ message: 'Each estimate is a "### " heading; nothing goes between "## Estimates" and the first one', line: intro.find((l) => l.text.trim())?.line });
    for (const part of items) {
      const item = readItem(part);
      const meta = metaOf(item, ['answer', 'unit', 'range', 'tolerance'], issues);
      const at = (key: string) => meta.get(key)?.[0];
      const answerLine = at('answer');
      const answer = answerLine ? parseNumber(answerLine.value) : undefined;
      if (answer === undefined || !(answer > 0)) {
        issues.push({ message: `"${item.title}": "- answer: <number>" above 0 is required (e.g. 2300, 2.3k, 5M)`, line: answerLine?.line ?? item.line });
        continue;
      }
      const unit = at('unit')?.value ?? '';
      if (!unit) issues.push({ message: `"${item.title}": "- unit: …" is required (what the answer counts, e.g. requests/s)`, line: item.line });
      let low = answer / DEFAULT_TOLERANCE;
      let high = answer * DEFAULT_TOLERANCE;
      let tolerance = DEFAULT_TOLERANCE;
      const range = at('range');
      const tol = at('tolerance');
      if (range && tol) issues.push({ message: `"${item.title}": give "range" or "tolerance", not both`, line: tol.line });
      if (range) {
        const m = /^(.+?)\s+to\s+(.+)$/.exec(range.value);
        const l = m ? parseNumber(m[1]) : undefined;
        const h = m ? parseNumber(m[2]) : undefined;
        if (l === undefined || h === undefined || !(l > 0) || !(l <= answer && answer <= h) || l === h) {
          issues.push({ message: `"${item.title}": "- range: <low> to <high>" must be two numbers above 0 around the answer`, line: range.line });
        } else {
          low = l;
          high = h;
          tolerance = Math.max(answer / l, h / answer);
        }
      } else if (tol) {
        const t = parseNumber(tol.value);
        if (t === undefined || t < 1.1 || t > 10) issues.push({ message: `"${item.title}": "- tolerance" is a factor from 1.1 to 10`, line: tol.line });
        else {
          tolerance = t;
          low = answer / t;
          high = answer * t;
        }
      }
      if (!item.body) issues.push({ message: `"${item.title}": write the worked answer under the settings`, line: item.line });
      interview.estimates.push({ question: item.title, answer, unit, low, high, tolerance, solution: item.body });
    }
    if (interview.estimates.length === 0) issues.push({ message: 'At least one estimate', line: estimates.line });
    if (interview.estimates.length > MAX_ESTIMATES) issues.push({ message: `At most ${MAX_ESTIMATES} estimates (there are ${interview.estimates.length})`, line: estimates.line });
  }
  return { interview, issues };
}

/** How facts are compared: without Markdown emphasis or code marks, quotes straightened, spaces collapsed, ignoring case. */
export function normalizeFact(text: string): string {
  return text
    .replace(/[*_`]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The statement split into its level-2 sections, each with its heading line (the text before the first heading has none). */
function sections(statement: string): { title?: string; text: string }[] {
  const lines = statement.replace(/\r\n?/g, '\n').split('\n');
  const starts = h2Headings(statement);
  const out: { title?: string; text: string }[] = [{ text: lines.slice(0, starts[0] ? starts[0].line - 1 : lines.length).join('\n') }];
  starts.forEach((h, i) => out.push({ title: h.text, text: lines.slice(h.line - 1, starts[i + 1] ? starts[i + 1].line - 1 : lines.length).join('\n') }));
  return out;
}

/** The statement without the sections interview mode hides (Scale, Constraints). */
export function redactedStatement(statement: string): string {
  return sections(statement)
    .filter((s) => !(HIDDEN_SECTIONS as readonly string[]).includes(s.title ?? ''))
    .map((s) => s.text.replace(/\n+$/, ''))
    .join('\n\n')
    .trim();
}

/** The text of the hidden sections, normalized like facts. */
export function hiddenText(statement: string): string {
  return normalizeFact(
    sections(statement)
      .filter((s) => (HIDDEN_SECTIONS as readonly string[]).includes(s.title ?? ''))
      .map((s) => s.text)
      .join('\n'),
  );
}

/** Everything wrong with a problem's interview.md: the file's own issues, and good questions whose fact is not in the statement's Scale or Constraints. */
export function interviewIssues(statement: string, text: string): FileIssue[] {
  const { interview, issues } = parseInterview(text);
  const hidden = hiddenText(statement);
  const lines = text.split('\n');
  for (const q of interview.questions) {
    if (!q.fact || hidden.includes(normalizeFact(q.fact))) continue;
    const line = lines.findIndex((l) => /^-\s+fact\s*:/.test(l) && l.includes(q.fact!)) + 1 || undefined;
    issues.push({ message: `"${q.question}": the fact "${q.fact}" is not in problem.md's ${HIDDEN_SECTIONS.join(' or ')} section (copy its words)`, line });
  }
  return issues;
}
