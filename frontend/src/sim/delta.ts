import { diffDiagrams, type DiagramDiff } from '../dsl/diff';
import type { Diagram } from '../dsl/types';
import { analyze, type Analysis } from './analyze';
import { formatAvailability, formatMs, formatPercent, formatRps } from './format';
import { runTests, type TestResult } from './tests';
import { headlineOf, type Headline } from './whatif';

/**
 * What a change to a design does (docs/VERSIONS.md, "View and compare
 * versions"): the structural diff of dsl/diff.ts plus what the simulation
 * says before and after. Pure, shared by the versions panel and the CLI's
 * `proschi diff` and `proschi versions diff`.
 */

/** A number on each side; a side is undefined where the item is not in that design. */
export interface Pair {
  before?: number;
  after?: number;
}

export interface UseCaseDelta {
  /** The use case's id. */
  id: string;
  name: string;
  rps: Pair;
  /** In ms. */
  p99Ms: Pair;
  /** 0..1. */
  availability: Pair;
}

/** A requirement, system or test whose result differs: it flipped, or it is only on one side. */
export interface CheckChange {
  /** Its name, which is how the two sides are matched (`req:<n>` ids move when a line is added). */
  name: string;
  category: TestResult['category'];
  /** Undefined where the design does not have it. */
  before?: boolean;
  after?: boolean;
}

export interface UtilizationDelta {
  /** The node's id. */
  node: string;
  /** 0..1 and over; undefined where the design does not have the node. */
  before?: number;
  after?: number;
}

export interface DesignDelta {
  diff: DiagramDiff;
  /** The slowest p99, the lowest availability and the cost of each whole design. */
  total: { before: Headline; after: Headline };
  /** Every use case of either side, in the target's order and then the removed ones. */
  useCases: UseCaseDelta[];
  /** How many checks (requirements, systems and tests) each side passes, of how many. */
  checks: { before: { passed: number; total: number }; after: { passed: number; total: number } };
  /** The checks whose result differs, failing ones first. */
  checkChanges: CheckChange[];
  /** Nodes whose utilisation moved by at least the threshold, or crossed 100%; the biggest move first. */
  utilization: UtilizationDelta[];
}

export interface DesignDeltaOptions {
  /** The smallest utilisation change listed, as a fraction: 0.1 (ten points) by default. */
  utilizationThreshold?: number;
}

interface Side {
  analysis: Analysis;
  results: TestResult[];
}

function simulate(diagram: Diagram): Side {
  const analysis = analyze(diagram);
  return { analysis, results: runTests(diagram, analysis) };
}

/** Items by name; a name seen again gets ` #2`, ` #3`, … so nothing is dropped. */
function byName<T>(items: T[], name: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    let k = name(item);
    for (let n = 2; map.has(k); n++) k = `${name(item)} #${n}`;
    map.set(k, item);
  }
  return map;
}

const finite = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : undefined);

/** The structural diff of `before` → `after`, and the simulation of both. */
export function designDelta(before: Diagram, after: Diagram, options: DesignDeltaOptions = {}): DesignDelta {
  const threshold = options.utilizationThreshold ?? 0.1;
  const a = simulate(before);
  const b = simulate(after);

  const oldUseCases = new Map(a.analysis.useCases.map((u) => [u.id, u]));
  const newIds = new Set(b.analysis.useCases.map((u) => u.id));
  const useCases: UseCaseDelta[] = [...b.analysis.useCases, ...a.analysis.useCases.filter((u) => !newIds.has(u.id))].map((u) => {
    const old = oldUseCases.get(u.id);
    const next = newIds.has(u.id) ? u : undefined;
    return {
      id: u.id,
      name: u.name,
      rps: { before: old?.rps, after: next?.rps },
      p99Ms: { before: finite(old?.percentiles.p99), after: finite(next?.percentiles.p99) },
      availability: { before: old?.availability, after: next?.availability },
    };
  });

  const oldChecks = byName(a.results, (r) => r.name);
  const newChecks = byName(b.results, (r) => r.name);
  const checkChanges: CheckChange[] = [];
  for (const [name, r] of newChecks) {
    const old = oldChecks.get(name);
    if (old?.passed !== r.passed) checkChanges.push({ name, category: r.category, before: old?.passed, after: r.passed });
  }
  for (const [name, r] of oldChecks) if (!newChecks.has(name)) checkChanges.push({ name, category: r.category, before: r.passed });
  // What now fails reads first, then what now passes, then what only one side has.
  const rank = (c: CheckChange) => (c.before === true && c.after === false ? 0 : c.before === false && c.after === true ? 1 : 2);
  checkChanges.sort((x, y) => rank(x) - rank(y));

  const oldNodes = new Map(a.analysis.nodes.map((n) => [n.id, n.utilization]));
  const newNodes = new Map(b.analysis.nodes.map((n) => [n.id, n.utilization]));
  const utilization: UtilizationDelta[] = [];
  for (const node of new Set([...newNodes.keys(), ...oldNodes.keys()])) {
    const u = { node, before: oldNodes.get(node), after: newNodes.get(node) };
    const crossed = (u.before ?? 0) >= 1 !== (u.after ?? 0) >= 1;
    if (crossed || Math.abs((u.after ?? 0) - (u.before ?? 0)) >= threshold) utilization.push(u);
  }
  utilization.sort((x, y) => Math.abs((y.after ?? 0) - (y.before ?? 0)) - Math.abs((x.after ?? 0) - (x.before ?? 0)));

  const count = (results: TestResult[]) => ({ passed: results.filter((r) => r.passed).length, total: results.length });
  return {
    diff: diffDiagrams(before, after),
    total: { before: headlineOf(a.analysis), after: headlineOf(b.analysis) },
    useCases,
    checks: { before: count(a.results), after: count(b.results) },
    checkChanges,
    utilization,
  };
}

