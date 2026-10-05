import { formatAvailability, formatMs, formatPercent, formatRps, formatUsd } from '../sim/format';
import type {
  DesignReview,
  DesignReviewIssue,
  DesignReviewRequest,
  ReviewHop,
  ReviewNodeMetrics,
  ReviewScenario,
  ReviewSeverity,
  ReviewTestResult,
  ReviewUseCaseMetrics,
} from './contract';

/**
 * The rule reviewer: a design review computed on the page, at once and
 * deterministically, from the same DesignReviewRequest an LLM would get
 * (./contract.ts). Every finding comes from the request's data: the parser's
 * diagnostics, the test results and the simulation's numbers. It never sees
 * the reference solution, and says nothing it cannot point at.
 */

/** Utilisation from which a node is reported as close to saturation. */
export const NEAR_SATURATION = 0.8;
/** Utilisation the replica and shard counts the review suggests keep a node under (the simulation's HOT). */
export const TARGET_UTILIZATION = 0.7;
/** A measured latency at or past this share of its limit is reported as close to it. */
export const NEAR_LIMIT = 0.8;
/** A hop to a third party or an analytics store at least this slow, waited for on the request path, is reported. */
export const SLOW_DEPENDENCY_MS = 50;
/** A third party whose answer a response rarely needs: notifications, analytics, logging (by its tech or name). */
const SIDE_EFFECT = /e-?mail|mail|sms|push|notif|webhook|analytics|tracking|logging|\blogs?\b/i;
/** Kinds you deploy and size yourself (sim/analyze.ts DEPLOYED). */
const DEPLOYED = (kind: string) => !['client', 'other', 'external', 'dns'].includes(kind);

const ORDER: Record<ReviewSeverity, number> = { critical: 0, major: 1, minor: 2, info: 3 };

interface Finding extends DesignReviewIssue {
  /** A concrete next step, offered as a suggestion when the finding is among the first. */
  suggestion?: string;
}

/** Everything the rules share: the request, indexed. */
interface Context {
  request: DesignReviewRequest;
  nodes: Map<string, ReviewNodeMetrics>;
  useCases: ReviewUseCaseMetrics[];
  failing: ReviewTestResult[];
  /** Ids of failing tests a finding already explains, so they are not listed twice. */
  covered: Set<string>;
  label: (id: string) => string;
  given: (id: string) => boolean;
  /** Names of use cases the problem's traffic or tests refer to that the design does not have. */
  missing: string[];
}

const pct = formatPercent;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const usd = (x: number) => formatUsd(x).replace('/month', '');
const quote = (name: string) => `"${name}"`;
/** `a`, `a and b`, `a, b and c` */
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Reviews a design from its request. Pure and synchronous; ruleReviewer wraps it. */
export function reviewDesign(request: DesignReviewRequest): DesignReview {
  const model = request.model;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const metrics = request.metrics;
  const ctx: Context = {
    request,
    nodes: new Map((metrics?.nodes ?? []).map((n) => [n.id, n])),
    useCases: metrics?.useCases ?? [],
    failing: (request.tests?.results ?? []).filter((r) => !r.passed),
    covered: new Set(),
    label: (id) => {
      const tech = byId.get(id)?.tech;
      return tech ? `${id} (${tech})` : id;
    },
    given: (id) => !!byId.get(id)?.given,
    missing: [],
  };
  const unknownUseCase = (text: string) => /^(?:Traffic for unknown use case|No use case named) "(.+?)"/.exec(text)?.[1];
  ctx.missing = [
    ...new Set(
      [
        ...ctx.failing.map((t) => unknownUseCase(t.message)),
        ...(metrics?.warnings ?? []).map(unknownUseCase),
        ...model.diagnostics.map((d) => (d.severity === 'warning' ? UNKNOWN_USE_CASE.exec(d.message)?.[1] : undefined)),
      ].filter((n): n is string => n !== undefined),
    ),
  ];
  const sideEffect = (id: string) => {
    const node = byId.get(id);
    return ctx.nodes.get(id)?.kind === 'analytics' || (ctx.nodes.get(id)?.kind === 'external' && SIDE_EFFECT.test(`${node?.tech ?? ''} ${node?.name ?? ''} ${id}`));
  };

  const findings: Finding[] = [...diagnostics(ctx)];
  const errors = model.diagnostics.filter((d) => d.severity === 'error').length;
  if (errors > 0 || request.tests?.blocked === 'errors') {
    return finish(ctx, findings, [], `The design has ${plural(errors, 'error')}; fix ${errors === 1 ? 'it' : 'them'} first, since the simulation and the tests run only on a design without errors.`);
  }
  if (request.tests?.blocked === 'no-engine' || !metrics) {
    findings.push({
      severity: 'info',
      title: 'No simulation to review',
      detail: 'The simulation did not run, so there are no load, latency, availability or cost numbers to comment on.',
    });
    findings.push(...missingUseCases(ctx), ...failingTests(ctx));
    return finish(ctx, findings, [], 'Without the simulation, this review can only report the parser’s diagnostics and the tests.');
  }

  findings.push(
    ...missingUseCases(ctx),
    ...saturation(ctx),
    ...latency(ctx),
    ...availability(ctx),
    ...singlePointsOfFailure(ctx),
    ...cost(ctx),
    ...durability(ctx),
    ...cacheFallbacks(ctx),
    ...slowDependencies(ctx, sideEffect),
    ...unused(ctx),
    ...simulationWarnings(ctx),
  );
  // Last: the failing tests no finding above explains.
  findings.push(...failingTests(ctx));
  return finish(ctx, findings, strengths(ctx));
}

