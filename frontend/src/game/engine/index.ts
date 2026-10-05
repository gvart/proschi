/**
 * Scale or Fail, the system design roguelite (docs/GAME.md): a pure engine
 * shared by the Arcade page, the Worker and the `proschi game` CLI.
 */
export * from './types';
export * from './rules';
export { GAME_ICONS, isIconName, type IconName } from './icons';
export { Game, GameError, mergeRequirements, parseRequirements, type Breach, type BreachKind, type EventInstance, type FlowTick, type Forecast, type NodeTick, type Outcome, type RunState, type TickResult, type UseCaseTick, type WaveSummary } from './run';
export { boardProblems, canWire, cloneBoard, laneOf, nextId, roleOf, type NodeRole } from './board';
export { compile, USERS, WAN, type Compiled } from './compile';
export { readContent, ContentError, type ContentRead } from './content';
export { buy, dailyScenario, emptyMeta, equip, firstClear, loadoutAllowed, loadoutFor, maxAscension, MetaError, readMeta, recordRun, scenarioOpen, shop, type Meta, type RunRecord, type ShopItem } from './meta';
export { computeMods, type Mods } from './mods';
export { dailySeed } from './rng';
