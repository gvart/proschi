import { loadJson, saveJson } from '../../services/storage';
import { parseNumber } from '../../learn/grade';
import type { Block, Inline, ListItem } from '../markdownReader';
import { PHASES, type Phase } from '../modes/session';

/**
 * The room's stage screens (docs/design/paid-plans.md P49): one screen per
 * phase, the user moving on with Next. Pure helpers: the brief revealed word
 * by word, the worksheet's rows and its calculator, and the transcript split
 * by stage.
 */

export const stageIndex = (p: Phase) => PHASES.findIndex((x) => x.id === p);
export const nextStage = (p: Phase): Phase | undefined => PHASES[stageIndex(p) + 1]?.id;
export const stageLabel = (p: Phase) => PHASES[stageIndex(p)].label;

// The brief, revealed as if typed (Clarify).

const words = (text: string): string[] => text.match(/\s*\S+\s*/g) ?? (text ? [text] : []);

function inlineWords(nodes: Inline[]): number {
  return nodes.reduce((n, x) => n + (x.kind === 'text' || x.kind === 'code' ? words(x.text).length : inlineWords(x.children)), 0);
}

/** The first `budget` words of inline nodes; `left` carries what is still to spend. */
function cutInlines(nodes: Inline[], left: { n: number }): Inline[] {
  const out: Inline[] = [];
  for (const x of nodes) {
    if (left.n <= 0) break;
    if (x.kind === 'text' || x.kind === 'code') {
      const w = words(x.text);
      const taken = w.slice(0, left.n);
      left.n -= taken.length;
      out.push({ ...x, text: taken.join('') });
    } else out.push({ ...x, children: cutInlines(x.children, left) });
  }
  return out;
}

function blockWords(b: Block): number {
  switch (b.kind) {
    case 'heading':
    case 'paragraph':
      return inlineWords(b.children);
    case 'list':
      return b.items.reduce((n, i) => n + inlineWords(i.children) + (i.sublist?.items.reduce((m, s) => m + inlineWords(s), 0) ?? 0), 0);
    default:
      // A table, a code block or a callout appears whole, as one step.
      return 1;
  }
}

/** How many steps the reveal of `blocks` takes. */
export const countWords = (blocks: Block[]): number => blocks.reduce((n, b) => n + blockWords(b), 0);

/** The blocks as they stand after `shown` words: whole blocks, then the one being typed, cut. */
export function revealBlocks(blocks: Block[], shown: number): Block[] {
  const left = { n: shown };
  const out: Block[] = [];
  for (const b of blocks) {
    if (left.n <= 0) break;
    const size = blockWords(b);
    if (size <= left.n) {
      out.push(b);
      left.n -= size;
      continue;
    }
    if (b.kind === 'heading' || b.kind === 'paragraph') out.push({ ...b, children: cutInlines(b.children, left) });
    else if (b.kind === 'list') {
      const items: ListItem[] = [];
      for (const item of b.items) {
        if (left.n <= 0) break;
        const children = cutInlines(item.children, left);
        const sub = item.sublist && left.n > 0 ? { ...item.sublist, items: item.sublist.items.map((s) => cutInlines(s, left)).filter((s) => s.length) } : undefined;
        items.push({ children, ...(sub ? { sublist: sub } : {}) });
      }
      out.push({ ...b, items });
    }
    left.n = 0;
  }
  return out;
}

/** The brief as plain text, for reading it aloud. */
export function plainText(blocks: Block[]): string {
  const inl = (nodes: Inline[]): string => nodes.map((x) => (x.kind === 'text' || x.kind === 'code' ? x.text : inl(x.children))).join('');
  return blocks
    .map((b) => (b.kind === 'heading' || b.kind === 'paragraph' ? inl(b.children) : b.kind === 'list' ? b.items.map((i) => inl(i.children)).join('. ') : ''))
    .filter(Boolean)
    .join('. ')
    .replace(/\.\.+/g, '.');
}

// The worksheet's calculator (Estimate). The server's (backend/src/ai/calc.ts) is the authority; this one shows the value as you type.