/** Sorts the findings by severity (stable: diagnostics stay first), and writes the summary and the suggestions. */
function finish(ctx: Context, findings: Finding[], strengthList: string[], summary?: string): DesignReview {
  const sorted = findings.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.severity] - ORDER[b.f.severity] || a.i - b.i).map(({ f }) => f);
  const suggestions = [...new Set(sorted.flatMap((f) => (f.suggestion ? [f.suggestion] : [])))].slice(0, 3);
  const issues = sorted.map((f): DesignReviewIssue => ({ severity: f.severity, title: f.title, detail: f.detail, ...(f.nodeId !== undefined ? { nodeId: f.nodeId } : {}) }));
  return { summary: summary ?? summarize(ctx, sorted), strengths: strengthList, issues, suggestions, by: 'rules' };
}

function summarize(ctx: Context, findings: Finding[]): string {
  const tests = ctx.request.tests;
  const testPart = !tests || tests.total === 0 ? undefined : tests.solved ? `All ${tests.total} tests pass` : `${tests.passed} of ${tests.total} tests pass`;
  const top = findings[0];
  const pressing = top && (top.severity === 'critical' || top.severity === 'major') ? top : undefined;
  if (!pressing) {
    const rest = 'the simulation shows no critical or major issue';
    return testPart ? `${testPart}, and ${rest}.` : `${rest[0].toUpperCase()}${rest.slice(1)}.`;
  }
  const count = findings.filter((f) => f.severity === pressing.severity).length;
  const more = count > 1 ? ` (one of ${count} ${pressing.severity} findings)` : '';
  return `${testPart ? `${testPart}. ` : ''}Most pressing${more}: ${pressing.title}.`;
}

// ---------- rules ----------

/** The parser's warning for a use case named in traffic, requirements or tests that does not exist; missingUseCases reports those. */
const UNKNOWN_USE_CASE = /^Unknown use case '(.+)'$/;

function diagnostics(ctx: Context): Finding[] {
  const all = ctx.request.model.diagnostics.filter((d) => !(d.severity === 'warning' && UNKNOWN_USE_CASE.test(d.message)));
  const at = (line?: number) => (line !== undefined ? ` on line ${line}` : '');
  const errors = all.filter((d) => d.severity === 'error');
  const warnings = all.filter((d) => d.severity === 'warning');
  const shown = (items: typeof all, max: number, severity: ReviewSeverity, what: string): Finding[] => {
    const out: Finding[] = items.slice(0, max).map((d) => ({ severity, title: `${what}${at(d.line)}`, detail: d.message }));
    if (items.length > max) out.push({ severity, title: `${plural(items.length - max, `more ${what.toLowerCase()}`)}`, detail: 'The editor lists every one under the code.' });
    return out;
  };
  const out = [...shown(errors, 5, 'critical', 'Error'), ...shown(warnings, 3, 'minor', 'Warning')];
  if (errors.length) out[0].suggestion = `Fix the ${errors.length === 1 ? 'error' : `${errors.length} errors`} in the code so the simulation and the tests can run.`;
  return out;
}

