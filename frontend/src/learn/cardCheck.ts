import {
  answerOf,
  CardFileError,
  cardFromFile,
  compareCards,
  LIMITS,
  promptOf,
  readLock,
  readTopics,
  type Card,
  type Topic,
} from './cards';

/**
 * Checks a cards folder (docs/CARDS.md): every file reads as a card, ids are
 * unique and in ids.lock, the lock lists no deleted card, topics and related
 * problems exist, the text fits a phone, and no two cards ask nearly the same
 * thing. Pure: the CLI (`proschi cards check`) feeds it the file system, the
 * tests Vite's import.meta.glob.
 */

export const TAGS_FILE = 'tags.json';
export const LOCK_FILE = 'ids.lock';

export interface CardViolation {
  /** Relative to the cards folder, e.g. caching/cache-aside.md or ids.lock. */
  file: string;
  line?: number;
  message: string;
}

export interface CardCheck {
  cards: Card[];
  topics: Topic[];
  violations: CardViolation[];
}

export interface CheckOptions {
  /** Ids of the practice problems, to check `related`; skipped when absent. */
  problemIds?: string[];
  /** Overlap at or above this is reported (0–1); see similarity(). */
  threshold?: number;
}

/** Overlap reported by default: a reworded card scores about 0.5, unrelated cards on one topic below 0.25. */
export const DUPLICATE_THRESHOLD = 0.4;

const STOP = new Set(
  'a an the and or of to in on for with is are was be it its this that what which when why how does do you your from by as at than then into can would should'.split(' '),
);

/** The words of a text that carry meaning: lowercase, Markdown and punctuation removed, stop words dropped. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()#>|{}]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Character trigrams of the meaningful words, the unit of overlap. */
export function shingles(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(text)) {
    const w = ` ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Jaccard overlap of two shingle sets, 0 (nothing shared) to 1 (the same). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Which pairs of cards look like the same card: by question, and by question and answer together. */
export function overlaps(cards: Card[], threshold = DUPLICATE_THRESHOLD): { a: Card; b: Card; score: number }[] {
  const live = cards.filter((c) => !c.retired);
  const prompts = live.map((c) => shingles(promptOf(c)));
  const full = live.map((c) => shingles(`${promptOf(c)} ${answerOf(c)}`));
  const out: { a: Card; b: Card; score: number }[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const score = Math.max(similarity(prompts[i], prompts[j]), similarity(full[i], full[j]));
      if (score >= threshold) out.push({ a: live[i], b: live[j], score });
    }
  }
  return out;
}

/**
 * Checks the files of a cards folder, keyed by their path in it:
 * `tags.json`, `ids.lock` and `<topic>/<id>.md`.
 */
export function checkCardFiles(files: Record<string, string>, options: CheckOptions = {}): CardCheck {
  const violations: CardViolation[] = [];
  const add = (file: string, message: string, line?: number) => violations.push({ file, message, ...(line ? { line } : {}) });

  let topics: Topic[] = [];
  if (files[TAGS_FILE] === undefined) add(TAGS_FILE, 'Missing: the list of topics, [{"id", "title", "summary"}]');
  else {
    try {
      topics = readTopics(files[TAGS_FILE]);
    } catch (e) {
      if (!(e instanceof CardFileError)) throw e;
      add(TAGS_FILE, e.detail);
    }
  }
  const topicIds = new Set(topics.map((t) => t.id));

  const cards: Card[] = [];
  for (const file of Object.keys(files).sort()) {
    if (file === TAGS_FILE || file === LOCK_FILE) continue;
    if (!/^[^/]+\/[^/]+\.md$/.test(file)) {
      add(file, `Unexpected file: the cards folder holds ${TAGS_FILE}, ${LOCK_FILE} and <topic>/<id>.md`);
      continue;
    }
    try {
      cards.push(cardFromFile(file, files[file]));
    } catch (e) {
      if (!(e instanceof CardFileError)) throw e;
      add(e.file, e.detail, e.line);
    }
  }
  cards.sort(compareCards);

  const fileOf = (c: Card) => `${c.topic}/${c.id}.md`;
  const byId = new Map<string, Card>();
  for (const card of cards) {
    const other = byId.get(card.id);
    if (other) add(fileOf(card), `The id "${card.id}" is taken by ${fileOf(other)}; ids are unique across topics`);
    else byId.set(card.id, card);
    if (topics.length && !topicIds.has(card.topic)) add(fileOf(card), `The folder "${card.topic}" is not a topic in ${TAGS_FILE}`);
    for (const tag of card.tags.slice(1)) if (topics.length && !topicIds.has(tag)) add(fileOf(card), `Unknown tag "${tag}" (topics are listed in ${TAGS_FILE})`);
    if (options.problemIds) {
      for (const id of card.related) if (!options.problemIds.includes(id)) add(fileOf(card), `'related' names "${id}", which is not a practice problem`);
    }
    const prompt = promptOf(card);
    if (prompt.length > LIMITS.prompt) add(fileOf(card), `The question is ${prompt.length} characters; keep it to ${LIMITS.prompt} so it fits a phone screen`);
    if (card.type === 'flip' && card.back.length > LIMITS.answer) add(fileOf(card), `The back is ${card.back.length} characters; keep it to ${LIMITS.answer} and move detail to "## Why"`);
    if (card.type === 'choice') {
      for (const o of card.options) if (o.text.length > LIMITS.option) add(fileOf(card), `An option is ${o.text.length} characters; keep options to ${LIMITS.option}`);
      const texts = card.options.map((o) => o.text.toLowerCase());
      if (new Set(texts).size !== texts.length) add(fileOf(card), 'Two options are the same');
    }
    if (card.type === 'estimate' && card.solution.length > LIMITS.solution) add(fileOf(card), `The solution is ${card.solution.length} characters; keep it to ${LIMITS.solution}`);
    if (card.why && card.why.length > LIMITS.why) add(fileOf(card), `"## Why" is ${card.why.length} characters; keep it to ${LIMITS.why}`);
  }
  for (const card of cards) {
    for (const other of card.distinctFrom) if (!byId.has(other)) add(fileOf(card), `'distinct-from' names "${other}", which is not a card`);
  }

  // ids.lock: every card is in it, and nothing in it was deleted.
  if (files[LOCK_FILE] === undefined) add(LOCK_FILE, 'Missing: run `proschi cards lock` to create it');
  else {
    const { ids, lines } = readLock(files[LOCK_FILE]);
    const sorted = [...new Set(ids)].sort();
    if (ids.join('\n') !== sorted.join('\n')) add(LOCK_FILE, 'Not sorted, or an id appears twice; run `proschi cards lock`');
    for (const card of cards) {
      if (!lines.has(card.id)) add(fileOf(card), `New card: add its id to ${LOCK_FILE} with \`proschi cards lock\``);
    }
    for (const id of lines.keys()) {
      if (!byId.has(id)) add(LOCK_FILE, `"${id}" has no card file: never delete a card, set \`status: retired\` in its front matter instead`, lines.get(id));
    }
  }

  // Overlap: cards that ask nearly the same thing, unless one says it is distinct from the other.
  for (const { a, b, score } of overlaps(cards, options.threshold)) {
    if (a.distinctFrom.includes(b.id) || b.distinctFrom.includes(a.id)) continue;
    add(
      fileOf(b),
      `Possible duplicate of ${fileOf(a)} (${Math.round(score * 100)}% overlap). Merge them, reword one, or add \`distinct-from: [${a.id}]\` if they test different things`,
    );
  }

  return { cards, topics, violations };
}
