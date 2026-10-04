import type { Assertion, Diagram, DiagramScenario, DiagramUseCase, FlowTest, Percentile, Requirement, Selector, SourceLoc } from '../dsl/types';
import {
  DEFAULT_TIMEOUT_MS,
  DEPLOYED,
  HOT,
  PERCENTILE_KEYS,
  analyze,
  components,
  mainScenarioIndex,
  replicasOf,
  resolveTraffic,
  type Analysis,
  type NodeAnalysis,
  type UseCaseAnalysis,
} from './analyze';
import {
  criticalPath,
  fallbacksFor,
  findScenario,
  findUseCase,
  needs,
  nodeLabel,
  pathNodes,
  requestOrder,
  selectNodes,
  selectorText,
  writesBeforeResponse,
} from './flow';
import { formatAvailability, formatMs, formatPercent, formatRps, formatUsd } from './format';

/**
 * Requirements and `test` blocks as executable checks
 * (docs/design/hld-and-practice.md §3). Every requirement and every test
 * block yields one result; messages state what was measured and the limit,
 * hints name the lever that fixes a failure.
 */

export interface TestResult {
  /** Stable: `req:<n>` (1-based position in `requirements`) or `test:<name>`. */
  id: string;
  name: string;
  category: 'latency' | 'availability' | 'durability' | 'resilience' | 'cost' | 'flow';
  passed: boolean;
  /** What was measured: "p99 of Redirect is 41 ms (limit 50 ms)". */
  message: string;
  /** How to fix it, when failed. */
  hint?: string;
  /** The requirement or test line. */
  loc?: SourceLoc;
  /** For `test` blocks: the result of each assertion line. */
  assertions?: AssertionResult[];
}

export interface AssertionResult {
  passed: boolean;
  message: string;
  hint?: string;
  loc: SourceLoc;
}

interface Check {
  passed: boolean;
  message: string;
  hint?: string;
}

const pass = (message: string): Check => ({ passed: true, message });
const fail = (message: string, hint?: string): Check => ({ passed: false, message, hint });

/** Context shared by the checks of one run. */
interface Run {
  diagram: Diagram;
  analysis: Analysis;
  nodes: Map<string, NodeAnalysis>;
  useCases: Map<string, UseCaseAnalysis>;
  shares: Map<string, number[]>;
}

export function runTests(diagram: Diagram, analysis: Analysis = analyze(diagram)): TestResult[] {
  const run: Run = {
    diagram,
    analysis,
    nodes: new Map(analysis.nodes.map((n) => [n.id, n])),
    useCases: new Map(analysis.useCases.map((u) => [u.id, u])),
    shares: new Map([...resolveTraffic(diagram)].map(([id, t]) => [id, t.shares])),
  };
  const results: TestResult[] = (diagram.requirements ?? []).map((r, i) => ({
    id: `req:${i + 1}`,
    name: requirementName(r),
    category: CATEGORY[r.kind],
    ...requirement(run, r),
    loc: r.loc,
  }));
  const names = new Map<string, number>();
  for (const test of diagram.tests ?? []) {
    const n = (names.get(test.name) ?? 0) + 1;
    names.set(test.name, n);
    results.push({ id: n === 1 ? `test:${test.name}` : `test:${test.name}#${n}`, name: test.name, category: 'flow', ...flowTest(run, test), loc: test.loc });
  }
  return results.map(({ hint, ...r }) => (r.passed || !hint ? r : { ...r, hint }));
}

const CATEGORY: Record<Requirement['kind'], TestResult['category']> = {
  latency: 'latency',
  availability: 'availability',
  durable: 'durability',
  survive: 'resilience',
  cost: 'cost',
};

const percentileName = (q: Percentile) => PERCENTILE_KEYS[q];

/** The requirement line in words: "p99 of Redirect < 50 ms". */
export function requirementName(r: Requirement): string {
  switch (r.kind) {
    case 'latency':
      return `${percentileName(r.percentile)} of ${r.useCase ?? 'every use case'} < ${formatMs(r.maxMs)}`;
    case 'availability':
      return `availability of ${r.useCase ?? 'every use case'} ≥ ${r.minPercent}%`;
    case 'durable':
      return `${r.useCase} is durable`;
    case 'survive':
      return r.target === 'any' ? 'survive any node failure' : `survive failure of ${selectorText(r.target)}`;
    case 'cost':
      return `cost ≤ ${formatUsd(r.maxUsdPerMonth)}`;
  }
}

