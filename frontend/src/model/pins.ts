import { componentCatalog } from '../catalog/componentCatalog';
import { parse } from '../dsl/parser';
import type { DiagramNode, Percentile } from '../dsl/types';
import {
  DEFAULT_TIMEOUT_MS,
  FAILOVER_SHARE,
  HOT,
  SERVICE_SPREAD,
  analyze,
  erlangC,
  hopLatency,
  hopMean,
  hopModel,
  hopQuantile,
  primaryAvailability,
  replicatedAvailability,
  type Analysis,
  type NodeAnalysis,
} from '../sim/analyze';
import { formatAvailability, formatMs, formatPercent, formatRps } from '../sim/format';
import { profileOf, type Profile } from '../sim/profiles';
import { runTests, type TestResult } from '../sim/tests';

/**
 * The numbers on the "How the simulation works" page (src/docs/model.html, served at /docs/model/) are
 * plain text, so the page needs no JavaScript to read. Each one sits in an
 * element with `data-pin="<scope>|<path>"`, and `resolvePin` computes what
 * the text must be from the simulation itself; model.test.ts compares the two,
 * so the page cannot drift from the code.
 *
 * Scopes:
 * - `profile|<Tech stack>.<field>`: a default profile (reads, writes, latency,
 *   availability, cost, bandwidth, egress, durable, consistency).
 * - `const|<name>`: a constant of the model (hot, queueCap, maxSlowdown,
 *   timeout, failover, spread, f50 … f999 (idle hop quantile ÷ mean),
 *   slowdown@<utilisation> (one server), slowdown@<servers>@<utilisation>,
 *   wait@<servers>@<utilisation> (Erlang C), tail99@<utilisation> (p99 ÷ mean
 *   of one server), primary@<replicas> (a PostgreSQL primary's write
 *   availability), catalog (number of tech stacks)).
 * - `<example id>|<path>`: a number from analysing a worked example whose
 *   source is in a `<pre data-example="<id>">` on the page; paths are
 *   `node.<id>.<field>`, `uc.<use case>.<field>`, `sc.<use case>.<scenario>.<field>`,
 *   `total.cost`, `total.egress`, `spof`, `test.<n>.message|hint|verdict`.
 */

/** `$1,700` */
export const usd = (x: number): string => `$${Math.round(x).toLocaleString('en-US')}`;

const gb = (x: number): string => `${Math.round(x).toLocaleString('en-US')} GB`;

/** `20k`, `∞` */
const rate = (x: number): string => formatRps(x).replace(/ rps$/, '');

function profileNode(tech: string): DiagramNode {
  const entry = componentCatalog.find((c) => c.techStack === tech);
  if (!entry) throw new Error(`Unknown tech stack in a pin: ${tech}`);
  return { kind: 'component', type: entry.type, techStack: tech } as DiagramNode;
}

function profileField(p: Profile, field: string): string {
  switch (field) {
    case 'reads':
      return rate(p.readRps);
    case 'writes':
      return rate(p.writeRps);
    case 'latency':
      return formatMs(p.latencyMs);
    case 'availability':
      return formatAvailability(p.availability);
    case 'cost':
      return usd(p.costUsd);
    case 'bandwidth':
      return `${p.bandwidthMBps.toLocaleString('en-US')} MB/s`;
    case 'egress':
      return p.egressUsdPerGb > 0 ? `$${p.egressUsdPerGb}/GB` : '—';
    case 'durable':
      return p.durable ? 'yes' : 'no';
    case 'consistency':
      return p.consistency ?? '—';
    case 'kind':
      return p.kind;
    case 'writeScaling':
      return p.writeScaling;
  }
  throw new Error(`Unknown profile field in a pin: ${field}`);
}

