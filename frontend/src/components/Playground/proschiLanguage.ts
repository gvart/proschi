import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { componentCatalog } from '../../catalog/componentCatalog';
import { COLOR_NAMES } from '../../dsl/palette';
import { HTTP_METHODS, KINDS, builtinTypes, parse, typeKey, type Diagnostic, type Diagram, type ResolvedType } from '../../dsl';

interface LexState {
  inLabel: boolean;
  /** Open { / [ in a payload, so multi-line JSON stays highlighted as a label. */
  depth: number;
  /** Inside a traffic, requirements, capacity, entity, decision or test block, whose own words are keywords. */
  inSection: boolean;
  /** Inside the legend block, where palette names and dashes are words of their own. */
  inLegend?: boolean;
  /** Inside a `type Name { … }` block, whose property words are keywords. */
  inType?: boolean;
}

const KEYWORDS = /^(title|import|group|usecase|par|alt|pos|color|critical)\b/;
/** The palette of `color <name>` (dsl/palette.ts). */
const COLOR_NAME = new RegExp(`^(?:${COLOR_NAMES.join('|')})\\b`);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])/;
const LEGEND_HEADER = /^\s*legend\s*\{\s*(?:#.*)?$/;
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
/** `direction right`, `layout ordered`: layout hints, statements of their own (any other use of the words is a node id). */
const LAYOUT_HINT = /^\s*(?:direction\s+(?:down|right|up|left)|layout\s+ordered)\s*(?:#.*)?$/;
/** `let name = value`: a constant's definition (any other use of `let` is a node id). */
const LET_LINE = /^\s*let\s+[A-Za-z_]\w*\s*=/;
/** `$peak`, or `x$n` for replicas and multipliers: a constant's use. */
const CONSTANT = /^x?\$[A-Za-z_]\w*/;
/** `when` is a keyword only right after an alt name: `alt "Name" when "condition" {`. */
const AFTER_ALT_NAME = /^\s*(\}\s*)?alt\s+("(?:[^"\\]|\\.)*"|\w+)\s+$/;

const STRING = '"(?:[^"\\\\]|\\\\.)*"';
/** `[abstract] type Name [extends Parent] {`: a type header (docs/design/typed-components.md); elsewhere `type` is a node id. */
const TYPE_HEADER = /^\s*(?:abstract\s+)?type\s+(?:\[[^\]]*\]|[A-Za-z_]\w*)\s*(?:extends\s+(?:\[[^\]]*\]|[A-Za-z_]\w*)\s*)?\{/;
/** The words a type body line starts with. */
const TYPE_PROPERTIES = [
  'kind', 'op', 'status', 'header', 'protocol', 'icon', 'doc',
  'rps', 'readRps', 'writeRps', 'writeScaling', 'latencyMs', 'availability', 'costUsd', 'durable', 'consistency', 'bandwidthMBps', 'egressUsdPerGb',
];
const TYPE_WORD = new RegExp(`^(?:${TYPE_PROPERTIES.join('|')})\\b`);
/** A line that opens a section block, in the shapes the parser accepts. */
export const SECTION_HEADER = new RegExp(
  `^\\s*(?:(?:traffic|requirements|capacity)\\s*\\{|entity\\s+[A-Za-z_]\\w*\\b.*\\{|(?:decision|test|whatif)\\s+${STRING}.*\\{)\\s*(?:#.*)?$`,
);
/** `decision "…" because "…"`: a section statement without a block. */
export const ONE_LINE_DECISION = new RegExp(`^\\s*decision\\s+${STRING}\\s+because\\b`);
/** Words with a meaning inside section blocks (docs/HLD.md). */
const SECTION_WORDS =
  /^(traffic|requirements|capacity|entity|decision|test|whatif|fail|mix|peak|hit|group|errors|retries|drain|lag|durable|volatile|survive|because|rejected|calls|uses|sends|header|with|on|before|after|never|every|waits|for|starts|at|or|responds|writes|reads|responding|handles|failure|path|replicas|any|strong|eventual|store|in|scenario|latency|availability|cost|shards|consistency|bandwidth|egress|timeout|no|from|to|has|of|node|key|index|unique|optional|p50|p90|p95|p99|p999)\b/;
/** A number with an optional fraction and unit, attached or one space away: 120, 2.5, 50ms, 100k rps, 99.9 %. */
const QUANTITY = /^-?\d+(?:\.\d+)?(?:[A-Za-z]+(?:\/[A-Za-z]+)?|%)?(?: (?:rps|rpm|rpd|ms|s|usd\/month|usd\/GB|MB\/s|GB\/s)\b| %)?/;
/** `x200` (fan-out) and `~2MB` (payload size) at the start of a step label (§7.3). */
const LABEL_PREFIX = /^(?:x\d+|~\d+(?:\.\d+)?[KMGT]?B)(?=\s|$)/;
/** Everything after ':' so far is label prefixes, so another one may follow. */
const BEFORE_LABEL_PREFIX = /^[^:]*:\s*(?:(?:x\d+|~\d+(?:\.\d+)?[KMGT]?B)\s+)*$/;

/** Tokenizer behind the highlighting; exported for tests. */
export const proschiStreamParser: StreamParser<LexState> = {
  name: 'proschi',
  startState: () => ({ inLabel: false, depth: 0, inSection: false }),
  token(stream, state) {
    if (stream.sol() && state.depth <= 0) {
      state.inLabel = false;
      state.depth = 0;
      if (/^\s*\}/.test(stream.string)) state.inSection = state.inLegend = state.inType = false;
      else if (!state.inSection && TYPE_HEADER.test(stream.string)) state.inType = !/\}\s*(?:#.*)?$/.test(stream.string);
      else if (!state.inSection && SECTION_HEADER.test(stream.string)) state.inSection = true;
      else if (!state.inSection && LEGEND_HEADER.test(stream.string)) state.inSection = state.inLegend = true;
    }
    if (stream.eatSpace()) return null;
    // Section words count on header lines and inside the block; the one-line decision has its own.
    const sectionLine = state.inSection || ONE_LINE_DECISION.test(stream.string);

    const afterColor = !state.inLabel && /\bcolor\s+$/.test(stream.string.slice(0, stream.pos));
    // `color #3b82f6`: right after `color` a # is a hex color, not a comment.
    if (afterColor && stream.match(HEX_COLOR)) return 'atom';

    const afterSpace = stream.pos === 0 || /\s/.test(stream.string[stream.pos - 1]);
    if (stream.peek() === '#' && afterSpace && state.depth <= 0) {
      stream.skipToEnd();
      return 'comment';
    }

    if (state.inLabel) {
      if (state.depth <= 0) {
        if (BEFORE_LABEL_PREFIX.test(stream.string.slice(0, stream.pos)) && stream.match(LABEL_PREFIX)) return 'number';
        if (stream.match(HTTP_METHOD)) return 'keyword';
        if (stream.match(/^\/\S*/)) return 'link';
        // `GET /orders header Authorization, Idempotency-Key`: the headers the request sends.
        const label = stream.string.slice(0, stream.pos);
        if (/:\s*[A-Z]+\s+\S+\s+$/.test(label) && stream.match(/^header\b/)) return 'keyword';
        if (/:\s*[A-Z]+\s+\S+\s+header\s+(?:[\w-]+\s*,\s*)*$/.test(label) && stream.match(/^[\w-]+/)) return 'propertyName';
        if (stream.match(/^\d{3}\b/)) return 'number';
        if (stream.match(/^(json|xml|text)\b/)) return 'typeName';
      }
      const ch = stream.next();
      if (ch === '{' || ch === '[') state.depth++;
      else if (ch === '}' || ch === ']') state.depth--;
      return 'string';
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\[[^\]]*\]?/)) return 'typeName';
    if (stream.match(/^@[\w-]*/)) return 'attributeName';
    if (stream.match(/^(->>|-->|->|-x(?!\w))/)) return 'operator';
    if (stream.match(CONSTANT)) return 'atom';
    if (LET_LINE.test(stream.string)) {
      if (stream.pos === stream.string.search(/\S/) && stream.match(/^let\b/)) return 'keyword';
      if (stream.eat('=')) return 'operator';
    }
    const typeStyle = typeToken(stream, state);
    if (typeStyle) return typeStyle;
    if (stream.match(QUANTITY)) return 'number';
    if (stream.match(/^[<>]=?/)) return 'operator';
    if ((afterColor || (state.inLegend && stream.string.slice(0, stream.pos).trim())) && stream.match(COLOR_NAME)) return 'atom';
    if (state.inLegend && stream.match(/^(legend|dashed|dotted|color)\b/)) return 'keyword';
    if (!state.inLegend && sectionLine && stream.match(SECTION_WORDS)) return 'keyword';
    // `.planned`: a legend tag on a node, group or connection.
    if (stream.match(/^\.[A-Za-z_]\w*/)) return 'attributeName';
    // `x3` after a node id is its replica count.
    if (!sectionLine && stream.string.slice(0, stream.pos).trim() && stream.match(/^x\d+\b/)) return 'number';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (!state.inSection && LAYOUT_HINT.test(stream.string)) {
      if (stream.match(/^(direction|layout)\b/)) return 'keyword';
      if (stream.match(/^(down|right|up|left|ordered)\b/)) return 'atom';
    }
    // `rank 2`, `rank first`: a node or group part.
    const before = stream.string.slice(0, stream.pos);
    if (!sectionLine && before.trim() && stream.match(/^rank(?=\s+(?:\d+|first|last)\b)/)) return 'keyword';
    if (/\brank\s+$/.test(before) && stream.match(/^(first|last)\b/)) return 'atom';
    if (AFTER_ALT_NAME.test(stream.string.slice(0, stream.pos)) && stream.match(/^when\b/)) return 'keyword';
    if (stream.match(/^[A-Za-z_]\w*/)) return 'variableName';
    if (stream.eat(':')) {
      state.inLabel = true;
      return 'punctuation';
    }
    if (stream.match(/^[{}]/)) return 'brace';
    if (stream.eat(',')) return 'punctuation';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

