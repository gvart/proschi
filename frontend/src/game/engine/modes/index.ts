import type { Action, GameMode } from '../types';
import { cost } from './cost';
import { diagnosis, incident } from './incident';
import { legacy, legacyVersions } from './legacy';
import { migrations } from './migrations';
import type { ActionHandlers, Mechanic, ModeRules } from './mode';
import { scale } from './scale';
import { startup } from './startup';

export type { ActionHandlers, Mechanic, ModeRules, ServeContext, TickContext } from './mode';
export { backfillKey, blockedBy, migrationOf } from './migrations';
export { upkeep } from './legacy';

/** Every mode, by the `mode` of a scenario's front matter. */
export const MODES: Record<GameMode, ModeRules> = { scale, startup, incident, legacy, cost };

/** Every mechanic a mode can use. */
export const MECHANICS: readonly Mechanic[] = [legacyVersions, migrations, diagnosis];

/** The mechanic that owns an action type, if one does (the rest are the core's). */
export function ownerOf(t: Action['t']): ActionHandlers[Action['t']] | undefined {
  for (const m of MECHANICS) {
    const handler = m.actions?.[t];
    if (handler) return handler;
  }
  return undefined;
}
