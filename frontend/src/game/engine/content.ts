import { FrontMatterError, parseFrontMatter, type FrontMatterValue } from '../../practice/frontMatter';
import type { IconName } from './icons';
import { CARD_EFFECTS, CURVES, EVENT_EFFECTS, GAME_MODES, RARITIES, ROLES, TICKET_KINDS, TICKET_SENDERS, type Board, type MigrationDef, type CardDef, type ComponentDef, type ContractDef, type EventDef, type FeatureDef, type GameContent, type PerkDef, type Role, type ScenarioDef, type Stat } from './types';

/**
 * Reads the game's content folder (docs/GAME.md) from a map of files keyed
 * by their path in it: `components.json`, `perks.json`, `cards/<id>.md`,
 * `events/<id>.md` and `scenarios/<id>/scenario.{json,md}`. The Arcade page
 * passes Vite's glob of the folder, the CLI reads it from disk, the Worker
 * gets a generated module: all three read it with this.
 */

export class ContentError extends Error {
  readonly file: string;
  readonly line?: number;
  constructor(file: string, message: string, line?: number) {
    super(`${file}${line ? `:${line}` : ''}: ${message}`);
    this.name = 'ContentError';
    this.file = file;
    this.line = line;
  }
}

export interface ContentRead {
  content: GameContent;
  errors: ContentError[];
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `## Heading` sections of a Markdown body, keyed by the heading as written. */
export function markdownSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (name !== undefined) out[name] = lines.join('\n').trim();
  };
  for (const raw of body.split(/\r?\n/)) {
    const h = /^## (.+?)\s*$/.exec(raw);
    if (h) {
      flush();
      name = h[1];
      lines = [];
    } else lines.push(raw);
  }
  flush();
  return out;
}

class Fields {
  readonly file: string;
  readonly data: Record<string, FrontMatterValue>;
  constructor(file: string, data: Record<string, FrontMatterValue>) {
    this.file = file;
    this.data = data;
  }
  private fail(message: string): never {
    throw new ContentError(this.file, message);
  }
  string(key: string): string {
    const v = this.data[key];
    if (typeof v !== 'string' || !v.trim()) this.fail(`"${key}:" is required and must be text`);
    return v;
  }
  optionalString(key: string): string | undefined {
    return this.data[key] === undefined ? undefined : this.string(key);
  }
  number(key: string, fallback?: number): number {
    const v = this.data[key];
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v !== 'number') this.fail(`"${key}:" must be a number`);
    return v;
  }
  optionalNumber(key: string): number | undefined {
    return this.data[key] === undefined ? undefined : this.number(key);
  }
  list(key: string): string[] {
    const v = this.data[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) this.fail(`"${key}:" must be a list, e.g. [a, b]`);
    return v;
  }
  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const v = this.string(key);
    if (!values.includes(v as T)) this.fail(`"${key}: ${v}" must be one of ${values.join(', ')}`);
    return v as T;
  }
  optionalOneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    return this.data[key] === undefined ? undefined : this.oneOf(key, values);
  }
  known(allowed: readonly string[]) {
    for (const k of Object.keys(this.data)) if (!allowed.includes(k)) this.fail(`Unknown field "${k}:"; the fields are ${allowed.join(', ')}`);
  }
}

function readMarkdown(file: string, text: string): { fields: Fields; sections: Record<string, string> } {
  try {
    const { data, body } = parseFrontMatter(text);
    return { fields: new Fields(file, data), sections: markdownSections(body) };
  } catch (e) {
    if (e instanceof FrontMatterError) throw new ContentError(file, e.message.replace(/^line \d+: /, ''), e.line);
    throw e;
  }
}

function section(file: string, sections: Record<string, string>, name: string): string {
  const s = sections[name];
  if (!s) throw new ContentError(file, `Needs a "## ${name}" section`);
  return s;
}