/** A word of a type header or body: `abstract`, `type`, `extends`, the names, the property words and their values. */
function typeToken(stream: Parameters<StreamParser<LexState>['token']>[0], state: LexState): string | null {
  const header = TYPE_HEADER.test(stream.string);
  if (!header && !state.inType) return null;
  const before = stream.string.slice(0, stream.pos);
  if (header && /^\s*(?:abstract\s+)?$/.test(before) && stream.match(/^(?:abstract|type)\b/)) return 'keyword';
  if (header && /^\s*(?:abstract\s+)?type\s+\S+\s+$/.test(before) && stream.match(/^extends\b/)) return 'keyword';
  if (header && /(?:^\s*(?:abstract\s+)?type|\bextends)\s+$/.test(before) && stream.match(/^[A-Za-z_]\w*/)) return 'typeName';
  // A body line, or a one-line body after `{`.
  if ((state.inType ? /^\s*$/ : /\{\s*$/).test(before) && stream.match(TYPE_WORD)) return 'keyword';
  if (/(?:^|\{)\s*op\s+$/.test(before) && stream.match(/^(?:read|write|forward)\b/)) return 'keyword';
  if (/(?:^|\{)\s*op\s+(?:read|write|forward)\b/.test(before) && stream.match(/^(?:latency|cost)\b/)) return 'keyword';
  if (/(?:^|\{)\s*kind\s+$/.test(before) && stream.match(/^[A-Za-z_]\w*/)) return 'atom';
  if (/(?:^|\{)\s*(?:durable|consistency|writeScaling)\s+$/.test(before) && stream.match(/^[A-Za-z_]\w*/)) return 'atom';
  if (/(?:^|\{)\s*header\s+(?:[\w-]+\s*,\s*)*$/.test(before) && stream.match(/^[\w-]+/)) return 'propertyName';
  return null;
}

/** Syntax highlighting for Proschi documents. */
export const proschiLanguage = StreamLanguage.define(proschiStreamParser);

/** Inserts `tech` and closes the bracket unless it already is. */
const applyTech = (tech: string) => (view: EditorView, _completion: Completion, from: number, to: number) => {
  const closed = view.state.sliceDoc(to, to + 1) === ']';
  const insert = closed ? tech : `${tech}]`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 1 : 0) } });
};

/** Every catalog tech, and each alias (`S3`, `Postgres`) inserting the tech it stands for. */
const techOptions: Completion[] = componentCatalog.flatMap((c) => [
  { label: c.techStack, type: 'type', detail: c.category, apply: applyTech(c.techStack) },
  ...('aliases' in c ? c.aliases : []).map((alias: string) => ({ label: alias, type: 'type', detail: `→ ${c.techStack}`, boost: -1, apply: applyTech(c.techStack) })),
]);

const keywordOptions: Completion[] = [
  { label: 'title', type: 'keyword', apply: 'title "', detail: 'document title' },
  { label: 'import', type: 'keyword', apply: 'import "', detail: 'import "file.proschi"' },
  snippetCompletion('let ${name} = ${100 rps}', { label: 'let', type: 'keyword', detail: 'a constant, used as $name' }),
  snippetCompletion('type ${Name} extends ${Service} {\n\t${}\n}', { label: 'type', type: 'keyword', detail: 'type Name extends Parent { … }' }),
  snippetCompletion('abstract type ${Name} extends ${Service} {\n\t${}\n}', { label: 'abstract type', type: 'keyword', detail: 'a type only others extend' }),
  { label: 'group', type: 'keyword', detail: 'group id "Name" { … }' },
  { label: 'usecase', type: 'keyword', apply: 'usecase "', detail: 'usecase "Name" { … }' },
  { label: 'par', type: 'keyword', apply: 'par {', detail: 'parallel steps' },
  { label: 'alt', type: 'keyword', apply: 'alt "', detail: 'alt "Scenario" { … }' },
  snippetCompletion('legend {\n\t${tag} "${What it means}" ${blue}\n}', { label: 'legend', type: 'keyword', detail: 'styles that .tag applies' }),
  // Layout hints (docs/STYLING.md, "Steering the layout").
  snippetCompletion('direction ${right}', { label: 'direction', type: 'keyword', detail: 'down, right, up or left' }),
  { label: 'layout ordered', type: 'keyword', detail: 'edges follow declaration order' },
  // The high-level design sections, top level only.
  snippetCompletion('traffic {\n\t"${Use case}" ${100 rps}\n}', { label: 'traffic', type: 'keyword', detail: 'requests per use case' }),
  snippetCompletion('requirements {\n\tp99 < ${200ms}\n}', { label: 'requirements', type: 'keyword', detail: 'latency, availability, durability, cost' }),
  snippetCompletion('capacity {\n\t${node} ${1k rps}\n}', { label: 'capacity', type: 'keyword', detail: 'per-replica overrides' }),
  snippetCompletion('entity ${Name} in ${store} {\n\t${id} ${uuid} key\n}', { label: 'entity', type: 'keyword', detail: 'entity Name in store { fields }' }),
  snippetCompletion('decision "${Title}" {\n\tbecause "${reason}"\n}', { label: 'decision', type: 'keyword', detail: 'a trade-off and its reasons' }),
  snippetCompletion('test "${Name}" {\n\t${}\n}', { label: 'test', type: 'keyword', detail: 'flow assertions' }),
  snippetCompletion('whatif "${Name}" {\n\ttraffic "${Use case}" ${x3}\n}', { label: 'whatif', type: 'keyword', detail: 'traffic x3, fail node, node x4' }),
];

/** Assertion forms, offered at the start of a line inside a test block. */
const assertionOptions: Completion[] = [
  ['"${Use case}" calls ${node}', '"Use case" calls', 'some scenario calls it'],
  ['"${Use case}" never calls ${node}', '"Use case" never calls', 'no scenario calls it'],
  ['"${Use case}" every scenario calls ${node}', '"Use case" every scenario calls', 'every scenario calls it'],
  ['"${Use case}" calls ${node} before ${other}', '"Use case" calls … before …', 'first call before first call'],
  ['"${Use case}" calls ${node} after ${other}', '"Use case" calls … after …', 'last call after first call'],
  ['"${Use case}" never waits for ${node}', '"Use case" never waits for', 'no synchronous call before responding'],
  ['"${Use case}" writes ${node} before responding', '"Use case" writes … before responding', 'durable before the answer'],
  ['"${Use case}" calls ${node} with ${GET} ${/items/:id}','"Use case" calls … with', 'a request with this method and path'],
  ['"${Use case}" uses ${INSERT} on ${node}', '"Use case" uses … on', "a step names this operation of the node's type"],
  ['"${Use case}" uses ${INSERT} on ${node} before responding', '"Use case" uses … on … before responding', 'that operation before the answer'],
  ['"${Use case}" never uses ${Scan} on ${node}', '"Use case" never uses … on', 'no step names this operation'],
  ['"${Use case}" sends header ${Authorization} to ${node}', '"Use case" sends header … to', 'a request names this header'],
  ['"${Use case}" responds ${status}', '"Use case" responds', 'status of the entry response'],
  ['"${Use case}" starts at ${node}', '"Use case" starts at', 'who sends the entry request'],
  ['"${Use case}" has scenario "${Scenario}"', '"Use case" has scenario', 'the scenario exists'],
  ['"${Use case}" handles failure of ${node}', '"Use case" handles failure of', 'a scenario survives it failing'],
  ['${node} calls ${other}', 'node calls node', 'some step is sent from one to the other'],
  ['${node} never calls ${other}', 'node never calls node', 'no step is sent from one to the other'],
  ['in "${Use case}" ${node} calls ${other}', 'in "Use case" node calls node', 'sent within one use case'],
  ['no path from ${node} to ${other}', 'no path from … to …', 'no chain of connections'],
  ['${node} has replicas >= ${min}', 'node has replicas >=', 'minimum replica count'],
].map(([template, label, detail]) => snippetCompletion(template, { label, type: 'keyword', detail }));

/**
 * The diagram of a document, parsed once per version of it, for what completion needs of its types,
 * when the editor's page gives it no parse of its own (one without imports).
 */
const diagrams = new WeakMap<Text, Diagram>();
function diagramOf(doc: Text): Diagram {
  let diagram = diagrams.get(doc);
  if (!diagram) diagrams.set(doc, (diagram = parse(doc.toString()).diagram));
  return diagram;
}

/** A type name as written outside brackets: bare when it is a word, else in brackets. */
const bareTypeName = (name: string) => (/^[A-Za-z_]\w*$/.test(name) ? name : `[${name}]`);

/** The document's types (its imports' too), then the built-in ones (abstract marked, the doc as detail); `apply` inserts a name. */
function typeOptions(diagram: Diagram, apply: (name: string) => Completion['apply']): Completion[] {
  const builtin = [...builtinTypes().values()];
  return [...(diagram.types ?? []), ...builtin].map((t: ResolvedType) => ({
    label: t.name,
    type: 'class',
    detail: [t.abstract ? 'abstract' : '', t.doc ?? `extends ${t.parents[0] ?? 'nothing'}`].filter(Boolean).join(' · '),
    info: [t.name, ...t.parents].join(' → '),
    apply: apply(t.name),
    boost: 1,
  }));
}

/** Catalog techs no built-in type is named after, with their aliases. */
const untypedTechOptions = () => {
  const typed = new Set([...builtinTypes().values()].map((t) => typeKey(t.name)));
  // Aliases (boost -1) stay: `Postgres` still inserts the tech it stands for.
  return techOptions.filter((o) => o.boost === -1 || !typed.has(typeKey(o.label)));
};

/** The type-body lines: a property at the start, a kind after `kind`, read or write after `op`. */
const typeBodyOptions: Completion[] = TYPE_PROPERTIES.map((label) => ({ label, type: 'keyword', detail: 'type property' }));

/**
 * The open blocks around line `number` (1-based), outermost first, each as
 * the text of its opening line. Strings, labels and payloads are skipped.
 */
function openBlocks(doc: Text, number: number): string[] {
  const stack: string[] = [];
  let payload = 0;
  const count = (text: string, open: string, close: string, on: (opened: boolean) => void) => {
    for (const ch of text) if (open.includes(ch)) on(true);
    else if (close.includes(ch)) on(false);
  };
  for (let n = 1; n < number; n++) {
    const text = doc.line(n).text;
    if (payload > 0) {
      count(text, '{[', '}]', (o) => (payload = Math.max(0, payload + (o ? 1 : -1))));
      continue;
    }
    const code = text.replace(/"(?:[^"\\]|\\.)*"?/g, '""').replace(/(?:^|\s)#.*$/, '');
    const colon = code.indexOf(':');
    count(colon < 0 ? code : code.slice(0, colon), '{', '}', (o) => (o ? stack.push(text) : stack.pop()));
    if (colon >= 0) count(code.slice(colon + 1), '{[', '}]', (o) => (payload = Math.max(0, payload + (o ? 1 : -1))));
  }
  return stack;
}

/** `a -> b : label`: the step's nodes, arrow and its label so far. */
const STEP = /^\s*(?:\}\s*)?([A-Za-z_]\w*)\s*(->>|-->|->|-x)\s*([A-Za-z_]\w*)\s*:\s*(.*)$/;

