import type { Diagram } from '../../dsl/types';
import type { NewWhatIf } from '../../dsl/edit';
import { components, resolveTraffic, type AnalyzeOptions } from '../../sim/analyze';
import { findWhatIf, whatIfOptions } from '../../sim/whatif';
import { findUseCase } from '../../sim/flow';

/**
 * The editor's what-if (docs/design/paid-plans.md P57): the traffic slider and
 * the nodes taken down from the right-click menu, or a saved `whatif` block
 * previewed from Results. View state only: the text changes only when it is
 * saved as a what-if or written to the traffic block.
 */
export interface LiveWhatIf {
  /** Every use case's traffic times this; 1 leaves it. */
  multiplier: number;
  /** Ids of the nodes simulated down. */
  failed: readonly string[];
  /** A saved `whatif` block previewed instead (Pro): its name. */
  saved?: string;
}

export const NO_WHATIF: LiveWhatIf = { multiplier: 1, failed: [] };

/** The slider's stops, from half the traffic to ten times it. */
export const MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 7.5, 10] as const;

export const isActive = (w: LiveWhatIf): boolean => w.multiplier !== 1 || w.failed.length > 0 || w.saved !== undefined;

/** The slider's stop nearest to a multiplier. */
export function stopOf(multiplier: number): number {
  let best = 0;
  MULTIPLIERS.forEach((m, i) => {
    if (Math.abs(Math.log(m / multiplier)) < Math.abs(Math.log(MULTIPLIERS[best] / multiplier))) best = i;
  });
  return best;
}

/** `×3.0`, `×0.75`, `×7.5`. */
export function formatMultiplier(m: number): string {
  return `×${Number.isInteger(m * 10) ? m.toFixed(1) : String(Number(m.toFixed(2)))}`;
}

/** `×3`, `×0.75`: for names and badges. */
const shortMultiplier = (m: number) => `×${Number(m.toFixed(2))}`;

/** The `traffic` block's total rate. */
export function totalRps(diagram: Diagram): number {
  let sum = 0;
  for (const t of resolveTraffic(diagram).values()) sum += t.rps;
  return sum;
}

/** Only the nodes the diagram still has that the model covers. */
function liveFailed(diagram: Diagram, failed: readonly string[]): string[] {
  const ids = new Set(components(diagram).map((n) => n.id));
  return failed.filter((id) => ids.has(id));
}

/**
 * The analysis options of the what-if, or undefined when it changes nothing
 * (the base analysis stands). A previewed block that is gone counts as none.
 */
export function liveOptions(diagram: Diagram, w: LiveWhatIf): AnalyzeOptions | undefined {
  if (w.saved !== undefined) {
    const block = findWhatIf(diagram, w.saved);
    return block ? whatIfOptions(diagram, block).options : undefined;
  }
  const failed = liveFailed(diagram, w.failed);
  const rates = new Map<string, number>();
  if (w.multiplier !== 1) for (const [id, t] of resolveTraffic(diagram)) if (t.rps > 0) rates.set(id, t.rps * w.multiplier);
  if (rates.size === 0 && failed.length === 0) return undefined;
  return { ...(rates.size ? { trafficRps: rates } : {}), ...(failed.length ? { failed: new Set(failed) } : {}) };
}

/** `Traffic ×3`, `cache down`, `Traffic ×3, cache and db down`: the badge, and the name it is saved under. */
export function whatIfLabel(diagram: Diagram, w: LiveWhatIf): string {
  if (w.saved !== undefined) return w.saved;
  const failed = liveFailed(diagram, w.failed);
  const parts = [
    ...(w.multiplier !== 1 ? [`Traffic ${shortMultiplier(w.multiplier)}`] : []),
    ...(failed.length ? [`${failed.length > 2 ? `${failed.length} nodes` : failed.join(' and ')} down`] : []),
  ];
  return parts.join(', ') || 'As written';
}

/** The `whatif` block's lines for the live what-if: each use case with traffic multiplied, each node down. */
export function liveChanges(diagram: Diagram, w: LiveWhatIf): NewWhatIf {
  const traffic =
    w.multiplier === 1
      ? []
      : (diagram.traffic ?? []).filter((t) => t.rps > 0 && !t.loc.file && findUseCase(diagram, t.useCase)).map((t) => ({ useCase: t.useCase, multiply: w.multiplier }));
  return { traffic, fail: liveFailed(diagram, w.failed) };
}

/** Takes a node down, or brings it back up. */
export function toggleFailed(w: LiveWhatIf, id: string): LiveWhatIf {
  const failed = w.failed.includes(id) ? w.failed.filter((f) => f !== id) : [...w.failed, id];
  return { multiplier: w.multiplier, failed };
}
