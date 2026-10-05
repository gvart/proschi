import type { GameStats } from '../../learn/achievements';
import { ascensionRules, MAX_ASCENSION } from './rules';
import type { GameContent, Loadout, ScenarioDef } from './types';

/**
 * Progress between runs (docs/GAME.md, "Progression"): Blueprints earned by
 * runs and spent on unlocks and perks, the furthest wave and the highest
 * ascension cleared per scenario. Pure: the page keeps a guest's progress in
 * localStorage, the Worker keeps a signed-in player's in D1, and both change
 * it with these functions so the rules cannot drift.
 */

export interface Meta {
  v: 1;
  blueprints: number;
  /** Bought component, feature and card ids. */
  unlocked: string[];
  /** Bought perk levels. */
  perks: Record<string, number>;
  /** Perks taken into runs (at most the slots of the ascension played). */
  equipped: string[];
  /** Per scenario: the furthest wave reached (1-based) and the highest ascension cleared (-1 for none). */
  scenarios: Record<string, { reached: number; cleared: number }>;
  /** Codex: ids of components, cards and events seen. */
  seen: string[];
  runs: number;
}

export const emptyMeta = (): Meta => ({ v: 1, blueprints: 0, unlocked: [], perks: {}, equipped: [], scenarios: {}, seen: [], runs: 0 });

export class MetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaError';
  }
}

/** Reads stored progress, dropping anything malformed instead of failing. */
export function readMeta(value: unknown): Meta {
  const m = emptyMeta();
  if (!value || typeof value !== 'object') return m;
  const v = value as Partial<Meta>;
  const nat = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const strings = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && s.length <= 64))].slice(0, 500) : []);
  m.blueprints = nat(v.blueprints);
  m.unlocked = strings(v.unlocked);
  m.equipped = strings(v.equipped).slice(0, 3);
  m.seen = strings(v.seen);
  m.runs = nat(v.runs);
  if (v.perks && typeof v.perks === 'object') for (const [k, n] of Object.entries(v.perks)) if (nat(n) > 0 && k.length <= 64) m.perks[k] = nat(n);
  if (v.scenarios && typeof v.scenarios === 'object') {
    for (const [k, s] of Object.entries(v.scenarios)) {
      if (!s || typeof s !== 'object' || k.length > 64) continue;
      const cleared = typeof s.cleared === 'number' && Number.isInteger(s.cleared) ? Math.max(-1, Math.min(MAX_ASCENSION, s.cleared)) : -1;
      m.scenarios[k] = { reached: nat(s.reached), cleared };
    }
  }
  return m;
}

/** What can be bought, with its price, and why not when it cannot. */
export interface ShopItem {
  kind: 'component' | 'feature' | 'card' | 'perk';
  id: string;
  name: string;
  cost: number;
  owned: boolean;
  /** For perks: the level owned and the most there is. */
  level?: number;
  maxLevel?: number;
  blocked?: string;
}

export function shop(content: GameContent, meta: Meta): ShopItem[] {
  const has = new Set(meta.unlocked);
  const items: ShopItem[] = [];
  for (const c of content.components) {
    if (c.unlock === 0) continue;
    const missing = (c.requires ?? []).find((r) => !has.has(r) && (content.components.find((x) => x.id === r)?.unlock ?? 0) > 0);
    items.push({ kind: 'component', id: c.id, name: c.name, cost: c.unlock, owned: has.has(c.id), ...(missing ? { blocked: `Unlock ${content.components.find((x) => x.id === missing)?.name ?? missing} first` } : {}) });
  }
  for (const f of content.features) items.push({ kind: 'feature', id: f.id, name: f.name, cost: f.unlock, owned: has.has(f.id) });
  for (const c of content.cards) if (c.unlock > 0) items.push({ kind: 'card', id: c.id, name: c.name, cost: c.unlock, owned: has.has(c.id) });
  for (const p of content.perks) {
    const level = meta.perks[p.id] ?? 0;
    items.push({ kind: 'perk', id: p.id, name: p.name, cost: p.costs[level] ?? 0, owned: level >= p.costs.length, level, maxLevel: p.costs.length });
  }
  return items;
}

/** Spends Blueprints on an unlock or the next level of a perk. */
export function buy(content: GameContent, meta: Meta, id: string): Meta {
  const item = shop(content, meta).find((i) => i.id === id);
  if (!item) throw new MetaError(`Nothing called '${id}' is for sale`);
  if (item.owned) throw new MetaError(`${item.name} is already yours`);
  if (item.blocked) throw new MetaError(item.blocked);
  if (meta.blueprints < item.cost) throw new MetaError(`${item.name} costs ${item.cost} Blueprints; you have ${meta.blueprints}`);
  const next: Meta = { ...meta, blueprints: meta.blueprints - item.cost, perks: { ...meta.perks }, unlocked: [...meta.unlocked] };
  if (item.kind === 'perk') next.perks[id] = (next.perks[id] ?? 0) + 1;
  else next.unlocked.push(id);
  return next;
}