/**
 * In a use case step's label: the target type's operations (and the HTTP
 * methods, for an HTTP type), the sender type's statuses on a response, and
 * the target's headers after `METHOD /path header`.
 */
function stepOptions(diagram: () => Diagram, doc: Text, before: string, pos: number, lineNumber: number): CompletionResult | null {
  const m = STEP.exec(before);
  if (!m || !openBlocks(doc, lineNumber).some((b) => /^\s*usecase\b/.test(b))) return null;
  const [, from, arrow, to, label] = m;
  const typeOf = (id: string) => diagram().nodes.find((n) => n.id === id)?.resolvedType;
  if (arrow === '-->') {
    const t = typeOf(from);
    if (!t || !/^\d*$/.test(label)) return null;
    return { from: pos - label.length, options: t.statuses.map((s) => ({ label: String(s), type: 'constant', detail: `status of ${t.name}` })), validFor: /^\d*$/ };
  }
  const t = typeOf(to);
  if (!t) return null;
  const headers = /^([A-Z]+)\s+\S+\s+header\s+((?:[\w-]+\s*,\s*)*)([\w-]*)$/.exec(label);
  if (headers && HTTP_METHODS.includes(headers[1])) {
    const used = new Set(headers[2].split(',').map((h) => h.trim().toLowerCase()));
    const options = t.headers.filter((h) => !used.has(h.toLowerCase())).map((h) => ({ label: h, type: 'property', detail: `header of ${t.name}` }));
    return { from: pos - headers[3].length, options, validFor: /^[\w-]*$/ };
  }
  const afterPath = /^([A-Z]+)\s+\S+\s+(\w*)$/.exec(label);
  if (afterPath && HTTP_METHODS.includes(afterPath[1]) && t.headers.length) {
    return { from: pos - afterPath[2].length, options: [{ label: 'header', type: 'keyword', apply: 'header ', detail: t.headers.join(', ') }], validFor: /^\w*$/ };
  }
  if (!/^\w*$/.test(label)) return null;
  const ops: Completion[] = t.ops.map((o) => ({ label: o.name, type: 'method', detail: `${o.access} · ${t.name}`, info: t.doc }));
  const http = t.protocol?.toUpperCase() === 'HTTP' ? HTTP_METHODS.filter((h) => !t.ops.some((o) => o.name === h)) : [];
  const options = [...ops, ...http.map((h) => ({ label: h, type: 'method', detail: `HTTP method · ${t.name}` }))];
  return options.length ? { from: pos - label.length, options, validFor: /^\w*$/ } : null;
}

