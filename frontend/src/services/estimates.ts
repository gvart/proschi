/**
 * What each paid action is likely to cost, in credits (GET
 * /api/credits/estimates, backend/README.md). Pure and
 * dependency-free, so the Worker's tests can check its fallback against the
 * server's own numbers (backend/test/credits.test.ts).
 */

/** What an action usually costs, low to high; `worst` (from the server) is what it can never cost more than. */
export interface Range {
  min: number;
  max: number;
  worst?: number;
}

/** GET /api/credits/estimates. */
export interface CreditEstimates {
  /** A 45-minute mock interview, verdict included. */
  mock_interview: Range;
  partner_review: Range;
  partner_build: Range;
  partner_turn: Range;
  /** Voice input's server speech-to-text, a minute of audio (where the browser has no speech recognition). */
  voice_minute?: Range;
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
  mock_interview: { min: 37.253, max: 57.039, worst: 150 },
  partner_review: { min: 8.36, max: 12.16, worst: 49.4 },
  partner_build: { min: 12.996, max: 20.596, worst: 72.2 },
  partner_turn: { min: 4.028, max: 5.928, worst: 30.4 },
  voice_minute: { min: 0.098, max: 0.098, worst: 0.098 },
  verdict: { min: 12.692, max: 16.492, worst: 53.2 },
  // Opus's price per token over Sonnet's (meter.ts DEEP_MULTIPLIER).
  deepMultiplier: 2,
};
