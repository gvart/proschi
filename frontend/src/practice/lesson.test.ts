import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problems } from './catalog';
import { GUIDES } from './guide/guides';
import { LESSON_HEADINGS, blockIssues, h2Headings, lessonIssues, readingMinutes } from './lesson';
import { lessonToc, parseMarkdown, quizIds, slugger, type Block } from './markdown';
import { LESSONS_KEY, lessonRead, lessonsRead, markLessonRead, markLessonsRead, onLessonsRead } from './progress';
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

describe('lesson blocks', () => {
  const lesson = (body: string) => `${body}\n${lessonOf(LESSON_HEADINGS)}`;

  it('parses each kind', () => {
    const blocks = parseMarkdown(
      [
        '```tldr',
        'Cache **reads**.',
        '```',
        '```callout pitfall Watch **p99**',
        'Misses decide it.',
        '```',
        '```callout interview',
        'Say the ratio.',
        '```',
        '```numbers',
        '100:1 | reads per **write**',
        '500 rps | to the DB',
        '```',
        '````deepdive Counter blocks',
        'Text.',
        '```proschi',
        'a -> b',
        '```',
        '````',
        '```quiz',
        'cache-aside',
        'hit-rate-to-db-load',
        '```',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['tldr', 'callout', 'callout', 'numbers', 'deepdive', 'quiz']);
    expect(blocks[1]).toMatchObject({ tone: 'pitfall', title: [{ kind: 'text', text: 'Watch ' }, { kind: 'strong' }] });
    expect(blocks[2]).toMatchObject({ tone: 'interview' });
    expect(blocks[2]).not.toHaveProperty('title');
    expect(blocks[3]).toMatchObject({ items: [{ value: '100:1' }, { value: '500 rps', label: [{ kind: 'text', text: 'to the DB' }] }] });
    // The longer fence keeps the code block inside the deep dive.
    expect(blocks[4]).toMatchObject({ kind: 'deepdive', children: [{ kind: 'paragraph' }, { kind: 'code', lang: 'proschi', text: 'a -> b' }] });
    expect(quizIds(blocks)).toEqual(['cache-aside', 'hit-rate-to-db-load']);
  });

  it('finds quizzes nested in other blocks, once each', () => {
    const blocks = parseMarkdown('````deepdive More\n```quiz\na\n```\n````\n```quiz\na b\n```');
    expect(quizIds(blocks)).toEqual(['a', 'b']);
  });

  it('keeps other fences code, with an info string', () => {
    expect(parseMarkdown('```js title="x"\nlet a\n```')).toEqual([{ kind: 'code', lang: 'js', text: 'let a' }]);
  });

  it('accepts well-formed blocks and counts their prose as reading, not the quiz ids', () => {
    const text = lesson('```tldr\nShort.\n```\n\n```callout tip\nA tip.\n```\n\n```numbers\n1 | one\n```\n\n```deepdive More\n### A detail\nText.\n```\n\n```quiz\ncache-aside\n```');
    expect(lessonIssues(text, new Set(['cache-aside']))).toEqual([]);
    expect(h2Headings(text).map((h) => h.text)).toEqual([...LESSON_HEADINGS]);
    expect(readingMinutes('```quiz\n' + 'card '.repeat(1000) + '\n```')).toBe(1);
    expect(readingMinutes('```callout tip\n' + 'word '.repeat(1000) + '\n```')).toBe(5);
  });

  it('reports malformed blocks with their lines', () => {
    const issues = (body: string) => blockIssues(body, new Set(['cache-aside'])).map((i) => `${i.line}: ${i.message}`);
    expect(issues('```callout\nx\n```')).toEqual([expect.stringMatching(/^1: A callout needs a tone after "callout": tip, pitfall, interview, takeaway$/)]);
    expect(issues('```callout warning\nx\n```')).toEqual([expect.stringMatching(/^1: .*, not "warning"$/)]);
    expect(issues('```deepdive\nx\n```')).toEqual(['1: A deepdive needs a title after "deepdive"']);
    expect(issues('```tldr Title\nx\n```')).toEqual(['1: A tldr block takes nothing after its name']);
    expect(issues('```numbers\n100 rps\n```')).toEqual(['2: Each line of a numbers block is "value | label"']);
    expect(issues('```quiz\n```')).toEqual(['1: The quiz block is empty']);
    expect(issues('```quiz\ncache-aside nope\n```')).toEqual(['2: The quiz names "nope", which is not a review card']);
    expect(issues('```deepdive More\n## Concepts\n```')).toEqual([expect.stringMatching(/^2: Headings inside a deepdive block must be ### or smaller/)]);
    // A heading in a block is not one of the lesson's sections.
    expect(h2Headings('```callout tip\n## Concepts\n```')).toEqual([]);
    // Without card ids, quiz ids are not checked.
    expect(blockIssues('```quiz\nnope\n```')).toEqual([]);
  });

  it('every lesson and guide quizzes existing cards', () => {
    const cardIds = new Set(Object.keys(import.meta.glob('./cards/*/*.md')).map((path) => path.replace(/^.*\/(.*)\.md$/, '$1')));
    for (const p of problems) expect(lessonIssues(p.lesson!, cardIds), p.id).toEqual([]);
    for (const g of GUIDES) expect(blockIssues(readFileSync(new URL(`./guide/${g.id}.md`, import.meta.url), 'utf8'), cardIds), g.id).toEqual([]);
  });
});

describe('the list of lessons read', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists them, and tells listeners about new ones with where they came from', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const heard: [string[], string][] = [];
    const stop = onLessonsRead((ids, source) => heard.push([ids, source]));
    markLessonRead('pastebin');
    markLessonsRead(['pastebin', 'approach', 'chat', '__proto__'], 'account');
    markLessonRead('chat');
    stop();
    markLessonRead('rate-limiter');
    expect(lessonsRead()).toEqual(['approach', 'chat', 'pastebin', 'rate-limiter']);
    expect(heard).toEqual([
      [['pastebin'], 'here'],
      [['approach', 'chat'], 'account'],
    ]);
  });
});
