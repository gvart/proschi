import type {
  Assertion,
  Decision,
  Diagram,
  DiagramNode,
  DiagramScenario,
  DiagramUseCase,
  Entity,
  Kind,
  Requirement,
  Selector,
  SourceLoc,
} from '../dsl/types';
import type { Analysis, ScenarioAnalysis, TestResult } from './engine';
import { kindOf } from '../dsl/kinds';
import { requirementName } from '../sim';

/**
 * A high-level design document built from a diagram, plus the simulation's
 * analysis and test results when there are any (docs/design/hld-and-practice.md
 * §4). This is a plain model; toMarkdown, toHtml and the editor's HLD view
 * render it. Sections without content are left out.
 */

/** Checked against the simulation: passed, failed, or not checked (no engine, or no result for it). */
export type CheckStatus = 'pass' | 'fail' | 'unchecked';

export interface FunctionalRequirement {
  useCaseId: string;
  name: string;
  description?: string;
  scenarios: { id: string; name: string; outcome: 'success' | 'error'; condition?: string }[];
}

export interface NonFunctionalRequirement {
  /** "p99 of Redirect < 50 ms" */
  label: string;
  category: TestResult['category'];
  status: CheckStatus;
  /** The measured value, from the test result. */
  measured?: string;
  hint?: string;
  loc: SourceLoc;
}

export interface FlowTestRow {
  name: string;
  /** Each assertion line as text. */
  assertions: string[];
  status: CheckStatus;
  measured?: string;
  hint?: string;
  loc: SourceLoc;
}

export interface TrafficRow {
  useCase: string;
  rps: number;
  mix: { scenario: string; share: number }[];
}

export interface LoadRow {
  id: string;
  name: string;
  loadRps: number;
  capacityRps: number;
  utilization: number;
  saturated: boolean;
  replicas: number;
  /** Partitions, each with `replicas` instances (§7.2); 1 unless `capacity { n shards … }`. */
  shards: number;
  /** Reads and writes separately: load, capacity (all replicas and shards) and utilisation (§7.2). */
  readLoadRps: number;
  readCapacityRps: number;
  readUtilization: number;
  writeLoadRps: number;
  writeCapacityRps: number;
  writeUtilization: number;
  /** `shards`: writes go to one primary per shard (relational databases). */
  writeScaling: 'replicas' | 'shards';
  /** Data leaving the node per month and what it costs (§7.3); included in `costUsd`. */
  egressGbPerMonth: number;
  egressUsd: number;
  costUsd: number;
}

export interface Component {
  id: string;
  name: string;
  tech?: string;
  kind: Kind;
  team?: string;
  replicas: number;
  /** The node description. */
  responsibility?: string;
  /** Name of the enclosing group. */
  group?: string;
  /** Names of the entities stored in it. */
  entities: string[];
}

export interface DataEntity extends Entity {
  /** Display name of the store. */
  storeName?: string;
}

export interface ApiResponse {
  scenario: string;
  outcome: 'success' | 'error';
  /** HTTP status of the entry response, `failed` for a call that got no answer, or undefined. */
  status?: string;
  body?: string;
}

export interface ApiOperation {
  useCaseId: string;
  useCase: string;
  /** The concrete `METHOD /path` of this use case. */
  endpoint: string;
  request?: string;
  responses: ApiResponse[];
}

export interface ApiEndpoint {
  /** `METHOD /path/{param}` shared by the operations. */
  endpoint: string;
  method: string;
  path: string;
  /** The node that receives the request. */
  service?: string;
  operations: ApiOperation[];
}

export interface ScenarioRow {
  id: string;
  name: string;
  outcome: 'success' | 'error';
  condition?: string;
  /** Share of the use case's traffic, 0..1, when traffic is given. */
  share?: number;
  latency?: ScenarioAnalysis['percentiles'];
  meanMs?: number;
  /** Number of steps; a scenario without steps has no sequence diagram. */
  steps: number;
}

export interface ScenarioUseCase {
  useCaseId: string;
  name: string;
  description?: string;
  endpoint?: string;
  rps?: number;
  scenarios: ScenarioRow[];
}

export interface Risk {
  severity: 'high' | 'medium' | 'low';
  kind: 'requirement' | 'test' | 'saturated' | 'hot' | 'spof' | 'no-error-handling' | 'warning';
  title: string;
  detail?: string;
  hint?: string;
}

