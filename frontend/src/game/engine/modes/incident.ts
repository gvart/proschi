import { DIAGNOSIS_POINTS, DIAGNOSIS_TRUST, TRUST_PENALTY } from '../rules';
import { GameError } from '../state';
import type { Mechanic, ModeRules } from './mode';

/**
 * Incident (Dinnerbell): every wave opens on a live incident. Before the fix
 * is deployed the player names its root cause from the wave's `diagnosis`
 * options: a right call gives Trust and points, a wrong one costs Trust.
 */

export const diagnosis: Mechanic = {
  id: 'diagnosis',
  actions: {
    diagnose(game, action) {
      const s = game.state;
      game.expect('plan');
      const d = game.waveDef().diagnosis;
      if (!d) throw new GameError('There is nothing to diagnose this wave');
      if (s.diagnosis) throw new GameError('You already named a root cause this wave');
      const option = d.options.find((o) => o.id === action.pick);
      if (!option) throw new GameError(`No such diagnosis '${action.pick}'`);
      const correct = !!option.correct;
      s.diagnosis = { pick: option.id, correct };
      if (correct) {
        s.trust = Math.min(s.maxTrust, s.trust + DIAGNOSIS_TRUST);
        s.score += DIAGNOSIS_POINTS;
      } else {
        s.trust = Math.max(0, s.trust - TRUST_PENALTY.misdiagnosis);
        if (s.trust <= 0) game.end('churned');
      }
    },
  },
  onWaveStart(game) {
    delete game.state.diagnosis;
  },
  beforeDeploy(game) {
    if (game.waveDef().diagnosis && !game.state.diagnosis) throw new GameError('Name the root cause first: the fix depends on it');
  },
};

export const incident: ModeRules = {
  id: 'incident',
  draft: false,
  twists: false,
  leanRefund: false,
  mechanics: [diagnosis],
};
