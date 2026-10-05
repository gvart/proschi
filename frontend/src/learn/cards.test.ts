import { describe, expect, it } from 'vitest';
import { checkCardFiles, LOCK_FILE, overlaps, TAGS_FILE } from './cardCheck';
import {
  answerOf,
  CardFileError,
  cardFromFile,
  clozeWithAnswers,
  estimateError,
  gradeCloze,
  gradeEstimate,
  promptOf,
  readLock,
  writeLock,
  type ChoiceCard,
  type ClozeCard,
  type EstimateCard,
} from './cards';
import { problems } from '../practice/catalog';

const repoFiles = Object.fromEntries(
  Object.entries({
    ...import.meta.glob<string>('../practice/cards/*', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('../practice/cards/*/*.md', { query: '?raw', import: 'default', eager: true }),
  }).map(([path, text]) => [path.replace(/^\.\.\/practice\/cards\//, ''), text]),
);

const flip = (front = 'What is cache-aside?', back = 'The app reads the cache, then the database on a miss.', extra = '') =>
  `---\ntype: flip\ndifficulty: easy\n${extra}---\n\n## Front\n\n${front}\n\n## Back\n\n${back}\n`;

function error(file: string, text: string): CardFileError {
  try {
    cardFromFile(file, text);
  } catch (e) {
    if (e instanceof CardFileError) return e;
    throw e;
  }
  throw new Error('expected a CardFileError');
}

describe('cardFromFile', () => {
  it('reads a flip card: the folder is the topic and the first tag, the file name the id', () => {
    const card = cardFromFile('caching/cache-aside.md', flip('Front?', 'Back.', 'tags: [databases]\nrelated: [url-shortener]\ndecks: [sample]\n'));
    expect(card).toEqual({
      id: 'cache-aside',
      topic: 'caching',
      tags: ['caching', 'databases'],
      difficulty: 'easy',
      related: ['url-shortener'],
      decks: ['sample'],
      version: 1,
      retired: false,
      distinctFrom: [],
      type: 'flip',
      front: 'Front?',
      back: 'Back.',
    });
  });

  it('reads choice options, estimate numbers and cloze gaps', () => {
    const choice = cardFromFile(
      'networking/lb.md',
      '---\ntype: choice\ndifficulty: medium\n---\n## Question\nWhich?\n## Options\n- [ ] Layer 4\n- [x] Layer 7\n## Why\nIt reads HTTP.\n',
    ) as ChoiceCard;
    expect(choice.options).toEqual([
      { text: 'Layer 4', correct: false },
      { text: 'Layer 7', correct: true },
    ]);
    expect(choice.why).toBe('It reads HTTP.');
    expect(answerOf(choice)).toBe('Layer 7');

    const estimate = cardFromFile('estimation/qps.md', '---\ntype: estimate\ndifficulty: easy\nanswer: 2300\nunit: requests/s\n---\n## Question\nHow many?\n## Solution\nMath.\n') as EstimateCard;
    expect(estimate).toMatchObject({ answer: 2300, unit: 'requests/s', tolerance: 2, solution: 'Math.' });

    const cloze = cardFromFile('caching/stampede.md', '---\ntype: cloze\ndifficulty: easy\n---\n## Text\nIt is a {{cache stampede|thundering herd}}; fix it with {{coalescing}}.\n') as ClozeCard;
    expect(cloze.text).toBe('It is a {{0}}; fix it with {{1}}.');
    expect(cloze.blanks).toEqual([['cache stampede', 'thundering herd'], ['coalescing']]);
    expect(clozeWithAnswers(cloze)).toBe('It is a cache stampede; fix it with coalescing.');
    expect(promptOf(cloze)).toBe('It is a cache stampede; fix it with coalescing.');
  });

  it('reads version, retirement and distinct-from', () => {
    const card = cardFromFile('caching/x.md', flip('a', 'b', 'version: 3\nstatus: retired\ndistinct-from: [y]\n'));
    expect(card).toMatchObject({ version: 3, retired: true, distinctFrom: ['y'] });
  });

  it.each([
    ['caching/Bad_Id.md', flip(), /lowercase words/],
    ['cache-aside.md', flip(), /<topic>\/<id>\.md/],
    ['caching/x.md', flip().replace('type: flip', 'type: quiz'), /'type' must be one of flip, choice, estimate, cloze/],
    ['caching/x.md', flip().replace('difficulty: easy', 'difficulty: trivial'), /'difficulty'/],
    ['caching/x.md', flip('a', 'b', 'colour: red\n'), /Unknown front matter field 'colour'/],
    ['caching/x.md', flip('a', 'b', 'tags: [caching]\n'), /repeats the topic/],
    ['caching/x.md', flip('a', 'b', 'decks: [vip]\n'), /Unknown deck "vip"/],
    ['caching/x.md', flip('a', 'b', 'status: draft\n'), /'status' can only be retired/],
    ['caching/x.md', flip('a', 'b', 'answer: 3\n'), /'answer' is only for estimate cards/],
    ['caching/x.md', '---\ntype: flip\ndifficulty: easy\n---\n## Front\nQ\n', /needs a "## Back" section/],
    ['caching/x.md', flip() + '\n## Hint\nNo.\n', /no "## hint" section/],
    ['caching/x.md', '---\ntype: flip\ndifficulty: easy\n---\nIntro\n## Front\nQ\n## Back\nA\n', /Text before the first/],
    ['caching/x.md', '---\ntype: choice\ndifficulty: easy\n---\n## Question\nQ\n## Options\n- [x] A\n- [x] B\n', /Exactly one option/],
    ['caching/x.md', '---\ntype: choice\ndifficulty: easy\n---\n## Question\nQ\n## Options\n- [x] A\n', /2 to 6 options, not 1/],
    ['caching/x.md', '---\ntype: choice\ndifficulty: easy\n---\n## Question\nQ\n## Options\n* A\n- [x] B\n', /Each option is one line/],
    ['caching/x.md', '---\ntype: estimate\ndifficulty: easy\nunit: GB\n---\n## Question\nQ\n## Solution\nS\n', /needs 'answer'/],
    ['caching/x.md', '---\ntype: estimate\ndifficulty: easy\nanswer: 3\nunit: GB\ntolerance: 1\n---\n## Question\nQ\n## Solution\nS\n', /'tolerance' is a factor/],
    ['caching/x.md', '---\ntype: cloze\ndifficulty: easy\n---\n## Text\nNo gaps here.\n', /1 to 3 gaps/],
    ['caching/x.md', '---\ntype: cloze\ndifficulty: easy\n---\n## Text\nA {{a|}} gap.\n', /Empty answer/],
  ])('rejects %s (%#)', (file, text, message) => {
    expect(error(file, text).message).toMatch(message);
  });

  it('points at the line of an option that is not one', () => {
    const e = error('caching/x.md', '---\ntype: choice\ndifficulty: easy\n---\n\n## Question\nQ\n## Options\n- [x] A\nB\n');
    expect(e.line).toBe(10);
  });
});

describe('grading', () => {
  const estimate = cardFromFile('estimation/x.md', '---\ntype: estimate\ndifficulty: easy\nanswer: 1000\nunit: GB\n---\n## Question\nQ\n## Solution\nS\n') as EstimateCard;
  it('accepts estimates within the tolerance factor', () => {
    expect([499, 500, 1000, 2000, 2001].map((v) => gradeEstimate(estimate, v))).toEqual([false, true, true, true, false]);
    expect(gradeEstimate(estimate, 0)).toBe(false);
    expect(gradeEstimate(estimate, Number.NaN)).toBe(false);
    expect(estimateError(estimate, 10000)).toBeCloseTo(1);
  });

  it('accepts any listed cloze answer, ignoring case, punctuation and a plural s', () => {
    const cloze = cardFromFile('caching/x.md', '---\ntype: cloze\ndifficulty: easy\n---\n## Text\nA {{cache stampede|thundering herd}}.\n') as ClozeCard;
    expect(gradeCloze(cloze, 0, 'Cache-Stampede')).toBe(true);
    expect(gradeCloze(cloze, 0, ' thundering herds ')).toBe(true);
    expect(gradeCloze(cloze, 0, 'stampede')).toBe(false);
    expect(gradeCloze(cloze, 0, '')).toBe(false);
    expect(gradeCloze(cloze, 1, 'cache stampede')).toBe(false);
  });
});

describe('ids.lock', () => {
  it('reads ids, skipping comments, and writes them sorted without duplicates', () => {
    expect(readLock('# header\nb\n\na\n').ids).toEqual(['b', 'a']);
    expect(writeLock(['b'], ['a', 'b'])).toMatch(/\na\nb\n$/);
  });
});

describe('checkCardFiles', () => {
  const tags = JSON.stringify([
    { id: 'caching', title: 'Caching', summary: 'Caches.' },
    { id: 'databases', title: 'Databases', summary: 'Data.' },
  ]);
  const base = {
    [TAGS_FILE]: tags,
    [LOCK_FILE]: writeLock([], ['cache-aside', 'b-tree']),
    'caching/cache-aside.md': flip(),
    'databases/b-tree.md': flip('How does a B-tree index find a row?', 'It walks from the root page to a leaf in a few page reads.'),
  };
  const messages = (files: Record<string, string>, problemIds?: string[]) => checkCardFiles(files, problemIds ? { problemIds } : {}).violations.map((v) => `${v.file}: ${v.message}`);

  it('passes a good folder', () => {
    expect(messages(base, [])).toEqual([]);
  });

  it('needs every card in ids.lock, and every locked id to have a card', () => {
    expect(messages({ ...base, [LOCK_FILE]: writeLock([], ['cache-aside']) })).toEqual(['databases/b-tree.md: New card: add its id to ids.lock with `proschi cards lock`']);
    const gone = { ...base };
    delete (gone as Record<string, string>)['databases/b-tree.md'];
    expect(messages(gone)).toEqual(['ids.lock: "b-tree" has no card file: never delete a card, set `status: retired` in its front matter instead']);
    expect(messages({ ...base, [LOCK_FILE]: 'cache-aside\nb-tree\n' })).toEqual(['ids.lock: Not sorted, or an id appears twice; run `proschi cards lock`']);
  });

  it('checks topics, tags, related problems and unique ids', () => {
    expect(messages({ ...base, 'caching/b-tree.md': flip('Another', 'thing entirely different') })).toContain(
      'databases/b-tree.md: The id "b-tree" is taken by caching/b-tree.md; ids are unique across topics',
    );
    expect(messages({ ...base, [LOCK_FILE]: writeLock([], ['cache-aside', 'b-tree', 'x']), 'misc/x.md': flip('Zebra', 'Quokka') })).toEqual([
      'misc/x.md: The folder "misc" is not a topic in tags.json',
    ]);
    expect(messages({ ...base, 'caching/cache-aside.md': flip('a', 'b', 'tags: [queues]\nrelated: [nope]\n') }, ['url-shortener'])).toEqual([
      'caching/cache-aside.md: Unknown tag "queues" (topics are listed in tags.json)',
      'caching/cache-aside.md: \'related\' names "nope", which is not a practice problem',
    ]);
    expect(messages({ ...base, 'caching/notes.txt': 'x' })).toEqual(['caching/notes.txt: Unexpected file: the cards folder holds tags.json, ids.lock and <topic>/<id>.md']);
  });

  it('keeps cards to a phone screen', () => {
    expect(messages({ ...base, 'caching/cache-aside.md': flip('x'.repeat(301)) })).toEqual([
      'caching/cache-aside.md: The question is 301 characters; keep it to 300 so it fits a phone screen',
    ]);
  });

  it('flags a reworded card as a possible duplicate unless it says it is distinct', () => {
    const reworded = flip('Describe how reading with cache-aside works.', 'The app reads the cache, and on a miss the database.');
    const files = { ...base, [LOCK_FILE]: writeLock([], ['cache-aside', 'b-tree', 'cache-aside-read']), 'caching/cache-aside-read.md': reworded };
    expect(messages(files)).toEqual([expect.stringMatching(/^caching\/cache-aside-read\.md: Possible duplicate of caching\/cache-aside\.md \(\d+% overlap\)/)]);
    const distinct = { ...files, 'caching/cache-aside-read.md': reworded.replace('difficulty: easy\n', 'difficulty: easy\ndistinct-from: [cache-aside]\n') };
    expect(messages(distinct)).toEqual([]);
    expect(messages({ ...base, 'caching/cache-aside.md': flip('a', 'b', 'distinct-from: [ghost]\n') })).toEqual([
      'caching/cache-aside.md: \'distinct-from\' names "ghost", which is not a card',
    ]);
  });

  it('ignores retired cards when looking for duplicates', () => {
    const a = cardFromFile('caching/a.md', flip());
    const b = cardFromFile('caching/b.md', flip(undefined, undefined, 'status: retired\n'));
    expect(overlaps([a, b])).toEqual([]);
  });
});

describe('the cards in this repository', () => {
  const check = checkCardFiles(repoFiles, { problemIds: problems.map((p) => p.id) });

  it('pass every check', () => {
    expect(check.violations).toEqual([]);
  });

  it('cover every topic, with a sample deck to try without an account', () => {
    expect(check.cards.length).toBeGreaterThanOrEqual(30);
    const topics = new Set(check.cards.map((c) => c.topic));
    expect([...topics].sort()).toEqual(check.topics.map((t) => t.id).sort());
    const sample = check.cards.filter((c) => c.decks.includes('sample') && !c.retired);
    expect(sample.length).toBeGreaterThanOrEqual(20);
    expect(sample.length).toBeLessThanOrEqual(40);
  });
});
