import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problems } from './catalog';
import { GUIDES } from './guide/guides';
import { LESSON_HEADINGS, h2Headings, lessonIssues, readingMinutes } from './lesson';
import { lessonToc, parseMarkdown, slugger, type Block } from './markdown';
import { LESSONS_KEY, lessonRead, markLessonRead } from './progress';
import { RESERVED_IDS } from './problemFiles';
import { ROADMAP } from './roadmap';

/**
 * Problems whose lesson.md is still being written (in parallel branches).
 * Remove an id once its lesson lands; the test below fails if a listed
 * problem already has one, so the list cannot go stale.
 */
const LESSONS_PENDING: string[] = [];

const lessonOf = (headings: readonly string[], body = 'Text.') => headings.map((h) => `## ${h}\n\n${body}\n`).join('\n');

describe('lessons of the problems', () => {
  it.each(problems.filter((p) => !LESSONS_PENDING.includes(p.id)).map((p) => [p.id, p] as const))('%s has a lesson with every section', (_id, p) => {
    expect(p.lesson, `${p.id}/lesson.md`).toBeDefined();
    expect(lessonIssues(p.lesson!)).toEqual([]);
    expect(lessonToc(parseMarkdown(p.lesson!)).map((e) => e.text)).toEqual(expect.arrayContaining([...LESSON_HEADINGS]));
  });

  it('lists as pending only problems that exist and still lack a lesson', () => {
    const ids = problems.map((p) => p.id);
    for (const id of LESSONS_PENDING) {
      expect(ids, `${id} in LESSONS_PENDING is not a problem`).toContain(id);
      expect(problems.find((p) => p.id === id)?.lesson, `${id} has a lesson.md now: remove it from LESSONS_PENDING`).toBeUndefined();
    }
  });

  it('the example lesson cites its sources and reads in a reasonable time', () => {
    const lesson = problems.find((p) => p.id === 'url-shortener')!.lesson!;
    expect(lesson).toMatch(/^## Further reading$/m);
    expect(lesson).toContain('https://github.com/donnemartin/system-design-primer');
    expect(readingMinutes(lesson)).toBeGreaterThanOrEqual(7);
    expect(readingMinutes(lesson)).toBeLessThanOrEqual(15);
  });
});

describe('lessonIssues', () => {
  it('accepts the sections in order, with other headings between them', () => {
    expect(lessonIssues(lessonOf(LESSON_HEADINGS))).toEqual([]);
    expect(lessonIssues(lessonOf([LESSON_HEADINGS[0], 'An extra section', ...LESSON_HEADINGS.slice(1)]))).toEqual([]);
    // A curly apostrophe reads like a straight one.
    expect(lessonIssues(lessonOf(LESSON_HEADINGS).replace("What you'll learn", 'What you’ll learn'))).toEqual([]);
  });

  it('reports a missing section and one out of order, with its line', () => {
    expect(lessonIssues(lessonOf(LESSON_HEADINGS.filter((h) => h !== 'Common mistakes')))).toEqual([
      { message: expect.stringMatching(/^The lesson needs a "## Common mistakes" section/) },
    ]);
    const swapped = [...LESSON_HEADINGS];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(lessonIssues(lessonOf(swapped))).toEqual([{ message: '"## Back-of-the-envelope" must come after "## The problem, explained"', line: 5 }]);
  });

  it('ignores headings and links in code', () => {
    const fenced = `\`\`\`markdown\n## Concepts\n[x](/local)\n\`\`\`\n${lessonOf(LESSON_HEADINGS)}Use \`[a](b)\` for links.\n`;
    expect(lessonIssues(fenced)).toEqual([]);
    expect(h2Headings(fenced).map((h) => h.text)).toEqual([...LESSON_HEADINGS]);
  });

  it('reports links that are not http(s)', () => {
    const issues = lessonIssues(`${lessonOf(LESSON_HEADINGS)}\n[a](https://example.com) [b](#concepts) [c](mailto:x@y.z) [d](javascript:alert)\n`);
    expect(issues.map((i) => i.message)).toEqual([
      'Links in a lesson must go to an http(s) address, not "#concepts"',
      'Links in a lesson must go to an http(s) address, not "mailto:x@y.z"',
      'Links in a lesson must go to an http(s) address, not "javascript:alert"',
    ]);
  });

  it('reports an empty lesson', () => {
    expect(lessonIssues('  \n')).toEqual([{ message: 'The lesson is empty' }]);
  });

  it('counts reading minutes from the words outside code', () => {
    expect(readingMinutes('word '.repeat(1000))).toBe(5);
    expect(readingMinutes(`short\n\`\`\`\n${'code '.repeat(5000)}\n\`\`\``)).toBe(1);
  });
});

describe('roadmap guides', () => {
  it.each(GUIDES.map((g) => [g.id, g] as const))('%s has its Markdown, web links only and a reserved id', (id, g) => {
    const text = readFileSync(new URL(`./guide/${id}.md`, import.meta.url), 'utf8');
    expect(g.title.trim()).not.toBe('');
    expect(lessonIssues(text).filter((i) => /^Links/.test(i.message))).toEqual([]);
    expect(h2Headings(text).length).toBeGreaterThanOrEqual(3);
    expect(RESERVED_IDS).toContain(id);
    expect(problems.map((p) => p.id)).not.toContain(id);
    expect(ROADMAP.map((s) => s.id)).not.toContain(id);
  });

  it('the interview guide covers the four steps, estimation, latency and the nines', () => {
    const text = readFileSync(new URL('./guide/approach.md', import.meta.url), 'utf8');
    for (const words of ['Scope and requirements', 'High-level design', 'Deep dive', 'Wrap-up', 'Back-of-the-envelope', 'Latency numbers', 'nines', 'How Proschi maps']) {
      expect(text).toContain(words);
    }
  });
});

describe('markdown for lessons', () => {
  const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

  it('gives headings stable, unique ids', () => {
    const blocks = parseMarkdown("## What you'll learn\n\n## Back-of-the-envelope\n\n### `code` *and* more!\n\n## Concepts\n\n## Concepts");
    expect(blocks.map((b) => (b.kind === 'heading' ? b.id : ''))).toEqual(['what-youll-learn', 'back-of-the-envelope', 'code-and-more', 'concepts', 'concepts-1']);
    // One slugger shared by two texts keeps the ids of a page unique.
    const slug = slugger();
    parseMarkdown('## Scale', slug);
    expect(parseMarkdown('## Scale', slug)[0]).toMatchObject({ id: 'scale-1' });
  });

  it('reads GFM pipe tables with alignment, escaped pipes and inline markup', () => {
    const [table, after] = parseMarkdown('| Name | Rate | Note |\n|:---|---:|:-:|\n| **api** | 2k rps | a \\| b |\n| db | 20k | `x` |\n\nAfter.');
    expect(table).toMatchObject({
      kind: 'table',
      align: ['left', 'right', 'center'],
      header: [[{ kind: 'text', text: 'Name' }], [{ kind: 'text', text: 'Rate' }], [{ kind: 'text', text: 'Note' }]],
    });
    if (table.kind !== 'table') throw new Error('not a table');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toEqual([{ kind: 'strong', children: [{ kind: 'text', text: 'api' }] }]);
    expect(table.rows[0][2]).toEqual([{ kind: 'text', text: 'a | b' }]);
    expect(table.rows[1][2]).toEqual([{ kind: 'code', text: 'x' }]);
    expect(after).toMatchObject({ kind: 'paragraph' });
  });

  it('pads short rows, drops extra cells and accepts tables without outer pipes', () => {
    const [table] = parseMarkdown('a | b\n--- | ---\n1\n2 | 3 | 4');
    if (table.kind !== 'table') throw new Error('not a table');
    expect(table.rows.map((r) => r.map((c) => (c[0]?.kind === 'text' ? c[0].text : '')))).toEqual([
      ['1', ''],
      ['2', '3'],
    ]);
  });

  it('leaves a pipe without a delimiter row as text', () => {
    expect(kinds(parseMarkdown('a | b\nc | d'))).toEqual(['paragraph']);
    expect(kinds(parseMarkdown('| a |\n| b |'))).toEqual(['paragraph']);
  });

  it('reads blockquotes as callouts with Markdown inside', () => {
    const [quote, after] = parseMarkdown('> **Key idea**: misses decide p99.\n> - one\n> - two\n\nAfter.');
    expect(quote.kind).toBe('quote');
    if (quote.kind !== 'quote') throw new Error('not a quote');
    expect(kinds(quote.children)).toEqual(['paragraph', 'list']);
    expect(after).toMatchObject({ kind: 'paragraph' });
  });

  it('reads ```proschi fences, also with flags such as fragment', () => {
    expect(parseMarkdown('```proschi fragment\na -> b\n```')).toEqual([{ kind: 'code', lang: 'proschi', text: 'a -> b' }]);
    expect(parseMarkdown('```proschi\na -> b\n```')).toEqual([{ kind: 'code', lang: 'proschi', text: 'a -> b' }]);
  });

  it('keeps raw HTML as text in tables and quotes', () => {
    const blocks = parseMarkdown('| <b>x</b> |\n|---|\n| <script>y</script> |\n\n> <img src=x onerror=alert(1)>');
    expect(JSON.stringify(blocks)).toContain('"text":"<script>y</script>"');
    expect(JSON.stringify(blocks)).toContain('"text":"<img src=x onerror=alert(1)>"');
  });
});

describe('lessons read', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('remembers per problem that the lesson was read', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(lessonRead('url-shortener')).toBe(false);
    markLessonRead('url-shortener');
    expect(lessonRead('url-shortener')).toBe(true);
    expect(lessonRead('pastebin')).toBe(false);
    expect(JSON.parse(store.get(LESSONS_KEY)!)).toEqual({ 'url-shortener': true });
    markLessonRead('__proto__');
    expect(lessonRead('__proto__')).toBe(false);
    expect(lessonRead('toString')).toBe(false);
  });

  it('works without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => markLessonRead('url-shortener')).not.toThrow();
    expect(lessonRead('url-shortener')).toBe(false);
  });
});
