import type { ComponentType, TechStack } from '../types/canvas';
import type { FlowStep, Protocol } from '../services/api';
import { componentCatalog } from '../catalog/componentCatalog';
import { bracketDepth, tokenizeLine, type Token } from './lexer';
import type {
  Diagnostic,
  Diagram,
  DiagramEdge,
  DiagramNode,
  DiagramScenario,
  DiagramUseCase,
  ParseResult,
  SourceLoc,
} from './types';

type Arrow = '->' | '->>' | '-->' | '-x';

interface RawStep {
  from: string;
  to: string;
  arrow: Arrow;
  label: string;
  parallelGroup?: number;
  loc: SourceLoc;
}

/** A use case body: steps, and sets of `alt` branches that split it into scenarios. */
type Item = { kind: 'step'; step: RawStep } | { kind: 'alt'; branches: Branch[] };

interface Branch {
  name: string;
  items: Item[];
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
  | { kind: 'par'; group: number; loc: SourceLoc };

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const DEFAULT_TECH: TechStack = 'Rectangle';
const DEFAULT_GROUP_TECH: TechStack = 'Logical Group';
/** Nested or repeated alt sets multiply; past this many scenarios the rest are dropped. */
export const MAX_SCENARIOS = 32;

const techByName = new Map<string, { type: ComponentType; techStack: TechStack }>(
  componentCatalog.map((c) => [c.techStack.toLowerCase(), { type: c.type, techStack: c.techStack }])
);

/**
 * Parses Proschi source text into a diagram. Parsing never throws: problems are
 * reported as diagnostics and the rest of the document is still returned, so an
 * editor can keep rendering while the user types.
 */
export function parse(source: string): ParseResult {
  return new Parser(source).run();
}

class Parser {
  private readonly lines: string[];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly nodes = new Map<string, DiagramNode>();
  private readonly edges: DiagramEdge[] = [];
  private readonly useCases: { useCase: DiagramUseCase; body: Container }[] = [];
  private readonly references: Reference[] = [];
  private readonly stack: Frame[] = [];
  private title?: string;

  constructor(source: string) {
    this.lines = source.split('\n');
  }

  run(): ParseResult {
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
              : 'par block';
      this.error(`Missing } to close ${what}`, frame.loc);
    }

    this.createImplicitNodes();

    const diagram: Diagram = {
      title: this.title,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      useCases: this.useCases.map(({ useCase, body }) => this.buildUseCase(useCase, body)),
    };

    this.diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
    return { diagram, diagnostics: this.diagnostics };
  }