function requirement(run: Run, r: Requirement): Check {
  switch (r.kind) {
    case 'latency':
      return overUseCases(run, r.useCase, (u) => latency(run, u, r.percentile, r.maxMs), `(limit ${formatMs(r.maxMs)})`);
    case 'availability':
      return overUseCases(run, r.useCase, (u) => availability(run, u, r.minPercent), `(limit ${r.minPercent}%)`, true);
    case 'durable':
      return durable(run, r.useCase);
    case 'survive':
      return survive(run, r.target);
    case 'cost':
      return cost(run, r.maxUsdPerMonth);
  }
}

/**
 * Checks one named use case, or every use case with traffic (with
 * `anyWithoutTraffic`, every use case when none has traffic).
 */
function overUseCases(run: Run, name: string | undefined, check: (u: DiagramUseCase) => Check & { value?: string }, limit: string, anyWithoutTraffic = false): Check {
  if (name !== undefined) {
    const u = findUseCase(run.diagram, name);
    return u ? check(u) : unknownUseCase(run, name);
  }
  let targets = run.diagram.useCases.filter((u) => (run.useCases.get(u.id)?.rps ?? 0) > 0);
  if (targets.length === 0 && anyWithoutTraffic) targets = run.diagram.useCases;
  if (targets.length === 0) return fail('No use case has traffic, so there is nothing to measure', 'Add traffic { "<use case>" 1k rps } for the use cases this applies to');
  const checks = targets.map(check);
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) {
    return pass(checks.length === 1 ? checks[0].message : `All ${checks.length} use cases hold; ${checks.map((c) => c.value).join(', ')} ${limit}`);
  }
  return fail(failed.length === 1 ? failed[0].message : `${failed.map((c) => c.value ?? c.message).join('; ')} ${limit}`, failed[0].hint);
}

function unknownUseCase(run: Run, name: string): Check {
  const known = run.diagram.useCases.map((u) => `"${u.name}"`);
  return fail(`No use case named "${name}"`, known.length ? `Use one of ${known.join(', ')}` : 'Add a usecase "…" { … } block');
}

function latency(run: Run, u: DiagramUseCase, q: Percentile, maxMs: number): Check & { value?: string } {
  const result = run.useCases.get(u.id)!;
  const key = percentileName(q);
  const shares = run.shares.get(u.id) ?? [];
  // A saturated node fails every latency requirement whose use case sends it load.
  const touched = new Set(u.scenarios.flatMap((s, i) => ((shares[i] ?? 0) > 0 ? s.steps.map((step) => step.toServiceId) : [])));
  const saturated = [...touched].map((id) => run.nodes.get(id)).filter((n): n is NodeAnalysis => !!n?.saturated);
  if (saturated.length) {
    const n = saturated[0];
    const usage = `${formatRps(n.loadRps)} of ${formatRps(n.capacityRps)}, ${formatPercent(n.utilization)}`;
    const value = `${key} of ${u.name}: ${n.id} is saturated (${usage})`;
    return { ...fail(`${value} (limit ${formatMs(maxMs)})`, saturationHint(run, n)), value };
  }
  const ms = result.percentiles[key];
  const value = `${key} of ${u.name} is ${formatMs(ms)}${result.rps > 0 ? '' : ' with no traffic'}`;
  const message = `${value} (limit ${formatMs(maxMs)})`;
  return ms < maxMs ? { ...pass(message), value } : { ...fail(message, latencyHint(run, u, result, key, ms)), value };
}

function saturationHint(run: Run, n: NodeAnalysis): string {
  const perReplica = n.capacityRps / n.replicas;
  const replicas = Math.ceil(n.loadRps / (perReplica * HOT));
  return `Add replicas to ${nodeLabel(run.diagram, n.id)}: x${replicas} keeps it under ${formatPercent(HOT)}, or take load off it (a cache in front, or async work)`;
}