export type HldSection =
  | { kind: 'overview'; title: 'Overview'; summary?: string; components: number; useCases: number; teams: string[] }
  | { kind: 'requirements'; title: 'Requirements'; functional: FunctionalRequirement[]; nonFunctional: NonFunctionalRequirement[]; flowTests: FlowTestRow[] }
  | { kind: 'capacity'; title: 'Capacity estimates'; traffic: TrafficRow[]; load: LoadRow[]; totalCostUsd?: number; totalEgressUsd?: number }
  | { kind: 'components'; title: 'Components'; components: Component[] }
  | { kind: 'dataModel'; title: 'Data model'; entities: DataEntity[] }
  | { kind: 'apis'; title: 'APIs'; endpoints: ApiEndpoint[] }
  | { kind: 'scenarios'; title: 'Scenarios'; useCases: ScenarioUseCase[] }
  | { kind: 'decisions'; title: 'Decisions'; decisions: Decision[] }
  | { kind: 'risks'; title: 'Risks'; risks: Risk[] };

export type HldSectionKind = HldSection['kind'];

export interface HldDocument {
  title: string;
  summary?: string;
  /** Whether simulation results went into the document; without them nothing is checked. */
  checked: boolean;
  sections: HldSection[];
  /** The source diagram, for renderers that draw it (Mermaid, SVG, canvas). */
  diagram: Diagram;
}

/** Utilisation above which a node is called hot in the risks. */
export const HOT_UTILIZATION = 0.7;

// ── Labels ────────────────────────────────────────────────────────────────

