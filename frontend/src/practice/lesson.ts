/**
 * A problem's lesson, `lesson.md` in its folder (docs/PRACTICE.md, "The
 * lesson"): plain Markdown that teaches the ideas behind the problem before
 * the solver tries it. The roadmap shows it first ("Learn → Challenge →
 * Review"). Pure, so the page, the tests and `proschi problem check` share it.
 */

import { CALLOUT_TONES, FENCE, RICH_BLOCKS, closesFence } from './lessonBlocks';

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

/** A lesson block (```callout and the others): its language, the rest of its opening line, where it opens and its body's lines. */
interface LessonBlock {
  lang: string;
  info: string;
  line: number;
  body: { text: string; line: number }[];
}

/** A line of prose: outside code fences, maybe inside a lesson block. */
interface ProseLine {
  text: string;
  line: number;
  /** The innermost lesson block the line is in. */
  block?: LessonBlock;
}

/**
 * Reads a text's lines as markdown.ts does: code fences close on as many
 * backticks as they opened with, a lesson block's body is prose (a quiz's
 * ids are not) and its fence lines are not. Lines are 1-based.
 */
function scan(source: string): { prose: ProseLine[]; blocks: LessonBlock[] } {
  const prose: ProseLine[] = [];
  const blocks: LessonBlock[] = [];
  const open: (LessonBlock & { ticks: string })[] = [];
  let code: string | undefined;
  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((text, i) => {
      const line = i + 1;
      if (code !== undefined) {
        if (closesFence(text, code)) code = undefined;
        return;
      }
      const top = open.at(-1);
      if (top && closesFence(text, top.ticks)) {
        open.pop();
        return;
      }
      const fence = FENCE.exec(text);
      if (fence) {
        const [, ticks, lang, info = ''] = fence;
        // A fence inside a block is part of its body (so a deepdive of code is not empty).
        if (top) blocks.find((b) => b.line === top.line)!.body.push({ text, line });
        if ((RICH_BLOCKS as readonly string[]).includes(lang)) {
          const block = { lang, info, line, body: [] };
          blocks.push(block);
          open.push({ ...block, ticks });
        } else code = ticks;
        return;
      }
      if (top) blocks.find((b) => b.line === top.line)!.body.push({ text, line });
      if (top?.lang !== 'quiz') prose.push({ text, line, ...(top ? { block: blocks.find((b) => b.line === top.line) } : {}) });
    });
  return { prose, blocks };
}

const proseLines = (source: string) => scan(source).prose;

/** The level-2 headings of a Markdown text, outside code blocks. */
export function h2Headings(source: string): { text: string; line: number }[] {
  return proseLines(source)
    .filter((l) => !l.block)
    .map(({ text, line }) => ({ m: /^##\s+(.*?)\s*#*\s*$/.exec(text), line }))
    .filter((h): h is { m: RegExpExecArray; line: number } => h.m !== null)
    .map(({ m, line }) => ({ text: m[1], line }));
}

/**
 * What is wrong with a lesson: an empty text, a missing or out-of-order
 * required heading, a link that does not go to the web (http or https), a
 * lesson block that is malformed or quizzes a card that does not exist (when
 * `cardIds`, every live card's id, is given). Other headings may sit between
 * the required ones.
 */
export function lessonIssues(source: string, cardIds?: ReadonlySet<string>): LessonIssue[] {
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
  issues.push(...blockIssues(source, cardIds));
  for (const { text, line } of proseLines(source)) {
    // Inline code is not a link.
    const prose = text.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(/\]\(([^)\s]*)[^)]*\)/g)) {
      if (!/^https?:\/\/\S+$/i.test(m[1])) issues.push({ message: `Links in a lesson must go to an http(s) address, not "${m[1]}"`, line });
    }
  }
  return issues;
}

/** What is wrong with a text's lesson blocks (docs/PRACTICE.md, "Lesson blocks"); a guide is checked with it too. */
export function blockIssues(source: string, cardIds?: ReadonlySet<string>): LessonIssue[] {
  const issues: LessonIssue[] = [];
  for (const block of scan(source).blocks) {
    const { lang, info, line } = block;
    const tone = info.split(/\s+/)[0];
    if (lang === 'callout' && !(CALLOUT_TONES as readonly string[]).includes(tone))
      issues.push({ message: `A callout needs a tone after "callout": ${CALLOUT_TONES.join(', ')}${tone ? `, not "${tone}"` : ''}`, line });
    if (lang === 'deepdive' && !info.trim()) issues.push({ message: 'A deepdive needs a title after "deepdive"', line });
    if (lang !== 'callout' && lang !== 'deepdive' && info.trim()) issues.push({ message: `A ${lang} block takes nothing after its name`, line });
    if (!block.body.some((l) => l.text.trim())) issues.push({ message: `The ${lang} block is empty`, line });
    for (const { text, line: at } of block.body) {
      if (lang === 'quiz') {
        for (const id of text.split(/\s+/).filter(Boolean)) if (cardIds && !cardIds.has(id)) issues.push({ message: `The quiz names "${id}", which is not a review card`, line: at });
      } else if (FENCE.test(text)) continue;
      else if (/^#{1,2}\s/.test(text)) issues.push({ message: `Headings inside a ${lang} block must be ### or smaller, so the lesson's sections stay its own`, line: at });
      else if (lang === 'numbers' && text.trim() && !/^[^|]+\|\s*\S/.test(text)) issues.push({ message: 'Each line of a numbers block is "value | label"', line: at });
    }
  }
  return issues;
}

/** Minutes to read a Markdown text at about 200 words a minute; at least 1. Code and quiz ids are not read. */
export function readingMinutes(source: string): number {
  const words = proseLines(source)
    .map((l) => l.text)
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / 200));
}
