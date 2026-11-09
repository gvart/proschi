import { soloCounts } from '../../learn/mastery';
import { soloScores, type SoloResults, type SoloSkill } from '../../learn/soloInterview';
import { checkedSoloResults, soloEffort } from '../interview/record';
import type { InterviewSummary } from '../modes/session';
import type { KeptSolo } from './api';
import type { TrendSession } from './SkillTrends';

/**
 * An interview on your own as the progress page shows it (P48, P53), from
 * this browser's history (modes/store.ts) or the account's
 * (GET /api/me/interviews/solo, Pro), which are merged: the same session in
 * both is one, the browser's copy first.
 */
export interface SoloRecord {
  problem: string;
  startedAt: number;
  durationMin: number;
  totalMs: number;
  overtime: boolean;
  /** Enough effort to count (mastery.ts soloCounts). */
  counts: boolean;
  /** The last check run passed every check. */
  solved: boolean;
  /** What it did; absent for one kept before they were. */
  results?: SoloResults;
}

export const soloKey = (r: Pick<SoloRecord, 'problem' | 'startedAt'>): string => `${r.problem}-${r.startedAt}`;

export function fromSummary(s: InterviewSummary): SoloRecord {
  const results = checkedSoloResults(s);
  return {
    problem: s.problem,
    startedAt: s.startedAt,
    durationMin: s.durationMin,
    totalMs: s.totalMs,
    overtime: s.overtime,
    counts: soloCounts(soloEffort(s)),
    solved: s.tests?.solved === true,
    ...(results ? { results } : {}),
  };
}

export function fromKept(s: KeptSolo): SoloRecord {
  return {
    problem: s.problem,
    startedAt: s.startedAt,
    durationMin: s.durationMin,
    totalMs: s.totalMs,
    overtime: s.totalMs > s.durationMin * 60_000,
    counts: soloCounts(s),
    solved: s.solved,
    ...(s.results ? { results: s.results } : {}),
  };
}

/** Both lists as one, newest first. */
export function mergeSolo(local: readonly InterviewSummary[], kept: readonly KeptSolo[] = []): SoloRecord[] {
  const byKey = new Map<string, SoloRecord>();
  for (const k of kept) byKey.set(soloKey(k), fromKept(k));
  for (const s of local) {
    const r = fromSummary(s);
    const other = byKey.get(soloKey(r));
    byKey.set(soloKey(r), r.results || !other?.results ? r : { ...r, results: other.results });
  }
  return [...byKey.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Within its minutes with every check passing, as record.ts soloOnTime. */
export const soloRecordOnTime = (r: SoloRecord): boolean => !r.overtime && r.solved;

/** How it ended, in words. */
export function soloOutcome(r: SoloRecord): string {
  if (!r.counts) return 'Too short to count';
  if (soloRecordOnTime(r)) return 'Solved on time';
  if (r.overtime) return 'Over time';
  return r.solved ? 'Solved' : 'Finished';
}

/** The sessions on the trend per skill: those that count and say what they did, scored (soloInterview.ts soloScores). */
export function soloTrend(records: readonly SoloRecord[]): TrendSession<SoloSkill>[] {
  return records
    .filter((r): r is SoloRecord & { results: SoloResults } => r.counts && r.results !== undefined)
    .map((r) => ({ id: soloKey(r), problem: r.problem, startedAt: r.startedAt, scores: soloScores(r.results), outcome: soloOutcome(r) }));
}