export function selectorLabel(s: Selector): string {
  if ('node' in s) return s.node;
  if ('tech' in s) return `[${s.tech}]`;
  if ('anyOf' in s) return s.anyOf.map(selectorLabel).join(' or ');
  if ('consistency' in s) return `any ${s.consistency} store`;
  return `any ${s.kind}`;
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

/** A requirement as a sentence, the same as its test name: "p99 of Redirect < 50 ms". */
export const requirementLabel: (r: Requirement) => string = requirementName;

const REQUIREMENT_CATEGORY: Record<Requirement['kind'], TestResult['category']> = {
  latency: 'latency',
  availability: 'availability',
  durable: 'durability',
  survive: 'resilience',
  cost: 'cost',
};

/** An assertion as it is written in a `test` block. */
export function assertionLabel(a: Assertion): string {
  const uc = 'useCase' in a ? `"${a.useCase}"${'scenario' in a && a.scenario && a.kind !== 'hasScenario' ? ` scenario "${a.scenario}"` : ''}` : '';
  switch (a.kind) {
    case 'calls':
      return `${uc} ${a.quantifier === 'every' ? 'every scenario calls' : a.quantifier === 'never' ? 'never calls' : 'calls'} ${selectorLabel(a.target)}`;
    case 'before':
      return `${uc} calls ${selectorLabel(a.first)} before ${selectorLabel(a.then)}`;
    case 'writesBeforeResponding':
      return `${uc} writes ${selectorLabel(a.target)} before responding`;
    case 'responds':
      return `${uc} responds ${a.status}`;
    case 'hasScenario':
      return `${uc} has scenario "${a.scenario}"`;
    case 'handlesFailure':
      return `${uc} handles failure of ${selectorLabel(a.target)}`;
    case 'noPath':
      return `no path from ${selectorLabel(a.from)} to ${selectorLabel(a.to)}`;
    case 'replicas':
      return `${selectorLabel(a.target)} has replicas >= ${a.min}`;
    case 'neverWaits':
      return `${uc} never waits for ${selectorLabel(a.target)}`;
    case 'after':
      return `${uc} calls ${selectorLabel(a.target)} after ${selectorLabel(a.after)}`;
    case 'senderCalls':
      return `${a.useCase ? `in "${a.useCase}" ` : ''}${selectorLabel(a.from)} ${a.quantifier === 'never' ? 'never calls' : 'calls'} ${selectorLabel(a.to)}`;
    case 'startsAt':
      return `${uc} starts at ${selectorLabel(a.target)}`;
  }
}

// ── Building ──────────────────────────────────────────────────────────────

const sameLoc = (a: SourceLoc | undefined, b: SourceLoc) => !!a && a.line === b.line && a.file === b.file;

/** The test result for a requirement or test line: by position, then by name. */
function resultFor(tests: TestResult[], loc: SourceLoc, name: string): TestResult | undefined {
  return tests.find((t) => sameLoc(t.loc, loc)) ?? tests.find((t) => t.name === name);
}

const statusOf = (result: TestResult | undefined): CheckStatus => (result ? (result.passed ? 'pass' : 'fail') : 'unchecked');

const components = (d: Diagram) => d.nodes.filter((n) => n.kind === 'component');

/** Scenario shares from `traffic … mix`: by name, normalised; without a mix everything goes to the first scenario. */
export function scenarioShares(useCase: DiagramUseCase, diagram: Diagram): Map<string, number> | undefined {
  const entry = diagram.traffic?.find((t) => t.useCase === useCase.name);
  if (!entry) return undefined;
  const shares = new Map<string, number>();
  const mix = (entry.mix ?? []).filter((m) => useCase.scenarios.some((s) => s.name === m.scenario));
  const total = mix.reduce((sum, m) => sum + m.share, 0);
  if (total > 0) for (const m of mix) shares.set(m.scenario, m.share / total);
  else if (useCase.scenarios[0]) shares.set(useCase.scenarios[0].name, 1);
  return shares;
}

function entryResponse(scenario: DiagramScenario): Pick<ApiResponse, 'status' | 'body'> {
  const first = scenario.steps[0];
  if (!first) return {};
  if (first.failed) return { status: 'failed' };
  return { status: first.statusCode !== undefined ? String(first.statusCode) : undefined, body: first.responseBody || undefined };
}

function buildApis(diagram: Diagram, name: (id: string) => string): ApiEndpoint[] {
  const groups = new Map<string, ApiEndpoint>();
  for (const useCase of diagram.useCases) {
    if (!useCase.endpoint) continue;
    const key = useCase.endpointGroup ?? useCase.endpoint;
    let group = groups.get(key);
    if (!group) {
      const [method, ...path] = key.split(' ');
      const first = useCase.steps[0];
      group = { endpoint: key, method, path: path.join(' '), service: first ? name(first.toServiceId) : undefined, operations: [] };
      groups.set(key, group);
    }
    group.operations.push({
      useCaseId: useCase.id,
      useCase: useCase.name,
      endpoint: useCase.endpoint,
      request: useCase.steps[0]?.requestBody || undefined,
      responses: useCase.scenarios.map((s) => ({ scenario: s.name, outcome: s.outcome, ...entryResponse(s) })),
    });
  }
  return [...groups.values()];
}

/** No scenario of the use case fails or returns an error: nothing says what happens when a call goes wrong. */
function lacksErrorHandling(useCase: DiagramUseCase): boolean {
  return useCase.scenarios.length > 0 && useCase.scenarios.every((s) => s.outcome === 'success' && !s.steps.some((st) => st.failed));
}

export function hld(diagram: Diagram, analysis?: Analysis, tests: TestResult[] = []): HldDocument {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const nodes = components(diagram);
  const nodeAnalysis = new Map(analysis?.nodes.map((n) => [n.id, n]));
  const sections: HldSection[] = [];

  // 1. Overview
  const teams = [...new Set(nodes.map((n) => n.ownerTeam).filter((t): t is string => !!t))];
  if (nodes.length > 0 || diagram.summary) {
    sections.push({ kind: 'overview', title: 'Overview', summary: diagram.summary, components: nodes.length, useCases: diagram.useCases.length, teams });
  }

  // 2. Requirements
  const functional: FunctionalRequirement[] = diagram.useCases.map((u) => ({
    useCaseId: u.id,
    name: u.name,
    description: u.description,
    scenarios: u.scenarios.map((s) => ({ id: s.id, name: s.name, outcome: s.outcome, condition: s.condition })),
  }));
  const nonFunctional: NonFunctionalRequirement[] = (diagram.requirements ?? []).map((r) => {
    const label = requirementLabel(r);
    const result = resultFor(tests, r.loc, label);
    return { label, category: REQUIREMENT_CATEGORY[r.kind], status: statusOf(result), measured: result?.message, hint: result?.passed ? undefined : result?.hint, loc: r.loc };
  });
  const flowTests: FlowTestRow[] = (diagram.tests ?? []).map((t) => {
    const result = resultFor(tests, t.loc, t.name);
    return { name: t.name, assertions: t.assertions.map(assertionLabel), status: statusOf(result), measured: result?.message, hint: result?.passed ? undefined : result?.hint, loc: t.loc };
  });
  if (functional.length || nonFunctional.length || flowTests.length) {
    sections.push({ kind: 'requirements', title: 'Requirements', functional, nonFunctional, flowTests });
  }

  // 3. Capacity estimates
  const traffic: TrafficRow[] = (diagram.traffic ?? []).map((t) => ({ useCase: t.useCase, rps: t.rps, mix: t.mix ?? [] }));
  const load: LoadRow[] = (analysis?.nodes ?? [])
    .filter((n) => n.kind !== 'client')
    .map((n) => ({
      id: n.id,
      name: name(n.id),
      loadRps: n.loadRps,
      capacityRps: n.capacityRps,
      utilization: n.utilization,
      saturated: n.saturated,
      replicas: n.replicas,
      shards: n.shards,
      readLoadRps: n.readLoadRps,
      readCapacityRps: n.readCapacityRps,
      readUtilization: n.readUtilization,
      writeLoadRps: n.writeLoadRps,
      writeCapacityRps: n.writeCapacityRps,
      writeUtilization: n.writeUtilization,
      writeScaling: n.writeScaling,
      egressGbPerMonth: n.egressGbPerMonth,
      egressUsd: n.egressUsd,
      costUsd: n.costUsd,
    }));
  if (traffic.length || load.length) {
    sections.push({ kind: 'capacity', title: 'Capacity estimates', traffic, load, totalCostUsd: analysis?.totalCostUsd, totalEgressUsd: analysis?.totalEgressUsd });
  }

  // 4. Components
  const entities = diagram.entities ?? [];
  const group = (n: DiagramNode) => (n.parent ? byId.get(n.parent)?.name : undefined);
  const componentRows: Component[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    tech: n.implicit ? undefined : n.techStack,
    kind: nodeAnalysis.get(n.id)?.kind ?? kindOf(n),
    team: n.ownerTeam,
    replicas: nodeAnalysis.get(n.id)?.replicas ?? n.replicas ?? 1,
    responsibility: n.description,
    group: group(n),
    entities: entities.filter((e) => e.store === n.id).map((e) => e.name),
  }));
  if (componentRows.length) sections.push({ kind: 'components', title: 'Components', components: componentRows });

  // 5. Data model
  if (entities.length) {
    sections.push({ kind: 'dataModel', title: 'Data model', entities: entities.map((e) => ({ ...e, storeName: e.store ? name(e.store) : undefined })) });
  }

  // 6. APIs
  const endpoints = buildApis(diagram, name);
  if (endpoints.length) sections.push({ kind: 'apis', title: 'APIs', endpoints });

  // 7. Scenarios
  const useCaseAnalysis = new Map(analysis?.useCases.map((u) => [u.id, u]));
  const scenarioUseCases: ScenarioUseCase[] = diagram.useCases.map((u) => {
    const ua = useCaseAnalysis.get(u.id);
    const shares = scenarioShares(u, diagram);
    return {
      useCaseId: u.id,
      name: u.name,
      description: u.description,
      endpoint: u.endpoint,
      rps: ua?.rps ?? diagram.traffic?.find((t) => t.useCase === u.name)?.rps,
      scenarios: u.scenarios.map((s) => {
        const sa = ua?.scenarios.find((x) => x.id === s.id);
        return {
          id: s.id,
          name: s.name,
          outcome: s.outcome,
          condition: s.condition,
          share: sa?.share ?? (shares ? (shares.get(s.name) ?? 0) : undefined),
          latency: sa?.percentiles,
          meanMs: sa?.meanMs,
          steps: s.steps.length,
        };
      }),
    };
  });
  if (scenarioUseCases.length) sections.push({ kind: 'scenarios', title: 'Scenarios', useCases: scenarioUseCases });

  // 8. Decisions
  if (diagram.decisions?.length) sections.push({ kind: 'decisions', title: 'Decisions', decisions: diagram.decisions });

  // 9. Risks
  const risks: Risk[] = [];
  for (const r of nonFunctional.filter((r) => r.status === 'fail')) {
    risks.push({ severity: 'high', kind: 'requirement', title: `Requirement not met: ${r.label}`, detail: r.measured, hint: r.hint });
  }
  for (const t of flowTests.filter((t) => t.status === 'fail')) {
    risks.push({ severity: 'high', kind: 'test', title: `Test failing: ${t.name}`, detail: t.measured, hint: t.hint });
  }
  for (const n of load) {
    const pct = `${Math.round(n.utilization * 100)}%`;
    if (n.saturated) {
      risks.push({ severity: 'high', kind: 'saturated', title: `${n.name} is saturated`, detail: `${formatRps(n.loadRps)} against a capacity of ${formatRps(n.capacityRps)} (${pct})`, hint: 'Add replicas, cache in front of it, or move work async.' });
    } else if (n.utilization > HOT_UTILIZATION) {
      risks.push({ severity: 'medium', kind: 'hot', title: `${n.name} runs hot`, detail: `${pct} utilisation; latency climbs steeply near saturation`, hint: 'Add headroom with another replica.' });
    }
  }
  for (const id of analysis?.singlePointsOfFailure ?? []) {
    const node = byId.get(id);
    risks.push({ severity: 'medium', kind: 'spof', title: `Single point of failure: ${name(id)}${node && !node.implicit ? ` (${node.techStack})` : ''}`, hint: 'Add a replica or a fallback scenario.' });
  }
  for (const u of diagram.useCases.filter(lacksErrorHandling)) {
    risks.push({ severity: 'low', kind: 'no-error-handling', title: `${u.name} has no error scenario`, detail: 'Nothing describes what happens when a call fails or is rejected.', hint: 'Add an alt branch with a -x call or a 4xx/5xx response.' });
  }
  for (const w of analysis?.warnings ?? []) risks.push({ severity: 'low', kind: 'warning', title: w });
  if (risks.length) sections.push({ kind: 'risks', title: 'Risks', risks });

  return { title: diagram.title ?? 'Architecture', summary: diagram.summary, checked: !!analysis || tests.length > 0, sections, diagram };
}

