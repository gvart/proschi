/**
 * What each paid action is likely to cost, in credits (GET
 * /api/credits/estimates, docs/impl/design-partner.md). Pure and
 * dependency-free, so the Worker's tests can check its fallback against the
 * server's own numbers (backend/test/credits.test.ts).
 */

export interface Range {
  min: number;
  max: number;
}

/** GET /api/credits/estimates. */
export interface CreditEstimates {
  /** A 45-minute mock interview, verdict included. */
  mock_interview: Range;
  partner_review: Range;
  partner_build: Range;
  partner_turn: Range;
  /** The mock interview's verdict alone, inside `mock_interview`: what Deep mode multiplies there. */
  verdict?: Range;
  /** Deep mode (Max) costs about this many times as much. */
  deepMultiplier: number;
}

/**
 * The typical costs, shown signed out and until the server's estimates
 * arrive (P26): what GET /api/credits/estimates answers at the default
 * exchange rate (backend/src/meter.ts estimates). backend/test/credits.test.ts
 * fails when the two differ, so change both together.
 */
export const TYPICAL_COSTS: CreditEstimates = {
  mock_interview: { min: 37.984, max: 140.92 },
  partner_review: { min: 10.26, max: 49.4 },
  partner_build: { min: 16.796, max: 72.2 },
  partner_turn: { min: 4.978, max: 30.4 },
  verdict: { min: 14.592, max: 53.2 },
  // Opus's price per token over Sonnet's (meter.ts DEEP_MULTIPLIER).
  deepMultiplier: 2,
};
