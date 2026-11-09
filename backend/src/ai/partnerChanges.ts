import { diffDiagrams, parse, type DiagramDiff, type ParseResult } from '../../../frontend/src/dsl';
import { defaultEngine } from '../../../frontend/src/hld/engine';
import type { Problem } from '../../../frontend/src/practice/types';
import { parseSolution } from '../../../frontend/src/practice/workspace';
import { MAX_REVIEW_SOURCE } from '../../../frontend/src/review/contract';
import { sentFilesResolver } from './reviewer';

/**
 * A Design partner change checked on the server (docs/design/paid-plans.md
 * P29; README.md "Design partner", Change): its find-and-replace edits are
 * applied in order to the source the page sent, the result is parsed,
 * simulated and, on a practice problem, tested, and the change carries the
 * numbers before and after. The model's edits are never trusted: an edit
 * that does not apply, a result that does not parse or is too big is
 * `{ok: false, reason}`.
 */

export interface Edit {
  find: string;
  replace: string;
}

export interface Metrics {
  tests: { passed: number; total: number } | null;
  p99Ms: number | null;
  availability: number | null;
  costPerMonth: number | null;
}

export type ChangeResult = { ok: true; source: string; summary: string[]; before: Metrics; after: Metrics } | { ok: false; reason: string };

/** Where the design comes from: a practice problem's solution, or an editor diagram and the files it imports (as data, never fetched). */
export type DesignSite = { problem: Problem } | { problem?: undefined; files: Record<string, string> };

export interface Measured {
  parsed: ParseResult;
  errors: string[];
  metrics: Metrics;
}

const NO_METRICS: Metrics = { tests: null, p99Ms: null, availability: null, costPerMonth: null };
const finite = (n: number | undefined): number | null => (n !== undefined && Number.isFinite(n) ? n : null);

/** Parses, simulates and tests `source` as the server sees it (P6). */
export function measure(source: string, site: DesignSite): Measured {
  const parsed = site.problem ? parseSolution(site.problem, source) : parse(source, { resolve: sentFilesResolver(site.files, undefined) });
  const errors = parsed.diagnostics
    .filter((d) => d.severity === 'error')
    .slice(0, 5)
    .map((d) => `${d.file ? `${d.file} ` : ''}line ${d.line}: ${d.message}`);
  if (errors.length) return { parsed, errors, metrics: NO_METRICS };
  const analysis = defaultEngine.analyze(parsed.diagram);
  const results = defaultEngine.runTests(parsed.diagram, analysis);
  const p99s = (analysis?.useCases ?? []).map((u) => u.percentiles.p99).filter(Number.isFinite);
  const availabilities = (analysis?.useCases ?? []).map((u) => u.availability).filter(Number.isFinite);
  return {
    parsed,
    errors,
    metrics: {
      tests: results.length ? { passed: results.filter((r) => r.passed).length, total: results.length } : null,
      p99Ms: p99s.length ? Math.max(...p99s) : null,
      availability: availabilities.length ? Math.min(...availabilities) : null,
      costPerMonth: finite(analysis?.totalCostUsd),
    },
  };
}

/** How many times `needle` occurs in `text`, counting overlaps, up to 2 (all the check needs). */
function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0 && count < 2; at = text.indexOf(needle, at + 1)) count++;
  return count;
}

const quote = (s: string) => JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);

/**
 * Applies `edits` in order, each to the previous one's result. Each `find`
 * must occur exactly once in the text it is applied to; an empty `find`
 * replaces the whole document, and is allowed only as the first edit when
 * `whole` (a build) or the document is blank. The new source, or why not.
 */
export function applyEdits(source: string, edits: readonly Edit[], whole = false): { source: string } | { reason: string } {
  if (!edits.length) return { reason: 'The change has no edits' };
  let text = source;
  for (const [i, { find, replace }] of edits.entries()) {
    const n = `Edit ${i + 1}`;
    if (find === '') {
      if (i > 0 || !(whole || !text.trim())) return { reason: `${n} has an empty find` };
      text = replace;
    } else {
      const count = occurrences(text, find);
      if (count === 0) return { reason: `${n}: ${quote(find)} is not in the design` };
      if (count > 1) return { reason: `${n}: ${quote(find)} occurs more than once; include more of the surrounding text` };
      const at = text.indexOf(find);
      text = text.slice(0, at) + replace + text.slice(at + find.length);
    }
    if (text.length > MAX_REVIEW_SOURCE) return { reason: `The changed design is over ${MAX_REVIEW_SOURCE / 1024} KiB` };
  }
  if (text === source) return { reason: 'The change does not change the design' };
  return { source: text };
}

/** A one-line description of each change between two diagrams, from diffDiagrams; at most `max` lines. */
export function diffSummary(diff: DiagramDiff, max = 12): string[] {
  const lines: string[] = [];
  for (const f of diff.diagram) lines.push(`Changed the ${f.field}`);
  const section = <T>(label: string, d: { added: T[]; removed: T[]; changed: { key: string; changes: { field: string }[] }[] }, name: (t: T) => string) => {
    for (const t of d.added) lines.push(`Added ${label} ${name(t)}`);
    for (const t of d.removed) lines.push(`Removed ${label} ${name(t)}`);
    for (const c of d.changed) lines.push(`Changed ${label} ${c.key}: ${c.changes.map((x) => x.field).join(', ')}`);
  };
  section('node', diff.nodes, (n) => n.id);
  section('connection', diff.edges, (e) => `${e.source} -> ${e.target}`);
  section('use case', diff.useCases, (u) => JSON.stringify(u.name));
  section('scenario', diff.scenarios, (s) => `${s.useCase}/${s.scenario.id}`);
  section('requirement', diff.requirements, (r) => r.kind);
  section('traffic of', diff.traffic, (t) => JSON.stringify(t.useCase));
  section('capacity of', diff.capacity, (c) => c.node);
  section('system', diff.systems, (s) => s.id);
  return lines.length > max ? [...lines.slice(0, max - 1), `and ${lines.length - max + 1} more`] : lines;
}

/** Checks one change against `source` (already measured as `before`): applied, parsed, simulated and tested. */
export function checkChange(source: string, before: Measured, edits: readonly Edit[], site: DesignSite, whole = false): ChangeResult {
  const applied = applyEdits(source, edits, whole);
  if ('reason' in applied) return { ok: false, reason: applied.reason };
  const after = measure(applied.source, site);
  if (after.errors.length) return { ok: false, reason: `The changed design does not parse: ${after.errors.join('; ')}` };
  const summary = before.errors.length ? ['Replaced a design that did not parse'] : diffSummary(diffDiagrams(before.parsed.diagram, after.parsed.diagram));
  return { ok: true, source: applied.source, summary, before: before.metrics, after: after.metrics };
}
