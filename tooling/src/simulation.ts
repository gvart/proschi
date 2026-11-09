/**
 * The simulation and tests (frontend/src/sim) for the command line and the
 * language server: `proschi test` runs requirements and test blocks,
 * `proschi analyze` prints the capacity table, and the language server turns
 * failing results into warnings and adds load to node hovers.
 */
import {
  HOT,
  costBreakdown,
  formatAvailability,
  formatCount,
  formatDuration,
  formatQueue,
  formatMs,
  formatPercent,
  formatRps,
  formatTraffic,
  formatUsd,
  findWhatIf,
  headlineOf,
  parseQuantity,
  runTests,
  runWhatIf,
  runWhatIfs,
  simulate,
  sweep,
  type Diagnostic,
  type Diagram,
  type NodeAnalysis,
  type ParseResult,
  type SimAnalysis,
  type SweepResult,
  type TestResult,
  type WhatIfResult,
} from './proschi';
import { displayPath, parseFile } from './imports';

export const SIM_USAGE = `  proschi test [--format text|github|json] <file|dir>...
  proschi analyze [--format text|json] [--whatif <name>|all] [--sweep <use case> <from>..<to> [--steps <n>]] <file>`;

export const SIM_HELP = `test    Runs the requirements and test blocks of each file (imports are
        followed) against the simulation. Exits with 1 if any fails or a file
        has errors.
analyze Prints the capacity table: reads and writes (load of capacity and
        utilisation), latency, availability, egress and cost per node; latency
        percentiles per use case and scenario. A file with whatif blocks also
        gets a summary of them: requirements, worst p99, availability, cost.
        --whatif <name> prints the table under that what-if, with its
        requirement results; --whatif all prints only the summary. Either
        exits with 1 when a what-if it runs fails its requirements.
        --sweep "Use case" 10k..500k analyses that use case at --steps rates
        (10 by default) and prints, per rate, p99, availability, cost and what
        saturates, then where each node saturates and the highest rate at
        which the requirements still hold. With --whatif <name>, the sweep
        runs under that what-if.`;

/** Reads a file with its imports; tests may substitute their own. */
export type Loader = (file: string) => ParseResult;

export interface TestReport {
  file: string;
  /** Parse errors in the file or its imports; any makes the run fail. */
  errors: Diagnostic[];
  results: TestResult[];
}

export function testFiles(files: string[], load: Loader = parseFile): TestReport[] {
  return files.map((file) => {
    const { diagram, diagnostics } = load(file);
    return { file: displayPath(file), errors: diagnostics.filter((d) => d.severity === 'error'), results: runTests(diagram) };
  });
}

const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');

export function formatTestReports(reports: TestReport[], style: 'text' | 'github' | 'json'): string {
  if (style === 'json') return JSON.stringify(reports, null, 2);
  const lines: string[] = [];
  for (const { file, errors, results } of reports) {
    const where = (loc: { file?: string; line: number; col: number } | undefined) => ({ file: loc?.file ?? file, line: loc?.line ?? 1, col: loc?.col ?? 1 });
    if (style === 'github') {
      for (const e of errors) lines.push(`::error file=${e.file ?? file},line=${e.line},col=${e.col},title=proschi::${escape(e.message)}`);
      for (const r of results.filter((r) => !r.passed)) {
        const at = where(r.loc);
        lines.push(`::error file=${at.file},line=${at.line},col=${at.col},title=proschi test: ${escape(r.name)}::${escape(r.hint ? `${r.message}. ${r.hint}` : r.message)}`);
      }
      continue;
    }
    lines.push(file);
    for (const e of errors) lines.push(`  error ${e.file ? `${e.file}:` : ''}${e.line}:${e.col}: ${e.message}`);
    if (results.length === 0) lines.push('  no requirements or tests');
    for (const r of results) {
      const at = r.loc ? ` (${r.loc.file ? `${r.loc.file}:` : 'line '}${r.loc.line})` : '';
      lines.push(`  ${r.passed ? '✓' : '✗'} ${r.name}${r.passed ? '' : at}: ${r.message}`);
      if (!r.passed) {
        for (const a of r.assertions ?? []) if (!a.passed && r.assertions!.length > 1) lines.push(`      ✗ line ${a.loc.line}: ${a.message}`);
        if (r.hint) lines.push(`      → ${r.hint}`);
      }
    }
  }
  if (style === 'text') {
    const all = reports.flatMap((r) => r.results);
    const failed = all.filter((r) => !r.passed).length;
    const errors = reports.reduce((n, r) => n + r.errors.length, 0);
    const files = reports.length === 1 ? '1 file' : `${reports.length} files`;
    lines.push(`${files}: ${all.length - failed} passed, ${failed} failed${errors ? `, ${errors} error(s)` : ''}`);
  }
  return lines.join('\n');
}