const fileId = (file: string) => file.replace(/^.*\//, '').replace(/\.md$/, '');

export function cardFromFile(file: string, text: string): CardDef {
  const { fields: f, sections } = readMarkdown(file, text);
  f.known(['name', 'icon', 'rarity', 'topic', 'learn', 'effect', 'target', 'stat', 'value', 'unlock']);
  const id = fileId(file);
  if (!ID.test(id)) throw new ContentError(file, 'The file name must be lowercase words joined by "-"');
  const stat = f.optionalString('stat');
  if (stat !== undefined && !['rps', 'reads', 'writes'].includes(stat)) throw new ContentError(file, '"stat:" is rps, reads or writes');
  const target = f.optionalString('target');
  return {
    id,
    name: f.string('name'),
    icon: f.string('icon') as IconName,
    rarity: f.oneOf('rarity', RARITIES),
    topic: f.string('topic'),
    learn: f.list('learn'),
    effect: f.oneOf('effect', CARD_EFFECTS),
    ...(target !== undefined ? { target } : {}),
    ...(stat !== undefined ? { stat: stat as Stat } : {}),
    value: f.number('value', 0),
    unlock: f.number('unlock', 0),
    text: section(file, sections, 'Text'),
    why: section(file, sections, 'Why'),
  };
}

export function eventFromFile(file: string, text: string): EventDef {
  const { fields: f, sections } = readMarkdown(file, text);
  f.known(['title', 'icon', 'category', 'topic', 'learn', 'effect', 'target', 'value', 'values', 'duration', 'from', 'telegraph', 'counters', 'requires', 'min-wave']);
  const id = fileId(file);
  if (!ID.test(id)) throw new ContentError(file, 'The file name must be lowercase words joined by "-"');
  const values = f.list('values').map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ContentError(file, `"values:" holds numbers, not ${v}`);
    return n;
  });
  const requires = f.list('requires');
  for (const r of requires) if (!ROLES.includes(r as Role)) throw new ContentError(file, `"requires:" lists component roles (${ROLES.join(', ')}), not ${r}`);
  const target = f.optionalString('target');
  const value = f.optionalNumber('value');
  const from = f.optionalNumber('from');
  return {
    id,
    title: f.string('title'),
    icon: f.string('icon') as IconName,
    category: f.oneOf('category', ['incident', 'spike'] as const),
    topic: f.string('topic'),
    learn: f.list('learn'),
    effect: f.oneOf('effect', EVENT_EFFECTS),
    ...(target !== undefined ? { target } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(values.length ? { values } : {}),
    duration: f.number('duration', 1),
    ...(from !== undefined ? { from } : {}),
    telegraph: f.string('telegraph'),
    counters: f.list('counters'),
    requires: requires as Role[],
    minWave: f.number('min-wave', 1),
    whatHappened: section(file, sections, 'What happened'),
    why: section(file, sections, 'Why'),
    senior: section(file, sections, 'What a senior engineer would do'),
  };
}

function json<T>(file: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ContentError(file, `Not valid JSON: ${(e as Error).message}`);
  }
}