/** `Redirect sends 9.5k rps (95%) and Shorten 100 rps (1%)` */
function drivers(n: ReviewNodeMetrics): string {
  const top = n.loadBy.slice(0, 2).map((l) => `${quote(l.useCase)} ${formatRps(l.rps)}${n.loadBy.length > 1 && n.loadRps > 0 ? ` (${pct(l.rps / n.loadRps)})` : ''}`);
  if (top.length === 0) return '';
  return n.loadBy.length === 1 ? `All of it comes from ${top[0]}.` : `Most of it comes from ${list(top)}.`;
}

/** What it takes to bring a node under TARGET_UTILIZATION. */
function capacityFix(ctx: Context, n: ReviewNodeMetrics): string {
  const label = ctx.label(n.id);
  if (n.bandwidthBound) {
    return `Send the payload bytes around ${n.id} (clients upload to and download from object storage or a CDN directly), or run ${label} as x${Math.ceil((n.utilization * n.replicas) / TARGET_UTILIZATION)}.`;
  }
  if (n.writeBound) {
    return `Add shards to ${label}: capacity { ${n.id} shards ${Math.ceil((n.utilization * n.shards) / TARGET_UTILIZATION)} } keeps its writes under ${pct(TARGET_UTILIZATION)}; read replicas do not add write capacity.`;
  }
  if (n.kind === 'external') return `Call ${label} less: cache its answers, or batch the calls.`;
  return `Run ${label} as x${Math.ceil((n.utilization * n.replicas) / TARGET_UTILIZATION)} to keep it under ${pct(TARGET_UTILIZATION)}, or take load off it (a cache in front, or async work).`;
}

function saturation(ctx: Context): Finding[] {
  const out: Finding[] = [];
  const hot = [...ctx.nodes.values()].filter((n) => n.kind !== 'client' && n.kind !== 'other' && n.utilization >= NEAR_SATURATION).sort((a, b) => b.utilization - a.utilization);
  for (const n of hot) {
    const saturated = n.utilization >= 1;
    const what = n.bandwidthBound ? 'its network bandwidth' : n.writeBound ? 'its write capacity (one primary per shard)' : 'its capacity';
    const effect = saturated
      ? 'Requests queue without bound, so every use case that calls it misses its latency limits.'
      : 'Little is left for a traffic spike or for losing a replica, and queueing already adds latency.';
    // `survive …` fails with "Losing one of 2 <id> replicas leaves …" when the node is short of capacity: the same cause.
    const survive = ctx.failing.find(
      (t) => t.category === 'resilience' && !t.message.includes('(and ') && new RegExp(`^Losing one of (?:the )?\\d+ (?:replicas of an? )?${escape(n.id)} (?:replicas|shard) leaves`).test(t.message),
    );
    if (survive) ctx.covered.add(survive.id);
    const fails = survive ? ` It also fails ${quote(survive.name)}: ${survive.message}.` : '';
    out.push({
      severity: saturated ? 'critical' : 'major',
      title: `${n.id} is ${saturated ? 'saturated' : 'close to saturation'} at ${pct(n.utilization)}`,
      detail: `${ctx.label(n.id)} takes ${formatRps(n.loadRps)} and is at ${pct(n.utilization)} of ${what}. ${drivers(n)} ${effect}${fails}`.replace(/ {2,}/g, ' '),
      nodeId: n.id,
      suggestion: capacityFix(ctx, n),
    });
    // A saturated node fails the latency requirements of the use cases that load it: this finding explains them.
    if (saturated) {
      const loaders = new Set(n.loadBy.map((l) => l.useCase));
      for (const u of ctx.useCases) if (loaders.has(u.name)) for (const l of u.latency ?? []) if (l.testId && l.ms >= l.limitMs) ctx.covered.add(l.testId);
      for (const t of ctx.failing) if (t.category === 'latency' && t.message.includes(`${n.id} is saturated`)) ctx.covered.add(t.id);
    }
  }
  return out;
}

/** The scenario a latency figure is about: the tail scenario, or the main one. */
function scenarioOf(u: ReviewUseCaseMetrics, name?: string): ReviewScenario | undefined {
  const scenarios = u.scenarios ?? [];
  return scenarios.find((s) => s.name === name) ?? [...scenarios].sort((a, b) => b.share - a.share)[0];
}

