import type { BoardNode, CardDef, ComponentDef, PerkDef, Stat } from './types';

/**
 * What the held cards and equipped perks add up to. Cards change numbers
 * (capacity, latency, cost as multipliers) or rules (autoscaling, request
 * coalescing); perks change the start of a run and the per-wave allowances.
 */
export interface Mods {
  capacity: { target?: string; stat: Stat; mult: number }[];
  latency: { target?: string; mult: number }[];
  cost: { target?: string; mult: number }[];
  /** Added to every cache hit ratio (0..1). */
  cacheHit: number;
  edgeHit: number;
  /** What a failed call costs, in ms, when a card lowers it. */
  timeoutMs?: number;
  coalesce: boolean;
  autoscale: boolean;
  interestCap: number;
  /** Extra on-call actions per wave. */
  oncall: number;
  /** Free load tests per wave. */
  loadtests: number;
  /** Share of background messages that write (write batching). */
  writeShare: number;
  payload: number;
  /** Multiplier on the hot-key penalty. */
  hotKey: number;
  failover: boolean;
  reserved: boolean;
  spot: boolean;
  streakStep: number;
  freeReroll: boolean;
  /** Users upload straight to object storage with a signed URL. */
  presigned: boolean;
}

export function computeMods(cards: readonly CardDef[], perks: readonly { def: PerkDef; level: number }[], base: { streakStep: number; interestCap: number }): Mods {
  const m: Mods = {
    capacity: [],
    latency: [],
    cost: [],
    cacheHit: 0,
    edgeHit: 0,
    coalesce: false,
    autoscale: false,
    interestCap: base.interestCap,
    oncall: 0,
    loadtests: 0,
    writeShare: 1,
    payload: 1,
    hotKey: 1,
    failover: false,
    reserved: false,
    spot: false,
    streakStep: base.streakStep,
    freeReroll: false,
    presigned: false,
  };
  for (const c of cards) {
    switch (c.effect) {
      case 'capacity':
        m.capacity.push({ target: c.target, stat: c.stat ?? 'rps', mult: c.value });
        break;
      case 'latency':
        m.latency.push({ target: c.target, mult: c.value });
        break;
      case 'cost':
        m.cost.push({ target: c.target, mult: c.value });
        break;
      case 'cache-hit':
        m.cacheHit += c.value;
        break;
      case 'edge-hit':
        m.edgeHit += c.value;
        break;
      case 'timeout':
        m.timeoutMs = Math.min(m.timeoutMs ?? Infinity, c.value);
        break;
      case 'coalesce':
        m.coalesce = true;
        break;
      case 'autoscale':
        m.autoscale = true;
        break;
      case 'interest':
        m.interestCap += c.value;
        break;
      case 'oncall':
        m.oncall += c.value;
        break;
      case 'loadtest':
        m.loadtests += c.value;
        break;
      case 'write-batching':
        m.writeShare = Math.min(m.writeShare, c.value);
        break;
      case 'payload':
        m.payload *= c.value;
        break;
      case 'hot-key':
        m.hotKey *= c.value;
        break;
      case 'failover':
        m.failover = true;
        break;
      case 'reserved':
        m.reserved = true;
        m.cost.push({ target: c.target ?? 'app', mult: c.value });
        break;
      case 'spot':
        m.spot = true;
        m.cost.push({ target: c.target ?? 'worker', mult: c.value });
        break;
      case 'streak':
        m.streakStep += c.value;
        break;
      case 'presigned':
        m.presigned = true;
        break;
      case 'trust':
      case 'cash':
        break; // paid once, when picked
    }
  }
  for (const { def, level } of perks) {
    if (def.effect === 'loadtest') m.loadtests += def.value * level;
    else if (def.effect === 'oncall') m.oncall += def.value * level;
    else if (def.effect === 'free-reroll') m.freeReroll = true;
  }
  return m;
}

/** Whether a card's or event's `target` (a component id, a role, or `any`/absent) selects the node. */
export function targets(target: string | undefined, node: BoardNode, component: ComponentDef | undefined): boolean {
  if (!target || target === 'any') return true;
  return node.component === target || component?.role === target || node.id === target;
}
