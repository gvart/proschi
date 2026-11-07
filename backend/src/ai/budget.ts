import { HAIKU, NO_USAGE, OPUS, SONNET, type Model, type Usage } from './client';

/**
 * The limits of one AI interview (docs/design/paid-plans.md, P3): a hard
 * token cap and a 60-minute wall clock, whatever the chosen duration.
 *
 * The cap counts input-equivalent tokens: input, cache writes and output in
 * full, cache reads at a tenth (what they cost next to input). A heavy
 * 45-minute session (30 turns, a design sent every few turns) uses about
 * 350k; the cap leaves room for that and stops a runaway one.
 */

export const TOKEN_CAP = 600_000;
/** Kept back for the verdict: turns stop before it, so the verdict can always run. */
export const VERDICT_RESERVE = 60_000;
export const WALL_CLOCK_MS = 60 * 60_000;
/** Candidate turns per session. */
export const MAX_TURNS = 80;
/** One candidate message, in characters. */
export const MAX_MESSAGE_CHARS = 4_000;
/** One design snapshot: the Free plan's diagram size (P1). */
export const MAX_DESIGN_CHARS = 64 * 1024;

export type SessionUsage = Record<Model, Usage>;

export const emptyUsage = (): SessionUsage => ({ [SONNET]: { ...NO_USAGE }, [HAIKU]: { ...NO_USAGE } }) as SessionUsage;

export function addUsage(total: SessionUsage, model: Model, u: Usage | undefined): SessionUsage {
  if (!u) return total;
  const t = total[model];
  return {
    ...total,
    [model]: {
      input_tokens: t.input_tokens + u.input_tokens,
      output_tokens: t.output_tokens + u.output_tokens,
      cache_creation_input_tokens: t.cache_creation_input_tokens + u.cache_creation_input_tokens,
      cache_read_input_tokens: t.cache_read_input_tokens + u.cache_read_input_tokens,
    },
  };
}

/** Input-equivalent tokens of a session, the unit of TOKEN_CAP. */
export function billedTokens(total: SessionUsage): number {
  return Object.values(total).reduce((sum, u) => sum + u.input_tokens + u.cache_creation_input_tokens + u.output_tokens + Math.ceil(u.cache_read_input_tokens / 10), 0);
}

/** USD per million tokens (first-party Claude API rates). Cache writes are priced at the 1-hour rate, an upper bound. */
const PRICES: Record<Model, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  [SONNET]: { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  [HAIKU]: { input: 0.1, output: 0.5, cacheWrite: 0.2, cacheRead: 0.01 },
  [OPUS]: { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 },
};

/** What a session cost, for metering and the admin's numbers. */
export function sessionCostUsd(total: SessionUsage): number {
  return (Object.keys(total) as Model[]).reduce((sum, model) => {
    const u = total[model];
    const p = PRICES[model];
    return sum + (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_creation_input_tokens * p.cacheWrite + u.cache_read_input_tokens * p.cacheRead) / 1e6;
  }, 0);
}

/** What `after` used beyond `before` (the same session's usage, later): one turn's bill. */
export function usageSince(after: SessionUsage, before: SessionUsage): SessionUsage {
  const out = emptyUsage();
  for (const model of Object.keys(out) as Model[]) {
    const a = after[model];
    const b = before[model];
    out[model] = {
      input_tokens: a.input_tokens - b.input_tokens,
      output_tokens: a.output_tokens - b.output_tokens,
      cache_creation_input_tokens: a.cache_creation_input_tokens - b.cache_creation_input_tokens,
      cache_read_input_tokens: a.cache_read_input_tokens - b.cache_read_input_tokens,
    };
  }
  return out;
}

/** Whether a turn estimated at `tokens` still fits under the cap, the verdict's reserve kept; `billed` is what the session has used so far (billedTokens). */
export function turnFits(billed: number, tokens: number): boolean {
  return billed + tokens <= TOKEN_CAP - VERDICT_RESERVE;
}
