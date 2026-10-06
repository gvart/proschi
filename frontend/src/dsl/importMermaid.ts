import {
  idAllocator,
  plainLabel,
  renderDesign,
  stepLabel,
  techFromLabel,
  type Design,
  type DesignNode,
  type DesignStep,
  type DesignUseCase,
  type ImportResult,
  type ImportWarning,
} from './importDesign';

/**
 * Mermaid to Proschi: `flowchart`/`graph` diagrams become the architecture
 * (nodes, subgraphs as groups, links as connections) and `sequenceDiagram`s
 * become use cases. Text with several ```mermaid blocks (a Markdown file,
 * `proschi render --format md`) merges them into one document. Pure; never
 * throws: what it cannot read becomes a warning. The reverse is mermaid.ts.
 */

interface Block {
  /** Lines of the diagram, with their 1-based line numbers in the input. */
  lines: { text: string; line: number }[];
  title?: string;
}

/** Splits the input into diagrams: each ```mermaid fence, or the whole text. */
function blocks(text: string): Block[] {
  const all = text.split(/\r?\n/).map((t, i) => ({ text: t, line: i + 1 }));
  const fenced: Block[] = [];
  let current: Block | undefined;
  for (const l of all) {
    if (!current && /^\s*(```|~~~)\s*mermaid\b/i.test(l.text)) current = { lines: [] };
    else if (current && /^\s*(```|~~~)\s*$/.test(l.text)) {
      fenced.push(current);
      current = undefined;
    } else if (current) current.lines.push(l);
  }
  if (current) fenced.push(current);
  const found = fenced.length ? fenced : [{ lines: all }];
  for (const block of found) readFrontMatter(block);
  return found;
}

/** Reads and removes a `---` front matter: its `title:` names the diagram. */
function readFrontMatter(block: Block) {
  const first = block.lines.findIndex((l) => l.text.trim() !== '');
  if (first < 0 || block.lines[first].text.trim() !== '---') return;
  const close = block.lines.findIndex((l, i) => i > first && l.text.trim() === '---');
  if (close < 0) return;
  for (const l of block.lines.slice(first + 1, close)) {
    const m = /^title:\s*(.+)$/.exec(l.text.trim());
    if (m) block.title = unquoteYaml(m[1]);
  }
  block.lines = block.lines.slice(close + 1);
}

function unquoteYaml(value: string): string {
  const v = value.trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  return v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
}

const NAMED_ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'", hash: '#', semi: ';' };

