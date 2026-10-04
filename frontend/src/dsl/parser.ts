import type { ComponentType, TechName, TechStack } from '../types/canvas';
import { findTech, suggestTech } from '../catalog/componentCatalog';
import { BracketCounter, tokenizeLine, type Token } from './lexer';
import { endpointGroupKey } from './paths';
import { DATA_STORE_KINDS, KINDS, TYPE_OF_KIND, isDataStore, isKind, kindFromName, kindOf } from './kinds';
import { parseQuantity } from './quantity';
import { accessOf } from './access';
import type {
  FlowStep,
  Protocol,
  Assertion,
  CapacityOverride,
  Decision,
  Diagnostic,
  Diagram,
  DiagramEdge,
  DiagramImport,
  DiagramNode,
  DiagramScenario,
  DiagramStep,
  DiagramUseCase,
  Entity,
  FlowTest,
  Kind,
  ParseOptions,
  ParseResult,
  Percentile,
  Quantity,
  Requirement,
  ResolvedImport,
  Selector,
  SourceLoc,
  TrafficEntry,
} from './types';

type Arrow = '->' | '->>' | '-->' | '-x';

interface RawStep {
  from: string;
  to: string;
  arrow: Arrow;
  label: string;
  parallelGroup?: number;
  /** `x200` at the start of the label (§7.3). */
  multiplier?: number;
  /** `~2MB` at the start of the label, in bytes (§7.3). */
  sizeBytes?: number;
  loc: SourceLoc;
}

/** A use case body: steps, and sets of `alt` branches that split it into scenarios. */
type Item = { kind: 'step'; step: RawStep } | { kind: 'alt'; branches: Branch[] };

interface Branch {
  name: string;
  condition?: string;
  items: Item[];
  loc: SourceLoc;
}

/** A use case body or an alt branch: anything that holds steps. */
interface Container {
  items: Item[];
  /** The alt set closed last, while no step has followed it; a new `alt` joins it. */
  openAlt?: Item & { kind: 'alt' };
}

interface Reference {
  id: string;
  loc: SourceLoc;
}

type Frame =
  | { kind: 'group'; id: string; loc: SourceLoc }
  | { kind: 'usecase'; useCase: DiagramUseCase; body: Container; parCount: number; loc: SourceLoc }
  | { kind: 'alt'; name: string; body: Container; owner: Container; set: Item & { kind: 'alt' }; loc: SourceLoc }
  | { kind: 'par'; group: number; loc: SourceLoc }
  | SectionFrame;

/** The top-level blocks of docs/design/hld-and-practice.md §1, whose lines are read by their own rules. */
type Section = 'traffic' | 'requirements' | 'capacity' | 'entity' | 'decision' | 'test';

interface SectionFrame {
  kind: 'section';
  section: Section;
  /** Misplaced or with a broken header: its lines are skipped so they are not read as nodes. */
  discard?: boolean;
  /** What a skipped block was, for "Missing } to close …" (an alt nested too deep). */
  skipped?: string;
  /** Blocks open inside a skipped alt. */
  nested?: number;
  entity?: Entity;
  decision?: Decision;
  test?: FlowTest;
  loc: SourceLoc;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const DEFAULT_TECH: TechStack = 'Rectangle';
const DEFAULT_GROUP_TECH: TechStack = 'Logical Group';
/** Nested or repeated alt sets multiply; past this many scenarios the rest are dropped. */
export const MAX_SCENARIOS = 32;
/**
 * How deep alt blocks may nest. Deeper ones are skipped with an error: they
 * could add nothing past MAX_SCENARIOS, and unbounded nesting made parsing
 * quadratic (a crafted share link could freeze the tab).
 */
export const MAX_ALT_DEPTH = 16;
/** `x3` on a node declaration: its replica count. */
const REPLICAS = /^x(\d+)$/;
const PERCENTILES: Record<string, Percentile> = { p50: 50, p90: 90, p95: 95, p99: 99, p999: 99.9 };
const FIELD_FLAGS = ['key', 'index', 'unique', 'optional'];
const UNIT_EXAMPLES: Record<Quantity['unit'], string> = {
  rps: 'a rate, e.g. 100k rps, 6k rpm or 1m rpd',
  ms: 'a duration, e.g. 50ms or 1.5s',
  '%': 'a percentage, e.g. 99.9%',
  'usd/month': 'a monthly cost, e.g. 400 usd/month',
  MBps: 'a bandwidth, e.g. 500 MB/s or 1 GB/s',
  'usd/GB': 'a price per gigabyte, e.g. 0.05 usd/GB',
};
const CAPACITY_PARTS = 'a rate, reads, writes, shards, latency, availability, cost, durable or volatile, consistency, bandwidth or egress';
const ASSERTION_HELP =
  'Expected an assertion: "Use case" calls <node>, "Use case" writes <node> before responding, <node> calls <node>, no path from <node> to <node>, <node> has replicas >= 2, …';
const ASSERTION_VERBS = 'calls, every scenario calls, never calls, never waits for, writes, responds, starts at, has scenario or handles failure of';

/** The generic catalog tech of each kind, named in the warning about an unknown tech. */
const GENERIC_TECH: Record<Kind, string> = {
  client: 'Actor',
  edge: 'WAF',
  cdn: 'CDN',
  loadbalancer: 'Load Balancer',
  gateway: 'API Gateway',
  dns: 'DNS',
  service: 'Service',
  function: 'Function',
  cache: 'Cache',
  database: 'Database',
  search: 'Search Engine',
  analytics: 'Data Warehouse',
  queue: 'Message Queue',
  storage: 'Object Storage',
  external: 'Third Party API',
  other: 'Note',
};

/**
 * `Unknown tech stack 'Postgress'. Did you mean 'PostgreSQL'? Until then it is
 * simulated as a generic database, like [Database]`. The language server's
 * quick fix reads the suggestion back with `DID_YOU_MEAN`.
 */
export function unknownTechMessage(tech: string, kind: Kind, suggestion?: string): string {
  const simulated = `simulated as a generic ${kind}${suggestion === GENERIC_TECH[kind] ? '' : `, like [${GENERIC_TECH[kind]}]`}`;
  return suggestion ? `Unknown tech stack '${tech}'. Did you mean '${suggestion}'? Until then it is ${simulated}` : `Unknown tech stack '${tech}'; ${simulated}`;
}

/** Reads the suggestion out of an unknown-tech warning. */
export const DID_YOU_MEAN = /^Unknown tech stack '(.*)'\. Did you mean '([^']+)'\?/;

/**
 * Parses Proschi source text into a diagram. Parsing never throws: problems are
 * reported as diagnostics and the rest of the document is still returned, so an
 * editor can keep rendering while the user types.
 *
 * `import` statements are followed through `options.resolve`; everything the
 * imported files declare becomes part of the diagram, and their problems are
 * reported with the file's path in `file`.
 */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  return new Parser(source, options).run();
}

class Parser {
  // Per-file state, swapped while an imported file is read.
  private lines: string[];
  /** Path of the imported file being read; undefined for the root document. */
  private file?: string;
  private stack: Frame[] = [];

  private readonly diagnostics: Diagnostic[] = [];
  /** Warnings reported so far (see `warning`). */
  private readonly warned = new Set<string>();
  private readonly nodes = new Map<string, DiagramNode>();
  private readonly edges: DiagramEdge[] = [];
  /** Connections so far per `from->to`, for the ids of repeated ones. */
  private readonly edgeCount = new Map<string, number>();
  private readonly useCases: { useCase: DiagramUseCase; body: Container }[] = [];
  private readonly references: Reference[] = [];
  private readonly imports: DiagramImport[] = [];
  /** Files read so far, so a file imported along several paths is included once. */
  private readonly included = new Set<string>();
  /** Files being read, outermost first, to find import cycles. */
  private readonly chain: (string | undefined)[];
  /** Diagnostics are sorted by file in the order the files were first read, the root first. */
  private readonly fileOrder = new Map<string | undefined, number>([[undefined, 0]]);
  /** `a|b` for every connection, both directions; filled before use cases are built. */
  private readonly connected = new Set<string>();
  private title?: string;
  private summary?: string;
  private readonly traffic: TrafficEntry[] = [];
  private readonly requirements: Requirement[] = [];
  private readonly capacity: CapacityOverride[] = [];
  private readonly entities: Entity[] = [];
  private readonly decisions: Decision[] = [];
  private readonly tests: FlowTest[] = [];
  /** Checks of use case, scenario and node names, run once every file is read and use cases are built. */
  private readonly deferred: (() => void)[] = [];
  private built: DiagramUseCase[] = [];
  private readonly options: ParseOptions;

  constructor(source: string, options: ParseOptions) {
    this.options = options;
    this.lines = source.split('\n');
    this.chain = [options.path];
    if (options.path !== undefined) this.included.add(options.path);
  }

  run(): ParseResult {
    // Implicit nodes are created only once every file is read, so a use case
    // file may refer to nodes its imports declare.
    this.parseFile();
    this.createImplicitNodes();
    // Connections from every file count, so a use case file may rely on its imports' connections.
    for (const e of this.edges) this.connected.add(`${e.source}|${e.target}`).add(`${e.target}|${e.source}`);

    const useCases = this.useCases.map(({ useCase, body }) => this.buildUseCase(useCase, body));
    const endpoints = useCases.flatMap((u) => (u.endpoint ? [u.endpoint] : []));
    for (const u of useCases) if (u.endpoint) u.endpointGroup = endpointGroupKey(u.endpoint, endpoints);
    this.built = useCases;
    for (const check of this.deferred) check();

    const diagram: Diagram = {
      title: this.title,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      useCases,
      // The HLD sections are left out when a document has none, so older documents parse exactly as before.
      ...(this.summary !== undefined ? { summary: this.summary } : {}),
      ...(this.traffic.length ? { traffic: this.traffic } : {}),
      ...(this.requirements.length ? { requirements: this.requirements } : {}),
      ...(this.capacity.length ? { capacity: this.capacity } : {}),
      ...(this.entities.length ? { entities: this.entities } : {}),
      ...(this.decisions.length ? { decisions: this.decisions } : {}),
      ...(this.tests.length ? { tests: this.tests } : {}),
    };

    const order = (d: Diagnostic) => this.fileOrder.get(d.file) ?? 0;
    this.diagnostics.sort((a, b) => order(a) - order(b) || a.line - b.line || a.col - b.col);
    return { diagram, diagnostics: this.diagnostics, ...(this.imports.length ? { imports: this.imports } : {}) };
  }