function constant(name: string): string {
  if (name === 'hot') return formatPercent(HOT);
  if (name === 'timeout') return formatMs(DEFAULT_TIMEOUT_MS);
  // hopLatency caps utilisation, so the slowdown at or past saturation is the largest there is.
  if (name === 'maxSlowdown') return `${Number(hopLatency(1, 10).toFixed(1))}×`;
  if (name === 'queueCap') return formatPercent(1 - 1 / hopLatency(1, 10));
  const times = (x: number, digits = 1) => `${Number(x.toFixed(digits))}×`;
  const slowdown = /^slowdown@(\d+)$/.exec(name);
  if (slowdown) return times(hopLatency(1, Number(slowdown[1]) / 100));
  const pool = /^slowdown@(\d+)@(\d+)$/.exec(name);
  if (pool) return times(hopLatency(1, Number(pool[2]) / 100, Number(pool[1])), 2);
  const wait = /^wait@(\d+)@(\d+)$/.exec(name);
  if (wait) return formatPercent(erlangC(Number(wait[1]), Number(wait[2]) / 100));
  const tail = /^tail99@(\d+)$/.exec(name);
  if (tail) {
    const hop = hopModel(1, Number(tail[1]) / 100);
    return times(hopQuantile(hop, 0.99) / hopMean(hop));
  }
  const factor = /^f(\d+)$/.exec(name);
  if (factor) {
    const q = (factor[1] === '999' ? 99.9 : Number(factor[1])) as Percentile;
    if (![50, 90, 95, 99, 99.9].includes(q)) throw new Error(`Unknown percentile in a pin: ${name}`);
    return times(hopQuantile(hopModel(1, 0), q / 100), 2);
  }
  if (name === 'failover') return formatPercent(FAILOVER_SHARE);
  if (name === 'spread') return formatPercent(SERVICE_SPREAD);
  if (name === 'catalog') return String(componentCatalog.filter((c) => c.type !== 'group' && c.type !== 'text').length);
  const primary = /^primary@(\d+)$/.exec(name);
  if (primary) return formatAvailability(primaryAvailability(profileOf(profileNode('PostgreSQL')).availability, Number(primary[1])));
  if (name === 'sixServices') return formatAvailability(replicatedAvailability(profileOf(profileNode('REST API')).availability, 6));
  throw new Error(`Unknown constant in a pin: ${name}`);
}

function nodeField(n: NodeAnalysis, field: string): string {
  if (/utilization$/i.test(field)) return formatPercent(n[field as 'utilization']);
  if (/Rps$/.test(field)) return formatRps(n[field as 'loadRps']);
  if (field === 'latencyMs') return formatMs(n.latencyMs);
  if (field === 'availability' || field === 'writeAvailability') return formatAvailability(n[field]);
  if (field === 'waitProbability') return formatPercent(n.waitProbability);
  if (field === 'servers') return String(n.servers);
  if (field === 'costUsd' || field === 'egressUsd') return usd(n[field]);
  if (field === 'egressGbPerMonth') return gb(n.egressGbPerMonth);
  throw new Error(`Unknown node field in a pin: ${field}`);
}

interface Run {
  analysis: Analysis;
  tests: TestResult[];
}

function exampleValue(run: Run, path: string): string {
  const [head, ...rest] = path.split('.');
  const { analysis } = run;
  switch (head) {
    case 'node': {
      const [id, field] = rest;
      const n = analysis.nodes.find((x) => x.id === id);
      if (!n) throw new Error(`No node ${id}`);
      return nodeField(n, field);
    }
    case 'uc': {
      const [name, field] = rest;
      const u = analysis.useCases.find((x) => x.name === name);
      if (!u) throw new Error(`No use case ${name}`);
      if (field === 'availability') return formatAvailability(u.availability);
      if (field === 'rps') return formatRps(u.rps);
      return formatMs(u.percentiles[field as 'p99']);
    }
    case 'sc': {
      const [useCase, scenario, field] = rest;
      const s = analysis.useCases.find((x) => x.name === useCase)?.scenarios.find((x) => x.name === scenario);
      if (!s) throw new Error(`No scenario ${useCase} › ${scenario}`);
      if (field === 'share') return formatPercent(s.share);
      return formatMs(field === 'meanMs' ? s.meanMs : s.percentiles[field as 'p99']);
    }
    case 'total':
      return usd(rest[0] === 'egress' ? analysis.totalEgressUsd : analysis.totalCostUsd);
    case 'spof':
      return analysis.singlePointsOfFailure.join(', ') || 'none';
    case 'test': {
      const [index, field] = rest;
      const t = run.tests[Number(index) - 1];
      if (!t) throw new Error(`No test ${index}`);
      if (field === 'verdict') return t.passed ? 'pass' : 'fail';
      if (field === 'name') return t.name;
      if (field === 'hint') return t.hint ?? '';
      return t.message;
    }
  }
  throw new Error(`Unknown pin path: ${path}`);
}

/** Resolves pins against the worked examples, given as id → Proschi source. */
export function pinResolver(examples: Map<string, string>): (pin: string) => string {
  const runs = new Map<string, Run>();
  const runOf = (id: string): Run => {
    let run = runs.get(id);
    if (!run) {
      const source = examples.get(id);
      if (source === undefined) throw new Error(`No worked example ${id}`);
      const { diagram } = parse(source);
      const analysis = analyze(diagram);
      run = { analysis, tests: runTests(diagram, analysis) };
      runs.set(id, run);
    }
    return run;
  };
  return (pin) => {
    const bar = pin.indexOf('|');
    const scope = pin.slice(0, bar);
    const path = pin.slice(bar + 1);
    if (scope === 'profile') {
      const dot = path.lastIndexOf('.');
      return profileField(profileOf(profileNode(path.slice(0, dot))), path.slice(dot + 1));
    }
    if (scope === 'const') return constant(path);
    return exampleValue(runOf(scope), path);
  };
}