/** True when line `number` (1-based) is inside a `test "…" {` block. */
function inTestBlock(doc: Text, number: number): boolean {
  for (let n = number - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (/^\s*\}/.test(text)) return false;
    if (/\{\s*(?:#.*)?$/.test(text)) return /^\s*test\s+"/.test(text);
  }
  return false;
}

/** A tech the editor offers inside [ ], when a page narrows the catalog (the Arcade offers only what the player may place). */
export interface TechChoice {
  tech: string;
  /** Shown next to it, e.g. the game's name for the component. */
  detail?: string;
}

/**
 * Completes tech stacks inside [ ] and node ids / keywords elsewhere; `getTechs` narrows the techs offered when it returns a list.
 * `getDiagram` is the page's own parse of the document, with its imports resolved (a practice problem's given, other
 * diagrams), so their types and nodes are offered too; without one, completion parses the document alone.
 */
export function proschiCompletions(getNodeIds: () => string[], getTechs?: () => readonly TechChoice[] | undefined, getDiagram?: () => Diagram | undefined) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const diagram = () => getDiagram?.() ?? diagramOf(ctx.state.doc);
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);

    const tech = before.match(/\[([^\]]*)$/);
    if (tech) {
      const only = getTechs?.();
      const options = only ? only.map((t) => ({ label: t.tech, type: 'type', detail: t.detail, apply: applyTech(t.tech) })) : [...typeOptions(diagram(), applyTech), ...untypedTechOptions()];
      return { from: ctx.pos - tech[1].length, options, validFor: /^[\w ./-]*$/ };
    }
    const parent = before.match(/^\s*(?:abstract\s+)?type\s+(?:\[[^\]]*\]|\w+)\s+extends\s+(\w*)$/);
    if (parent) return { from: ctx.pos - parent[1].length, options: typeOptions(diagram(), bareTypeName), validFor: /^\w*$/ };

    const step = stepOptions(diagram, ctx.state.doc, before, ctx.pos, line.number);
    if (step) return step;
    // Other labels after ':' are free text.
    if (/^[^"#]*:/.test(before)) return null;

    const word = ctx.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !ctx.explicit) return null;
    const from = word?.from ?? ctx.pos;
    const atLineStart = before.slice(0, from - line.from).trim() === '';
    // `when` is only valid right after an alt name: alt "Not found" when "…" {
    if (/^\s*(\}\s*)?alt\s+"[^"]*"\s+$/.test(before.slice(0, from - line.from))) {
      return { from, options: [{ label: 'when', type: 'keyword', apply: 'when "', detail: 'condition of this scenario' }], validFor: /^\w*$/ };
    }

    const head = before.slice(0, from - line.from);
    const blocks = openBlocks(ctx.state.doc, line.number);
    if (blocks.length && /^\s*(?:abstract\s+)?type\b/.test(blocks[blocks.length - 1])) {
      if (atLineStart) return { from, options: typeBodyOptions, validFor: /^\w*$/ };
      if (/^\s*kind\s+$/.test(head)) return { from, options: KINDS.map((k) => ({ label: k, type: 'enum' })), validFor: /^\w*$/ };
      if (/^\s*op\s+$/.test(head)) return { from, options: ['read', 'write', 'forward'].map((label) => ({ label, type: 'keyword' })), validFor: /^\w*$/ };
      return null;
    }

    const ids: Completion[] = getNodeIds().map((id) => ({ label: id, type: 'variable' }));
    const inTest = inTestBlock(ctx.state.doc, line.number);
    if (atLineStart && inTest) return { from, options: [...assertionOptions, ...ids], validFor: /^\w*$/ };
    // `uses INSERT on db`, `sends header Authorization to api`: what the diagram's node types offer.
    if (inTest && /\b(?:uses|sends\s+header)\s+$/.test(head)) {
      const types = [...new Map(diagram().nodes.flatMap((n) => (n.resolvedType ? [[n.resolvedType.name, n.resolvedType] as const] : []))).values()];
      const names = /\buses\s+$/.test(head)
        ? types.flatMap((t) => t.ops.map((o) => ({ label: o.name, type: 'function', detail: `${o.access} · ${t.name}` })))
        : types.flatMap((t) => t.headers.map((h) => ({ label: h, type: 'property', detail: t.name })));
      const unique = [...new Map(names.map((o) => [o.label.toLowerCase(), o])).values()];
      return { from, options: unique, validFor: /^[\w-]*$/ };
    }
    return { from, options: atLineStart ? [...keywordOptions, ...ids] : ids, validFor: /^\w*$/ };
  };
}

/** Maps parser diagnostics (1-based line/col) onto document offsets. */
export function toCmDiagnostics(diagnostics: Diagnostic[], doc: Text): CmDiagnostic[] {
  return diagnostics
    .filter((d) => d.line <= doc.lines)
    .map((d) => {
      const line = doc.line(d.line);
      const from = Math.min(line.from + d.col - 1, line.to);
      const to = Math.min(from + Math.max(d.length, 1), line.to);
      return { from, to: Math.max(to, from), severity: d.severity, message: d.message };
    });
}