/** The use case starts at a client: someone waits for its answer (not a worker or a scheduled job). */
function clientFacing(ctx: Context, u: ReviewUseCaseMetrics): boolean {
  const entry = u.scenarios?.[0]?.path[0]?.from;
  return entry !== undefined && ctx.nodes.get(entry)?.kind === 'client';
}

const slowestHop = (path: ReviewHop[]): ReviewHop | undefined => path.reduce<ReviewHop | undefined>((best, h) => (!best || h.ms > best.ms ? h : best), undefined);

/** Where the time goes on a scenario's path, and the lever for it. */
function whereTimeGoes(ctx: Context, u: ReviewUseCaseMetrics, s: ReviewScenario | undefined): { text: string; fix?: string } {
  if (!s || s.path.length === 0) return { text: '' };
  const lead = (u.scenarios?.length ?? 0) > 1 ? `Most slow requests take the ${quote(s.name)} path (${pct(s.share)} of traffic). ` : '';
  const hop = slowestHop(s.path)!;
  const label = ctx.label(hop.to);
  if (hop.failed) {
    return {
      text: `${lead}It waits ${formatMs(hop.ms)} for the failed call ${hop.from} -x ${hop.to}.`,
      fix: `Time out sooner on ${hop.to} (capacity { ${hop.to} timeout 200ms }), or give the path that calls it with -x a smaller share.`,
    };
  }
  const kind = ctx.nodes.get(hop.to)?.kind ?? '';
  const transfer = hop.transferMs ? ` (${formatMs(hop.transferMs)} of it moving the payload)` : '';
  const text = `${lead}Its slowest hop is ${hop.from} ${hop.async ? '->>' : '->'} ${label}, ${formatMs(hop.ms)} on average${transfer}, on a path of ${plural(s.path.length, 'hop')}.`;
  if (hop.transferMs && hop.transferMs > hop.ms / 2) {
    return { text, fix: `Move fewer bytes on the ${quote(u.name)} path: compress the payload, or let the client fetch it from a CDN or object storage directly.` };
  }
  if (kind === 'external' || kind === 'analytics') {
    if (hop.async) return { text };
    return { text, fix: `If ${quote(u.name)} does not need ${hop.to}’s answer to respond, send it with ->> so the request does not wait for it.` };
  }
  const n = ctx.nodes.get(hop.to);
  if (n && n.utilization > TARGET_UTILIZATION) return { text, fix: capacityFix(ctx, n) };
  const cacheable = ['database', 'storage', 'search'].includes(kind);
  return {
    text,
    fix: cacheable
      ? `Put a cache in front of ${hop.to} for ${quote(u.name)}, or run its independent calls in par.`
      : `Shorten the ${quote(u.name)} path: every hop adds its own latency, so drop hops it does not need, run independent calls in par, or move work after the response with ->>.`,
  };
}

function latency(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const u of ctx.useCases) {
    for (const l of u.latency ?? []) {
      if (l.testId && ctx.covered.has(l.testId)) continue;
      const over = l.ms >= l.limitMs;
      if (!over && l.ms < NEAR_LIMIT * l.limitMs) continue;
      const { text, fix } = whereTimeGoes(ctx, u, scenarioOf(u, l.tailScenario));
      const hop = slowestHop(scenarioOf(u, l.tailScenario)?.path ?? []);
      out.push({
        severity: over ? 'critical' : 'minor',
        title: over
          ? `${l.percentile} of ${quote(u.name)} is ${formatMs(l.ms)}, over its ${formatMs(l.limitMs)} limit`
          : `${l.percentile} of ${quote(u.name)} is ${formatMs(l.ms)}, close to its ${formatMs(l.limitMs)} limit`,
        detail: `${over ? 'The latency requirement fails.' : `That is ${pct(l.ms / l.limitMs)} of the limit, so there is little room for more load or another hop.`} ${text}`.trim(),
        ...(hop ? { nodeId: hop.to } : {}),
        // Only a failing limit earns a next step; a close one is for information.
        ...(fix && over ? { suggestion: fix } : {}),
      });
      if (over && l.testId) ctx.covered.add(l.testId);
    }
  }
  return out;
}