/** Decodes Mermaid entity codes (`#35;`, `#quot;`) and HTML ones. */
function decode(text: string): string {
  return text
    .replace(/[#&](\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[#&]([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** A label's plain text: line breaks become spaces, HTML tags, Markdown marks and icons go. */
function labelText(raw: string): string {
  return decode(
    raw
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/fa[bklrs]?:fa-[\w-]+/g, '')
      .replace(/`|\*\*|__/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** A node label, and the tech when it ends with `<br/>[Tech]` as Proschi's own export writes it. */
function nodeLabel(raw: string): { name: string; tech?: string } {
  const parts = raw.split(/<br\s*\/?>/i);
  const last = parts.length > 1 ? decode(parts[parts.length - 1]).trim() : '';
  const tech = /^\[([^\]]+)\]$/.exec(last)?.[1].trim();
  return tech ? { name: labelText(parts.slice(0, -1).join('<br/>')), tech } : { name: labelText(raw) };
}

/** A diagram being built from several Mermaid blocks. */
type SequenceUseCase = DesignUseCase & { scenario?: { name: string; when?: string } };

class Builder {
  readonly design: Design & { useCases: SequenceUseCase[] } = { nodes: [], edges: [], useCases: [] };
  readonly warnings: ImportWarning[] = [];
  private readonly id = idAllocator();
  private readonly byRaw = new Map<string, DesignNode>();

  warn(line: number | undefined, message: string) {
    this.warnings.push(line === undefined ? { message } : { line, message });
  }

  has(raw: string): boolean {
    return this.byRaw.has(raw);
  }

  /** The node for a Mermaid id, created on first use. */
  node(raw: string, init?: { name?: string; tech?: string; parent?: string }): DesignNode {
    let node = this.byRaw.get(raw);
    if (!node) {
      const name = init?.name || raw;
      node = { id: this.id(raw), name, tech: init?.tech ?? techFromLabel(name), parent: init?.parent };
      this.byRaw.set(raw, node);
      this.design.nodes.push(node);
    }
    return node;
  }

  edge(from: string, to: string, label: string | undefined) {
    const existing = this.design.edges.find((e) => e.from === from && e.to === to);
    if (existing) {
      existing.label ||= label;
      return;
    }
    this.design.edges.push({ from, to, ...(label ? { label } : {}) });
  }

  connected(a: string, b: string): boolean {
    return this.design.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  }
}

/** Splits a line into statements at `;` outside quotes. */
function statements(text: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === ';' && !quoted) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- flowchart

type Shape = 'rect' | 'round' | 'stadium' | 'cylinder' | 'subroutine' | 'circle' | 'rhombus' | 'hexagon' | 'slanted' | 'asymmetric' | 'documents' | 'cloud';

/** Openers in the order they must be tried (longest first), with their closers. */
const SHAPES: [string, string[], Shape][] = [
  ['(((', [')))'], 'circle'],
  ['((', ['))'], 'circle'],
  ['([', ['])'], 'stadium'],
  ['[(', [')]'], 'cylinder'],
  ['[[', [']]'], 'subroutine'],
  ['[/', ['/]', '\\]'], 'slanted'],
  ['[\\', ['\\]', '/]'], 'slanted'],
  ['{{', ['}}'], 'hexagon'],
  ['{', ['}'], 'rhombus'],
  ['(', [')'], 'round'],
  ['[', [']'], 'rect'],
  ['>', [']'], 'asymmetric'],
];

/** `A@{ shape: cyl }` shape names (Mermaid 11), by what they suggest. */
const NAMED_SHAPES: Record<string, Shape> = {
  cyl: 'cylinder', cylinder: 'cylinder', db: 'cylinder', database: 'cylinder', das: 'cylinder', disk: 'cylinder', 'lin-cyl': 'cylinder', 'h-cyl': 'cylinder', 'horizontal-cylinder': 'cylinder', 'lined-cylinder': 'cylinder',
  docs: 'documents', documents: 'documents', 'st-doc': 'documents', 'stacked-document': 'documents', doc: 'documents', document: 'documents',
  circle: 'circle', circ: 'circle', 'sm-circ': 'circle', 'dbl-circ': 'circle', stadium: 'stadium', pill: 'stadium', 'terminal': 'stadium',
  diam: 'rhombus', diamond: 'rhombus', decision: 'rhombus', hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
  subproc: 'subroutine', subprocess: 'subroutine', subroutine: 'subroutine', 'fr-rect': 'subroutine',
  cloud: 'cloud', flag: 'asymmetric', 'tag-rect': 'rect', rounded: 'round', rect: 'rect', rectangle: 'rect', process: 'rect',
};

const SHAPE_TECH: Partial<Record<Shape, string>> = {
  cylinder: 'Database',
  subroutine: 'Message Queue',
  documents: 'Object Storage',
  cloud: 'Third Party API',
};

interface NodeRef {
  raw: string;
  label?: string;
  shape?: Shape;
}

interface Arrow {
  label?: string;
  both: boolean;
  invisible: boolean;
}

class Scanner {
  pos = 0;
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  skip() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }
  done() {
    this.skip();
    return this.pos >= this.text.length;
  }
  rest() {
    return this.text.slice(this.pos);
  }
  /** Reads up to (not including) the earliest closer; a label in quotes may hold closers. */
  until(closers: string[]): { text: string; closer: string } | undefined {
    let i = this.pos;
    while (i < this.text.length && /\s/.test(this.text[i])) i++;
    if (this.text[i] === '"') {
      const end = this.text.indexOf('"', i + 1);
      if (end > 0) {
        let j = end + 1;
        while (j < this.text.length && /\s/.test(this.text[j])) j++;
        const closer = closers.find((c) => this.text.startsWith(c, j));
        if (closer) {
          this.pos = j + closer.length;
          return { text: this.text.slice(i + 1, end), closer };
        }
      }
    }
    let best: { at: number; closer: string } | undefined;
    for (const closer of closers) {
      const at = this.text.indexOf(closer, this.pos);
      if (at >= 0 && (!best || at < best.at)) best = { at, closer };
    }
    if (!best) return undefined;
    const text = this.text.slice(this.pos, best.at);
    this.pos = best.at + best.closer.length;
    return { text, closer: best.closer };
  }
}

const ID = /[\p{L}\p{N}_][\p{L}\p{N}_.]*/uy;

function readNode(s: Scanner): NodeRef | undefined {
  s.skip();
  ID.lastIndex = s.pos;
  const m = ID.exec(s.text);
  if (!m) return undefined;
  s.pos += m[0].length;
  const ref: NodeRef = { raw: m[0].replace(/\.+$/, '') };
  if (ref.raw.length < m[0].length) s.pos -= m[0].length - ref.raw.length;
  for (const [open, closers, shape] of SHAPES) {
    if (!s.text.startsWith(open, s.pos)) continue;
    s.pos += open.length;
    const label = s.until(closers);
    if (!label) return undefined;
    ref.label = label.text;
    ref.shape = shape;
    break;
  }
  const cls = /^:::[\w-]+/.exec(s.rest());
  if (cls) s.pos += cls[0].length;
  if (s.text.startsWith('@{', s.pos)) {
    const end = s.text.indexOf('}', s.pos);
    if (end < 0) return undefined;
    const body = s.text.slice(s.pos + 2, end);
    s.pos = end + 1;
    const shape = /shape\s*:\s*["']?([\w-]+)/.exec(body)?.[1].toLowerCase();
    const label = /label\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? /label\s*:\s*'([^']*)'/.exec(body)?.[1];
    if (shape) ref.shape = NAMED_SHAPES[shape] ?? 'rect';
    if (label !== undefined) ref.label = label;
  }
  return ref;
}

// Links: `-->`, `---`, `-.->`, `==>`, `~~~`, `<-->`, `--o`, `--x`, longer forms, and labels written inside (`-- text -->`).
const LINK = /(<)?(?:(--|==|-\.)\s+(.*?)\s+(-{2,}|={2,}|\.+-)|(-{2,}|={2,}|-\.+-|~{3,}))(>|[ox](?=[\s|]|$))?/y;

function readArrow(s: Scanner): Arrow | undefined {
  s.skip();
  LINK.lastIndex = s.pos;
  const m = LINK.exec(s.text);
  if (!m) return undefined;
  s.pos += m[0].length;
  const arrow: Arrow = { both: !!m[1] && m[6] === '>', invisible: !!m[5]?.startsWith('~') };
  if (m[3] !== undefined) arrow.label = m[3].replace(/^"(.*)"$/, '$1');
  s.skip();
  if (s.text[s.pos] === '|') {
    const end = s.text.indexOf('|', s.pos + 1);
    if (end > 0) {
      arrow.label = s.text.slice(s.pos + 1, end).trim().replace(/^"(.*)"$/, '$1');
      s.pos = end + 1;
    }
  }
  return arrow;
}

/** `A & B` */
function readNodes(s: Scanner): NodeRef[] | undefined {
  const out: NodeRef[] = [];
  for (;;) {
    const node = readNode(s);
    if (!node) return undefined;
    out.push(node);
    s.skip();
    if (s.text[s.pos] !== '&') return out;
    s.pos++;
  }
}

const IGNORED = /^(style|classDef|class|linkStyle|click|direction|accTitle|accDescr)\b/;

function readFlowchart(block: Block, b: Builder, start: number) {
  const groups: string[] = [];
  let ignored = 0;
  const declare = (ref: NodeRef) => {
    const parent = groups[groups.length - 1];
    const label = ref.label !== undefined ? nodeLabel(ref.label) : undefined;
    const known = b.has(ref.raw);
    const node = b.node(ref.raw, { name: label?.name, parent });
    if (known && parent && !node.parent && !node.group && node.id !== parent) node.parent = parent;
    if (label) {
      if (label.name) node.name = label.name;
      node.tech = label.tech ?? (ref.shape === 'asymmetric' ? 'Text Note' : techFromLabel(node.name, SHAPE_TECH[ref.shape ?? 'rect']));
    } else if (!known) {
      node.tech = techFromLabel(node.name);
    }
    return node;
  };

  for (const { text, line } of block.lines.slice(start)) {
    for (const statement of statements(text)) {
      if (statement.startsWith('%%')) break;
      if (IGNORED.test(statement)) {
        ignored++;
        continue;
      }
      if (statement === 'end') {
        if (!groups.pop()) b.warn(line, "'end' without a subgraph");
        continue;
      }
      const sub = /^subgraph\b\s*(.*)$/.exec(statement);
      if (sub) {
        const rest = sub[1].trim();
        const withTitle = /^([\p{L}\p{N}_.-]+)\s*\[(.*)\]$/u.exec(rest);
        const raw = withTitle?.[1] ?? (/^[\p{L}\p{N}_]+$/u.test(rest) ? rest : `${rest.replace(/^"|"$/g, '') || 'group'}`);
        const title = labelText((withTitle?.[2] ?? rest).trim().replace(/^"(.*)"$/, '$1')) || raw;
        const group = b.node(raw, { name: title, parent: groups[groups.length - 1] });
        group.group = true;
        group.name = title;
        groups.push(group.id);
        continue;
      }

      const s = new Scanner(statement);
      const first = readNodes(s);
      if (!first) {
        b.warn(line, `Could not read '${statement}'; left out`);
        continue;
      }
      let left = first.map(declare);
      let failed = false;
      while (!s.done()) {
        const arrow = readArrow(s);
        const right = arrow && readNodes(s);
        if (!arrow || !right) {
          b.warn(line, `Could not read '${s.rest()}'; left out`);
          failed = true;
          break;
        }
        const nodes = right.map(declare);
        if (!arrow.invisible) {
          const label = arrow.label === undefined ? undefined : plainLabel(labelText(arrow.label)) || undefined;
          for (const from of left) {
            for (const to of nodes) {
              b.edge(from.id, to.id, label);
              if (arrow.both) b.edge(to.id, from.id, label);
            }
          }
        }
        left = nodes;
      }
      if (failed) continue;
    }
  }
  if (groups.length) b.warn(undefined, `${groups.length} subgraph(s) not closed with 'end'`);
  if (ignored) b.warn(undefined, `Ignored ${ignored} styling line(s) (style, classDef, class, linkStyle, click)`);
  // A group left empty (a subgraph only linked to) is drawn as an empty box; fine, but say so.
  for (const group of b.design.nodes.filter((n) => n.group)) {
    if (!b.design.nodes.some((n) => n.parent === group.id)) b.warn(undefined, `Subgraph '${group.name}' has no nodes`);
  }
}

// ----------------------------------------------------------------- sequence

type MessageArrow = '->' | '-->' | '->>' | '-->>' | '-x' | '--x' | '-)' | '--)' | '<<->>' | '<<-->>';

type SeqItem =
  | { kind: 'msg'; from: string; to: string; arrow: MessageArrow; label: string; line: number }
  | { kind: 'block'; type: string; line: number; branches: { label: string; items: SeqItem[] }[] };

const MESSAGE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::(.*))?$/;
const BLOCK_START = /^(par|alt|opt|loop|critical|break|rect)\b\s*(.*)$/;
const BRANCH = { and: 'par', else: 'alt', option: 'critical' } as const;
const COLORS = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|blue|green|red|yellow|orange|purple|pink|gray|grey|white|black|lightblue|lightgreen|lightyellow|lightgrey|lightgray)\s*/i;

function readSequence(block: Block, b: Builder, start: number, index: number) {
  const root: SeqItem[] = [];
  const stack: Extract<SeqItem, { kind: 'block' }>[] = [];
  const items = () => (stack.length ? stack[stack.length - 1].branches.at(-1)!.items : root);
  let title = '';
  let box: string | undefined;
  let scenario: { name: string; when?: string } | undefined;

  const participant = (raw: string, init?: { name?: string; tech?: string }) => {
    const name = raw.trim().replace(/^"(.*)"$/, '$1');
    const node = b.node(name, { name: init?.name ? labelText(init.name) : name, tech: init?.tech, parent: box });
    if (box && !node.parent && !node.group && node.id !== box) node.parent = box;
    return node.id;
  };

  for (const { text, line } of block.lines.slice(start)) {
    const statement = text.trim();
    if (!statement || statement.startsWith('%%')) continue;
    const note = /^note\s+over\s+[^:]+:\s*(.*)$/i.exec(statement);
    if (note && !root.length && !stack.length && scenario === undefined) {
      // Proschi's own export names the scenario in a note before the first message.
      const m = /^(.*?)( \(error\))?(?: when (.*))?$/.exec(labelText(note[1]))!;
      scenario = { name: m[1], ...(m[3] ? { when: m[3] } : {}) };
      continue;
    }
    if (/^(autonumber|activate|deactivate|note|accTitle|accDescr|destroy|links?|properties|details)\b/i.test(statement)) continue;
    const t = /^title\s*:?\s*(.*)$/.exec(statement);
    if (t) {
      title = labelText(t[1]);
      continue;
    }
    const p = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:@\{(.*)\})?(?:\s+as\s+(.+))?$/.exec(statement);
    if (p) {
      const type = /["']?type["']?\s*:\s*["']?(\w+)/.exec(p[3] ?? '')?.[1];
      const tech =
        p[1] === 'actor' || type === 'actor' ? 'Actor' : type === 'database' || type === 'collections' ? 'Database' : type === 'queue' ? 'Message Queue' : undefined;
      participant(p[2], { name: p[4], tech: tech ?? techFromLabel(labelText(p[4] ?? p[2])) });
      continue;
    }
    const boxStart = /^box\b\s*(.*)$/.exec(statement);
    if (boxStart) {
      const name = boxStart[1].replace(COLORS, '').trim() || 'Group';
      const group = b.node(name, { name });
      group.group = true;
      box = group.id;
      continue;
    }
    const open = BLOCK_START.exec(statement);
    if (open) {
      const item: SeqItem = { kind: 'block', type: open[1], line, branches: [{ label: labelText(open[2]), items: [] }] };
      items().push(item);
      stack.push(item);
      continue;
    }
    const branch = /^(and|else|option)\b\s*(.*)$/.exec(statement);
    if (branch) {
      const top = stack[stack.length - 1];
      if (top && top.type === BRANCH[branch[1] as keyof typeof BRANCH]) top.branches.push({ label: labelText(branch[2]), items: [] });
      else b.warn(line, `'${branch[1]}' outside a matching block; left out`);
      continue;
    }
    if (statement === 'end') {
      if (stack.length) stack.pop();
      else if (box) box = undefined;
      else b.warn(line, "'end' without a block");
      continue;
    }
    const m = MESSAGE.exec(statement);
    if (m) {
      const from = participant(m[1]);
      const to = participant(m[4]);
      items().push({ kind: 'msg', from, to, arrow: m[2] as MessageArrow, label: labelText(m[5] ?? ''), line });
      continue;
    }
    b.warn(line, `Could not read '${statement}'; left out`);
  }

  const name = title || block.title || (index === 0 ? 'Sequence' : `Sequence ${index + 1}`);
  const steps = new SequenceConverter(b).convert(root, false);
  if (!steps.some(hasStep)) {
    b.warn(block.lines[start]?.line, `Sequence diagram '${name}' has no messages; left out`);
    return;
  }
  b.design.useCases.push({ name, steps, ...(scenario ? { scenario } : {}) });
}

const hasStep = (s: DesignStep): boolean => s.kind === 'step' || (s.kind === 'par' ? s.steps.some(hasStep) : s.branches.some((br) => br.steps.some(hasStep)));

/** Turns Mermaid messages into steps: solid arrows call, dotted ones answer the open call they reply to. */
class SequenceConverter {
  /** Calls that can still be answered: from → to. */
  private open: { from: string; to: string }[] = [];
  private readonly b: Builder;
  constructor(b: Builder) {
    this.b = b;
  }

  convert(items: SeqItem[], inPar: boolean): DesignStep[] {
    const out: DesignStep[] = [];
    for (const item of items) {
      if (item.kind === 'msg') {
        out.push(this.message(item));
        continue;
      }
      const { type, branches, line } = item;
      if (type === 'rect') {
        out.push(...this.convert(branches[0].items, inPar));
      } else if (type === 'loop') {
        this.b.warn(line, `loop${branches[0].label ? ` '${branches[0].label}'` : ''} is imported as a single pass; use an x<N> prefix on a step for fan-out`);
        out.push(...this.convert(branches[0].items, inPar));
      } else if (type === 'par') {
        if (inPar) {
          this.b.warn(line, 'Nested par is merged into the outer par block');
          for (const br of branches) out.push(...this.convert(br.items, true));
          continue;
        }
        const steps = branches.flatMap((br) => {
          const converted = this.convert(br.items, true);
          if (converted.filter((s) => s.kind === 'step' && s.arrow !== '-->').length > 1) {
            this.b.warn(line, `A par branch${br.label ? ` ('${br.label}')` : ''} makes several calls; Proschi runs every step of a par block in parallel`);
          }
          return converted;
        });
        if (steps.length) out.push({ kind: 'par', steps });
      } else {
        // alt, opt, critical, break: scenarios.
        if (inPar) {
          this.b.warn(line, `${type} inside par: only its first branch is imported`);
          out.push(...this.convert(branches[0].items, true));
          continue;
        }
        if (type === 'break') this.b.warn(line, "break is imported as an optional branch; the steps after it still run in that scenario");
        const before = [...this.open];
        const names = new Set<string>();
        const result = branches.map((br, i) => {
          this.open = [...before];
          let name = br.label || (type === 'opt' || type === 'break' ? 'Yes' : `Branch ${i + 1}`);
          for (let n = 2; names.has(name); n++) name = `${br.label || 'Branch'} ${n}`;
          names.add(name);
          return { name, steps: this.convert(br.items, false) };
        });
        if (type === 'opt' || type === 'break') result.push({ name: names.has('Otherwise') ? 'Otherwise 2' : 'Otherwise', steps: [] });
        this.open = before;
        out.push({ kind: 'alt', branches: result });
      }
    }
    return out;
  }

  private message(m: Extract<SeqItem, { kind: 'msg' }>): DesignStep {
    const reply = m.arrow === '-->' || m.arrow === '-->>' || m.arrow === '--)';
    const { label, cut } = stepLabel(m.label);
    if (cut) this.b.warn(m.line, 'A payload that does not close on its line was cut from the message');
    if (m.arrow.startsWith('<<')) this.b.warn(m.line, 'A two-way message is imported as a call');
    if (reply) {
      const at = this.open.map((o) => `${o.from}>${o.to}`).lastIndexOf(`${m.to}>${m.from}`);
      if (at >= 0) {
        this.open.splice(at, 1);
        return { kind: 'step', from: m.from, arrow: '-->', to: m.to, label };
      }
      // A dotted arrow that answers nothing reads as a one-way message.
      return { kind: 'step', from: m.from, arrow: '->>', to: m.to, label };
    }
    if (m.arrow === '-x' || m.arrow === '--x') return { kind: 'step', from: m.from, arrow: '-x', to: m.to, label };
    this.open.push({ from: m.from, to: m.to });
    return { kind: 'step', from: m.from, arrow: m.arrow === '-)' ? '->>' : '->', to: m.to, label };
  }
}

/**
 * Sequence diagrams of one use case's scenarios (same title, each naming its
 * scenario in a leading note, as Proschi's export writes them) become one use
 * case with an `alt` branch per scenario.
 */
function mergeScenarios(useCases: SequenceUseCase[]): DesignUseCase[] {
  const out: DesignUseCase[] = [];
  const alts = new Map<string, Extract<DesignStep, { kind: 'alt' }>>();
  const branch = (scenario: { name: string; when?: string }, steps: DesignStep[]) => ({ name: scenario.name, ...(scenario.when ? { when: scenario.when } : {}), steps });
  for (const { name, description, steps, scenario } of useCases) {
    const alt = scenario && alts.get(name);
    if (alt) {
      let branchName = scenario.name;
      for (let n = 2; alt.branches.some((br) => br.name === branchName); n++) branchName = `${scenario.name} ${n}`;
      alt.branches.push(branch({ ...scenario, name: branchName }, steps));
      continue;
    }
    if (scenario && !alts.has(name) && useCases.filter((u) => u.name === name && u.scenario).length > 1) {
      const created: Extract<DesignStep, { kind: 'alt' }> = { kind: 'alt', branches: [branch(scenario, steps)] };
      alts.set(name, created);
      out.push({ name, ...(description ? { description } : {}), steps: [created] });
      continue;
    }
    out.push({ name, ...(description ? { description } : {}), steps });
  }
  return out;
}

/** Connections for the calls the use cases make that the architecture does not show. */
function connectSteps(b: Builder, steps: DesignStep[]) {
  for (const step of steps) {
    if (step.kind === 'par') connectSteps(b, step.steps);
    else if (step.kind === 'alt') step.branches.forEach((br) => connectSteps(b, br.steps));
    else if (step.arrow !== '-->' && step.from !== step.to && !b.connected(step.from, step.to)) b.edge(step.from, step.to, undefined);
  }
}

/**
 * Converts Mermaid source (one diagram, or Markdown with ```mermaid blocks)
 * to a Proschi document.
 */
export function fromMermaid(text: string): ImportResult {
  const b = new Builder();
  let sequences = 0;
  let read = 0;
  for (const block of blocks(text)) {
    const header = block.lines.findIndex((l) => l.text.trim() !== '' && !l.text.trim().startsWith('%%'));
    if (header < 0) continue;
    const { text: headerText, line } = block.lines[header];
    const [first, ...more] = statements(headerText.trim());
    b.design.title ??= block.title;
    const kind = /^(flowchart|graph)\b(?:\s+(TB|TD|BT|RL|LR))?\s*$/i.exec(first ?? '');
    if (kind) {
      read++;
      // Statements after `graph TD;` on the same line.
      const rest = { lines: [{ text: more.join(';'), line }, ...block.lines.slice(header + 1)], title: block.title };
      readFlowchart(rest, b, 0);
    } else if (/^sequenceDiagram\b/.test(first ?? '')) {
      read++;
      readSequence(block, b, header + 1, sequences++);
    } else {
      b.warn(line, `'${(first ?? '').split(/\s/)[0]}' diagrams are not supported; only flowchart, graph and sequenceDiagram are imported`);
    }
  }
  if (!read && !b.warnings.length) b.warn(undefined, 'No Mermaid diagram found; start with flowchart, graph or sequenceDiagram');
  b.design.useCases = mergeScenarios(b.design.useCases);
  b.design.title ??= b.design.useCases.length === 1 && !b.design.edges.length ? b.design.useCases[0].name : 'Imported from Mermaid';
  for (const useCase of b.design.useCases) connectSteps(b, useCase.steps);
  return { source: renderDesign(b.design), warnings: b.warnings };
}