type Style = 'text' | 'github' | 'json';

/** Reads `--format` and the paths; undefined after reporting bad usage. */
function parseArgs(args: string[], styles: Style[], err: (s: string) => void): { style: Style; paths: string[] } | undefined {
  let style: Style = 'text';
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format') {
      const value = args[++i] as Style;
      if (!styles.includes(value)) {
        err(`Unknown format '${value ?? ''}'; use ${styles.join(', ')}`);
        return undefined;
      }
      style = value;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${SIM_USAGE}`);
      return undefined;
    } else paths.push(arg);
  }
  if (paths.length === 0) {
    err(`Usage:\n${SIM_USAGE}`);
    return undefined;
  }
  return { style, paths };
}

export function runTest(
  args: string[],
  collectFiles: (paths: string[]) => string[],
  out: (s: string) => void,
  err: (s: string) => void,
  load: Loader = parseFile,
): number {
  const parsed = parseArgs(args, ['text', 'github', 'json'], err);
  if (!parsed) return 2;
  let reports: TestReport[];
  try {
    reports = testFiles(collectFiles(parsed.paths), load);
  } catch (e) {
    err(String((e as Error).message));
    return 2;
  }
  const text = formatTestReports(reports, parsed.style);
  if (text) out(text);
  return reports.some((r) => r.errors.length > 0 || r.results.some((t) => !t.passed)) ? 1 : 0;
}

interface AnalyzeFlags {
  whatif?: string;
  sweep?: { useCase: string; from: number; to: number };
  steps?: number;
}

/** `10k..500k` or `10k rps..500k rps`: a rising range of rates in requests per second. */
export function parseRange(text: string): { from: number; to: number } | { error: string } {
  const bad = { error: `Expected a range of rates such as 10k..500k, not '${text}'` };
  const parts = text.split('..');
  if (parts.length !== 2) return bad;
  const [from, to] = parts.map((p) => {
    const q = parseQuantity(p.trim());
    return 'error' in q || (q.unit !== undefined && q.unit !== 'rps') ? undefined : q.value;
  });
  if (from === undefined || to === undefined) return bad;
  if (!(to > from)) return { error: `The range ${text} must go up` };
  return { from, to };
}

/** Takes `--whatif`, `--sweep` and `--steps` out of the arguments; undefined after reporting bad usage. */
function analyzeFlags(args: string[], err: (s: string) => void): { rest: string[]; flags: AnalyzeFlags } | undefined {
  const rest: string[] = [];
  const flags: AnalyzeFlags = {};
  const usage = `Usage:\n${SIM_USAGE}`;
  const fail = (message: string) => {
    err(message);
    return undefined;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--whatif') {
      if (args[i + 1] === undefined) return fail(`--whatif needs a what-if name, or all\n\n${usage}`);
      flags.whatif = args[++i];
    } else if (arg === '--sweep') {
      const [useCase, range] = [args[i + 1], args[i + 2]];
      if (useCase === undefined || range === undefined) return fail(`--sweep needs a use case and a range, e.g. --sweep "Checkout" 10k..500k\n\n${usage}`);
      const parsed = parseRange(range);
      if ('error' in parsed) return fail(parsed.error);
      flags.sweep = { useCase, ...parsed };
      i += 2;
    } else if (arg === '--steps') {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 2 || n > 100) return fail('--steps needs a whole number from 2 to 100');
      flags.steps = n;
    } else rest.push(arg);
  }
  if (flags.steps !== undefined && !flags.sweep) return fail(`--steps goes with --sweep\n\n${usage}`);
  if (flags.whatif === 'all' && flags.sweep) return fail('--sweep runs under one what-if, not all');
  return { rest, flags };
}

export function runAnalyze(args: string[], out: (s: string) => void, err: (s: string) => void, load: Loader = parseFile): number {
  const extra = analyzeFlags(args, err);
  if (!extra) return 2;
  const parsed = parseArgs(extra.rest, ['text', 'json'], err);
  if (!parsed) return 2;
  if (parsed.paths.length !== 1) {
    err(`Usage:\n${SIM_USAGE}`);
    return 2;
  }
  const [file] = parsed.paths;
  let result: ParseResult;
  try {
    result = load(file);
  } catch (e) {
    err(String((e as Error).message));
    return 2;
  }
  const { diagram } = result;
  const shown = displayPath(file);
  const json = parsed.style === 'json';
  const exit = result.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
  const { whatif: name, sweep: range, steps } = extra.flags;

  // `all` is the summary, unless a what-if has that name.
  const whatif = name !== undefined ? findWhatIf(diagram, name) : undefined;
  if (name !== undefined && name !== 'all' && !whatif) {
    const names = (diagram.whatifs ?? []).map((w) => `"${w.name}"`).join(', ');
    err(`No what-if named "${name}"; ${names ? `the file has ${names}` : 'the file has no whatif blocks'}`);
    return 2;
  }
  const chosen = whatif ? runWhatIf(diagram, whatif) : undefined;

  if (range) {
    let swept: SweepResult;
    try {
      swept = sweep(diagram, range.useCase, range.from, range.to, { steps, base: chosen?.options });
    } catch (e) {
      err(String((e as Error).message));
      return 2;
    }
    if (json) out(JSON.stringify({ file: shown, ...(chosen ? { whatif: chosen.name } : {}), sweep: swept }, null, 2));
    else out(sweepReport(swept, shown, chosen?.name));
    return exit;
  }

  if (chosen) {
    if (json) out(JSON.stringify({ file: shown, whatif: chosen.name, analysis: chosen.analysis, ...whatIfJson(chosen) }, null, 2));
    else out(whatIfReport(diagram, chosen, shown));
    return chosen.passed ? exit : 1;
  }

  if (name === 'all') {
    const all = runWhatIfs(diagram);
    if (json) out(JSON.stringify({ file: shown, whatifs: all.map(whatIfJson) }, null, 2));
    else out([diagram.title ? `${diagram.title} (${shown})` : shown, '', ...whatIfSummary(diagram, all)].join('\n'));
    return all.every((w) => w.passed) ? exit : 1;
  }

  const analysis = simulate(diagram);
  // A document without whatif blocks prints exactly as before.
  const all = diagram.whatifs?.length ? runWhatIfs(diagram) : undefined;
  if (json) out(JSON.stringify({ file: shown, analysis, ...(all ? { whatifs: all.map(whatIfJson) } : {}) }, null, 2));
  else out([capacityReport(diagram, analysis, shown), ...(all ? ['', ...whatIfSummary(diagram, all)] : [])].join('\n'));
  return exit;
}

/** A what-if in JSON output, without its full analysis. */
function whatIfJson(w: WhatIfResult) {
  return { name: w.name, passed: w.passed, headline: w.headline, results: w.results, ...(w.warnings.length ? { warnings: w.warnings } : {}) };
}

const headlineCells = (h: WhatIfResult['headline']) => [formatMs(h.p99Ms), formatAvailability(h.availability), formatUsd(h.costUsd).replace('/month', '')];

/** `all 3 pass`, `1 of 3 fail`: the requirements (and systems) of a run; test blocks do not count. */
export function verdict(results: TestResult[]): string {
  const reqs = results.filter((r) => !r.id.startsWith('test:'));
  if (reqs.length === 0) return 'no requirements';
  const failed = reqs.filter((r) => !r.passed).length;
  return failed ? `${failed} of ${reqs.length} fail` : `all ${reqs.length} pass`;
}

/** The base design, then each what-if: requirements, worst p99, lowest availability, cost; then what fails. */
function whatIfSummary(diagram: Diagram, all: WhatIfResult[]): string[] {
  if (all.length === 0) return ['No whatif blocks.'];
  const base = simulate(diagram);
  const rows = [
    ['What-if', 'Requirements', 'Worst p99', 'Availability', 'Cost/month'],
    ['(as designed)', verdict(runTests(diagram, base)), ...headlineCells(headlineOf(base))],
    ...all.map((w) => [w.name, verdict(w.results), ...headlineCells(w.headline)]),
  ];
  const failing = all.flatMap((w) => w.results.filter((r) => !r.passed && !r.id.startsWith('test:')).map((r) => `  ${w.name}: ${r.name}: ${r.message}`));
  const warnings = all.flatMap((w) => w.warnings.map((m) => `  ${m}`));
  return [...table(rows, 2), ...(failing.length ? ['', 'Failing:', ...failing] : []), ...(warnings.length ? ['', 'Warnings:', ...warnings] : [])];
}

/** `proschi analyze --whatif <name>`: its changes, the capacity table under it, and its requirement results. */
function whatIfReport(diagram: Diagram, w: WhatIfResult, file: string): string {
  const changes = (findWhatIf(diagram, w.name)?.changes ?? []).map((c) =>
    c.kind === 'traffic'
      ? `traffic "${c.useCase}" ${c.rps !== undefined ? formatRps(c.rps) : `x${c.multiply}`}`
      : c.kind === 'fail'
        ? `fail ${c.node}`
        : c.kind === 'hit'
          ? `${c.node} hit ${c.percent}%`
          : c.kind === 'errors'
            ? `${c.node} errors ${c.percent}%`
            : `${c.node} x${c.replicas}`,
  );
  const lines = [`What-if "${w.name}": ${changes.join(', ') || 'no changes'}`, '', capacityReport(diagram, w.analysis, file), ''];
  const reqs = w.results.filter((r) => !r.id.startsWith('test:'));
  if (reqs.length === 0) lines.push('No requirements to check.');
  for (const r of reqs) {
    lines.push(`${r.passed ? '✓' : '✗'} ${r.name}: ${r.message}`);
    if (!r.passed && r.hint) lines.push(`    → ${r.hint}`);
  }
  if (reqs.length) lines.push('', `Requirements ${w.passed ? 'hold' : 'fail'} under "${w.name}".`);
  if (w.warnings.length) lines.push('', 'Warnings:', ...w.warnings.map((m) => `  ${m}`));
  return lines.join('\n');
}

/** `proschi analyze --sweep`: one row per rate, then where nodes saturate and how far the requirements hold. */
export function sweepReport(r: SweepResult, file: string, whatif?: string): string {
  const lines = [`Sweep of "${r.useCase}" from ${formatRps(r.from)} to ${formatRps(r.to)}${whatif ? ` under what-if "${whatif}"` : ''} (${file})`, ''];
  lines.push(
    ...table([
      ['Traffic', 'Worst p99', 'Availability', 'Cost/month', 'Requirements', 'Saturated'],
      ...r.steps.map((s) => [formatRps(s.rps), ...headlineCells(s.headline), s.passed ? 'pass' : 'FAIL', s.saturated.join(', ') || '-']),
    ]),
    '',
  );
  if (r.saturation.length === 0) lines.push('No node saturates in this range.');
  else lines.push('Saturates at:', ...r.saturation.map((s) => `  ${s.node}: ${s.atStart ? `already at ${formatRps(r.from)}` : formatRps(s.rps)}`));
  lines.push('');
  const failing = r.steps.find((s) => !s.passed)?.failing ?? [];
  if (r.maxPassingRps === undefined) lines.push(`Requirements fail already at ${formatRps(r.from)}: ${failing.join(', ')}`);
  else if (r.maxPassingRps >= r.to) lines.push(`Requirements hold over the whole range, up to ${formatRps(r.to)}.`);
  else lines.push(`Requirements hold up to ${formatRps(r.maxPassingRps)}; past it: ${failing.join(', ')}`);
  return lines.join('\n');
}

/** Left-aligns the first `left` columns (names) and right-aligns the rest (numbers). */
function table(rows: string[][], left = 1): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c < left ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  ').trimEnd());
}

/** `1k/20k rps 5%`: load of capacity and utilisation for reads or writes; `-` without load. */
function accessCell(load: number, capacity: number, utilization: number): string {
  return load > 0 ? `${formatRps(load).replace(' rps', '')}/${formatRps(capacity)} ${formatPercent(utilization)}` : '-';
}

/** `2.6 TB`, `260 GB` */
function formatGb(gb: number): string {
  const n = (x: number, digits: number) => Number(x.toFixed(digits)).toLocaleString('en-US');
  return gb >= 1000 ? `${n(gb / 1000, 1)} TB` : `${n(gb, gb < 10 ? 1 : 0)} GB`;
}

/** `$233,280 (2,592 TB)`: what leaves the node per month; `-` when nothing does. */
function egressCell(n: NodeAnalysis): string {
  return n.egressGbPerMonth > 0 ? `${formatUsd(n.egressUsd).replace('/month', '')} (${formatGb(n.egressGbPerMonth)})` : '-';
}

/** The capacity table of `proschi analyze`. */
export function capacityReport(diagram: Diagram, analysis: SimAnalysis, file: string): string {
  const lines = [diagram.title ? `${diagram.title} (${file})` : file, ''];
  if ((diagram.traffic ?? []).length === 0) lines.push('No traffic { … } block: loads are zero and latencies are at idle.', '');

  const nodes = analysis.nodes.filter((n) => n.kind !== 'client' && n.kind !== 'other');
  lines.push(
    ...table([
      ['Node', 'Kind', 'Replicas', 'Reads', 'Writes', 'Util', 'Latency', 'Availability', 'Egress/month', 'Cost/month'],
      ...nodes.map((n) => [
        n.id,
        n.kind,
        n.shards > 1 ? `${n.replicas}x${n.shards} shards` : String(n.replicas),
        accessCell(n.readLoadRps, n.readCapacityRps, n.readUtilization),
        accessCell(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization),
        `${formatPercent(n.utilization)}${n.saturated ? ' SATURATED' : n.utilization > HOT ? ' hot' : ''}`,
        formatMs(n.latencyMs),
        formatAvailability(n.availability),
        egressCell(n),
        formatUsd(n.costUsd).replace('/month', ''),
      ]),
    ], 2),
    '',
    `Total cost: ${formatUsd(analysis.totalCostUsd)}${analysis.totalEgressUsd > 0 ? ` (${formatUsd(analysis.totalEgressUsd)} of it egress)` : ''}`,
    ...costLines(diagram, analysis),
    '',
  );

  const queues = analysis.nodes.filter((n) => n.queue);
  if (queues.length) {
    lines.push(
      ...table([
        ['Queue', 'Inflow', 'Drain', 'Consumers', 'Backlog or lag'],
        ...queues.map((n) => {
          const q = n.queue!;
          return [n.id, formatRps(q.inflowRps), formatRps(q.drainRps), Number.isFinite(q.utilization) ? formatPercent(q.utilization) : '-', q.backlogPerHour > 0 ? `+${formatCount(q.backlogPerHour)} messages/hour` : `lag ${formatDuration(q.lagMs)}`];
        }),
      ]),
      '',
    );
  }

  if (analysis.useCases.length) {
    const rows = [['Use case', 'Traffic', 'p50', 'p95', 'p99', 'p99.9', 'Availability']];
    for (const u of analysis.useCases) {
      rows.push([u.name, u.rps > 0 ? formatTraffic(u.rps, u.avgRps) : '-', ...(['p50', 'p95', 'p99', 'p999'] as const).map((p) => formatMs(u.percentiles[p])), formatAvailability(u.availability)]);
      if (u.scenarios.length > 1) {
        for (const s of u.scenarios) rows.push([`  ${s.name}`, formatPercent(s.share), formatMs(s.percentiles.p50), formatMs(s.percentiles.p95), formatMs(s.percentiles.p99), formatMs(s.percentiles.p999), '']);
      }
    }
    lines.push(...table(rows), '');
  }

  lines.push(`Single points of failure: ${analysis.singlePointsOfFailure.join(', ') || 'none'}`);
  if (analysis.warnings.length) lines.push('', 'Warnings:', ...analysis.warnings.map((w) => `  ${w}`));
  return lines.join('\n');
}

/** `Cost by team: @Data $400, @Payments $250, no team $30`, and by group and tag; none when the design names neither. */
function costLines(diagram: Diagram, analysis: SimAnalysis): string[] {
  const b = costBreakdown(diagram, analysis);
  const usd = (x: number) => formatUsd(x).replace('/month', '');
  const line = (by: string, shares: { id: string; costUsd: number }[]) => (shares.length ? [`Cost by ${by}: ${shares.map((s) => `${s.id} ${usd(s.costUsd)}`).join(', ')}`] : []);
  return [...line('team', b.unowned ? [...b.teams, b.unowned] : b.teams), ...line('group', b.groups), ...line('tag', b.tags)];
}

/**
 * Failing requirements and tests as warnings at their lines in the root
 * document; for a test block, at each failing assertion.
 */
export function testDiagnostics(diagram: Diagram): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of resultsOf(diagram)) {
    if (r.passed || !r.loc || r.loc.file !== undefined) continue;
    const message = `${r.name}: ${r.message}${r.hint ? `. ${r.hint}` : ''}`;
    out.push({ ...r.loc, severity: 'warning', message });
    for (const a of r.assertions ?? []) {
      if (a.passed || a.loc.file !== undefined || a.loc.line === r.loc.line) continue;
      out.push({ ...a.loc, severity: 'warning', message: `${a.message}${a.hint ? `. ${a.hint}` : ''}` });
    }
  }
  return out;
}

/** Load, utilisation and latency of a node, for hovers; only when the document has traffic. */
export function nodeSimulation(diagram: Diagram, nodeId: string): string | undefined {
  if ((diagram.traffic ?? []).length === 0) return undefined;
  const sim = simulationOf(diagram);
  const n = sim.nodes.find((x) => x.id === nodeId);
  if (!n || n.kind === 'client' || n.kind === 'other') return undefined;
  const peak = sim.useCases.some((u) => u.avgRps !== undefined) ? ' at the peak' : '';
  const state = n.saturated ? ' — **saturated**' : n.utilization > HOT ? ' — hot' : '';
  const split =
    n.readLoadRps > 0 && n.writeLoadRps > 0
      ? [`Reads ${formatRps(n.readLoadRps)} of ${formatRps(n.readCapacityRps)} (${formatPercent(n.readUtilization)}) · writes ${formatRps(n.writeLoadRps)} of ${formatRps(n.writeCapacityRps)} (${formatPercent(n.writeUtilization)})`]
      : [];
  const hit = diagram.capacity?.find((c) => c.node === nodeId)?.hitPercent;
  const egress = n.egressGbPerMonth > 0 ? ` (${formatUsd(n.egressUsd).replace('/month', '')} of it egress, ${formatGb(n.egressGbPerMonth)})` : '';
  return [
    `Load ${formatRps(n.loadRps)} of ${formatRps(n.capacityRps)}${peak} (${formatPercent(n.utilization)} utilised${state})`,
    ...split,
    ...(hit !== undefined ? [`Hit rate ${hit}%: what it misses, ${Number((100 - hit).toFixed(6))}% of reads, goes on to the backing store`] : []),
    ...(n.retry ? [retryLine(n.retry)] : []),
    ...(n.queue ? [`Consumers drain ${formatRps(n.queue.drainRps)} of ${formatRps(n.queue.inflowRps)} in: ${n.queue.backlogPerHour > 0 ? `the backlog grows by **${formatCount(n.queue.backlogPerHour)} messages an hour**` : `lag ${formatDuration(n.queue.lagMs)}`}`] : []),
    `Latency ${formatMs(n.latencyMs)} per call · availability ${formatAvailability(n.availability)} · ${formatUsd(n.costUsd)}${n.replicas > 1 ? ` for ${n.replicas} replicas` : ''}${egress}`,
  ].join('  \n');
}

/** `lag 0.8 ms`, or `backlog +3.6M/h` when the consumers fall behind. */
export const queueText = (q: NonNullable<NodeAnalysis['queue']>): string => formatQueue(q);

/** `Errors 2% · 3 retries: 1.02 calls a request (in the load), 99.99999% succeed in the end`, and the storm risk. */
function retryLine(r: NonNullable<NodeAnalysis['retry']>): string {
  const retries = r.retries === 0 ? 'no retries' : `${r.retries} ${r.retries === 1 ? 'retry' : 'retries'}`;
  const calls = r.retries === 0 ? '' : `${Number(r.attempts.toPrecision(3))} calls a request (in the load), `;
  return `Errors ${formatPercent(r.errorRate)} · ${retries}: ${calls}${formatAvailability(r.success)} succeed in the end${r.stormRisk ? ' — **retry storm risk**' : ''}`;
}

/**
 * The simulation, requirement results and what-ifs of a parsed diagram,
 * computed once: the language server keeps one parse per document version,
 * so hovers, inlay hints, code lenses and diagnostics of a version share them.
 */
const runs = new WeakMap<Diagram, { analysis: SimAnalysis; results?: TestResult[]; whatifs?: WhatIfResult[] }>();

function runOf(diagram: Diagram) {
  let run = runs.get(diagram);
  if (!run) runs.set(diagram, (run = { analysis: simulate(diagram) }));
  return run;
}

export const simulationOf = (diagram: Diagram): SimAnalysis => runOf(diagram).analysis;

export function resultsOf(diagram: Diagram): TestResult[] {
  const run = runOf(diagram);
  return (run.results ??= runTests(diagram, run.analysis));
}

export function whatIfsOf(diagram: Diagram): WhatIfResult[] {
  const run = runOf(diagram);
  return (run.whatifs ??= runWhatIfs(diagram));
}