/** Names the scenario that sets the percentile and its slowest hop. */
function latencyHint(run: Run, u: DiagramUseCase, result: UseCaseAnalysis, key: keyof UseCaseAnalysis['percentiles'], ms: number): string {
  const index = result.scenarios.findIndex((s) => s.percentiles[key] === ms);
  const scenario = u.scenarios[Math.max(0, index)];
  const lead =
    u.scenarios.length > 1 ? `The "${scenario.name}" path (${formatPercent(result.scenarios[Math.max(0, index)].share)} of traffic) sets ${key}. ` : '';
  const hops = criticalPath(u, scenario).flat();
  const cost = (h: (typeof hops)[number]) => (h.failed ? DEFAULT_TIMEOUT_MS : (run.nodes.get(h.target)?.latencyMs ?? 0));
  const slowest = hops.reduce<(typeof hops)[number] | undefined>((best, h) => (!best || cost(h) > cost(best) ? h : best), undefined);
  if (!slowest) return `${lead}Shorten the synchronous path of the request.`;
  const label = nodeLabel(run.diagram, slowest.target);
  if (slowest.failed) return `${lead}It waits ${formatMs(DEFAULT_TIMEOUT_MS)} for the failed call to ${label}; give that path a smaller share of traffic or avoid the call.`;
  const node = run.nodes.get(slowest.target);
  if (node && node.utilization > HOT) return `${lead}${label} runs at ${formatPercent(node.utilization)} and queues requests; add replicas to it.`;
  return `${lead}Its slowest hop is ${label} at ${formatMs(cost(slowest))}: put a cache in front of it, run independent calls in par, or move work off the request path with ->>.`;
}

function availability(run: Run, u: DiagramUseCase, minPercent: number): Check & { value?: string } {
  const result = run.useCases.get(u.id)!;
  const value = `availability of ${u.name} is ${formatAvailability(result.availability)}`;
  const message = `${value} (limit ${minPercent}%)`;
  if (result.availability * 100 >= minPercent - 1e-9) return { ...pass(message), value };
  // The weakest node on the main path that has no fallback.
  const shares = run.shares.get(u.id) ?? [];
  const main = u.scenarios.length ? pathNodes(u, u.scenarios[mainScenarioIndex(shares)]) : [];
  const weakest = main
    .filter((id) => fallbacksFor(u, id).length === 0)
    .map((id) => run.nodes.get(id))
    .filter((n): n is NodeAnalysis => !!n && n.availability < 1)
    .sort((a, b) => a.availability - b.availability)[0];
  const hint = weakest
    ? `The weakest link is ${nodeLabel(run.diagram, weakest.id)} at ${formatAvailability(weakest.availability)}: add a replica (x${weakest.replicas + 1}) or a fallback scenario that calls it with -x and still completes`
    : 'Add replicas to the nodes on the main path, or fallback scenarios that complete without them';
  return { ...fail(message, hint), value };
}

type WriteGap = 'async' | 'after' | 'none';

/** Why a scenario does not write to an accepted node synchronously before responding. */
function writeGap(u: DiagramUseCase, s: DiagramScenario, accept: (id: string) => boolean): WriteGap {
  const { requests, beforeResponse } = requestOrder(u, s);
  const writes = requests.map((m, i) => ({ m, i })).filter(({ m }) => !m.failed && accept(m.to));
  if (writes.some(({ m, i }) => m.async && i < beforeResponse)) return 'async';
  if (writes.some(({ i }) => i >= beforeResponse)) return 'after';
  return 'none';
}

const GAP_TEXT: Record<WriteGap, string> = {
  async: 'writes only asynchronously (->>)',
  after: 'writes only after responding',
  none: 'never writes',
};

/** Every success scenario writes to a node accepted by `accept`, synchronously, before the entry response. */
function writesCheck(
  u: DiagramUseCase,
  scenarios: DiagramScenario[],
  accept: (id: string) => boolean,
  what: string,
): Check {
  const success = scenarios.filter((s) => s.outcome === 'success');
  if (success.length === 0) return fail(`"${u.name}" has no success scenario to check`, 'Add a scenario whose entry request is answered with a 2xx');
  const gaps = success.map((s) => ({ s, ok: writesBeforeResponse(u, s, accept) })).filter((x) => !x.ok);
  if (gaps.length === 0) {
    const label = success.length === 1 ? `"${u.name}"` : `Every success scenario of "${u.name}"`;
    return pass(`${label} writes ${what} before responding`);
  }
  const details = gaps.map(({ s }) => ({ s, gap: writeGap(u, s, accept) }));
  const where = (s: DiagramScenario) => (u.scenarios.length > 1 ? `"${s.name}"` : `"${u.name}"`);
  const message = details.map(({ s, gap }) => `${where(s)} ${GAP_TEXT[gap]} ${what} before responding`).join('; ');
  const gap = details[0].gap;
  const hint =
    gap === 'async'
      ? `Make the write a synchronous request (->) so it is acknowledged before the response`
      : gap === 'after'
        ? `Move the write before the step that answers the entry request`
        : `Add a synchronous write (->) to ${what} before the entry request is answered`;
  return fail(message, hint);
}