  /** Reads the current file's lines and reports blocks it leaves open. */
  private parseFile() {
    for (let i = 0; i < this.lines.length; i++) {
      i = this.parseLine(i);
    }

    for (const frame of this.stack) {
      const what =
        frame.kind === 'group'
          ? `group '${frame.id}'`
          : frame.kind === 'usecase'
            ? `usecase '${frame.useCase.name}'`
            : frame.kind === 'alt'
              ? `alt '${frame.name}'`
              : frame.kind === 'par'
                ? 'par block'
                : sectionName(frame);
      this.error(`Missing } to close ${what}`, frame.loc);
    }
  }

  /** Parses the line at `index` and returns the index of the last line it consumed. */
  private parseLine(index: number): number {
    const line = index + 1;
    const { tokens, diagnostics } = tokenizeLine(this.lines[index], line);
    this.diagnostics.push(...diagnostics.map((d) => ({ ...d, ...this.fileField() })));
    // A line the lexer could not read is skipped rather than half-interpreted.
    if (tokens.length === 0 || diagnostics.some((d) => d.severity === 'error')) return index;

    const [first, second, third] = tokens;
    const loc = (t: Token): SourceLoc => this.locOf(t, line);

    // Inside traffic, requirements, … every line follows the block's own rules.
    const top = this.top();
    if (top?.kind === 'section') {
      if (top.skipped !== undefined) {
        // A skipped alt: follow its inner blocks so its own `}` ends it.
        const opens = tokens[tokens.length - 1].kind === 'lbrace';
        if (first.kind !== 'rbrace') top.nested = (top.nested ?? 0) + (opens ? 1 : 0);
        else if (top.nested) top.nested += opens ? 0 : -1;
        else {
          this.stack.pop();
          if (second?.kind === 'ident' && second.value === 'alt') this.parseAlt(tokens.slice(1), line);
          else if (second) this.error('Unexpected input after }', loc(second));
        }
        return index;
      }
      if (first.kind === 'rbrace') {
        this.stack.pop();
        if (!top.discard) this.closeSection(top);
        if (second) this.error('Unexpected input after }', loc(second));
      } else if (!top.discard) {
        this.parseSectionLine(top, tokens, line);
      }
      return index;
    }

    if (first.kind === 'rbrace') {
      if (this.stack.length === 0) this.error('Unmatched }', loc(first));
      else this.closeFrame();
      // `} alt "Next" {` closes one branch and opens the next on the same line.
      if (second?.kind === 'ident' && second.value === 'alt') this.parseAlt(tokens.slice(1), line);
      else if (second) this.error('Unexpected input after }', loc(second));
      return index;
    }

    if (first.kind === 'ident' && second?.kind === 'arrow') {
      return this.parseConnection(tokens, index);
    }

    if (first.kind !== 'ident') {
      this.error('Expected a node, connection, group or usecase', loc(first));
      return index;
    }

    switch (first.value) {
      case 'title':
        this.parseTitle(tokens, line);
        break;
      case 'group':
        this.parseGroup(tokens, line);
        break;
      case 'usecase':
        this.parseUseCase(tokens, line);
        break;
      case 'par':
        this.parsePar(tokens, line);
        break;
      case 'alt':
        this.parseAlt(tokens, line);
        break;
      case 'import':
        this.parseImport(tokens, line);
        break;
      // These words are keywords only in the shape of their statement, so older documents may still use them as ids.
      case 'traffic':
      case 'requirements':
      case 'capacity':
        if (second?.kind === 'lbrace') this.openSection(first.value, tokens, line);
        else this.parseNode(tokens, line);
        break;
      case 'entity':
        if (second?.kind === 'ident' && second.value !== 'pos' && !REPLICAS.test(second.value)) this.parseEntity(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case 'decision':
        if (second?.kind === 'string' && (third?.kind === 'lbrace' || (third?.kind === 'ident' && third.value !== 'pos' && !REPLICAS.test(third.value))))
          this.parseDecision(tokens, line);
        else this.parseNode(tokens, line);
        break;
      case 'test':
        if (second?.kind === 'string' && tokens[tokens.length - 1].kind === 'lbrace') this.parseTest(tokens, line);
        else this.parseNode(tokens, line);
        break;
      default:
        this.parseNode(tokens, line);
    }
    return index;
  }

  private parseTitle(tokens: Token[], line: number) {
    const value = tokens[1];
    if (!value || (value.kind !== 'string' && value.kind !== 'ident')) {
      this.error('Expected a title, e.g. title "My System"', this.locOf(tokens[0], line));
      return;
    }
    const summary = tokens[2]?.kind === 'string' ? tokens[2] : undefined;
    // The root document names the diagram; titles of imported files are ignored.
    if (this.file === undefined) {
      this.title = value.value;
      if (summary) this.summary = summary.value;
    }
    this.expectEnd(tokens, summary ? 3 : 2, line);
  }

  private parseImport(tokens: Token[], line: number) {
    const keyword = tokens[0];
    if (this.stack.length > 0) {
      this.error('import is only allowed at the top level', this.locOf(keyword, line));
      return;
    }
    const pathToken = tokens[1];
    if (pathToken?.kind !== 'string' || !pathToken.value.trim()) {
      this.error('Expected a file path, e.g. import "infra.proschi"', this.locOf(pathToken ?? keyword, line));
      return;
    }
    this.expectEnd(tokens, 2, line);

    const path = pathToken.value;
    const loc = this.locOf(pathToken, line);
    const entry: DiagramImport = { path, loc };
    this.imports.push(entry);

    const { resolve } = this.options;
    if (!resolve) {
      this.warning(`Imports are not resolved in this context; '${path}' was not loaded`, loc);
      return;
    }
    let target: ResolvedImport | undefined;
    try {
      target = resolve(path, this.file ?? this.options.path);
    } catch {
      target = undefined;
    }
    if (!target) {
      this.error(`Cannot find '${path}'`, loc);
      return;
    }
    entry.resolved = target.path;

    const cycleStart = this.chain.indexOf(target.path);
    if (cycleStart !== -1) {
      const names = [...this.chain.slice(cycleStart), target.path].map((p) => fileName(p ?? ''));
      this.error(`Import cycle: ${names.join(' → ')}`, loc);
      return;
    }
    if (this.included.has(target.path)) return;
    this.included.add(target.path);
    this.fileOrder.set(target.path, this.fileOrder.size);

    // The imported file gets its own lines and block stack; what it declares is shared.
    const outer = { lines: this.lines, file: this.file, stack: this.stack };
    this.lines = target.source.split('\n');
    this.file = target.path;
    this.stack = [];
    this.chain.push(target.path);
    this.parseFile();
    this.chain.pop();
    ({ lines: this.lines, file: this.file, stack: this.stack } = outer);
  }

  private parseGroup(tokens: Token[], line: number) {
    const keyword = tokens[0];
    const top = this.top();
    if (top && top.kind !== 'group') {
      this.error('Groups cannot be declared inside a usecase', this.locOf(keyword, line));
      return;
    }

    const idToken = tokens[1];
    if (idToken?.kind !== 'ident') {
      this.error('Expected a group id, e.g. group vpc "AWS VPC" {', this.locOf(keyword, line));
      return;
    }

    let i = 2;
    let name = idToken.value;
    let techStack: TechStack = DEFAULT_GROUP_TECH;
    if (tokens[i]?.kind === 'string') name = tokens[i++].value;
    if (tokens[i]?.kind === 'tech') {
      const tech = tokens[i++];
      const resolved = findTech(tech.value);
      if (resolved?.type === 'group') techStack = resolved.techStack;
      else this.warning(`'${tech.value}' is not a group style; using ${DEFAULT_GROUP_TECH}`, this.locOf(tech, line));
    }
    let position: { x: number; y: number } | undefined;
    if (tokens[i]?.kind === 'ident' && tokens[i].value === 'pos') {
      const [x, comma, y] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
      if (x?.kind !== 'number' || comma?.kind !== 'comma' || y?.kind !== 'number') {
        this.error('Expected pos x,y', this.locOf(tokens[i], line));
        return;
      }
      position = { x: Number(x.value), y: Number(y.value) };
      i += 4;
    }

    if (tokens[i]?.kind !== 'lbrace') {
      this.error('Expected { after group header', this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);

    const loc = this.locOf(idToken, line);
    this.addNode({ id: idToken.value, kind: 'group', name, type: 'group', techStack, parent: this.currentGroup(), position, loc });
    this.stack.push({ kind: 'group', id: idToken.value, loc });
  }

  private parseUseCase(tokens: Token[], line: number) {
    const keyword = tokens[0];
    if (this.stack.length > 0) {
      this.error('A usecase must be declared at the top level', this.locOf(keyword, line));
      return;
    }

    const nameToken = tokens[1];
    if (nameToken?.kind !== 'string' && nameToken?.kind !== 'ident') {
      this.error('Expected a usecase name, e.g. usecase "Place order" {', this.locOf(keyword, line));
      return;
    }

    let i = 2;
    let description: string | undefined;
    if (tokens[i]?.kind === 'string') description = tokens[i++].value;
    if (tokens[i]?.kind !== 'lbrace') {
      this.error('Expected { after usecase name', this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);

    const loc = this.locOf(nameToken, line);
    const useCase: DiagramUseCase = { id: this.useCaseId(nameToken.value), name: nameToken.value, description, steps: [], scenarios: [], loc };
    const frame: Frame = { kind: 'usecase', useCase, body: { items: [] }, parCount: 0, loc };
    this.useCases.push({ useCase, body: frame.body });
    this.stack.push(frame);
  }

  private parseAlt(tokens: Token[], line: number) {
    const keyword = tokens[0];
    const top = this.top();
    if (top?.kind !== 'usecase' && top?.kind !== 'alt') {
      this.error(top?.kind === 'par' ? 'alt blocks cannot be inside a par block' : 'alt is only allowed inside a usecase', this.locOf(keyword, line));
      return;
    }

    const nameToken = tokens[1];
    if (nameToken?.kind !== 'string' && nameToken?.kind !== 'ident') {
      this.error('Expected a scenario name, e.g. alt "Not found" {', this.locOf(keyword, line));
      return;
    }
    let i = 2;
    let condition: string | undefined;
    // `when` is only a keyword here, between the alt name and its condition.
    if (tokens[i]?.kind === 'ident' && tokens[i].value === 'when') {
      const conditionToken = tokens[i + 1];
      if (conditionToken?.kind !== 'string') {
        this.error('Expected a condition after when, e.g. alt "Not found" when "the order does not exist" {', this.locOf(conditionToken ?? tokens[i], line));
        return;
      }
      condition = conditionToken.value.trim() || undefined;
      i += 2;
    }
    if (tokens[i]?.kind !== 'lbrace') {
      this.error(i === 2 ? 'Expected { after alt name' : 'Expected { after the alt condition', this.locOf(tokens[i] ?? tokens[i - 1], line));
      return;
    }
    this.expectEnd(tokens, i + 1, line);

    if (this.stack.filter((f) => f.kind === 'alt').length >= MAX_ALT_DEPTH) {
      const loc = this.locOf(keyword, line);
      this.error(`alt blocks can nest at most ${MAX_ALT_DEPTH} deep; this one is skipped`, loc);
      this.stack.push({ kind: 'section', section: 'test', discard: true, skipped: `alt '${nameToken.value}'`, loc });
      return;
    }

    // Alt blocks that follow each other directly are alternatives to one another.
    const owner = top.body;
    let set = owner.openAlt;
    if (!set) {
      set = { kind: 'alt', branches: [] };
      owner.items.push(set);
    }
    const loc = this.locOf(nameToken, line);
    if (set.branches.some((b) => b.name === nameToken.value)) this.warning(`Duplicate alt name '${nameToken.value}'`, loc);
    const body: Container = { items: [] };
    set.branches.push({ name: nameToken.value, condition, items: body.items, loc });
    owner.openAlt = undefined;
    this.stack.push({ kind: 'alt', name: nameToken.value, body, owner, set, loc });
  }

  private closeFrame() {
    const frame = this.stack.pop();
    if (frame?.kind === 'alt') frame.owner.openAlt = frame.set;
  }

  private parsePar(tokens: Token[], line: number) {
    const keyword = tokens[0];
    const top = this.top();
    if (top?.kind !== 'usecase' && top?.kind !== 'alt') {
      this.error(top?.kind === 'par' ? 'par blocks cannot be nested' : 'par is only allowed inside a usecase', this.locOf(keyword, line));
      return;
    }
    if (tokens[1]?.kind !== 'lbrace') {
      this.error('Expected { after par', this.locOf(tokens[1] ?? keyword, line));
      return;
    }
    this.expectEnd(tokens, 2, line);
    top.body.openAlt = undefined;
    const useCase = this.currentUseCase()!;
    useCase.parCount++;
    this.stack.push({ kind: 'par', group: useCase.parCount, loc: this.locOf(keyword, line) });
  }

  private parseNode(tokens: Token[], line: number) {
    const idToken = tokens[0];
    const loc = this.locOf(idToken, line);

    if (this.inUseCase()) {
      this.error('Declare nodes outside usecase blocks; steps look like a -> b : label', loc);
      return;
    }

    const node: DiagramNode = { id: idToken.value, kind: 'component', name: idToken.value, type: 'shape', techStack: DEFAULT_TECH, parent: this.currentGroup(), loc };
    let strings = 0;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === 'string' && strings < 2) {
        if (strings++ === 0) node.name = t.value;
        else node.description = t.value;
      } else if (t.kind === 'tech') {
        const resolved = this.resolveTech(t, line);
        node.type = resolved.type;
        node.techStack = resolved.techStack;
        if (resolved.inferredKind) node.inferredKind = resolved.inferredKind;
        node.kind = resolved.type === 'text' ? 'text' : resolved.type === 'group' ? 'group' : 'component';
      } else if (t.kind === 'team') {
        node.ownerTeam = t.value;
      } else if (t.kind === 'ident' && t.value === 'pos') {
        const [x, comma, y] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
        if (x?.kind !== 'number' || comma?.kind !== 'comma' || y?.kind !== 'number') {
          this.error('Expected pos x,y', this.locOf(t, line));
          return;
        }
        node.position = { x: Number(x.value), y: Number(y.value) };
        i += 3;
      } else if (t.kind === 'ident' && REPLICAS.test(t.value)) {
        const replicas = Number(REPLICAS.exec(t.value)![1]);
        if (replicas < 1) {
          this.error('A node needs at least one replica: x1, x2, …', this.locOf(t, line));
          return;
        }
        node.replicas = replicas;
      } else if (t.kind === 'label' || t.kind === 'arrow') {
        this.error(`Expected '${idToken.value} -> target' for a connection`, this.locOf(t, line));
        return;
      } else {
        this.error(`Unexpected ${describe(t)} in node declaration`, this.locOf(t, line));
        return;
      }
    }

    this.addNode(node);
  }

  private parseConnection(tokens: Token[], index: number): number {
    const line = index + 1;
    const [fromToken, arrowToken, toToken, labelToken] = tokens;

    if (toToken?.kind !== 'ident') {
      this.error('Expected a target id after the arrow', this.locOf(toToken ?? arrowToken, line));
      return index;
    }
    if (tokens.length > 4 || (labelToken && labelToken.kind !== 'label')) {
      this.error('Expected : before the connection label', this.locOf(labelToken, line));
      return index;
    }

    let label = labelToken?.value ?? '';
    let lastLine = index;
    // A JSON/XML payload may continue over several lines until its brackets balance.
    const brackets = new BracketCounter();
    let depth = brackets.feed(label);
    if (depth > 0) {
      while (depth > 0 && lastLine + 1 < this.lines.length) {
        lastLine++;
        const more = '\n' + this.lines[lastLine];
        label += more;
        depth = brackets.feed(more);
      }
      if (depth > 0) this.error('Unclosed { or [ in payload', this.locOf(labelToken, line));
      label = label.trimEnd();
    }

    const loc: SourceLoc = {
      line,
      col: fromToken.col,
      length: (labelToken ?? toToken).col + (labelToken ?? toToken).length - fromToken.col,
      ...this.fileField(),
    };
    const from = fromToken.value;
    const to = toToken.value;
    const arrow = arrowToken.value as Arrow;
    this.references.push({ id: from, loc: this.locOf(fromToken, line) }, { id: to, loc: this.locOf(toToken, line) });

    const top = this.top();
    if (top?.kind === 'usecase' || top?.kind === 'alt' || top?.kind === 'par') {
      const body = this.currentBody()!;
      body.openAlt = undefined;
      // Fan-out and payload size prefixes belong to requests; a response label is read as before.
      const prefixes = arrow === '-->' ? { rest: label } : this.readLabelPrefixes(label, labelToken!, line);
      body.items.push({
        kind: 'step',
        step: {
          from,
          to,
          arrow,
          label: prefixes.rest,
          parallelGroup: top.kind === 'par' ? top.group : undefined,
          ...(prefixes.multiplier !== undefined ? { multiplier: prefixes.multiplier } : {}),
          ...(prefixes.sizeBytes !== undefined ? { sizeBytes: prefixes.sizeBytes } : {}),
          loc,
        },
      });
    } else if (arrow === '-x') {
      this.error("'-x' marks a failed call and is only allowed in use case steps", this.locOf(arrowToken, line));
    } else {
      const base = `${from}->${to}`;
      // Counted in a map: scanning every edge made many duplicate connections quadratic.
      const count = this.edgeCount.get(base) ?? 0;
      this.edgeCount.set(base, count + 1);
      this.edges.push({ id: count ? `${base}#${count + 1}` : base, source: from, target: to, label: unquote(label) || undefined, loc });
    }
    return lastLine;
  }

  /**
   * Reads `x<N>` (fan-out) and `~<size>` (payload size) at the start of a step
   * label, in either order (§7.3), and returns the label without them. A
   * prefix must be followed by whitespace or end the label, so `xml …` and
   * `x-request-id` are ordinary labels. Problems are reported at the prefix.
   */
  private readLabelPrefixes(label: string, token: Token | undefined, line: number): { rest: string; multiplier?: number; sizeBytes?: number } {
    const out: { rest: string; multiplier?: number; sizeBytes?: number } = { rest: label };
    if (!token) return out;
    // Column of the label's first character: the label token starts at ':' and its value is trimmed.
    const after = this.lines[line - 1].slice(token.col);
    const base = token.col + 1 + (after.length - after.trimStart().length);
    let offset = 0;
    for (;;) {
      const rest = label.slice(offset);
      const at = (length: number): SourceLoc => ({ line, col: base + offset, length, ...this.fileField() });
      const fanOut = /^x(\d+)(?=\s|$)/.exec(rest);
      const size = rest.startsWith('~') ? /^~(\S*)/.exec(rest) : null;
      const match = fanOut ?? size;
      if (!match) break;
      if (fanOut) {
        const n = Number(fanOut[1]);
        if (out.multiplier !== undefined) this.error('The fan-out is given twice; write one x<N>', at(match[0].length));
        else if (n < 1) this.error('A fan-out needs at least one call per request: x1, x2, …', at(match[0].length));
        else out.multiplier = n;
      } else {
        const bytes = parseSize(size![1]);
        if (out.sizeBytes !== undefined) this.error('The payload size is given twice; write one ~<size>', at(match[0].length));
        else if ('error' in bytes) this.error(bytes.error, at(match[0].length));
        else out.sizeBytes = bytes.value;
      }
      offset += match[0].length;
      offset += label.slice(offset).length - label.slice(offset).trimStart().length;
    }
    out.rest = label.slice(offset);
    return out;
  }

  // ---- HLD sections: traffic, requirements, capacity, entity, decision, test (docs/design/hld-and-practice.md §1) ----

  /**
   * Starts a section block. Sections are top level only; a misplaced one, or
   * one whose header is broken, still opens a block so that its lines and its
   * `}` are not mistaken for nodes and the end of an enclosing block.
   */
  private openSection(section: Section, tokens: Token[], line: number, fill: Omit<SectionFrame, 'kind' | 'section' | 'loc'> = {}): boolean {
    const keyword = tokens[0];
    const loc = this.locOf(keyword, line);
    if (this.stack.length > 0) {
      this.error(`${section} is only allowed at the top level`, loc);
      this.skipSection(section, tokens, line);
      return false;
    }
    if (section === 'traffic' || section === 'requirements' || section === 'capacity') this.expectEnd(tokens, 2, line);
    this.stack.push({ kind: 'section', section, ...fill, loc });
    return true;
  }

  /** After an error in a section header: skips the block, if the line opens one. */
  private skipSection(section: Section, tokens: Token[], line: number) {
    if (tokens[tokens.length - 1].kind === 'lbrace') this.stack.push({ kind: 'section', section, discard: true, loc: this.locOf(tokens[0], line) });
  }

  private closeSection(frame: SectionFrame) {
    if (frame.test && frame.test.assertions.length === 0) this.warning(`Test '${frame.test.name}' has no assertions`, frame.test.loc);
  }

  private parseSectionLine(frame: SectionFrame, tokens: Token[], line: number) {
    switch (frame.section) {
      case 'traffic':
        return this.parseTrafficLine(tokens, line);
      case 'requirements':
        return this.parseRequirement(tokens, line);
      case 'capacity':
        return this.parseCapacityLine(tokens, line);
      case 'entity':
        return this.parseField(frame.entity!, tokens, line);
      case 'decision':
        return this.parseDecisionLine(frame.decision!, tokens, line);
      case 'test': {
        const assertion = this.parseAssertion(tokens, line);
        if (assertion) frame.test!.assertions.push(assertion);
        return;
      }
    }
  }

  /** `"Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%` */
  private parseTrafficLine(tokens: Token[], line: number) {
    const [name, rate] = tokens;
    if (name.kind !== 'string') {
      this.error('Expected a use case name in quotes and a rate, e.g. "Redirect" 100k rps', this.locOf(name, line));
      return;
    }
    const rps = this.quantityOf(rate, 'rps', name, line);
    if (rps === undefined) return;
    const entry: TrafficEntry = { useCase: name.value, rps, loc: this.lineLoc(tokens, line) };

    const shares: { scenario: string; share: number; loc: SourceLoc }[] = [];
    let i = 2;
    if (tokens[i]) {
      const mix = tokens[i++];
      if (!isWord(mix, 'mix')) {
        this.error(`Unexpected ${describe(mix)}; expected mix "Scenario" 90%, "Other" 10%`, this.locOf(mix, line));
        return;
      }
      for (;;) {
        const scenario = tokens[i];
        if (scenario?.kind !== 'string') {
          this.error('Expected a scenario name in quotes and its share, e.g. "Cache hit" 90%', this.locOf(scenario ?? tokens[i - 1], line));
          return;
        }
        const share = this.quantityOf(tokens[i + 1], '%', scenario, line);
        if (share === undefined) return;
        const loc = this.locOf(scenario, line);
        if (shares.some((s) => s.scenario === scenario.value)) {
          this.error(`Scenario '${scenario.value}' is in the mix twice`, loc);
          return;
        }
        shares.push({ scenario: scenario.value, share, loc });
        i += 2;
        if (!tokens[i]) break;
        if (tokens[i].kind !== 'comma') {
          this.error(`Expected , between mix shares, not ${describe(tokens[i])}`, this.locOf(tokens[i], line));
          return;
        }
        i++;
      }
      const total = shares.reduce((sum, s) => sum + s.share, 0);
      if (total <= 0) {
        this.error('Mix shares must add up to more than 0%', this.locOf(mix, line));
        return;
      }
      if (Math.abs(total - 100) > 1e-9) {
        this.warning(`Mix shares add up to ${Number(total.toFixed(3))}%, not 100%; they are scaled to fit`, this.locOf(mix, line));
      }
      entry.mix = shares.map((s) => ({ scenario: s.scenario, share: s.share / total }));
    }

    const nameLoc = this.locOf(name, line);
    const first = this.traffic.find((t) => t.useCase === entry.useCase);
    if (first) {
      this.error(`Duplicate traffic for '${entry.useCase}' (first ${this.where(first.loc, nameLoc)})`, nameLoc);
      return;
    }
    this.traffic.push(entry);
    this.deferred.push(() => {
      const useCase = this.checkUseCase(entry.useCase, nameLoc);
      if (useCase) for (const s of shares) this.checkScenario(useCase, s.scenario, s.loc);
    });
  }

  /** One line of `requirements { … }`. */
  private parseRequirement(tokens: Token[], line: number) {
    const [first] = tokens;
    const loc = this.lineLoc(tokens, line);
    const help = 'Expected a requirement: p99 "Use case" < 50ms, availability >= 99.9%, durable "Use case", survive any node failure, cost <= 3000 usd/month';
    if (first.kind !== 'ident') {
      this.error(help, this.locOf(first, line));
      return;
    }
    const word = first.value;

    // An optional use case name after the keyword; without one the requirement holds for every use case.
    let i = 1;
    let useCase: { name: string; loc: SourceLoc } | undefined;
    const readUseCase = () => {
      if (tokens[i]?.kind !== 'string') return;
      useCase = { name: tokens[i].value, loc: this.locOf(tokens[i], line) };
      i++;
    };
    const commit = (requirement: Requirement, scenario?: { name: string; loc: SourceLoc }) => {
      this.requirements.push(requirement);
      const named = useCase;
      if (named)
        this.deferred.push(() => {
          const found = this.checkUseCase(named.name, named.loc);
          if (found && scenario) this.checkScenario(found, scenario.name, scenario.loc);
        });
    };
    const withUseCase = () => (useCase ? { useCase: useCase.name } : {});

    if (/^p\d+$/.test(word)) {
      const percentile = PERCENTILES[word];
      if (percentile === undefined) {
        this.error(`Unknown percentile '${word}'; use p50, p90, p95, p99 or p999`, this.locOf(first, line));
        return;
      }
      readUseCase();
      // `p99 "Use case" scenario "S" < 100ms`: the latency of one scenario (§7.6).
      let scenario: { name: string; loc: SourceLoc } | undefined;
      if (isWord(tokens[i], 'scenario')) {
        const name = tokens[i + 1];
        if (!useCase) {
          this.error(`A scenario belongs to a use case; write ${word} "Use case" scenario "Scenario" < 100ms`, this.locOf(tokens[i], line));
          return;
        }
        if (name?.kind !== 'string') {
          this.error('Expected a scenario name in quotes after scenario', this.locOf(name ?? tokens[i], line));
          return;
        }
        scenario = { name: name.value, loc: this.locOf(name, line) };
        i += 2;
      }
      if (!this.expectOp(tokens, i, ['<', '<='], `${word} "Use case" < 50ms`, line)) return;
      const maxMs = this.quantityOf(tokens[i + 1], 'ms', tokens[i], line);
      if (maxMs === undefined || !this.expectEnd(tokens, i + 2, line)) return;
      commit({ kind: 'latency', percentile, ...withUseCase(), ...(scenario ? { scenario: scenario.name } : {}), maxMs, loc }, scenario);
      return;
    }

    switch (word) {
      case 'availability': {
        readUseCase();
        if (!this.expectOp(tokens, i, ['>=', '>'], 'availability "Use case" >= 99.9%', line)) return;
        const minPercent = this.quantityOf(tokens[i + 1], '%', tokens[i], line);
        if (minPercent === undefined) return;
        if (minPercent > 100) {
          this.error('Availability cannot be more than 100%', this.locOf(tokens[i + 1], line));
          return;
        }
        if (!this.expectEnd(tokens, i + 2, line)) return;
        commit({ kind: 'availability', ...withUseCase(), minPercent, loc });
        return;
      }
      case 'durable':
        readUseCase();
        if (!useCase) {
          this.error('Expected a use case name in quotes, e.g. durable "Shorten"', this.locOf(tokens[1] ?? first, line));
          return;
        }
        if (!this.expectEnd(tokens, i, line)) return;
        commit({ kind: 'durable', useCase: useCase.name, loc });
        return;
      case 'survive': {
        if (isWord(tokens[1], 'any') && isWord(tokens[2], 'node') && isWord(tokens[3], 'failure')) {
          if (this.expectEnd(tokens, 4, line)) commit({ kind: 'survive', target: 'any', loc });
          return;
        }
        if (!isWord(tokens[1], 'failure') || !isWord(tokens[2], 'of')) {
          this.error('Expected survive any node failure, or survive failure of <node | [Tech] | any kind>', this.locOf(tokens[1] ?? first, line));
          return;
        }
        const target = this.parseSelector(tokens, 3, line);
        if (!target || !this.expectEnd(tokens, target.next, line)) return;
        commit({ kind: 'survive', target: target.selector, loc });
        this.checkSelectorLater(target);
        return;
      }
      case 'cost': {
        if (!this.expectOp(tokens, 1, ['<=', '<'], 'cost <= 3000 usd/month', line)) return;
        const maxUsdPerMonth = this.quantityOf(tokens[2], 'usd/month', tokens[1], line);
        if (maxUsdPerMonth === undefined || !this.expectEnd(tokens, 3, line)) return;
        commit({ kind: 'cost', maxUsdPerMonth, loc });
        return;
      }
      default:
        this.error(`Unknown requirement '${word}'. ${help}`, this.locOf(first, line));
    }
  }

  /** `db 20k rps latency 4ms availability 99.95% cost 400 usd/month durable`, parts in any order. */
  private parseCapacityLine(tokens: Token[], line: number) {
    const [id] = tokens;
    if (id.kind !== 'ident') {
      this.error('Expected a node id and its overrides, e.g. db 20k rps latency 4ms', this.locOf(id, line));
      return;
    }
    const override: CapacityOverride = { node: id.value, loc: this.lineLoc(tokens, line) };
    const seen = new Set<string>();
    for (let i = 1; i < tokens.length; ) {
      const t = tokens[i];
      let part: string;
      if (t.kind === 'quantity' || t.kind === 'number') {
        part = 'rate';
        const rps = this.quantityOf(t, 'rps', t, line);
        if (rps === undefined) return;
        override.rps = rps;
        i++;
      } else if (isWord(t, 'latency') || isWord(t, 'availability') || isWord(t, 'cost')) {
        part = t.value;
        const unit = part === 'latency' ? 'ms' : part === 'availability' ? '%' : 'usd/month';
        const value = this.quantityOf(tokens[i + 1], unit, t, line);
        if (value === undefined) return;
        if (part === 'latency') override.latencyMs = value;
        else if (part === 'availability') override.availability = value;
        else override.costUsd = value;
        i += 2;
      } else if (isWord(t, 'durable') || isWord(t, 'volatile')) {
        part = 'durable or volatile';
        override.durable = t.value === 'durable';
        i++;
      } else if (isWord(t, 'reads') || isWord(t, 'writes')) {
        // Separate read and write capacity (§7.2).
        part = t.value;
        const value = this.quantityOf(tokens[i + 1], 'rps', t, line);
        if (value === undefined) return;
        if (part === 'reads') override.readRps = value;
        else override.writeRps = value;
        i += 2;
      } else if (isWord(t, 'shards')) {
        part = 'shards';
        const n = tokens[i + 1];
        if (n?.kind !== 'number' || Number(n.value) < 1) {
          this.error('Expected a whole number of shards, at least 1, e.g. shards 4', this.locOf(n ?? t, line));
          return;
        }
        override.shards = Number(n.value);
        i += 2;
      } else if (isWord(t, 'consistency')) {
        part = 'consistency';
        const value = tokens[i + 1];
        if (!isWord(value, 'strong') && !isWord(value, 'eventual')) {
          this.error(`Expected strong or eventual after consistency${value ? `, not ${describe(value)}` : ''}`, this.locOf(value ?? t, line));
          return;
        }
        override.consistency = value!.value as 'strong' | 'eventual';
        i += 2;
      } else if (isWord(t, 'bandwidth') || isWord(t, 'egress')) {
        // Transfer time and egress price (§7.3).
        part = t.value;
        const value = this.quantityOf(tokens[i + 1], part === 'bandwidth' ? 'MBps' : 'usd/GB', t, line);
        if (value === undefined) return;
        if (part === 'bandwidth') {
          if (value <= 0) {
            this.error('Bandwidth must be more than 0', this.locOf(tokens[i + 1], line));
            return;
          }
          override.bandwidthMBps = value;
        } else override.egressUsdPerGb = value;
        i += 2;
      } else {
        this.error(`Unexpected ${describe(t)}; expected ${CAPACITY_PARTS}`, this.locOf(t, line));
        return;
      }
      // A plain rate is both the read and the write capacity, so it cannot be combined with either.
      const clash = part === 'rate' ? ['reads', 'writes'].find((p) => seen.has(p)) : part === 'reads' || part === 'writes' ? (seen.has('rate') ? part : undefined) : undefined;
      if (clash) {
        this.error(`A rate sets both reads and writes; give either a rate or reads and writes for '${id.value}'`, this.locOf(t, line));
        return;
      }
      if (seen.has(part)) {
        this.error(`${part[0].toUpperCase()}${part.slice(1)} is given twice for '${id.value}'`, this.locOf(t, line));
        return;
      }
      seen.add(part);
    }

    const idLoc = this.locOf(id, line);
    if (seen.size === 0) {
      this.warning(`Capacity line for '${id.value}' overrides nothing; add ${CAPACITY_PARTS}`, idLoc);
      return;
    }
    const first = this.capacity.find((c) => c.node === id.value);
    if (first) {
      this.error(`Duplicate capacity for '${id.value}' (first ${this.where(first.loc, idLoc)})`, idLoc);
      return;
    }
    this.capacity.push(override);
    this.deferred.push(() => {
      const node = this.nodes.get(id.value);
      if (!node) {
        this.warning(`Unknown node '${id.value}' in capacity`, idLoc);
        return;
      }
      // Shards and consistency describe how a store keeps its data; elsewhere they mean nothing.
      const storeOnly = ['shards', 'consistency'].filter((p) => seen.has(p));
      if (storeOnly.length && !isDataStore(kindOf(node)))
        this.warning(`'${id.value}' is not a data store (${DATA_STORE_KINDS.join(', ')}); ${storeOnly.join(' and ')} only apply to data stores`, idLoc);
    });
  }

  /** `entity Url [in db] ["description"] {` */
  private parseEntity(tokens: Token[], line: number) {
    const name = tokens[1];
    let i = 2;
    let store: { id: string; loc: SourceLoc } | undefined;
    if (isWord(tokens[i], 'in')) {
      const id = tokens[i + 1];
      if (id?.kind !== 'ident') {
        this.error('Expected the id of the node that stores the entity after in, e.g. entity Url in db {', this.locOf(id ?? tokens[i], line));
        this.skipSection('entity', tokens, line);
        return;
      }
      store = { id: id.value, loc: this.locOf(id, line) };
      i += 2;
    }
    const description = tokens[i]?.kind === 'string' ? tokens[i++].value : undefined;
    if (tokens[i]?.kind !== 'lbrace') {
      this.error('Expected { after the entity header, e.g. entity Url in db "Short codes" {', this.locOf(tokens[i] ?? tokens[i - 1], line));
      this.skipSection('entity', tokens, line);
      return;
    }
    this.expectEnd(tokens, i + 1, line);

    const loc = this.locOf(name, line);
    const entity: Entity = { name: name.value, ...(store ? { store: store.id } : {}), ...(description !== undefined ? { description } : {}), fields: [], loc };
    const first = this.entities.find((e) => e.name === entity.name);
    if (first) {
      this.error(`Duplicate entity '${entity.name}' (first ${this.where(first.loc, loc)})`, loc);
      this.skipSection('entity', tokens, line);
      return;
    }
    if (!this.openSection('entity', tokens, line, { entity })) return;
    this.entities.push(entity);
    if (store) {
      const { id, loc: storeLoc } = store;
      this.deferred.push(() => {
        const node = this.nodes.get(id);
        if (!node) this.warning(`Unknown node '${id}'`, storeLoc);
        else if (!isDataStore(kindOf(node)))
          this.warning(`'${id}' is not a data store (${DATA_STORE_KINDS.join(', ')}); entity '${entity.name}' is placed in a ${kindOf(node)}`, storeLoc);
      });
    }
  }

  /** `code string key`: a field name, a type and flags. */
  private parseField(entity: Entity, tokens: Token[], line: number) {
    const [name, type] = tokens;
    if (name.kind !== 'ident') {
      this.error('Expected a field: name type [key] [index] [unique] [optional], e.g. code string key', this.locOf(name, line));
      return;
    }
    if (type?.kind !== 'ident') {
      this.error(`Expected a type after '${name.value}', e.g. ${name.value} string`, this.locOf(type ?? name, line));
      return;
    }
    const flags: string[] = [];
    for (const t of tokens.slice(2)) {
      if (t.kind !== 'ident' || !FIELD_FLAGS.includes(t.value)) {
        this.error(`Unknown field flag ${describe(t)}; use key, index, unique or optional`, this.locOf(t, line));
        return;
      }
      if (flags.includes(t.value)) {
        this.error(`Flag '${t.value}' is given twice`, this.locOf(t, line));
        return;
      }
      flags.push(t.value);
    }
    if (entity.fields.some((f) => f.name === name.value)) {
      this.error(`Duplicate field '${name.value}' in entity '${entity.name}'`, this.locOf(name, line));
      return;
    }
    entity.fields.push({ name: name.value, type: type.value, flags });
  }

  /** `decision "Title" because "Reason"`, or `decision "Title" {` with because / rejected lines. */
  private parseDecision(tokens: Token[], line: number) {
    const title = tokens[1];
    const decision: Decision = { title: title.value, rejected: [], loc: this.locOf(title, line) };
    const third = tokens[2];
    if (third.kind === 'lbrace') {
      this.expectEnd(tokens, 3, line);
      if (this.openSection('decision', tokens, line, { decision })) this.decisions.push(decision);
      return;
    }
    if (!isWord(third, 'because')) {
      this.error(`Expected because "reason" or { after the decision title, not ${describe(third)}`, this.locOf(third, line));
      this.skipSection('decision', tokens, line);
      return;
    }
    if (this.stack.length > 0) {
      this.error('decision is only allowed at the top level', this.locOf(tokens[0], line));
      return;
    }
    const reason = tokens[3];
    if (reason?.kind !== 'string') {
      this.error('Expected the reason in quotes after because', this.locOf(reason ?? third, line));
      return;
    }
    if (!this.expectEnd(tokens, 4, line)) return;
    decision.because = reason.value;
    this.decisions.push(decision);
  }

  private parseDecisionLine(decision: Decision, tokens: Token[], line: number) {
    const [word] = tokens;
    if (isWord(word, 'because')) {
      if (tokens[1]?.kind !== 'string') {
        this.error('Expected the reason in quotes after because', this.locOf(tokens[1] ?? word, line));
        return;
      }
      if (decision.because !== undefined) {
        this.error('A decision has one because; list the other options with rejected "option" "reason"', this.locOf(word, line));
        return;
      }
      if (this.expectEnd(tokens, 2, line)) decision.because = tokens[1].value;
      return;
    }
    if (isWord(word, 'rejected')) {
      const [, option, reason] = tokens;
      if (option?.kind !== 'string' || reason?.kind !== 'string') {
        const bad = option?.kind !== 'string' ? option : reason;
        this.error('Expected rejected "option" "reason"', this.locOf(bad ?? tokens[tokens.length - 1], line));
        return;
      }
      if (this.expectEnd(tokens, 3, line)) decision.rejected.push({ option: option.value, reason: reason.value });
      return;
    }
    this.error('Expected because "reason" or rejected "option" "reason"', this.locOf(word, line));
  }

  /** `test "Name" {` */
  private parseTest(tokens: Token[], line: number) {
    const name = tokens[1];
    const loc = this.locOf(name, line);
    if (tokens[2].kind !== 'lbrace') {
      this.error(`Expected { after the test name, not ${describe(tokens[2])}`, this.locOf(tokens[2], line));
      this.skipSection('test', tokens, line);
      return;
    }
    this.expectEnd(tokens, 3, line);
    const first = this.tests.find((t) => t.name === name.value);
    if (first) {
      this.error(`Duplicate test '${name.value}' (first ${this.where(first.loc, loc)})`, loc);
      this.skipSection('test', tokens, line);
      return;
    }
    const test: FlowTest = { name: name.value, assertions: [], loc };
    if (this.openSection('test', tokens, line, { test })) this.tests.push(test);
  }

  /** One assertion line of a test (docs/design/hld-and-practice.md §1.9). */
  private parseAssertion(tokens: Token[], line: number): Assertion | undefined {
    const loc = this.lineLoc(tokens, line);
    const [first] = tokens;
    const selectors: ParsedSelector[] = [];
    const selector = (i: number) => {
      const s = this.parseSelector(tokens, i, line);
      if (s) selectors.push(s);
      return s;
    };
    const done = (assertion: Assertion, end: number): Assertion | undefined => {
      if (!this.expectEnd(tokens, end, line)) return undefined;
      selectors.forEach((s) => this.checkSelectorLater(s));
      return assertion;
    };
    const expectWords = (i: number, words: string[], example: string): boolean => {
      for (const [k, w] of words.entries()) {
        if (!isWord(tokens[i + k], w)) {
          this.error(`Expected '${w}' here, e.g. ${example}`, this.locOf(tokens[i + k] ?? tokens[tokens.length - 1], line));
          return false;
        }
      }
      return true;
    };

    // no path from X to Y
    if (isWord(first, 'no') && isWord(tokens[1], 'path')) {
      const example = 'no path from client to any database';
      if (!expectWords(2, ['from'], example)) return;
      const from = selector(3);
      if (!from || !expectWords(from.next, ['to'], example)) return;
      const to = selector(from.next + 1);
      if (!to) return;
      return done({ kind: 'noPath', from: from.selector, to: to.selector, loc }, to.next);
    }

    // [in "U"] X calls Y, [in "U"] X never calls Y, X has replicas >= n
    if (first.kind !== 'string') {
      if (first.kind !== 'ident' && first.kind !== 'tech') {
        this.error(ASSERTION_HELP, this.locOf(first, line));
        return;
      }
      // `in "U"` scopes a sender assertion to one use case; `in` followed by anything else is a node id.
      const inUseCase = isWord(first, 'in') && tokens[1]?.kind === 'string' ? { name: tokens[1].value, loc: this.locOf(tokens[1], line) } : undefined;
      const target = selector(inUseCase ? 2 : 0);
      if (!target) return;
      const word = tokens[target.next];
      if (isWord(word, 'calls') || isWord(word, 'never')) {
        const never = word.value === 'never';
        if (never && !expectWords(target.next + 1, ['calls'], 'any service never calls any storage')) return;
        const to = selector(target.next + (never ? 2 : 1));
        if (!to) return;
        const assertion = done(
          { kind: 'senderCalls', ...(inUseCase ? { useCase: inUseCase.name } : {}), from: target.selector, to: to.selector, quantifier: never ? 'never' : 'some', loc },
          to.next,
        );
        if (assertion && inUseCase) this.deferred.push(() => this.checkUseCase(inUseCase.name, inUseCase.loc));
        return assertion;
      }
      if (inUseCase) {
        this.error(`Expected calls or never calls here, e.g. in "${inUseCase.name}" api calls db`, this.locOf(word ?? tokens[tokens.length - 1], line));
        return;
      }
      if (!isWord(word, 'has')) {
        this.error(ASSERTION_HELP, this.locOf(word ?? first, line));
        return;
      }
      const i = target.next + 1;
      const example = 'api has replicas >= 2';
      if (!expectWords(i, ['replicas'], example) || !this.expectOp(tokens, i + 1, ['>='], example, line)) return;
      const n = tokens[i + 2];
      if (n?.kind !== 'number' || Number(n.value) < 1) {
        this.error('Expected a whole number of replicas, at least 1', this.locOf(n ?? tokens[i + 1], line));
        return;
      }
      return done({ kind: 'replicas', target: target.selector, min: Number(n.value), loc }, i + 3);
    }

    // "Use case" [scenario "S"] …
    const useCase = first.value;
    const useCaseLoc = this.locOf(first, line);
    let i = 1;
    let scenario: { name: string; loc: SourceLoc } | undefined;
    if (isWord(tokens[i], 'scenario')) {
      const s = tokens[i + 1];
      if (s?.kind !== 'string') {
        this.error('Expected a scenario name in quotes after scenario', this.locOf(s ?? tokens[i], line));
        return;
      }
      scenario = { name: s.value, loc: this.locOf(s, line) };
      i += 2;
    }
    const withScenario = scenario ? { scenario: scenario.name } : {};
    const verb = tokens[i];
    const wholeUseCase = (what: string): boolean => {
      if (!scenario) return true;
      this.error(`${what} is about the whole use case; leave out scenario "…"`, scenario.loc);
      return false;
    };

    let assertion: Assertion | undefined;
    if (isWord(verb, 'calls')) {
      const target = selector(i + 1);
      if (!target) return;
      if (isWord(tokens[target.next], 'before')) {
        const then = selector(target.next + 1);
        if (!then) return;
        assertion = done({ kind: 'before', useCase, ...withScenario, first: target.selector, then: then.selector, loc }, then.next);
      } else if (isWord(tokens[target.next], 'after')) {
        const after = selector(target.next + 1);
        if (!after) return;
        assertion = done({ kind: 'after', useCase, ...withScenario, target: target.selector, after: after.selector, loc }, after.next);
      } else {
        assertion = done({ kind: 'calls', useCase, ...withScenario, target: target.selector, quantifier: 'some', loc }, target.next);
      }
    } else if (isWord(verb, 'every')) {
      if (!expectWords(i + 1, ['scenario', 'calls'], `"${useCase}" every scenario calls any cache`)) return;
      const target = selector(i + 3);
      if (!target) return;
      assertion = done({ kind: 'calls', useCase, ...withScenario, target: target.selector, quantifier: 'every', loc }, target.next);
    } else if (isWord(verb, 'never') && isWord(tokens[i + 1], 'waits')) {
      if (!expectWords(i + 2, ['for'], `"${useCase}" never waits for any queue`)) return;
      const target = selector(i + 3);
      if (!target) return;
      assertion = done({ kind: 'neverWaits', useCase, ...withScenario, target: target.selector, loc }, target.next);
    } else if (isWord(verb, 'starts')) {
      if (!wholeUseCase('starts at') || !expectWords(i + 1, ['at'], `"${useCase}" starts at any queue`)) return;
      const target = selector(i + 2);
      if (!target) return;
      assertion = done({ kind: 'startsAt', useCase, target: target.selector, loc }, target.next);
    } else if (isWord(verb, 'never')) {
      if (!expectWords(i + 1, ['calls'], `"${useCase}" never calls any database`)) return;
      const target = selector(i + 2);
      if (!target) return;
      assertion = done({ kind: 'calls', useCase, ...withScenario, target: target.selector, quantifier: 'never', loc }, target.next);
    } else if (isWord(verb, 'writes')) {
      const target = selector(i + 1);
      if (!target || !expectWords(target.next, ['before', 'responding'], `"${useCase}" writes db before responding`)) return;
      assertion = done({ kind: 'writesBeforeResponding', useCase, ...withScenario, target: target.selector, loc }, target.next + 2);
    } else if (isWord(verb, 'responds')) {
      const status = tokens[i + 1];
      if (!status || (status.kind !== 'number' && status.kind !== 'quantity') || !/^[1-5](\d\d|xx)$/.test(status.value)) {
        this.error('Expected a status code or class after responds, e.g. 201 or 4xx', this.locOf(status ?? verb, line));
        return;
      }
      assertion = done({ kind: 'responds', useCase, ...withScenario, status: status.value, loc }, i + 2);
    } else if (isWord(verb, 'has')) {
      if (!wholeUseCase('has scenario') || !expectWords(i + 1, ['scenario'], `"${useCase}" has scenario "Not found"`)) return;
      const name = tokens[i + 2];
      if (name?.kind !== 'string') {
        this.error('Expected a scenario name in quotes after has scenario', this.locOf(name ?? tokens[i + 1], line));
        return;
      }
      assertion = done({ kind: 'hasScenario', useCase, scenario: name.value, loc }, i + 3);
    } else if (isWord(verb, 'handles')) {
      if (!wholeUseCase('handles failure') || !expectWords(i + 1, ['failure', 'of'], `"${useCase}" handles failure of cache`)) return;
      const target = selector(i + 3);
      if (!target) return;
      assertion = done({ kind: 'handlesFailure', useCase, target: target.selector, loc }, target.next);
    } else {
      this.error(`Expected ${ASSERTION_VERBS} after "${useCase}"`, this.locOf(verb ?? first, line));
      return;
    }

    // `has scenario "S"` is the assertion itself: a missing scenario fails the test rather than warning.
    if (assertion) {
      this.deferred.push(() => {
        const found = this.checkUseCase(useCase, useCaseLoc);
        if (found && scenario) this.checkScenario(found, scenario.name, scenario.loc);
      });
    }
    return assertion;
  }

  /** A selector starting at `tokens[i]`: one or more of node id, `[Tech]`, `any <kind>`, `any strong store`, joined by `or`. */
  private parseSelector(tokens: Token[], i: number, line: number): ParsedSelector | undefined {
    const atoms: SelectorAtom[] = [];
    let next = i;
    for (;;) {
      const atom = this.parseSelectorAtom(tokens, next, line);
      if (!atom) return undefined;
      atoms.push(atom);
      next = atom.next;
      if (!isWord(tokens[next], 'or')) break;
      next++;
    }
    // `X or Y or Z` is one flat union.
    const selector: Selector = atoms.length === 1 ? atoms[0].selector : { anyOf: atoms.map((a) => a.selector) };
    return { selector, next, atoms };
  }

  /** One node id, `[Tech]`, `any <kind>` or `any strong|eventual store` at `tokens[i]`. */
  private parseSelectorAtom(tokens: Token[], i: number, line: number): SelectorAtom | undefined {
    const t = tokens[i];
    if (t?.kind === 'tech') {
      const tech = findTech(t.value)?.techStack ?? t.value;
      return { selector: { tech }, next: i + 1, token: t, loc: this.locOf(t, line) };
    }
    if (isWord(t, 'any')) {
      const kind = tokens[i + 1];
      if (isWord(kind, 'strong') || isWord(kind, 'eventual')) {
        if (!isWord(tokens[i + 2], 'store')) {
          this.error(`Expected 'store' here, e.g. any ${kind.value} store`, this.locOf(tokens[i + 2] ?? kind, line));
          return undefined;
        }
        return { selector: { consistency: kind.value as 'strong' | 'eventual' }, next: i + 3, token: t, loc: this.locOf(t, line) };
      }
      if (kind?.kind !== 'ident' || !isKind(kind.value)) {
        this.error(`Expected a kind after any: ${KINDS.join(', ')}, or strong store / eventual store`, this.locOf(kind ?? t, line));
        return undefined;
      }
      return { selector: { kind: kind.value }, next: i + 2, token: t, loc: this.locOf(t, line) };
    }
    if (t?.kind === 'ident') return { selector: { node: t.value }, next: i + 1, token: t, loc: this.locOf(t, line) };
    this.error(`Expected a node id, [Tech] or any <kind>${t ? `, not ${describe(t)}` : ''}`, this.locOf(t ?? tokens[tokens.length - 1], line));
    return undefined;
  }

  /** Warns about a selector naming a tech stack that does not exist, and (once every file is read) a node that does not. */
  private checkSelectorLater({ atoms }: ParsedSelector) {
    for (const { selector, token, loc } of atoms) {
      if ('tech' in selector && !findTech(token.value)) {
        const suggestion = suggestTech(token.value);
        this.warning(`Unknown tech stack '${token.value}'${suggestion ? `. Did you mean '${suggestion}'?` : ''}`, loc);
      }
      if ('node' in selector) {
        this.deferred.push(() => {
          if (!this.nodes.has(selector.node)) this.warning(`Unknown node '${selector.node}'`, loc);
        });
      }
    }
  }

  private checkUseCase(name: string, loc: SourceLoc): DiagramUseCase | undefined {
    const useCase = this.built.find((u) => u.name === name);
    if (!useCase) this.warning(`Unknown use case '${name}'`, loc);
    return useCase;
  }

  private checkScenario(useCase: DiagramUseCase, name: string, loc: SourceLoc) {
    if (useCase.scenarios.some((s) => s.name === name)) return;
    const names = useCase.scenarios.map((s) => `'${s.name}'`).join(', ');
    this.warning(`Use case '${useCase.name}' has no scenario '${name}'; its scenarios are ${names}`, loc);
  }

  /** The value of a quantity token in `unit`, or undefined after reporting what is wrong. `after` locates a missing token. */
  private quantityOf(token: Token | undefined, unit: Quantity['unit'], after: Token, line: number): number | undefined {
    const expected = UNIT_EXAMPLES[unit];
    if (token?.kind !== 'quantity' && token?.kind !== 'number') {
      this.error(`Expected ${expected}${token ? `, not ${describe(token)}` : ''}`, this.locOf(token ?? after, line));
      return undefined;
    }
    const loc = this.locOf(token, line);
    // As written, e.g. `100k rps`; the token value has the space removed.
    const written = this.lines[line - 1].slice(token.col - 1, token.col - 1 + token.length);
    const q = parseQuantity(written);
    if ('error' in q) {
      this.error(q.error, loc);
      return undefined;
    }
    if (q.unit !== unit) {
      this.error(q.unit ? `Expected ${expected}, not '${written}'` : `'${written}' needs a unit: expected ${expected}`, loc);
      return undefined;
    }
    return q.value;
  }

  private expectOp(tokens: Token[], i: number, ops: string[], example: string, line: number): boolean {
    const t = tokens[i];
    if (t?.kind === 'op' && ops.includes(t.value)) return true;
    this.error(`Expected ${ops[0]} here, e.g. ${example}`, this.locOf(t ?? tokens[tokens.length - 1], line));
    return false;
  }

  private buildUseCase(useCase: DiagramUseCase, body: Container): DiagramUseCase {
    let paths = expand(body.items);
    if (paths.length > MAX_SCENARIOS) {
      this.warning(`Too many scenarios (${paths.length}); only the first ${MAX_SCENARIOS} are kept`, useCase.loc);
      paths = paths.slice(0, MAX_SCENARIOS);
    }

    const taken = new Set<string>();
    const scenarios: DiagramScenario[] = paths.map((path) => {
      const base = path.names.length ? slug(path.names.join(' ')) || 'scenario' : 'main';
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      const steps = this.buildSteps(useCase.id, id, path.steps);
      const entry = steps[0];
      const failedEntry = !!entry && (entry.failed || (entry.statusCode ?? 0) >= 400);
      const condition = path.conditions.join(' · ');
      return {
        id,
        name: path.names.length ? path.names.join(' › ') : useCase.name,
        outcome: failedEntry ? 'error' : 'success',
        ...(condition ? { condition } : {}),
        steps,
        loc: path.locs.at(-1) ?? useCase.loc,
      };
    });

    const steps = scenarios[0]?.steps ?? [];
    const entry = steps[0];
    return {
      ...useCase,
      entryServiceId: entry?.fromServiceId,
      endpoint: entry?.httpMethod ? `${entry.httpMethod} ${entry.endpoint}` : undefined,
      steps,
      scenarios,
    };
  }

  private buildSteps(useCaseId: string, scenarioId: string, raw: RawStep[]): DiagramStep[] {
    const steps: DiagramStep[] = [];
    const answered = new Set<FlowStep>();
    const prefix = scenarioId === 'main' ? useCaseId : `${useCaseId}-${scenarioId}`;

    for (const step of raw) {
      this.checkConnection(step);
      if (step.arrow === '-->') {
        const request = [...steps]
          .reverse()
          .find((s) => s.fromServiceId === step.to && s.toServiceId === step.from && !answered.has(s) && !s.failed);
        if (!request) {
          this.warning(`Response has no matching request from '${step.to}' to '${step.from}'`, step.loc);
          continue;
        }
        answered.add(request);
        request.responseLoc = step.loc;
        const status = step.label.match(/^(\d{3})\b\s*([\s\S]*)$/);
        if (status) request.statusCode = Number(status[1]);
        const payload = splitPayload(status ? status[2] : step.label);
        const body = payload.body ?? payload.text;
        if (body) {
          request.responseBody = body;
          request.responseFormat = payload.body ? payload.format : 'FREE_TEXT';
        }
        if (request.executionType === 'ASYNC_FIRE_AND_FORGET') request.executionType = 'ASYNC_REQUEST_RESPONSE';
        continue;
      }

      const label = parseStepLabel(step.label);
      const target = this.nodes.get(step.to);
      const isAsync = step.arrow === '->>';
      steps.push({
        id: `${prefix}-${steps.length + 1}`,
        stepOrder: steps.length,
        stepName: label.name || `${step.from} → ${step.to}`,
        fromServiceId: step.from,
        toServiceId: step.to,
        protocol: inferProtocol(isAsync, label.method, target),
        httpMethod: label.method ?? '',
        endpoint: label.endpoint ?? '',
        requestFormat: label.format ?? 'JSON',
        requestBody: label.body,
        responseFormat: 'JSON',
        description: label.description,
        executionType: isAsync ? 'ASYNC_FIRE_AND_FORGET' : 'SYNC_REQUEST_RESPONSE',
        parallelGroup: step.parallelGroup,
        isParallel: step.parallelGroup !== undefined,
        isConditional: false,
        ...(step.arrow === '-x' ? { failed: true } : {}),
        loc: step.loc,
        ...(step.multiplier !== undefined ? { multiplier: step.multiplier } : {}),
        ...(step.sizeBytes !== undefined ? { sizeBytes: step.sizeBytes } : {}),
        access: accessOf(label.method, step.label),
      });
    }

    return steps;
  }

  /**
   * Warns when a step talks between two nodes the architecture never connects.
   * Documents without any connection are use-case-only sketches; they are left alone.
   */
  private checkConnection(step: RawStep) {
    if (this.edges.length === 0 || step.from === step.to || this.connected.has(`${step.from}|${step.to}`)) return;
    // A response travels back along the request's connection, so suggest the request direction.
    const [from, to] = step.arrow === '-->' ? [step.to, step.from] : [step.from, step.to];
    this.warning(`No connection between '${from}' and '${to}' in the architecture; add '${from} -> ${to}'`, step.loc);
  }

  private createImplicitNodes() {
    for (const ref of this.references) {
      if (this.nodes.has(ref.id)) continue;
      this.nodes.set(ref.id, { id: ref.id, kind: 'component', name: ref.id, type: 'shape', techStack: DEFAULT_TECH, implicit: true, loc: ref.loc });
    }
  }

  private addNode(node: DiagramNode) {
    const existing = this.nodes.get(node.id);
    if (existing) {
      this.error(`Duplicate id '${node.id}' (first declared ${this.where(existing.loc, node.loc)})`, node.loc);
      return;
    }
    this.nodes.set(node.id, node);
  }

  /** `on line 3`, or `in infra.proschi on line 3` when `first` is in another file than `later`. */
  private where(first: SourceLoc, later: SourceLoc): string {
    return first.file === later.file
      ? `on line ${first.line}`
      : `in ${fileName(first.file ?? this.options.path ?? 'the root document')} on line ${first.line}`;
  }

  /**
   * A node's `[Tech]`: the catalog entry it names (name or alias), or for an
   * unknown tech the text as written, with a warning that names the closest
   * catalog tech. It is drawn and simulated as the kind its name suggests
   * (`TigerBeetle DB`: database), else the kind of that closest tech
   * (`Postgress`: database), else a service; never a free, infinitely fast
   * client.
   */
  private resolveTech(token: Token, line: number): { type: ComponentType; techStack: TechName; inferredKind?: Kind } {
    const found = findTech(token.value);
    if (found) return { type: found.type, techStack: found.techStack };
    const text = token.value.trim();
    if (!text) {
      this.warning(`Empty tech stack; drawing a ${DEFAULT_TECH}`, this.locOf(token, line));
      return { type: 'shape', techStack: DEFAULT_TECH };
    }
    const suggestion = suggestTech(text);
    const closest = suggestion && findTech(suggestion);
    const kind = kindFromName(text) ?? (closest ? kindOf({ kind: 'component', type: closest.type, techStack: closest.techStack }) : undefined) ?? 'service';
    this.warning(unknownTechMessage(text, kind, suggestion), this.locOf(token, line));
    return { type: TYPE_OF_KIND[kind], techStack: text, inferredKind: kind };
  }

  private useCaseId(name: string): string {
    const base = slug(name) || 'usecase';
    const taken = new Set(this.useCases.map((u) => u.useCase.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  private currentGroup(): string | undefined {
    const top = this.top();
    return top?.kind === 'group' ? top.id : undefined;
  }

  private currentUseCase() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.kind === 'usecase') return frame;
    }
    return undefined;
  }

  private currentBody(): Container | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.kind === 'usecase' || frame.kind === 'alt') return frame.body;
    }
    return undefined;
  }

  private inUseCase(): boolean {
    return this.currentUseCase() !== undefined;
  }

  /** Reports the first token from `from` on; true when there is none. */
  private expectEnd(tokens: Token[], from: number, line: number): boolean {
    if (tokens.length <= from) return true;
    this.error(`Unexpected ${describe(tokens[from])}`, this.locOf(tokens[from], line));
    return false;
  }

  /** From the first token of a line to the end of its last one. */
  private lineLoc(tokens: Token[], line: number): SourceLoc {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return { line, col: first.col, length: last.col + last.length - first.col, ...this.fileField() };
  }

  private locOf(token: Token | undefined, line: number): SourceLoc {
    return token ? { line, col: token.col, length: token.length, ...this.fileField() } : { line, col: 1, length: 1, ...this.fileField() };
  }

  /** `{ file }` inside an imported file; nothing for the root document, whose locations stay as they were. */
  private fileField(): { file?: string } {
    return this.file === undefined ? {} : { file: this.file };
  }

  private error(message: string, loc: SourceLoc) {
    this.diagnostics.push({ severity: 'error', message, ...loc });
  }

  private warning(message: string, loc: SourceLoc) {
    // Steps shared by several scenarios are checked once per scenario; report each problem once.
    // A Set, not a scan of every diagnostic: many warnings made the scan quadratic.
    const key = `${loc.file ?? ''}\n${loc.line}\n${loc.col}\n${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.diagnostics.push({ severity: 'warning', message, ...loc });
  }
}

/**
 * Flattens a use case body into one step list per scenario. Each alt set
 * multiplies the paths so far by its branches; steps after a set are shared by
 * every branch.
 */
function expand(items: Item[]): { names: string[]; conditions: string[]; locs: SourceLoc[]; steps: RawStep[] }[] {
  let paths: ReturnType<typeof expand> = [{ names: [], conditions: [], locs: [], steps: [] }];
  for (const item of items) {
    if (item.kind === 'step') {
      for (const path of paths) path.steps.push(item.step);
      continue;
    }
    const next: typeof paths = [];
    for (const path of paths) {
      for (const branch of item.branches) {
        for (const sub of expand(branch.items)) {
          next.push({
            names: [...path.names, branch.name, ...sub.names],
            conditions: [...path.conditions, ...(branch.condition ? [branch.condition] : []), ...sub.conditions],
            locs: [...path.locs, branch.loc, ...sub.locs],
            steps: [...path.steps, ...sub.steps],
          });
        }
      }
      // Stop multiplying long before the result gets out of hand.
      if (next.length > MAX_SCENARIOS * 4) break;
    }
    paths = next;
  }
  return paths;
}

/** One alternative of a selector: a node id, `[Tech]`, `any <kind>` or `any strong store`. */
interface SelectorAtom {
  selector: Selector;
  /** Index of the token after it. */
  next: number;
  token: Token;
  loc: SourceLoc;
}

interface ParsedSelector {
  /** The atom itself, or `{ anyOf }` for `X or Y …`. */
  selector: Selector;
  /** Index of the token after the selector. */
  next: number;
  atoms: SelectorAtom[];
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === 'ident' && token.value === word;
}

function sectionName(frame: SectionFrame): string {
  if (frame.skipped) return frame.skipped;
  if (frame.entity) return `entity '${frame.entity.name}'`;
  if (frame.decision) return `decision '${frame.decision.title}'`;
  if (frame.test) return `test '${frame.test.name}'`;
  return `${frame.section} block`;
}

/** Last segment of a path, for messages. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type PayloadFormat = FlowStep['requestFormat'];

interface Payload {
  text: string;
  format: PayloadFormat;
  body?: string;
}

/**
 * Splits `OrderPlaced json {"id": 1}` into its text and payload. A payload is
 * either introduced by a json/xml/text keyword or starts with { [ or <.
 */
function splitPayload(input: string): Payload {
  const text = input.trim();
  const formats: Record<string, PayloadFormat> = { json: 'JSON', xml: 'XML', text: 'FREE_TEXT' };

  const leading = text.match(/^(json|xml|text)\s+([\s\S]+)$/i);
  if (leading) return { text: '', format: formats[leading[1].toLowerCase()], body: leading[2].trim() };

  const keyed = text.match(/^([\s\S]*?)\s+(json|xml)\s+([{[<][\s\S]*)$/i);
  if (keyed) return { text: keyed[1].trim(), format: formats[keyed[2].toLowerCase()], body: keyed[3].trim() };

  const bare = text.search(/(^|\s)[{[<]/);
  if (bare !== -1) {
    const body = text.slice(bare).trim();
    return { text: text.slice(0, bare).trim(), format: body.startsWith('<') ? 'XML' : 'JSON', body };
  }

  return { text: unquote(text), format: 'JSON' };
}

interface StepLabel {
  name: string;
  method?: string;
  endpoint?: string;
  description?: string;
  format?: PayloadFormat;
  body?: string;
}

/** Parses `POST /orders json {...}` or free text such as `INSERT order`. */
export function parseStepLabel(input: string): StepLabel {
  const http = input.trim().match(/^([A-Z]+)\s+(\S+)\s*([\s\S]*)$/);
  if (http && HTTP_METHODS.includes(http[1])) {
    const payload = splitPayload(http[3]);
    return {
      name: `${http[1]} ${http[2]}`,
      method: http[1],
      endpoint: http[2],
      description: payload.text || undefined,
      format: payload.body ? payload.format : undefined,
      body: payload.body,
    };
  }
  const payload = splitPayload(input);
  return { name: payload.text, format: payload.body ? payload.format : undefined, body: payload.body };
}

const SIZE_UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** `2MB`, `500KB`, `1.5GB` (decimal units) in bytes, from a `~<size>` label prefix. */
export function parseSize(text: string): { value: number } | { error: string } {
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(text);
  if (!m) return { error: `Expected a payload size after ~, e.g. ~2MB, ~500KB or ~1.5GB${text ? `, not '~${text}'` : ''}` };
  const factor = SIZE_UNITS[m[2]];
  if (factor === undefined) return { error: m[2] ? `Unknown size unit '${m[2]}' in '~${text}'; use B, KB, MB, GB or TB` : `'~${text}' needs a unit: B, KB, MB, GB or TB` };
  const value = Math.round(Number(m[1]) * factor);
  if (value <= 0) return { error: `A payload size must be more than 0, not '~${text}'` };
  return { value };
}

function inferProtocol(isAsync: boolean, method: string | undefined, target: DiagramNode | undefined): Protocol {
  if (isAsync || target?.type === 'queue') return 'MESSAGING';
  if (!method) return 'OTHER';
  switch (target?.techStack) {
    case 'GraphQL':
      return 'GRAPHQL';
    case 'gRPC':
      return 'GRPC';
    case 'SOAP API':
      return 'SOAP';
    default:
      return 'REST';
  }
}

function unquote(text: string): string {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function describe(token: Token): string {
  switch (token.kind) {
    case 'string':
      return `string "${token.value}"`;
    case 'tech':
      return `[${token.value}]`;
    case 'team':
      return `@${token.value}`;
    case 'label':
      return "':'";
    case 'lbrace':
    case 'rbrace':
    case 'comma':
    case 'arrow':
      return `'${token.value}'`;
    default:
      return `'${token.value}'`;
  }
}
