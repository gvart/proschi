import type { ModeRules } from './mode';

/**
 * Cost (Runway): the design works, the bill does not. Each wave's ticket
 * tightens a `cost` requirement, which the simulation's tests check like any
 * other, so the mode needs no mechanic of its own: only the design-first
 * rules (no draft, no twists).
 */
export const cost: ModeRules = {
  id: 'cost',
  draft: false,
  twists: false,
  leanRefund: false,
  mechanics: [],
};