/** Whether a change is good news: lower p99, cost and utilisation, higher availability. */
export type Tone = 'better' | 'worse' | 'same';

/** One line of the delta table, formatted for the panel and the CLI. */
export interface DeltaRow {
  /** What the row measures: `Cost`, `p99 · Order status`, `Utilisation · db`. */
  label: string;
  before: string;
  after: string;
  /** The change in a few words: `−$120/mo`, `p99 48→31 ms`, `✓ now passes`. */
  change: string;
  tone: Tone;
}

const MINUS = '−';
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const short = (ms: number) => formatMs(ms).replace(/ ms$/, '');
const none = '—';

function tone(before: number | undefined, after: number | undefined, lowerIsBetter: boolean, epsilon: number): Tone {
  if (before === undefined || after === undefined || Math.abs(after - before) < epsilon) return 'same';
  return after < before === lowerIsBetter ? 'better' : 'worse';
}

/** The cost row: `$600/mo → $1,250/mo`, change `+$650/mo`. */
export function costRow(before: number, after: number): DeltaRow {
  const d = Math.round(after) - Math.round(before);
  return {
    label: 'Cost',
    before: `${usd(before)}/mo`,
    after: `${usd(after)}/mo`,
    change: d === 0 ? 'same' : `${d > 0 ? '+' : MINUS}${usd(d)}/mo`,
    tone: tone(Math.round(before), Math.round(after), true, 1),
  };
}

/** A p99 row: change `p99 48→31 ms`. */
export function p99Row(label: string, before: number | undefined, after: number | undefined): DeltaRow {
  const same = before !== undefined && after !== undefined && formatMs(before) === formatMs(after);
  return {
    label,
    before: before === undefined ? none : formatMs(before),
    after: after === undefined ? none : formatMs(after),
    change: before === undefined || after === undefined ? (after === undefined ? 'removed' : 'new') : same ? 'same' : `p99 ${short(before)}→${short(after)} ms`,
    tone: same ? 'same' : tone(before, after, true, 0.05),
  };
}

/** An availability row: change `99.9%→99.99%`. */
export function availabilityRow(label: string, before: number | undefined, after: number | undefined): DeltaRow {
  const same = before !== undefined && after !== undefined && formatAvailability(before) === formatAvailability(after);
  return {
    label,
    before: before === undefined ? none : formatAvailability(before),
    after: after === undefined ? none : formatAvailability(after),
    change: before === undefined || after === undefined ? (after === undefined ? 'removed' : 'new') : same ? 'same' : `${formatAvailability(before)}→${formatAvailability(after)}`,
    tone: same ? 'same' : tone(before, after, false, 1e-12),
  };
}

/** A check that flipped or is only on one side: label `survive db failure`, change `✓ now passes`. */
export function checkRow(c: CheckChange): DeltaRow {
  const state = (p: boolean | undefined) => (p === undefined ? none : p ? 'pass' : 'fail');
  const change = c.before === undefined ? (c.after ? '✓ new, passes' : '✗ new, fails') : c.after === undefined ? 'removed' : c.after ? '✓ now passes' : '✗ now fails';
  return {
    label: c.name,
    before: state(c.before),
    after: state(c.after),
    change,
    tone: c.after === undefined ? 'same' : c.after ? (c.before === true ? 'same' : 'better') : 'worse',
  };
}

/** A node's utilisation row: change `62%→140%, saturated`. */
export function utilizationRow(u: UtilizationDelta): DeltaRow {
  const pct = (x: number | undefined) => (x === undefined ? none : formatPercent(x));
  const saturates = (u.after ?? 0) >= 1 && (u.before ?? 0) < 1;
  const frees = (u.before ?? 0) >= 1 && (u.after ?? 0) < 1;
  return {
    label: `Utilisation · ${u.node}`,
    before: pct(u.before),
    after: pct(u.after),
    change: `${pct(u.before)}→${pct(u.after)}${saturates ? ', saturated' : frees ? ', no longer saturated' : ''}`,
    tone: tone(u.before ?? 0, u.after ?? 0, true, 1e-9),
  };
}

/**
 * The delta as table rows, in reading order: cost, the worst p99 and the
 * lowest availability of the whole design, then each use case with traffic
 * on either side, the checks that changed and the nodes whose load moved.
 */
export function deltaRows(delta: DesignDelta): { headline: DeltaRow[]; useCases: DeltaRow[]; checks: DeltaRow[]; utilization: DeltaRow[] } {
  const { before, after } = delta.total;
  const busy = delta.useCases.filter((u) => (u.rps.before ?? 0) > 0 || (u.rps.after ?? 0) > 0);
  return {
    headline: [costRow(before.costUsd, after.costUsd), p99Row('Worst p99', before.p99Ms, after.p99Ms), availabilityRow('Availability', before.availability, after.availability)],
    useCases: busy.flatMap((u) => {
      const rows = [p99Row(`p99 · ${u.name}`, u.p99Ms.before, u.p99Ms.after), availabilityRow(`Availability · ${u.name}`, u.availability.before, u.availability.after)];
      if (u.rps.before !== u.rps.after)
        rows.unshift({
          label: `Traffic · ${u.name}`,
          before: u.rps.before === undefined ? none : formatRps(u.rps.before),
          after: u.rps.after === undefined ? none : formatRps(u.rps.after),
          change: u.rps.before === undefined || u.rps.after === undefined ? (u.rps.after === undefined ? 'removed' : 'new') : `${formatRps(u.rps.before)}→${formatRps(u.rps.after)}`,
          tone: 'same',
        });
      return rows;
    }),
    checks: delta.checkChanges.map(checkRow),
    utilization: delta.utilization.map(utilizationRow),
  };
}
