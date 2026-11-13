/**
 * `proschi diff a.proschi b.proschi`: what changed between two local designs
 * (the editor's structural diff, frontend/src/dsl/diff.ts) and what the
 * change does in the simulation (frontend/src/sim/delta.ts): cost, p99 and
 * availability before and after, the checks that flipped and the nodes whose
 * load moved. `proschi versions diff` prints the same (versions.ts).
 */
import { designDelta, summarizeDiff, type ParseResult } from './proschi';
import { displayPath, parseFile } from './imports';
import { deltaJson, formatDelta, warnErrors } from './simDelta';
import { formatDiff } from './versions';

export const DIFF_USAGE = `  proschi diff [--json] <before.proschi> <after.proschi>`;

export const DIFF_HELP = `diff    Prints what changed from <before> to <after> (nodes, edges, use
        cases, requirements, traffic, …) and what the change does in the
        simulation: cost, worst p99 and availability before and after, each
        use case with traffic, the checks (requirements, systems, tests) that
        flipped between pass and fail, and the nodes whose utilisation moved
        by 10 points or more. --json prints the same for scripts.`;

export function runDiff(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  let json = false;
  const files: string[] = [];
  for (const arg of args) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\nUsage:\n${DIFF_USAGE}`);
      return 2;
    } else files.push(arg);
  }
  if (files.length !== 2) {
    err(`Usage:\n${DIFF_USAGE}`);
    return 2;
  }
  let left: ParseResult;
  let right: ParseResult;
  try {
    left = parseFile(files[0]);
    right = parseFile(files[1]);
  } catch (e) {
    err(`error: ${(e as Error).message}`);
    return 1;
  }
  const [from, to] = files.map((f) => displayPath(f));
  warnErrors(
    [
      [from, left],
      [to, right],
    ],
    err,
  );
  const delta = designDelta(left.diagram, right.diagram);
  if (json) out(JSON.stringify({ base: { file: from }, target: { file: to }, summary: summarizeDiff(delta.diff), diff: delta.diff, delta: deltaJson(delta) }, null, 2));
  else {
    const sim = formatDelta(delta);
    out(sim ? `${formatDiff(delta.diff, from, to)}\n\n${sim}` : formatDiff(delta.diff, from, to));
  }
  return 0;
}