  /** Parses the line at `index` and returns the index of the last line it consumed. */
  private parseLine(index: number): number {
    const line = index + 1;
    const { tokens, diagnostics } = tokenizeLine(this.lines[index], line);
    this.diagnostics.push(...diagnostics);
    // A line the lexer could not read is skipped rather than half-interpreted.
    if (tokens.length === 0 || diagnostics.some((d) => d.severity === 'error')) return index;

    const [first, second] = tokens;
    const loc = (t: Token): SourceLoc => ({ line, col: t.col, length: t.length });

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
    this.title = value.value;
    this.expectEnd(tokens, 2, line);
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
    let techStack = DEFAULT_GROUP_TECH;
    if (tokens[i]?.kind === 'string') name = tokens[i++].value;
    if (tokens[i]?.kind === 'tech') {
      const tech = tokens[i++];
      const resolved = this.resolveTech(tech, line);
      if (resolved.type === 'group') techStack = resolved.techStack;
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
    if (tokens[2]?.kind !== 'lbrace') {
      this.error('Expected { after alt name', this.locOf(tokens[2] ?? nameToken, line));
      return;
    }
    this.expectEnd(tokens, 3, line);

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
    set.branches.push({ name: nameToken.value, items: body.items });
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
    if (bracketDepth(label) > 0) {
      while (bracketDepth(label) > 0 && lastLine + 1 < this.lines.length) {
        lastLine++;
        label += '\n' + this.lines[lastLine];
      }
      if (bracketDepth(label) > 0) this.error('Unclosed { or [ in payload', this.locOf(labelToken, line));
      label = label.trimEnd();
    }

    const loc: SourceLoc = { line, col: fromToken.col, length: (labelToken ?? toToken).col + (labelToken ?? toToken).length - fromToken.col };
    const from = fromToken.value;
    const to = toToken.value;
    const arrow = arrowToken.value as Arrow;
    this.references.push({ id: from, loc: this.locOf(fromToken, line) }, { id: to, loc: this.locOf(toToken, line) });

    const top = this.top();
    if (top?.kind === 'usecase' || top?.kind === 'alt' || top?.kind === 'par') {
      const body = this.currentBody()!;
      body.openAlt = undefined;
      body.items.push({ kind: 'step', step: { from, to, arrow, label, parallelGroup: top.kind === 'par' ? top.group : undefined, loc } });
    } else if (arrow === '-x') {
      this.error("'-x' marks a failed call and is only allowed in use case steps", this.locOf(arrowToken, line));
    } else {
      const base = `${from}->${to}`;
      const count = this.edges.filter((e) => e.id === base || e.id.startsWith(`${base}#`)).length;
      this.edges.push({ id: count ? `${base}#${count + 1}` : base, source: from, target: to, label: unquote(label) || undefined, loc });
    }
    return lastLine;
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
      return {
        id,
        name: path.names.length ? path.names.join(' › ') : useCase.name,
        outcome: failedEntry ? 'error' : 'success',
        steps,
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

  private buildSteps(useCaseId: string, scenarioId: string, raw: RawStep[]): FlowStep[] {
    const steps: FlowStep[] = [];
    const answered = new Set<FlowStep>();
    const prefix = scenarioId === 'main' ? useCaseId : `${useCaseId}-${scenarioId}`;

    for (const step of raw) {
      if (step.arrow === '-->') {
        const request = [...steps]
          .reverse()
          .find((s) => s.fromServiceId === step.to && s.toServiceId === step.from && !answered.has(s) && !s.failed);
        if (!request) {
          this.warning(`Response has no matching request from '${step.to}' to '${step.from}'`, step.loc);
          continue;
        }
        answered.add(request);
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
      });
    }

    return steps;
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
      this.error(`Duplicate id '${node.id}' (first declared on line ${existing.loc.line})`, node.loc);
      return;
    }
    this.nodes.set(node.id, node);
  }

  private resolveTech(token: Token, line: number): { type: ComponentType; techStack: TechStack } {
    const resolved = techByName.get(token.value.toLowerCase());
    if (resolved) return resolved;
    this.warning(`Unknown tech stack '${token.value}'; drawing a ${DEFAULT_TECH}`, this.locOf(token, line));
    return { type: 'shape', techStack: DEFAULT_TECH };
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

  private expectEnd(tokens: Token[], from: number, line: number) {
    if (tokens.length > from) this.error(`Unexpected ${describe(tokens[from])}`, this.locOf(tokens[from], line));
  }

  private locOf(token: Token | undefined, line: number): SourceLoc {
    return token ? { line, col: token.col, length: token.length } : { line, col: 1, length: 1 };
  }

  private error(message: string, loc: SourceLoc) {
    this.diagnostics.push({ severity: 'error', message, ...loc });
  }

  private warning(message: string, loc: SourceLoc) {
    // Steps shared by several scenarios are checked once per scenario; report each problem once.
    if (this.diagnostics.some((d) => d.message === message && d.line === loc.line && d.col === loc.col)) return;
    this.diagnostics.push({ severity: 'warning', message, ...loc });
  }
}

/**
 * Flattens a use case body into one step list per scenario. Each alt set
 * multiplies the paths so far by its branches; steps after a set are shared by
 * every branch.
 */
function expand(items: Item[]): { names: string[]; steps: RawStep[] }[] {
  let paths: { names: string[]; steps: RawStep[] }[] = [{ names: [], steps: [] }];
  for (const item of items) {
    if (item.kind === 'step') {
      for (const path of paths) path.steps.push(item.step);
      continue;
    }
    const next: typeof paths = [];
    for (const path of paths) {
      for (const branch of item.branches) {
        for (const sub of expand(branch.items)) {
          next.push({ names: [...path.names, branch.name, ...sub.names], steps: [...path.steps, ...sub.steps] });
        }
      }
      // Stop multiplying long before the result gets out of hand.
      if (next.length > MAX_SCENARIOS * 4) break;
    }
    paths = next;
  }
  return paths;
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