function availability(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const u of ctx.useCases) {
    const limit = u.availabilityLimit;
    if (!limit || u.availability >= limit.min - 1e-12) continue;
    const weakest = (u.dependencies ?? []).filter((d) => !d.fallback && d.availability < 1).sort((a, b) => a.availability - b.availability)[0];
    const n = weakest && ctx.nodes.get(weakest.nodeId);
    out.push({
      severity: 'critical',
      title: `Availability of ${quote(u.name)} is ${formatAvailability(u.availability)}, under the required ${formatAvailability(limit.min)}`,
      detail: weakest
        ? `Every node on its path must be up. The weakest is ${ctx.label(weakest.nodeId)} at ${formatAvailability(weakest.availability)}${n ? ` with ${plural(n.replicas, 'replica')}` : ''}, and no scenario of ${quote(u.name)} completes without it.`
        : `The nodes on its main path multiply to ${formatAvailability(u.availability)}.`,
      ...(weakest ? { nodeId: weakest.nodeId } : {}),
      suggestion: weakest
        ? `Give ${weakest.nodeId} another replica (x${(n?.replicas ?? 1) + 1}), or add a fallback scenario to ${quote(u.name)} that calls it with -x and still completes.`
        : `Add replicas to the nodes ${quote(u.name)} needs, or fallback scenarios that complete without them.`,
    });
    if (limit.testId) ctx.covered.add(limit.testId);
  }
  return out;
}

function singlePointsOfFailure(ctx: Context): Finding[] {
  const spofs = ctx.request.metrics?.singlePointsOfFailure ?? [];
  // `survive …` fails with "Losing <id> … breaks …" for a single point of failure: the finding explains it.
  for (const t of ctx.failing) {
    const m = /^Losing (\S+) .*breaks/.exec(t.message);
    if (t.category === 'resilience' && m && spofs.includes(m[1]) && !t.message.includes('(and ')) ctx.covered.add(t.id);
  }
  return spofs.map((id): Finding => {
    const stops = ctx.useCases.filter((u) => (u.dependencies ?? []).some((d) => d.nodeId === id && !d.fallback)).map((u) => quote(u.name));
    const cache = ctx.nodes.get(id)?.kind === 'cache';
    return {
      severity: 'major',
      title: `${id} is a single point of failure`,
      detail:
        `${ctx.label(id)} runs as one instance${ctx.given(id) ? ' (declared by the problem)' : ''}, and ${stops.length ? list(stops) : 'a use case'} cannot complete without it: losing it is an outage.` +
        (cache ? ' For a cache, a scenario that calls it with -x and reads from the database instead is a fallback.' : ''),
      nodeId: id,
      suggestion: `Run ${id} with a second replica (x2)${cache ? ', or add a scenario where the cache is down (-x) and the request still completes' : ''}.`,
    };
  });
}

/** Replicas a node could run with: under TARGET_UTILIZATION with one lost, at least 2, and every availability limit still met. */
function leanReplicas(ctx: Context, n: ReviewNodeMetrics): number {
  let k = Math.max(2, Math.ceil((n.utilization * n.replicas) / TARGET_UTILIZATION) + 1);
  const perReplica = n.availability < 1 ? 1 - (1 - n.availability) ** (1 / n.replicas) : 1;
  const holds = (k: number) => {
    const ak = 1 - (1 - perReplica) ** k;
    return ctx.useCases.every((u) => {
      const dep = u.availabilityLimit && (u.dependencies ?? []).find((d) => d.nodeId === n.id && !d.fallback);
      return !dep || n.availability <= 0 || (u.availability * ak) / n.availability >= u.availabilityLimit!.min;
    });
  };
  while (k < n.replicas && !holds(k)) k++;
  return k;
}

