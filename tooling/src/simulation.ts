/**
 * The simulation and tests (frontend/src/sim) for the command line and the
 * language server: `proschi test` runs requirements and test blocks,
 * `proschi analyze` prints the capacity table, and the language server turns
 * failing results into warnings and adds load to node hovers.
 */
import {
  HOT,
  formatAvailability,
  formatMs,
  formatPercent,
  formatRps,
  formatUsd,
  runTests,
  simulate,
  type Diagnostic,
  type Diagram,
  type NodeAnalysis,
  type ParseResult,
  type SimAnalysis,
  type TestResult,
} from './proschi';
import { displayPath, parseFile } from './imports';

export const SIM_USAGE = `  proschi test [--format text|github|json] <file|dir>...
  proschi analyze [--format text|json] <file>`;

export const SIM_HELP = `test    Runs the requirements and test blocks of each file (imports are
        followed) against the simulation. Exits with 1 if any fails or a file
        has errors.
analyze Prints the capacity table: reads and writes (load of capacity and
        utilisation), latency, availability, egress and cost per node; latency
        percentiles per use case and scenario.`;

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

export function runAnalyze(args: string[], out: (s: string) => void, err: (s: string) => void, load: Loader = parseFile): number {
  const parsed = parseArgs(args, ['text', 'json'], err);
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
  const analysis = simulate(result.diagram);
  if (parsed.style === 'json') out(JSON.stringify({ file: displayPath(file), analysis }, null, 2));
  else out(capacityReport(result.diagram, analysis, displayPath(file)));
  return result.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
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
    '',
  );

  if (analysis.useCases.length) {
    const rows = [['Use case', 'Traffic', 'p50', 'p95', 'p99', 'p99.9', 'Availability']];
    for (const u of analysis.useCases) {
      rows.push([u.name, u.rps > 0 ? formatRps(u.rps) : '-', ...(['p50', 'p95', 'p99', 'p999'] as const).map((p) => formatMs(u.percentiles[p])), formatAvailability(u.availability)]);
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

/**
 * Failing requirements and tests as warnings at their lines in the root
 * document; for a test block, at each failing assertion.
 */
export function testDiagnostics(diagram: Diagram): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of runTests(diagram)) {
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
  const n = simulate(diagram).nodes.find((x) => x.id === nodeId);
  if (!n || n.kind === 'client' || n.kind === 'other') return undefined;
  const state = n.saturated ? ' — **saturated**' : n.utilization > HOT ? ' — hot' : '';
  const split =
    n.readLoadRps > 0 && n.writeLoadRps > 0
      ? [`Reads ${formatRps(n.readLoadRps)} of ${formatRps(n.readCapacityRps)} (${formatPercent(n.readUtilization)}) · writes ${formatRps(n.writeLoadRps)} of ${formatRps(n.writeCapacityRps)} (${formatPercent(n.writeUtilization)})`]
      : [];
  const egress = n.egressGbPerMonth > 0 ? ` (${formatUsd(n.egressUsd).replace('/month', '')} of it egress, ${formatGb(n.egressGbPerMonth)})` : '';
  return [
    `Load ${formatRps(n.loadRps)} of ${formatRps(n.capacityRps)} (${formatPercent(n.utilization)} utilised${state})`,
    ...split,
    `Latency ${formatMs(n.latencyMs)} per call · availability ${formatAvailability(n.availability)} · ${formatUsd(n.costUsd)}${n.replicas > 1 ? ` for ${n.replicas} replicas` : ''}${egress}`,
  ].join('  \n');
}