// ── Formatting shared by the renderers ────────────────────────────────────

export function formatRps(rps: number): string {
  if (rps >= 1e6) return `${formatNumber(Number((rps / 1e6).toFixed(2)))}M rps`;
  if (rps >= 1e3) return `${formatNumber(Number((rps / 1e3).toFixed(2)))}k rps`;
  return `${formatNumber(Number(rps.toFixed(2)))} rps`;
}

export const formatMs = (ms: number) => `${ms >= 100 ? Math.round(ms) : formatNumber(Number(ms.toFixed(1)))} ms`;
export const formatPercent = (fraction: number) => `${formatNumber(Number((fraction * 100).toFixed(1)))}%`;
export const formatUsd = (usd: number) => `$${Math.round(usd).toLocaleString('en-US')}`;

/** `2.6 TB`, `260 GB`, `1.5 GB` */
export function formatGb(gb: number): string {
  const n = (x: number, digits: number) => Number(x.toFixed(digits)).toLocaleString('en-US');
  return gb >= 1000 ? `${n(gb / 1000, 1)} TB` : `${n(gb, gb < 10 ? 1 : 0)} GB`;
}

/** Reads or writes of a load row: `10k rps of 40k rps (25%)`, or `—` without load. */
export function accessText(n: LoadRow, access: 'read' | 'write'): string {
  const [load, capacity, utilization] =
    access === 'read' ? [n.readLoadRps, n.readCapacityRps, n.readUtilization] : [n.writeLoadRps, n.writeCapacityRps, n.writeUtilization];
  return load > 0 ? `${formatRps(load)} of ${formatRps(capacity)} (${formatPercent(utilization)})` : '—';
}