function cost(ctx: Context): Finding[] {
  const metrics = ctx.request.metrics!;
  const out: Finding[] = [];
  const limit = metrics.costLimit;
  const over = !!limit && metrics.costUsd > limit.maxUsd;
  const lean = [...ctx.nodes.values()]
    .filter((n) => DEPLOYED(n.kind) && !n.durable && !ctx.given(n.id) && n.replicas >= 3)
    .map((n) => {
      const k = leanReplicas(ctx, n);
      return { n, k, saving: (n.instanceCostUsd * (n.replicas - k)) / n.replicas };
    })
    .filter(({ n, k, saving }) => k < n.replicas && saving >= 100 && saving >= 0.05 * metrics.costUsd)
    .sort((a, b) => b.saving - a.saving);

  if (over) {
    const top = [...ctx.nodes.values()]
      .filter((n) => n.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 3)
      .map((n) => `${n.id} ${usd(n.costUsd)} (${pct(n.costUsd / metrics.costUsd)}${n.replicas > 1 ? `, x${n.replicas}` : ''}${n.shards > 1 ? `, ${n.shards} shards` : ''})`);
    out.push({
      severity: 'critical',
      title: `Costs ${formatUsd(metrics.costUsd)}, over the ${formatUsd(limit!.maxUsd)} budget`,
      detail: `It is ${usd(metrics.costUsd - limit!.maxUsd)} over. The largest items: ${list(top)}.`,
      ...(top.length ? { nodeId: [...ctx.nodes.values()].sort((a, b) => b.costUsd - a.costUsd)[0].id } : {}),
      suggestion: lean.length
        ? `Cut ${lean[0].n.id} from x${lean[0].n.replicas} to x${lean[0].k}: it runs at ${pct(lean[0].n.utilization)}, and that saves about ${usd(lean[0].saving)} a month.`
        : 'Use cheaper components for the largest items, or take load off them so fewer replicas carry it.',
    });
    if (limit!.testId) ctx.covered.add(limit!.testId);
  }
  for (const { n, k, saving } of lean) {
    out.push({
      severity: over ? 'minor' : 'info',
      title: `${n.id} has more replicas than its load needs`,
      detail:
        `${ctx.label(n.id)} runs x${n.replicas} at ${pct(n.utilization)}. x${k} would stay under ${pct(TARGET_UTILIZATION)} even with one replica lost` +
        `${n.availability < 1 ? ' and keep every availability limit' : ''}, saving about ${usd(saving)} a month. Fewer replicas queue a little more, so run the tests after the change.`,
      nodeId: n.id,
    });
  }
  return out;
}

function durability(ctx: Context): Finding[] {
  const out: Finding[] = [];
  const durable = (id: string) => !!ctx.nodes.get(id)?.durable;
  for (const u of ctx.useCases) {
    const writes = u.writes ?? [];
    if (!u.entryWrite || !clientFacing(ctx, u) || writes.some((w) => w.timing === 'sync' && durable(w.nodeId))) continue;
    const late = writes.filter((w) => w.timing !== 'sync' && durable(w.nodeId));
    if (late.length === 0) continue;
    const w = late[0];
    const how = w.timing === 'async' ? 'is sent with ->>, so nothing waits for it to be stored' : 'happens only after the response';
    out.push({
      severity: 'major',
      title: `${quote(u.name)} answers before its write is stored`,
      detail: `${quote(u.name)} is a write, but its write to ${ctx.label(w.nodeId)} ${how}. If that write is lost, the client was told it succeeded.`,
      nodeId: w.nodeId,
      suggestion: `Make the write to ${w.nodeId} in ${quote(u.name)} a synchronous request (->) before the response, or acknowledge only after a durable queue has the message.`,
    });
    if (u.durableTestId) ctx.covered.add(u.durableTestId);
  }
  return out;
}

function cacheFallbacks(ctx: Context): Finding[] {
  const spofs = new Set(ctx.request.metrics?.singlePointsOfFailure ?? []);
  const out: Finding[] = [];
  for (const n of ctx.nodes.values()) {
    if (n.kind !== 'cache' || spofs.has(n.id)) continue; // a single-instance cache is reported as a single point of failure
    // Only a cache with a store behind it: some path reads a durable node after it (a miss). Redis as the store itself is not a cache here.
    const storeBehind = (u: ReviewUseCaseMetrics) =>
      (u.scenarios ?? []).some((s) => {
        const at = s.path.findIndex((h) => h.to === n.id);
        return at >= 0 && s.path.slice(at + 1).some((h) => !h.failed && ctx.nodes.get(h.to)?.durable);
      });
    const without = ctx.useCases
      .filter((u) => u.rps > 0 && storeBehind(u) && (u.dependencies ?? []).some((d) => d.nodeId === n.id && !d.fallback))
      .map((u) => quote(u.name));
    if (without.length === 0) continue;
    out.push({
      severity: 'minor',
      title: `No fallback when ${n.id} is down`,
      detail: `${ctx.label(n.id)} has ${plural(n.replicas, 'replica')}, but no scenario of ${list(without)} calls it with -x and carries on without it, so an outage of the cache is an outage of ${without.length === 1 ? 'that use case' : 'those use cases'}. A cache is usually safe to skip: the data is in the store behind it.`,
      nodeId: n.id,
      suggestion: `Add a scenario to ${without[0]} where ${n.id} is down (-x) and the request is served from the store behind it.`,
    });
  }
  return out;
}

