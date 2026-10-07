import type { Game } from '../run';
import { BREACH_LEARN, GameError } from '../state';
import { TRUST_PENALTY } from '../rules';
import { migrations } from './migrations';
import type { Mechanic, ModeRules } from './mode';

/**
 * Legacy (Monolith): strangle an old system without breaking its clients.
 * Old API versions (`legacy` use cases) cost upkeep while they are served
 * next to their replacement, and sunsetting one too early sends its clients
 * 410 Gone; schema changes are migrations (migrations.ts).
 */

/** Cash a wave for the legacy versions still served. */
export function upkeep(game: Game): number {
  const s = game.state;
  return s.useCases.reduce((a, k) => {
    const legacy = game.scenario.useCases[k]?.legacy;
    return a + (legacy && !s.sunset.includes(k) && s.useCases.includes(legacy.replacedBy) ? legacy.upkeep : 0);
  }, 0);
}

export const legacyVersions: Mechanic = {
  id: 'legacy-versions',
  actions: {
    sunset(game, action) {
      const s = game.state;
      game.expect('plan');
      const uc = game.scenario.useCases[action.useCase];
      if (!uc?.legacy || !s.useCases.includes(action.useCase)) throw new GameError(`"${uc?.name ?? action.useCase}" is not a legacy version you serve`);
      if (!s.useCases.includes(uc.legacy.replacedBy)) throw new GameError(`"${uc.name}" has no replacement yet: ship ${game.scenario.useCases[uc.legacy.replacedBy]?.name ?? uc.legacy.replacedBy} first`);
      if (s.sunset.includes(action.useCase)) throw new GameError(`"${uc.name}" is already sunset`);
      s.sunset.push(action.useCase);
    },
  },
  serves: (game, key) => !game.state.sunset.includes(key),
  blocks(game, { key, useCase: uc, rps: r, breaches }) {
    if (!game.state.sunset.includes(key)) return false;
    if (r > 0) {
      breaches.push({
        kind: 'compat',
        message: `${Math.round(r)} rps of clients still call "${uc.name}", which you sunset: they get 410 Gone.`,
        hint: 'Sunset a version only once its traffic is gone: watch it fall, and give its clients a deadline first.',
        useCase: key,
        trust: TRUST_PENALTY.compat,
        learn: BREACH_LEARN.compat,
      });
    }
    return true;
  },
  upkeep,
};

export const legacy: ModeRules = {
  id: 'legacy',
  draft: false,
  twists: false,
  leanRefund: false,
  mechanics: [legacyVersions, migrations],
};