function durable(run: Run, name: string): Check {
  const u = findUseCase(run.diagram, name);
  if (!u) return unknownUseCase(run, name);
  return writesCheck(u, u.scenarios, (id) => !!run.nodes.get(id)?.durable, 'to a durable store');
}

function survive(run: Run, target: Selector | 'any'): Check {
  const all = components(run.diagram);
  const selected = target === 'any' ? all.filter((n) => DEPLOYED(run.nodes.get(n.id)!.kind)) : selectNodes(run.diagram, target);
  const what = target === 'any' ? 'any one node' : selectorText(target);
  if (selected.length === 0) {
    return target === 'any' ? pass('No nodes to lose') : fail(`No node matches ${what}`, 'Use a node id, [Tech] or any <kind>');
  }
  const failures: Check[] = [];
  for (const node of selected) {
    const n = run.nodes.get(node.id)!;
    const label = nodeLabel(run.diagram, node.id);
    const replicas = replicasOf(node);
    if (replicas >= 2) {
      const left = (n.capacityRps / replicas) * (replicas - 1);
      const rho = n.loadRps / left;
      if (rho >= 1) {
        failures.push(
          fail(
            `Losing one of ${replicas} ${node.id} replicas leaves ${formatRps(left)} for ${formatRps(n.loadRps)} (${formatPercent(rho)})`,
            `Add a replica to ${label} (x${replicas + 1}) so the rest carry the load`,
          ),
        );
      }
      continue;
    }
    for (const u of run.diagram.useCases) {
      if (needs(u, node.id) && fallbacksFor(u, node.id).length === 0) {
        failures.push(
          fail(
            `Losing ${label} breaks "${u.name}"`,
            `Add a replica (x2 on ${node.id}) or a fallback scenario in "${u.name}" that calls ${node.id} with -x and still completes`,
          ),
        );
      }
    }
  }
  if (failures.length === 0) {
    const count = selected.length === 1 ? selected[0].id : `any of ${selected.length} nodes`;
    return pass(`Every use case keeps working after losing ${count}`);
  }
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
  return fail(`${failures[0].message}${more}`, failures[0].hint);
}

function cost(run: Run, max: number): Check {
  const total = run.analysis.totalCostUsd;
  const message = `Total cost is ${formatUsd(total)} (limit ${formatUsd(max)})`;
  if (total <= max) return pass(message);
  const top = [...run.analysis.nodes]
    .filter((n) => n.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3)
    .map((n) => `${n.id} ${formatUsd(n.costUsd)}${n.replicas > 1 ? ` (${n.replicas} replicas)` : ''}`);
  return fail(message, `Biggest items: ${top.join(', ')}. Drop replicas on nodes with low utilisation or pick cheaper techs.`);
}

// ---------------------------------------------------------------- test blocks

function flowTest(run: Run, test: FlowTest): Omit<TestResult, 'id' | 'name' | 'category'> {
  const assertions: AssertionResult[] = test.assertions.map((a) => ({ ...assertion(run, a), loc: a.loc }));
  const failed = assertions.filter((a) => !a.passed);
  if (assertions.length === 0) return { passed: true, message: 'No assertions to check', assertions };
  if (failed.length === 0) {
    return { passed: true, message: assertions.length === 1 ? assertions[0].message : `All ${assertions.length} assertions hold`, assertions };
  }
  return { passed: false, message: failed.map((a) => a.message).join('; '), hint: failed[0].hint, assertions };
}

const quote = (s: string) => `"${s}"`;

/** The use case and the scenarios an assertion looks at, or why it cannot. */
function scope(run: Run, useCase: string, scenario?: string): { u: DiagramUseCase; scenarios: DiagramScenario[]; label: string } | Check {
  const u = findUseCase(run.diagram, useCase);
  if (!u) return unknownUseCase(run, useCase);
  if (scenario === undefined) return { u, scenarios: u.scenarios, label: quote(u.name) };
  const s = findScenario(u, scenario);
  if (!s) return missingScenario(u, scenario);
  return { u, scenarios: [s], label: `${quote(u.name)} scenario ${quote(s.name)}` };
}