function slowDependencies(ctx: Context, sideEffect: (id: string) => boolean): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const u of ctx.useCases) {
    if (u.rps <= 0 || !clientFacing(ctx, u)) continue;
    for (const s of u.scenarios ?? []) {
      if (!s.success || s.share <= 0) continue;
      for (const h of s.path) {
        if (h.async || h.failed || !sideEffect(h.to) || h.ms < SLOW_DEPENDENCY_MS || seen.has(`${u.name}\n${h.to}`)) continue;
        seen.add(`${u.name}\n${h.to}`);
        out.push({
          severity: 'minor',
          title: `${quote(u.name)} waits for ${h.to} on the request path`,
          detail: `${h.from} -> ${ctx.label(h.to)} takes ${formatMs(h.ms)} on average and the response waits for it${(u.scenarios?.length ?? 0) > 1 ? ` (in ${quote(s.name)})` : ''}. A notification or an analytics event rarely needs to hold up the answer: send it with ->>, or through a queue.`,
          nodeId: h.to,
          suggestion: `If ${quote(u.name)} does not need ${h.to}’s answer, change ${h.from} -> ${h.to} to ${h.from} ->> ${h.to}.`,
        });
      }
    }
  }
  return out;
}

function unused(ctx: Context): Finding[] {
  if (ctx.nodes.size === 0) return [];
  return ctx.request.model.nodes
    .filter((node) => (ctx.nodes.get(node.id)?.usedBy.length ?? 1) === 0 && node.kind !== 'other')
    .map((node): Finding => {
      const n = ctx.nodes.get(node.id)!;
      const costs = n.costUsd > 0 ? `, yet it costs ${formatUsd(n.costUsd)}` : '';
      return {
        severity: 'minor',
        title: `${node.id} is not used by any use case`,
        detail: node.given
          ? `The problem declares ${ctx.label(node.id)}, but no use case sends a request to it or from it yet.`
          : `No use case sends a request to ${ctx.label(node.id)} or from it, so the simulation gives it no load${costs}. Use it in a use case, or remove it.`,
        nodeId: node.id,
      };
    });
}

/** The simulation's warnings that no rule covers (saturation and hot nodes are). */
function simulationWarnings(ctx: Context): Finding[] {
  return (ctx.request.metrics?.warnings ?? [])
    .filter((w) => !/^'[^']+' (is saturated|runs hot)/.test(w))
    .filter((w) => !ctx.missing.some((name) => w.startsWith(`Traffic for unknown use case "${name}"`)))
    .map((w) => ({ severity: 'minor' as const, title: 'Simulation warning', detail: w }));
}

/** Use cases the problem's traffic, requirements or tests name that the design does not have: one finding for all the tests they fail. */
function missingUseCases(ctx: Context): Finding[] {
  return ctx.missing.map((name): Finding => {
    const tests = ctx.failing.filter((t) => t.message.startsWith(`No use case named "${name}"`));
    for (const t of tests) ctx.covered.add(t.id);
    const traffic = (ctx.request.metrics?.warnings ?? []).some((w) => w.startsWith(`Traffic for unknown use case "${name}"`));
    const names = tests.slice(0, 3).map((t) => t.name).join('; ') + (tests.length > 3 ? '; …' : '');
    const effects = [traffic ? 'Its traffic is ignored' : '', tests.length ? `${plural(tests.length, 'test')} ${tests.length === 1 ? 'fails' : 'fail'} because of it (${names})` : ''].filter(Boolean);
    return {
      severity: 'critical',
      title: `The use case ${quote(name)} is missing`,
      detail: `The design has no usecase ${quote(name)}.${effects.length ? ` ${effects.join(', and ')}.` : ''}`,
      suggestion: `Add usecase ${quote(name)} { … } with the steps it takes through your nodes.`,
    };
  });
}

const CATEGORY_WORDS: Record<string, string> = {
  latency: 'A latency requirement fails',
  availability: 'An availability requirement fails',
  durability: 'A durability requirement fails',
  resilience: 'The design does not survive a failure',
  cost: 'The cost requirement fails',
  flow: 'A flow test fails',
};