/** scenario.json plus the front matter and sections of scenario.md. */
export function scenarioFromFiles(id: string, jsonText: string, markdown: string): ScenarioDef {
  const jsonFile = `scenarios/${id}/scenario.json`;
  const mdFile = `scenarios/${id}/scenario.md`;
  const { fields: f, sections } = readMarkdown(mdFile, markdown);
  f.known(['title', 'summary', 'difficulty', 'tags', 'related', 'cards', 'order', 'version', 'mode']);
  const data = json<Omit<ScenarioDef, 'id' | 'title' | 'summary' | 'difficulty' | 'tags' | 'related' | 'cards' | 'order' | 'version' | 'sections' | 'grants'> & { grants?: unknown[] }>(jsonFile, jsonText);
  const need = (cond: unknown, message: string) => {
    if (!cond) throw new ContentError(jsonFile, message);
  };
  need(data && typeof data === 'object', 'Must be an object');
  need(data.start && typeof data.start.cash === 'number' && typeof data.start.trust === 'number' && isBoard(data.start.board), '"start" needs cash, trust and a board {nodes, edges}');
  need(Array.isArray(data.externals ?? []), '"externals" is a list');
  need(data.useCases && typeof data.useCases === 'object', '"useCases" is an object keyed by use case');
  need(Array.isArray(data.waves) && data.waves.length > 0, '"waves" is a non-empty list');
  for (const [i, w] of data.waves.entries()) {
    need(w && typeof w.traffic === 'object', `Wave ${i + 1} needs "traffic"`);
    need(w.curve === undefined || w.curve in CURVES, `Wave ${i + 1}: unknown curve "${w.curve}"; use ${Object.keys(CURVES).join(', ')}`);
    if (w.ticket !== undefined) {
      const t = w.ticket;
      need(t && typeof t.id === 'string' && typeof t.title === 'string', `Wave ${i + 1}: a ticket needs an id and a title`);
      need((TICKET_SENDERS as readonly string[]).includes(t.from), `Wave ${i + 1}: ticket "from" is one of ${TICKET_SENDERS.join(', ')}`);
      need((TICKET_KINDS as readonly string[]).includes(t.kind), `Wave ${i + 1}: ticket "kind" is one of ${TICKET_KINDS.join(', ')}`);
      need(sections[`Ticket: ${t.id}`] !== undefined, `Wave ${i + 1}: scenario.md needs a "## Ticket: ${t.id}" section`);
    }
  }
  const migrations = (data.migrations ?? []) as MigrationDef[];
  need(Array.isArray(migrations), '"migrations" is a list');
  for (const m of migrations) {
    need(m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.entity === 'string' && typeof m.store === 'string', 'A migration needs an id, a name, an entity and a store');
    need(['needs', 'writers', 'oldReaders'].every((k) => Array.isArray(m[k as 'needs'])), `Migration '${m.id}' needs "needs", "writers" and "oldReaders" lists`);
    need(typeof m.backfillRps === 'number' && m.backfillRps > 0, `Migration '${m.id}' needs a positive "backfillRps"`);
  }
  return {
    id,
    title: f.string('title'),
    summary: f.string('summary'),
    difficulty: f.oneOf('difficulty', ['easy', 'medium', 'hard'] as const),
    tags: f.list('tags'),
    related: f.list('related'),
    cards: f.list('cards'),
    order: f.number('order'),
    version: f.number('version', 1),
    sections,
    start: data.start,
    externals: data.externals ?? [],
    useCases: data.useCases,
    waves: data.waves,
    eventPool: data.eventPool ?? [],
    contracts: (data.contracts ?? []) as ContractDef[],
    ...(data.unlock ? { unlock: data.unlock } : {}),
    grants: Array.isArray(data.grants) ? data.grants.filter((g): g is string => typeof g === 'string') : [],
    mode: f.optionalOneOf('mode', GAME_MODES) ?? 'scale',
    migrations,
  };
}

export function isBoard(b: unknown): b is Board {
  if (!b || typeof b !== 'object') return false;
  const board = b as Board;
  return (
    Array.isArray(board.nodes) &&
    Array.isArray(board.edges) &&
    board.nodes.every((n) => n && typeof n.id === 'string' && typeof n.component === 'string' && typeof n.replicas === 'number') &&
    board.edges.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string')
  );
}

/** Reads every content file; a file that cannot be read is reported and left out. */
export function readContent(files: Record<string, string>): ContentRead {
  const errors: ContentError[] = [];
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ContentError) errors.push(e);
      else errors.push(new ContentError('?', String(e)));
      return undefined;
    }
  };
  const components = attempt(() => {
    const text = files['components.json'];
    if (text === undefined) throw new ContentError('components.json', 'Missing');
    return json<{ components: ComponentDef[]; features: FeatureDef[] }>('components.json', text);
  }) ?? { components: [], features: [] };
  const perks = attempt(() => {
    const text = files['perks.json'];
    if (text === undefined) throw new ContentError('perks.json', 'Missing');
    return json<{ perks: PerkDef[] }>('perks.json', text).perks;
  }) ?? [];
  const cards: CardDef[] = [];
  const events: EventDef[] = [];
  const scenarios: ScenarioDef[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (/^cards\/[^/]+\.md$/.test(path)) {
      const c = attempt(() => cardFromFile(path, text));
      if (c) cards.push(c);
    } else if (/^events\/[^/]+\.md$/.test(path)) {
      const e = attempt(() => eventFromFile(path, text));
      if (e) events.push(e);
    } else if (/^scenarios\/[^/]+\/scenario\.json$/.test(path)) {
      const id = path.split('/')[1];
      const md = files[`scenarios/${id}/scenario.md`];
      if (md === undefined) {
        errors.push(new ContentError(`scenarios/${id}/scenario.md`, 'Missing: every scenario has a scenario.md with its title and prose'));
        continue;
      }
      const s = attempt(() => scenarioFromFiles(id, text, md));
      if (s) scenarios.push(s);
    }
  }
  scenarios.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { content: { components: components.components ?? [], features: components.features ?? [], perks, cards, events, scenarios }, errors };
}
