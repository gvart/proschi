import { DEMAND_SPREAD, DEMAND_SPREAD_BOSS, LOADTEST_COST } from '../engine/rules';
import type { Board, ComponentDef } from '../engine/types';
import type { Briefing } from './briefing';

/**
 * Kernel's first-wave tutorial in Shortly: place a load balancer, add a
 * replica, load test, deploy. Each step is read off the plan itself, so undo
 * steps back and a player who already knows skips ahead. The page highlights
 * the step's control with CSS (`[data-coach-step]` in arcade.css).
 */

/** The scenario new players learn on, and the one the tutorial runs in. */
export const TUTORIAL_SCENARIO = 'shortly';

export type TutorialStep = 'lb' | 'replica' | 'loadtest' | 'deploy';
export const TUTORIAL_STEPS: readonly TutorialStep[] = ['lb', 'replica', 'loadtest', 'deploy'];

/** Where the plan is in the tutorial: the first step it has not done yet. */
export function tutorialStep(plan: Board, tested: boolean, components: ReadonlyMap<string, Pick<ComponentDef, 'role'>>): TutorialStep {
  const role = (component: string) => components.get(component)?.role;
  if (!plan.nodes.some((n) => role(n.component) === 'lb')) return 'lb';
  if (!plan.nodes.some((n) => role(n.component) === 'app' && n.replicas >= 2)) return 'replica';
  if (!tested) return 'loadtest';
  return 'deploy';
}

/** What Kernel says at each step. */
export const TUTORIAL_TEXT: Record<TutorialStep, string> = {
  lb: 'Let’s build. All our users hit one app server, and one box is one failure from an outage. Pick Load Balancer below, then tap the + in the edge row: it wires itself in.',
  replica: 'Now give it something to balance. Tap the App Server on the board and press + next to Replicas: two servers share the load, and one can fail without taking Redirect down.',
  loadtest: `Before we ship, try it. “Load test the peak” runs this plan at the month’s busiest moment for $${LOADTEST_COST}, and says what would break.`,
  deploy: 'Looks good? Deploy wave 1: eight ticks of real traffic follow. If something runs hot, the Hotfixes under the board act at once.',
};

/**
 * What Kernel says the first time a run has the advanced twists: what is new
 * since the basic rules. `daily` when it is the daily run (which has them
 * for everyone) before the player's first clear.
 */
export function twistsIntro(daily: boolean): Briefing {
  return {
    mood: 'happy',
    lines: [
      daily
        ? 'The daily run plays every twist, the same for everyone. Here is what is new:'
        : 'You cleared your first run, so the training wheels come off. Here is what is new:',
      'Mutators: a run starts with a choice of three twists, like users on another continent or three times the writes. Each changes the winning design and multiplies your points.',
      'Bounties: each wave offers three optional objectives. Take one or none: met, it pays; missed, it costs a little.',
      `Forecasts are ranges: the real peak lands within ${Math.round(DEMAND_SPREAD * 100)}% either way (${Math.round(DEMAND_SPREAD_BOSS * 100)}% on a boss), so leave some headroom.`,
      'Hold the line: change the board during the run and ship it live. Scaling lands the next tick, new parts in two.',
      'From wave 5 some incidents come unannounced, and one that breaks something can set off another.',
      'Three cards of one topic make a set (points ×1.1), and after a few waves a client offers a contract.',
    ],
  };
}