/** Evaluates `+ - * / ^`, parentheses, `%` and numbers like 10k, 3.2B, 1,000 or 1e6; undefined for anything else. */
export function calc(expression: string): number | undefined {
  const src = expression.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').trim();
  if (!src || src.length > 120) return undefined;
  const tokens = src.match(/\d[\d,_]*(?:\.\d+)?(?:e[+-]?\d+)?\s*(?:[kKMBGT](?![a-z]))?|\.\d+|[-+*/^()%]|\S/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const fail = () => {
    throw new Error('calc');
  };
  const atom = (): number => {
    const t = tokens[pos++];
    if (t === undefined) return fail();
    if (t === '(') {
      const v = sum();
      if (tokens[pos++] !== ')') fail();
      return v;
    }
    if (t === '-') return -atom();
    if (t === '+') return atom();
    const n = parseNumber(t.replace(/\s+/g, '').replace(/G$/, 'B'));
    return n === undefined ? fail() : n;
  };
  const power = (): number => {
    let v = atom();
    while (peek() === '%') {
      pos++;
      v /= 100;
    }
    if (peek() === '^') {
      pos++;
      v = v ** power();
    }
    return v;
  };
  const product = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/') v = tokens[pos++] === '*' ? v * power() : v / power();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = tokens[pos++] === '+' ? v + product() : v - product();
    return v;
  };
  try {
    const v = sum();
    return pos === tokens.length && Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A value for reading: 4 significant digits, with k, M, B or T for large ones. */
export function shortNumber(n: number): string {
  const abs = Math.abs(n);
  for (const [div, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) if (abs >= div) return `${Number((n / div).toPrecision(3))}${s}`;
  return String(Number(n.toPrecision(3)));
}

// The worksheet's rows.

export interface WorksheetRow {
  id: string;
  label: string;
  /** A number or an expression, as typed. */
  expression: string;
  unit: string;
}

/** On your own, row `q<i>` answers the problem's estimate question i. */
export const questionRowId = (i: number) => `q${i}`;
export const questionOf = (row: WorksheetRow): number | undefined => (/^q(\d+)$/.test(row.id) ? Number(row.id.slice(1)) : undefined);

/** The rows a worksheet with the interviewer starts with. */
export const STARTER_ROWS: readonly WorksheetRow[] = [
  { id: 'writes', label: 'Writes per second', expression: '', unit: '/s' },
  { id: 'reads', label: 'Reads per second', expression: '', unit: '/s' },
  { id: 'storage', label: 'Storage over 5 years', expression: '', unit: 'TB' },
  { id: 'bandwidth', label: 'Bandwidth at peak', expression: '', unit: 'MB/s' },
];

const WORKSHEET_KEY = (key: string) => `proschi.interview.worksheet.${key}`;
const MAX_ROWS = 24;

export function loadWorksheet(key: string): WorksheetRow[] | undefined {
  const raw = loadJson<unknown>(WORKSHEET_KEY(key), undefined);
  if (!Array.isArray(raw)) return undefined;
  const ok = (r: Partial<WorksheetRow> | null): r is WorksheetRow => !!r && typeof r.id === 'string' && typeof r.label === 'string' && typeof r.expression === 'string' && typeof r.unit === 'string';
  return (raw as (Partial<WorksheetRow> | null)[]).filter(ok).slice(0, MAX_ROWS);
}

export function saveWorksheet(key: string, rows: WorksheetRow[] | undefined): void {
  if (rows) saveJson(WORKSHEET_KEY(key), rows.slice(0, MAX_ROWS));
  else {
    try {
      localStorage.removeItem(WORKSHEET_KEY(key));
    } catch {
      // Storage unavailable: nothing was stored.
    }
  }
}

/** The rows the interviewer is sent with a turn: the filled ones, trimmed to the server's limits. */
export function worksheetPayload(rows: readonly WorksheetRow[]): { label: string; expression: string; unit?: string }[] {
  return rows
    .filter((r) => r.expression.trim())
    .slice(0, MAX_ROWS)
    .map((r) => ({ label: (r.label.trim() || 'Row').slice(0, 80), expression: r.expression.trim().slice(0, 120), ...(r.unit.trim() ? { unit: r.unit.trim().slice(0, 24) } : {}) }));
}

// The stage the user is on (with the interviewer; on your own it is the session's phase).

const STAGE_KEY = (id: string) => `proschi.interview.stage.${id}`;

export function loadStage(id: string): Phase | undefined {
  const raw = loadJson<unknown>(STAGE_KEY(id), undefined);
  return PHASES.some((p) => p.id === raw) ? (raw as Phase) : undefined;
}

export const saveStage = (id: string, stage: Phase): void => saveJson(STAGE_KEY(id), stage);

// Whether the brief was read (its reveal plays once per interview).

const BRIEF_KEY = (id: string) => `proschi.interview.brief.${id}`;
export const loadBriefRead = (id: string): boolean => loadJson<unknown>(BRIEF_KEY(id), false) === true;
export const saveBriefRead = (id: string): void => saveJson(BRIEF_KEY(id), true);


/** The messages said on `stage`, and how many came before it; a message without a stage counts as the first stage's. */
export function splitByStage<T extends { stage?: Phase }>(messages: readonly T[], stage: Phase): { earlier: T[]; here: T[] } {
  const at = stageIndex(stage);
  const earlier: T[] = [];
  const here: T[] = [];
  for (const m of messages) {
    const i = stageIndex(m.stage ?? 'clarify');
    if (i === at) here.push(m);
    else if (i < at) earlier.push(m);
  }
  return { earlier, here };
}