function failingTests(ctx: Context): Finding[] {
  return ctx.failing
    .filter((t) => !ctx.covered.has(t.id))
    .map((t): Finding => {
      // "No node matches any database": the design lacks a kind of node the test is about.
      const absent = /^No node matches ([^;]+)$/.exec(t.message)?.[1];
      return {
        severity: 'critical',
        title: `Fails: ${t.name}`,
        detail: absent
          ? `${CATEGORY_WORDS[t.category] ?? 'A test fails'}: the design has no node that is ${absent}.`
          : `${CATEGORY_WORDS[t.category] ?? 'A test fails'}: ${t.message}.`.replace(/([.!?])\.$/, '$1'),
        ...(absent ? { suggestion: `Add ${absent.replace(/^any /, 'a ')} to the design where the test expects one.` } : t.hint ? { suggestion: `${t.hint.replace(/\.$/, '')}.` } : {}),
      };
    });
}

// ---------- strengths ----------

function strengths(ctx: Context): string[] {
  const out: string[] = [];
  const tests = ctx.request.tests;
  const metrics = ctx.request.metrics!;
  if (tests?.solved) out.push(`All ${tests.total} tests pass.`);

  // With a use case missing, the numbers are of half a system: no praise for headroom, latency or cost.
  const complete = ctx.missing.length === 0;
  const nodes = [...ctx.nodes.values()];
  const loaded = nodes.filter((n) => DEPLOYED(n.kind) && n.loadRps > 0);
  const deployed = nodes.filter((n) => DEPLOYED(n.kind) && n.usedBy.length > 0);
  if (deployed.length > 0 && metrics.singlePointsOfFailure.length === 0) {
    out.push('No single point of failure: every node a use case needs has a replica or a fallback.');
  }
  if (complete && loaded.length > 0 && loaded.every((n) => n.utilization < TARGET_UTILIZATION)) {
    const busiest = loaded.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    out.push(`Every node has headroom under this traffic; the busiest, ${busiest.id}, runs at ${pct(busiest.utilization)}.`);
  }

  const comfortable = ctx.useCases.flatMap((u) => (u.latency ?? []).filter((l) => l.ms <= 0.5 * l.limitMs).map((l) => `${l.percentile} of ${quote(u.name)} is ${formatMs(l.ms)} (limit ${formatMs(l.limitMs)})`));
  if (complete && comfortable.length) out.push(`Latency has room to spare: ${list(comfortable.slice(0, 3))}.`);

  const asyncHops = new Set<string>();
  for (const u of ctx.useCases) {
    if (u.rps <= 0) continue;
    for (const s of u.scenarios ?? []) if (s.success && s.share > 0) for (const h of s.path) if (h.async) asyncHops.add(`${h.from} ->> ${h.to} in ${quote(u.name)}`);
  }
  if (asyncHops.size) out.push(`Work is kept off the request path with ->> (${list([...asyncHops].slice(0, 2))}): the response waits only for the send.`);

  const fallbacks = ctx.useCases.flatMap((u) => (u.dependencies ?? []).filter((d) => d.fallback).map((d) => `${quote(u.name)} without ${d.nodeId}`));
  if (fallbacks.length) out.push(`Fallback scenarios keep requests working through a failure: ${list(fallbacks.slice(0, 3))}.`);

  const durable = ctx.useCases.filter((u) => u.durableTestId && (u.writes ?? []).some((w) => w.timing === 'sync' && ctx.nodes.get(w.nodeId)?.durable));
  if (durable.length) out.push(`${list(durable.map((u) => quote(u.name)))} ${durable.length === 1 ? 'stores its write' : 'store their writes'} durably before answering.`);

  const limited = ctx.useCases.filter((u) => u.availabilityLimit);
  if (complete && limited.length && limited.every((u) => u.availability >= u.availabilityLimit!.min)) {
    out.push(`Availability meets its requirement: ${list(limited.slice(0, 3).map((u) => `${quote(u.name)} ${formatAvailability(u.availability)} (needs ${formatAvailability(u.availabilityLimit!.min)})`))}.`);
  }
  if (complete && metrics.costLimit && metrics.costUsd <= 0.6 * metrics.costLimit.maxUsd) {
    out.push(`Cost is ${formatUsd(metrics.costUsd)}, ${pct(metrics.costUsd / metrics.costLimit.maxUsd)} of the ${formatUsd(metrics.costLimit.maxUsd)} budget.`);
  }
  const decisions = ctx.request.model.decisions.length;
  if (decisions) out.push(`The trade-offs are written down in ${plural(decisions, 'decision')}.`);
  return out;
}
