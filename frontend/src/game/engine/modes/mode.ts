import type { Game } from '../run';
import type { Breach } from '../state';
import type { Action, Board, ComponentDef, GameMode, UseCaseDef } from '../types';

/**
 * How a game mode plugs into the run (docs/GAME.md, "The engine"). The core
 * (run.ts) is the same for every scenario; a mode says whether waves end in a
 * card draft and whether the Scale or Fail twists apply, and lists the
 * mechanics its scenarios use. A mechanic owns its planning actions and adds
 * to a wave and a tick through the hooks below; every hook is optional.
 */

/** A planning action a mechanic owns, by its `t`. */
export type ActionOf<T extends Action['t']> = Extract<Action, { t: T }>;

export type ActionHandlers = { [T in Action['t']]?: (game: Game, action: ActionOf<T>) => void };

/** One use case of a tick, before the core routes it. */
export interface ServeContext {
  key: string;
  /** The use case as the wave runs it. */
  useCase: UseCaseDef;
  /** Its rps this tick. */
  rps: number;
  breaches: Breach[];
}

/** A tick after the core served every use case. */
export interface TickContext {
  board: Board;
  tick: number;
  rps: ReadonlyMap<string, number>;
  useCases: Readonly<Record<string, UseCaseDef>>;
  breaches: Breach[];
}

export interface Mechanic {
  id: string;
  /**
   * Planning actions it owns. An action is checked against the scenario's
   * data (no migration, no legacy version, no diagnosis: refused), so the
   * core sends it to its owner whatever the mode.
   */
  actions?: ActionHandlers;
  /** A new wave's planning begins. */
  onWaveStart?(game: Game): void;
  /** Throws a GameError when the plan may not be deployed yet. */
  beforeDeploy?(game: Game): void;
  /** The use cases as this wave runs them (changed in place), and background jobs it adds. */
  shapeUseCases?(game: Game, useCases: Record<string, UseCaseDef>, jobs: { key: string; rps: number }[]): void;
  /** Whether an active use case is served this wave; one mechanic saying no is enough. */
  serves?(game: Game, key: string): boolean;
  /** Stores whose writes are locked this tick. */
  writesDown?(game: Game, board: Board, tick: number, comp: (id: string) => ComponentDef | undefined): string[];
  /** True when the use case gets no answer this tick (with any breach added): the core skips routing it. */
  blocks?(game: Game, ctx: ServeContext): boolean;
  /** Breaches of the tick once every use case was served. */
  afterServe?(game: Game, ctx: TickContext): void;
  /** Cash a wave this mechanic costs. */
  upkeep?(game: Game): number;
}

export interface ModeRules {
  id: GameMode;
  /** A card draft after each wave (Scale or Fail); the design-first modes have none. */
  draft: boolean;
  /**
   * The Scale or Fail twists (twists.ts) apply, once the run plays them: the
   * mutators, a forecast range, unannounced incidents and the bounties.
   */
  twists: boolean;
  /** A right-sized wave gets part of its cost back. */
  leanRefund: boolean;
  /** The mechanics its scenarios use, in the order their hooks run. */
  mechanics: readonly Mechanic[];
}