/** `3`, or `2 × 4 shards`. */
export const replicasText = (n: LoadRow): string => (n.shards > 1 ? `${n.replicas} × ${n.shards} shards` : String(n.replicas));

/** `130 TB, $2,592`, or `—` when nothing leaves the node. */
export const egressText = (n: LoadRow): string => (n.egressGbPerMonth > 0 ? `${formatGb(n.egressGbPerMonth)}, ${formatUsd(n.egressUsd)}` : '—');

/** The column headings of the load table, shared by the renderers. */
export const LOAD_HEADINGS = ['Component', 'Reads', 'Writes', 'Utilisation', 'Replicas', 'Egress / month', 'Cost / month'];

/** `$4,900 / month`, with the egress part when there is any. */
export const totalCostText = (totalUsd: number, egressUsd = 0): string =>
  `${formatUsd(totalUsd)} / month${egressUsd > 0 ? ` (${formatUsd(egressUsd)} of it egress)` : ''}`;

/** "201 {"id": 1}", "failed", or "—". */
export function responseText(r: ApiResponse): string {
  return [r.status, r.body].filter(Boolean).join(' ') || '—';
}

export function section<K extends HldSectionKind>(doc: HldDocument, kind: K): Extract<HldSection, { kind: K }> | undefined {
  return doc.sections.find((s) => s.kind === kind) as Extract<HldSection, { kind: K }> | undefined;
}