function missingScenario(u: DiagramUseCase, scenario: string): Check {
  const names = u.scenarios.map((s) => quote(s.name)).join(', ');
  return fail(`${quote(u.name)} has no scenario ${quote(scenario)}${names ? `; it has ${names}` : ''}`, `Add alt "${scenario}" { … } to "${u.name}"`);
}

const isCheck = (x: object): x is Check => 'passed' in x;

function assertion(run: Run, a: Assertion): Check {
  switch (a.kind) {
    case 'calls':
      return calls(run, a);
    case 'before':
      return before(run, a);
    case 'writesBeforeResponding': {
      const sc = scope(run, a.useCase, a.scenario);
      if (isCheck(sc)) return sc;
      const ids = new Set(selectNodes(run.diagram, a.target).map((n) => n.id));
      if (ids.size === 0) return noMatch(a.target);
      return writesCheck(sc.u, sc.scenarios, (id) => ids.has(id), selectorText(a.target));
    }
    case 'responds':
      return responds(run, a);
    case 'hasScenario': {
      const u = findUseCase(run.diagram, a.useCase);
      if (!u) return unknownUseCase(run, a.useCase);
      const s = findScenario(u, a.scenario);
      return s ? pass(`${quote(u.name)} has scenario ${quote(s.name)}`) : missingScenario(u, a.scenario);
    }
    case 'handlesFailure': {
      const u = findUseCase(run.diagram, a.useCase);
      if (!u) return unknownUseCase(run, a.useCase);
      const ids = new Set(selectNodes(run.diagram, a.target).map((n) => n.id));
      if (ids.size === 0) return noMatch(a.target);
      const handled = u.scenarios.find((s) => s.outcome === 'success' && s.steps.some((step) => step.failed && ids.has(step.toServiceId)));
      const what = selectorText(a.target);
      return handled
        ? pass(`${quote(u.name)} handles a failed call to ${what} in ${quote(handled.name)}`)
        : fail(
            `No success scenario of ${quote(u.name)} has a failed call to ${what}`,
            `Add alt "${what} down" { … -x ${[...ids][0]} … } that still answers the entry request with a 2xx`,
          );
    }
    case 'noPath':
      return noPath(run, a.from, a.to);
    case 'replicas': {
      const nodes = selectNodes(run.diagram, a.target);
      if (nodes.length === 0) return noMatch(a.target);
      const short = nodes.filter((n) => replicasOf(n) < a.min);
      const has = (n: (typeof nodes)[number]) => `${n.id} has ${replicasOf(n)} replica${replicasOf(n) === 1 ? '' : 's'}`;
      if (short.length === 0) return pass(`${nodes.map(has).join(', ')} (minimum ${a.min})`);
      return fail(`${short.map(has).join(', ')} (minimum ${a.min})`, `Declare ${short[0].id} with x${a.min}`);
    }
  }
}

function noMatch(selector: Selector): Check {
  return fail(`No node matches ${selectorText(selector)}`, 'Use a node id, [Tech] or any <kind> (any cache, any database, …)');
}

function calls(run: Run, a: Extract<Assertion, { kind: 'calls' }>): Check {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const what = selectorText(a.target);
  const ids = new Set(selectNodes(run.diagram, a.target).map((n) => n.id));
  const called = (s: DiagramScenario) => s.steps.filter((step) => ids.has(step.toServiceId)).map((step) => step.toServiceId);
  const calling = sc.scenarios.filter((s) => called(s).length > 0);
  const names = (list: DiagramScenario[]) => list.map((s) => quote(s.name)).join(', ');
  const multi = sc.scenarios.length > 1;

  if (a.quantifier === 'never') {
    if (calling.length === 0) return pass(`${sc.label} never calls ${what}`);
    const first = calling[0];
    return fail(
      `${multi ? quote(first.name) : sc.label} calls ${nodeLabel(run.diagram, called(first)[0])}`,
      `Take the call to ${called(first)[0]} out of ${quote(first.name)}, e.g. serve it from a cache`,
    );
  }
  if (ids.size === 0) return noMatch(a.target);
  if (a.quantifier === 'some') {
    if (calling.length) return pass(`${sc.label} calls ${what}${multi ? ` in ${names(calling)}` : ''}`);
    return fail(`${sc.label} never calls ${what}`, `Add a step to ${what}`);
  }
  const missing = sc.scenarios.filter((s) => !calling.includes(s));
  if (missing.length === 0 && sc.scenarios.length) return pass(`Every scenario of ${sc.label} calls ${what}`);
  return fail(`${sc.label} does not call ${what} in ${names(missing) || 'any scenario'}`, `Add a step to ${what} in ${names(missing) || 'a scenario'}`);
}

