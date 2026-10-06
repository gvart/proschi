import { FrontMatterError, parseFrontMatter, type FrontMatterValue } from '../practice/frontMatter';
import { DIFFICULTIES } from '../practice/types';

/**
 * Practice cards (docs/CARDS.md): short questions for daily review, one
 * Markdown file each in frontend/src/practice/cards/<topic>/<id>.md. The file
 * name is the card's id and never changes, since review history is stored by
 * it; the folder is its main topic.
 *
 * Pure TypeScript with no browser or React dependency: the practice page, the
 * Worker, the `proschi cards` CLI and a future mobile app read cards with it.
 */

export const CARD_TYPES = ['flip', 'choice', 'estimate', 'cloze'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Card lists a card can be put on with `decks:`. `sample` is the free deck anyone can try without an account. */
export const DECKS = ['sample'] as const;
export type Deck = (typeof DECKS)[number];

interface CardBase {
  /** The file name without .md: lowercase words joined by "-", unique across all topics. */
  id: string;
  /** The folder: the card's main topic, a tag from tags.json. */
  topic: string;
  /** The topic first, then the extra tags from the front matter. */
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  /** Practice problems the card relates to (problem ids). */
  related: string[];
  decks: Deck[];
  /**
   * 1 when absent. Bump it when the answer changes, so people who learned
   * the old one review the card again; typo fixes keep it.
   */
  version: number;
  /** `status: retired`: kept so its id is never reused, but no longer reviewed. */
  retired: boolean;
  /** Markdown shown after answering: why the answer is right. */
  why?: string;
  /** Cards the overlap check should not flag as duplicates of this one (`distinct-from:`). */
  distinctFrom: string[];
}

/** A question and an answer; the reviewer rates how well they remembered. */
export interface FlipCard extends CardBase {
  type: 'flip';
  front: string;
  back: string;
}

export interface ChoiceOption {
  text: string;
  correct: boolean;
}

/** A question with 2–6 options, exactly one of them correct. */
export interface ChoiceCard extends CardBase {
  type: 'choice';
  question: string;
  options: ChoiceOption[];
}

/** A back-of-envelope number, right when within a factor `tolerance` of `answer`. */
export interface EstimateCard extends CardBase {
  type: 'estimate';
  question: string;
  answer: number;
  /** What the answer counts, e.g. "requests/s" or "TB". */
  unit: string;
  /** A factor: 2 accepts answer / 2 to answer × 2. */
  tolerance: number;
  /** Markdown: the worked calculation. */
  solution: string;
}

/** A sentence with 1–3 gaps written `{{answer|other accepted answer}}`. */
export interface ClozeCard extends CardBase {
  type: 'cloze';
  /** The Markdown with every gap replaced by `{{n}}` (0-based). */
  text: string;
  /** The accepted answers of each gap, the first one shown as the answer. */
  blanks: string[][];
}

export type Card = FlipCard | ChoiceCard | EstimateCard | ClozeCard;

/** A topic cards are filed under (tags.json). */
export interface Topic {
  id: string;
  title: string;
  /** One line: what the topic covers. */
  summary: string;
}

/** What is wrong with a card file; `file` is relative to the cards folder, e.g. caching/cache-aside.md. */
export class CardFileError extends Error {
  readonly file: string;
  readonly line?: number;
  /** The message without the file. */
  readonly detail: string;
  constructor(file: string, message: string, line?: number) {
    super(`${file}${line ? `:${line}` : ''}: ${message}`);
    this.name = 'CardFileError';
    this.file = file;
    this.line = line;
    this.detail = message;
  }
}

export const CARD_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Limits that keep a card readable on a phone screen, in characters of Markdown. */
export const LIMITS = { prompt: 300, answer: 600, option: 140, why: 1200, solution: 1200 } as const;

const FIELDS = ['type', 'difficulty', 'tags', 'related', 'decks', 'version', 'status', 'distinct-from', 'answer', 'unit', 'tolerance'];

/** The `##` sections each type takes; `why` is optional for all. */
const SECTIONS: Record<CardType, { required: string[]; optional: string[] }> = {
  flip: { required: ['front', 'back'], optional: ['why'] },
  choice: { required: ['question', 'options'], optional: ['why'] },
  estimate: { required: ['question', 'solution'], optional: ['why'] },
  cloze: { required: ['text'], optional: ['why'] },
};

const OPTION = /^- \[( |x)\] (.+)$/;
const GAP = /\{\{([^{}]*)\}\}/g;

/** Splits the body into `## Heading` sections, keyed by the lowercase heading. */
function sections(file: string, body: string, bodyLine: number): Map<string, { text: string; line: number }> {
  const out = new Map<string, { text: string; line: number }>();
  let current: { name: string; lines: string[]; line: number } | undefined;
  const flush = () => {
    if (current) out.set(current.name, { text: current.lines.join('\n').trim(), line: current.line });
  };
  body.split('\n').forEach((raw, i) => {
    const line = bodyLine + i;
    const heading = raw.match(/^## (.+?)\s*$/);
    if (heading) {
      flush();
      const name = heading[1].toLowerCase();
      if (out.has(name)) throw new CardFileError(file, `Duplicate section "## ${heading[1]}"`, line);
      current = { name, lines: [], line };
    } else if (current) current.lines.push(raw);
    else if (raw.trim() !== '') throw new CardFileError(file, 'Text before the first "## " section; the body is made of sections such as "## Front"', line);
  });
  flush();
  return out;
}

/** The accepted answers in a gap: `{{consistent hashing|ring hashing}}`. */
function gapAnswers(file: string, inner: string, line: number): string[] {
  const answers = inner.split('|').map((a) => a.trim());
  if (answers.some((a) => a === '')) throw new CardFileError(file, `Empty answer in the gap {{${inner}}}`, line);
  return answers;
}

/**
 * Reads one card file. `file` is its path in the cards folder,
 * `<topic>/<id>.md`. Throws CardFileError naming the file (and line) of the
 * first problem.
 */
export function cardFromFile(file: string, text: string): Card {
  const fail = (message: string, line?: number): never => {
    throw new CardFileError(file, message, line);
  };
  const m = file.match(/^([^/]+)\/([^/]+)\.md$/);
  if (!m) return fail('A card is a file <topic>/<id>.md');
  const [, topic, id] = m;
  if (!CARD_ID.test(id)) fail('The file name is the card id and must be lowercase words joined by "-", e.g. cache-aside-vs-write-through');

  let data: Record<string, FrontMatterValue>;
  let body: string;
  try {
    ({ data, body } = parseFrontMatter(text));
  } catch (e) {
    if (e instanceof FrontMatterError) return fail(e.message.replace(/^line \d+: /, ''), e.line);
    throw e;
  }
  for (const key of Object.keys(data)) if (!FIELDS.includes(key)) fail(`Unknown front matter field '${key}' (use ${FIELDS.join(', ')})`);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const closing = lines.indexOf('---', 1);
  // The body starts after the closing `---` and the blank lines parseFrontMatter trimmed.
  let bodyLine = closing + 2;
  while (bodyLine <= lines.length && lines[bodyLine - 1].trim() === '') bodyLine++;

  const str = (key: string): string => {
    const v = data[key];
    if (typeof v !== 'string' || v.trim() === '') return fail(`'${key}' must be a non-empty string`);
    return v;
  };
  const list = (key: string): string[] => {
    const v = data[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) return fail(`'${key}' must be a list, e.g. ${key}: [a, b]`);
    return v;
  };
  const num = (key: string): number | undefined => {
    const v = data[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number') return fail(`'${key}' must be a number`);
    return v;
  };

  const type = str('type') as CardType;
  if (!CARD_TYPES.includes(type)) fail(`'type' must be one of ${CARD_TYPES.join(', ')}`);
  const difficulty = str('difficulty') as Card['difficulty'];
  if (!DIFFICULTIES.includes(difficulty)) fail(`'difficulty' must be one of ${DIFFICULTIES.join(', ')}`);
  const extraTags = list('tags');
  if (extraTags.includes(topic)) fail(`'tags' repeats the topic "${topic}"; the folder already tags the card with it`);
  if (new Set(extraTags).size !== extraTags.length) fail("'tags' has a duplicate");
  const decks = list('decks') as Deck[];
  for (const deck of decks) if (!DECKS.includes(deck)) fail(`Unknown deck "${deck}" (decks: ${DECKS.join(', ')})`);
  const version = num('version');
  if (version !== undefined && !(Number.isInteger(version) && version >= 1)) fail("'version' must be a whole number from 1");
  const status = data.status === undefined ? undefined : str('status');
  if (status !== undefined && status !== 'retired') fail("'status' can only be retired");
  if (type !== 'estimate') for (const key of ['answer', 'unit', 'tolerance']) if (data[key] !== undefined) fail(`'${key}' is only for estimate cards`);

  const parts = sections(file, body, bodyLine);
  const { required, optional } = SECTIONS[type];
  for (const name of required) if (!parts.get(name)?.text) fail(`A ${type} card needs a "## ${name[0].toUpperCase()}${name.slice(1)}" section`);
  for (const [name, part] of parts) {
    if (!required.includes(name) && !optional.includes(name)) {
      fail(`A ${type} card has no "## ${name}" section (it takes ${[...required, ...optional].map((s) => `## ${s[0].toUpperCase()}${s.slice(1)}`).join(', ')})`, part.line);
    }
  }
  const section = (name: string) => parts.get(name)!.text;
  const why = parts.get('why')?.text;
  if (parts.has('why') && !why) fail('The "## Why" section is empty', parts.get('why')!.line);

  const base: CardBase = {
    id,
    topic,
    tags: [topic, ...extraTags],
    difficulty,
    related: list('related'),
    decks,
    version: version ?? 1,
    retired: status === 'retired',
    distinctFrom: list('distinct-from'),
    ...(why ? { why } : {}),
  };

  switch (type) {
    case 'flip':
      return { ...base, type, front: section('front'), back: section('back') };
    case 'choice': {
      const { text, line } = parts.get('options')!;
      const options: ChoiceOption[] = [];
      text.split('\n').forEach((raw, i) => {
        if (raw.trim() === '') return;
        const o = raw.match(OPTION);
        if (!o) fail('Each option is one line "- [x] the right answer" or "- [ ] a wrong one"', line + 1 + i);
        else options.push({ text: o[2].trim(), correct: o[1] === 'x' });
      });
      if (options.length < 2 || options.length > 6) fail(`A choice card has 2 to 6 options, not ${options.length}`, line);
      if (options.filter((o) => o.correct).length !== 1) fail('Exactly one option must be marked [x]', line);
      return { ...base, type, question: section('question'), options };
    }
    case 'estimate': {
      const answer = num('answer');
      if (answer === undefined || !(answer > 0)) return fail("An estimate card needs 'answer', a number above 0");
      const tolerance = num('tolerance') ?? 2;
      if (!(tolerance >= 1.1 && tolerance <= 10)) fail("'tolerance' is a factor from 1.1 to 10 (2 accepts half to double the answer)");
      return { ...base, type, question: section('question'), answer, unit: str('unit'), tolerance, solution: section('solution') };
    }
    case 'cloze': {
      const { text: raw, line } = parts.get('text')!;
      const blanks: string[][] = [];
      const text = raw.replace(GAP, (_, inner: string) => {
        blanks.push(gapAnswers(file, inner, line));
        return `{{${blanks.length - 1}}}`;
      });
      if (/\{\{|\}\}/.test(text.replace(/\{\{\d+\}\}/g, ''))) fail('Unbalanced "{{" or "}}" in the text', line);
      if (blanks.length < 1 || blanks.length > 3) fail(`A cloze card has 1 to 3 gaps written {{answer}}, not ${blanks.length}`, line);
      return { ...base, type, text, blanks };
    }
  }
}

/** The question side of a card as plain-ish text: what overlap detection and length limits look at. */
export function promptOf(card: Card): string {
  switch (card.type) {
    case 'flip':
      return card.front;
    case 'choice':
    case 'estimate':
      return card.question;
    case 'cloze':
      return clozeWithAnswers(card);
  }
}

/** The answer side as text: the back, the right option, the number or the gaps' answers. */
export function answerOf(card: Card): string {
  switch (card.type) {
    case 'flip':
      return card.back;
    case 'choice':
      return card.options.find((o) => o.correct)?.text ?? '';
    case 'estimate':
      return `${card.answer} ${card.unit}`;
    case 'cloze':
      return card.blanks.map((b) => b[0]).join(', ');
  }
}

/** A cloze card's text with each gap filled with its first answer. */
export function clozeWithAnswers(card: ClozeCard): string {
  return card.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => card.blanks[Number(n)]?.[0] ?? '');
}

/** Lowercase, without punctuation and extra spaces: how typed answers are compared. A dot stays only inside a number, as in 2.5. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

/** Whether `typed` fills gap `index` of a cloze card: any accepted answer, ignoring case, punctuation and a trailing "s". */
export function gradeCloze(card: ClozeCard, index: number, typed: string): boolean {
  const t = normalizeAnswer(typed).replace(/s$/, '');
  return (card.blanks[index] ?? []).some((a) => normalizeAnswer(a).replace(/s$/, '') === t && t !== '');
}

/** Whether an estimate is within the card's tolerance factor of its answer. */
export function gradeEstimate(card: Pick<EstimateCard, 'answer' | 'tolerance'>, value: number): boolean {
  if (!(value > 0) || !Number.isFinite(value)) return false;
  return value >= card.answer / card.tolerance && value <= card.answer * card.tolerance;
}

/**
 * How far an estimate is from the answer in orders of magnitude, signed:
 * 0.3 is 2× too high, -1 is 10× too low. For the "how close" feedback.
 */
export function estimateError(card: EstimateCard, value: number): number {
  return Math.log10(value / card.answer);
}

/** Reads a tags.json: a list of {id, title, summary}. Throws CardFileError for anything else. */
export function readTopics(text: string, file = 'tags.json'): Topic[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CardFileError(file, `Not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new CardFileError(file, 'Must be a JSON list of {"id", "title", "summary"}');
  const seen = new Set<string>();
  return raw.map((t: unknown, i) => {
    const topic = t as Partial<Topic>;
    if (!topic || typeof topic.id !== 'string' || !CARD_ID.test(topic.id) || typeof topic.title !== 'string' || !topic.title || typeof topic.summary !== 'string' || !topic.summary) {
      throw new CardFileError(file, `Item ${i + 1} must be {"id": "lowercase-words", "title": "…", "summary": "…"}`);
    }
    if (Object.keys(topic).some((k) => !['id', 'title', 'summary'].includes(k))) throw new CardFileError(file, `Item ${i + 1} has a field other than id, title and summary`);
    if (seen.has(topic.id)) throw new CardFileError(file, `Duplicate topic "${topic.id}"`);
    seen.add(topic.id);
    return { id: topic.id, title: topic.title, summary: topic.summary };
  });
}

/** Reads ids.lock: one id per line, `#` comments and blank lines ignored. */
export function readLock(text: string): { ids: string[]; lines: Map<string, number> } {
  const ids: string[] = [];
  const lines = new Map<string, number>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    ids.push(line);
    if (!lines.has(line)) lines.set(line, i + 1);
  });
  return { ids, lines };
}

export const LOCK_HEADER = `# Every card id ever published, sorted. Review history is stored by id, so an
# id is never deleted or reused: retire a card with \`status: retired\` instead.
# \`proschi cards lock\` adds new cards' ids (docs/CARDS.md).
`;

/** ids.lock with `ids` added, sorted and without duplicates. */
export function writeLock(existing: string[], ids: string[]): string {
  return LOCK_HEADER + [...new Set([...existing, ...ids])].sort().join('\n') + '\n';
}

/** Sorts cards by topic, then id. */
export function compareCards(a: Pick<Card, 'topic' | 'id'>, b: Pick<Card, 'topic' | 'id'>): number {
  return a.topic.localeCompare(b.topic) || a.id.localeCompare(b.id);
}
