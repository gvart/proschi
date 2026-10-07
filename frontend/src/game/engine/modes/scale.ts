import type { ModeRules } from './mode';

/**
 * Scale or Fail: waves of growth with a card draft after each and, once a
 * player has cleared a scenario, the twists (twists.ts): mutators, a forecast
 * range, unannounced incidents and bounties. A right-sized wave gets part of
 * its bill back.
 */
export const scale: ModeRules = {
  id: 'scale',
  draft: true,
  twists: true,
  leanRefund: true,
  mechanics: [],
};
