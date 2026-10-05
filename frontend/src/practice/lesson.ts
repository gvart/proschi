/**
 * A problem's lesson, `lesson.md` in its folder (docs/PRACTICE.md, "The
 * lesson"): plain Markdown that teaches the ideas behind the problem before
 * the solver tries it. The roadmap shows it first ("Learn → Challenge →
 * Review"). Pure, so the page, the tests and `proschi problem check` share it.
 */

/** The level-2 headings every lesson has, in this order. */
export const LESSON_HEADINGS = [
  "What you'll learn",
  'The problem, explained',
  'Back-of-the-envelope',
  'Concepts',
  'Designing it step by step',
  'Common mistakes',
  'In the interview',
  'Further reading',
] as const;

/** A problem of a lesson, with its 1-based line when there is one. */
export interface LessonIssue {
  message: string;
  line?: number;
}

/** Curly and straight apostrophes read the same. */
const normalize = (heading: string) => heading.replace(/[‘’]/g, "'").trim();

/** The lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let fence = false;
  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((text, i) => {
      if (/^\s*```/.test(text)) fence = !fence;
      else if (!fence) out.push({ text, line: i + 1 });
    });
  return out;
}

/** The level-2 headings of a Markdown text, outside code blocks. */
export function h2Headings(source: string): { text: string; line: number }[] {
  return proseLines(source)
    .map(({ text, line }) => ({ m: /^##\s+(.*?)\s*#*\s*$/.exec(text), line }))
    .filter((h): h is { m: RegExpExecArray; line: number } => h.m !== null)
    .map(({ m, line }) => ({ text: m[1], line }));
}

/**
 * What is wrong with a lesson: an empty text, a missing or out-of-order
 * required heading, a link that does not go to the web (http or https).
 * Other headings may sit between the required ones.
 */
export function lessonIssues(source: string): LessonIssue[] {
  const issues: LessonIssue[] = [];
  if (!source.trim()) return [{ message: 'The lesson is empty' }];
  const headings = h2Headings(source);
  let last = -1;
  let lastName = '';
  for (const required of LESSON_HEADINGS) {
    const found = headings.find((h) => normalize(h.text) === required);
    if (!found) {
      issues.push({ message: `The lesson needs a "## ${required}" section (the sections are: ${LESSON_HEADINGS.join(', ')})` });
      continue;
    }
    const index = headings.indexOf(found);
    if (index < last) issues.push({ message: `"## ${required}" must come after "## ${lastName}"`, line: found.line });
    else {
      last = index;
      lastName = required;
    }
  }
  for (const { text, line } of proseLines(source)) {
    // Inline code is not a link.
    const prose = text.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(/\]\(([^)\s]*)[^)]*\)/g)) {
      if (!/^https?:\/\/\S+$/i.test(m[1])) issues.push({ message: `Links in a lesson must go to an http(s) address, not "${m[1]}"`, line });
    }
  }
  return issues;
}

/** Minutes to read a Markdown text at about 200 words a minute; at least 1. */
export function readingMinutes(source: string): number {
  const words = source
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / 200));
}