/** Sets the equipped perks; each must be owned, and at most `PERK_SLOTS`. */
export function equip(content: GameContent, meta: Meta, perks: readonly string[]): Meta {
  const unique = [...new Set(perks)];
  if (unique.length > ascensionRules(0).perkSlots) throw new MetaError(`At most ${ascensionRules(0).perkSlots} perks`);
  for (const p of unique) {
    if (!content.perks.some((x) => x.id === p)) throw new MetaError(`Unknown perk '${p}'`);
    if (!meta.perks[p]) throw new MetaError(`You do not own '${p}'`);
  }
  return { ...meta, equipped: unique };
}

/** Whether a scenario can be played, and if not, what unlocks it. */
export function scenarioOpen(scenario: ScenarioDef, meta: Meta, titleOf: (id: string) => string = (id) => id): { open: true } | { open: false; reason: string } {
  if (!scenario.unlock) return { open: true };
  const reached = meta.scenarios[scenario.unlock.scenario]?.reached ?? 0;
  if (reached >= scenario.unlock.wave) return { open: true };
  return { open: false, reason: `Reach wave ${scenario.unlock.wave} in ${titleOf(scenario.unlock.scenario)} to open it` };
}

/** The highest ascension a player may pick for a scenario: one above the highest cleared. */
export const maxAscension = (meta: Meta, scenario: string): number => Math.min(MAX_ASCENSION, (meta.scenarios[scenario]?.cleared ?? -1) + 1);

/** The loadout a run starts with: everything bought, and the equipped perks (trimmed to the ascension's slots). */
export function loadoutFor(meta: Meta, ascension: number): Loadout {
  const slots = ascensionRules(ascension).perkSlots;
  const perks: Record<string, number> = {};
  for (const id of meta.equipped.slice(0, slots)) if (meta.perks[id]) perks[id] = meta.perks[id];
  return { unlocked: [...meta.unlocked].sort(), perks };
}

/** Whether `loadout` is one `meta` allows (the Worker checks a ranked run's loadout with this). */
export function loadoutAllowed(meta: Meta, loadout: Loadout, ascension: number): string | undefined {
  const owned = new Set(meta.unlocked);
  for (const id of loadout.unlocked) if (!owned.has(id)) return `'${id}' is not unlocked`;
  const perks = Object.entries(loadout.perks);
  if (perks.length > ascensionRules(ascension).perkSlots) return 'Too many perks for this ascension';
  for (const [id, level] of perks) if (!meta.perks[id] || meta.perks[id] < level) return `Perk '${id}' at level ${level} is not owned`;
  return undefined;
}

export interface RunRecord {
  scenario: string;
  ascension: number;
  /** Waves survived. */
  reached: number;
  cleared: boolean;
  blueprints: number;
  seen: string[];
}

/** Banks a finished run: Blueprints, the furthest wave, the ascension cleared, the codex. */
export function recordRun(meta: Meta, run: RunRecord): Meta {
  const prev = meta.scenarios[run.scenario] ?? { reached: 0, cleared: -1 };
  return {
    ...meta,
    blueprints: meta.blueprints + Math.max(0, Math.floor(run.blueprints)),
    runs: meta.runs + 1,
    scenarios: {
      ...meta.scenarios,
      [run.scenario]: { reached: Math.max(prev.reached, run.reached), cleared: run.cleared ? Math.max(prev.cleared, run.ascension) : prev.cleared },
    },
    seen: [...new Set([...meta.seen, ...run.seen])],
  };
}

/** Whether this would be the player's first clear of the scenario (worth extra Blueprints). */
export const firstClear = (meta: Meta, scenario: string): boolean => (meta.scenarios[scenario]?.cleared ?? -1) < 0;

/** The daily run's scenario: the same for everyone on a UTC day, in turn, open to all whatever their progress. */
export function dailyScenario(content: GameContent, day: string): ScenarioDef {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const list = [...content.scenarios].sort((a, b) => a.order - b.order);
  return list[((n % list.length) + list.length) % list.length];
}

/** What the game badges and the skill map's game bonus need: the furthest wave, clears, top ascension, and lessons met per topic. */
export function gameStats(meta: Meta, content: Pick<GameContent, 'cards' | 'events'>): GameStats {
  const scenarios = Object.values(meta.scenarios);
  const topics = new Map<string, string>([...content.cards.map((c) => [c.id, c.topic] as const), ...content.events.map((e) => [e.id, e.topic] as const)]);
  const lessons: Record<string, number> = {};
  for (const id of meta.seen) {
    const topic = topics.get(id);
    if (topic) lessons[topic] = (lessons[topic] ?? 0) + 1;
  }
  return {
    reached: Math.max(0, ...scenarios.map((s) => s.reached)),
    clears: scenarios.filter((s) => s.cleared >= 0).length,
    ascension: Math.max(-1, ...scenarios.map((s) => s.cleared)),
    lessons,
  };
}