function before(run: Run, a: Extract<Assertion, { kind: 'before' }>): Check {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const first = new Set(selectNodes(run.diagram, a.first).map((n) => n.id));
  const then = new Set(selectNodes(run.diagram, a.then).map((n) => n.id));
  const [x, y] = [selectorText(a.first), selectorText(a.then)];
  if (first.size === 0) return noMatch(a.first);
  if (then.size === 0) return noMatch(a.then);
  let checked = 0;
  for (const s of sc.scenarios) {
    const order = requestOrder(sc.u, s).requests.map((m) => m.to);
    const iy = order.findIndex((id) => then.has(id));
    if (iy < 0) continue;
    checked++;
    const ix = order.findIndex((id) => first.has(id));
    if (ix < 0 || ix > iy) {
      const where = sc.scenarios.length > 1 || a.scenario ? `In ${quote(s.name)}` : `In ${quote(sc.u.name)}`;
      return fail(
        ix < 0 ? `${where}, ${order[iy]} is called but ${x} never is` : `${where}, ${order[iy]} is called before ${order[ix]}`,
        `Call ${x} before the first call to ${y}`,
      );
    }
  }
  if (checked === 0) return fail(`${sc.label} never calls ${y}`, `Add a step to ${y} after the call to ${x}`);
  return pass(`${sc.label} calls ${x} before ${y}${checked > 1 ? ` in all ${checked} scenarios that call ${y}` : ''}`);
}

/** `201` exactly, or a class: `2xx`. */
function statusMatches(status: number | undefined, wanted: string): boolean {
  if (status === undefined) return false;
  const cls = /^([1-5])xx$/i.exec(wanted);
  return cls ? Math.floor(status / 100) === Number(cls[1]) : String(status) === wanted;
}

function responds(run: Run, a: Extract<Assertion, { kind: 'responds' }>): Check {
  const sc = scope(run, a.useCase, a.scenario);
  if (isCheck(sc)) return sc;
  const hit = sc.scenarios.find((s) => statusMatches(s.steps[0]?.statusCode, a.status));
  if (hit) return pass(`${sc.label} responds ${hit.steps[0].statusCode}${sc.scenarios.length > 1 ? ` in ${quote(hit.name)}` : ''}`);
  const seen = [...new Set(sc.scenarios.map((s) => (s.steps[0]?.failed ? 'a failed call' : (s.steps[0]?.statusCode ?? 'no status'))))];
  return fail(`${sc.label} never responds ${a.status}; it answers ${seen.join(', ') || 'nothing'}`, `Add a scenario (alt) whose entry request is answered with ${a.status}`);
}

/**
 * `no path from X to Y`: no architecture connection and no use case step goes
 * directly from a node matching X to one matching Y. (Chains through other
 * nodes are allowed: client → gateway → service → db is how a working design
 * reaches its database.)
 */
function noPath(run: Run, from: Selector, to: Selector): Check {
  const sources = new Set(selectNodes(run.diagram, from).map((n) => n.id));
  const targets = new Set(selectNodes(run.diagram, to).map((n) => n.id));
  const [x, y] = [selectorText(from), selectorText(to)];
  const line = (loc: SourceLoc) => `${loc.file ? `${loc.file}:` : 'line '}${loc.line}`;
  const hint = `Route it through a node that guards ${y} (a gateway or a service) instead of going there directly`;
  const edge = run.diagram.edges.find((e) => sources.has(e.source) && targets.has(e.target));
  if (edge) return fail(`The connection ${edge.source} -> ${edge.target} (${line(edge.loc)}) goes directly from ${x} to ${y}`, hint);
  for (const u of run.diagram.useCases) {
    for (const s of u.scenarios) {
      const step = s.steps.find((st) => sources.has(st.fromServiceId) && targets.has(st.toServiceId));
      if (step) {
        const where = u.scenarios.length > 1 ? `${quote(u.name)} scenario ${quote(s.name)}` : quote(u.name);
        return fail(`The step ${step.fromServiceId} -> ${step.toServiceId} in ${where} (${line(step.loc)}) goes directly from ${x} to ${y}`, hint);
      }
    }
  }
  return pass(`No connection or step goes directly from ${x} to ${y}`);
}
