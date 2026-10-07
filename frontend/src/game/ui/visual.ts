import {
  Archive,
  Cloud,
  Cog,
  Database,
  DoorOpen,
  Globe,
  Inbox,
  LayoutGrid,
  Maximize2,
  MoveHorizontal,
  Search,
  Server,
  Shield,
  Split,
  Users,
  Warehouse,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { NodeRole } from '../engine/board';
import type { Breach, WaveSummary } from '../engine/run';
import type { CardDef, EventDef, FeatureDef, GameMode, TicketKind, TicketSender } from '../engine/types';
import type { IconName } from '../engine/icons';

/** How the board and the panels show things: icons, heat colours, money and rates. */

export const ICON: Record<NodeRole, LucideIcon> = {
  users: Users,
  lb: Split,
  waf: Shield,
  cdn: Globe,
  gateway: DoorOpen,
  app: Server,
  worker: Cog,
  cache: Zap,
  db: Database,
  blob: Archive,
  search: Search,
  warehouse: Warehouse,
  queue: Inbox,
  external: Cloud,
};

export { heat } from '../../utils/heat';

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const rps = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${Math.round(n)}`);

/** The most costly mistakes of a run: the breaches that took the most Trust, one per kind and node. */
export function topMistakes(history: WaveSummary[], n = 3): { breach: Breach; trust: number; waves: number[] }[] {
  const by = new Map<string, { breach: Breach; trust: number; waves: Set<number> }>();
  for (const h of history) {
    for (const b of h.breaches) {
      const key = `${b.kind}:${b.node ?? b.useCase ?? ''}`;
      const e = by.get(key) ?? { breach: b, trust: 0, waves: new Set<number>() };
      e.trust += b.trust;
      e.waves.add(h.wave + 1);
      by.set(key, e);
    }
  }
  return [...by.values()]
    .sort((a, b) => b.trust - a.trust)
    .slice(0, n)
    .map((e) => ({ breach: e.breach, trust: e.trust, waves: [...e.waves] }));
}

const SHORT: Record<string, string> = {
  'Load Balancer': 'LB',
  'App Server': 'App',
  'SQL Database': 'SQL',
  'NoSQL Database': 'NoSQL',
  'Object Storage': 'Storage',
  'Firewall (WAF)': 'WAF',
  'API Gateway': 'Gateway',
  'Search Index': 'Search',
  'Data Warehouse': 'Warehouse',
};

/** A name that fits a phone's node: "LB", "SQL", or the first word of a provider ("Payment"). */
export const shortName = (name: string): string => SHORT[name] ?? name.split(' ')[0];

/** Tile colours: cards by rarity, events by category, perks in one colour. */
export const RARITY_TILE: Record<CardDef['rarity'], string> = {
  common: 'bg-paper text-ink',
  uncommon: 'bg-pop-blue/40 text-ink',
  rare: 'bg-pop-lilac text-on-accent',
  legendary: 'bg-pop-yellow text-on-accent',
};
export const CATEGORY_TILE: Record<EventDef['category'], string> = {
  incident: 'bg-fail/15 text-fail',
  spike: 'bg-pop-pink/30 text-ink',
};
export const PERK_TILE = 'bg-pop-blue/20 text-ink';
export const COMPONENT_TILE = 'bg-pop-yellow/30 text-ink';
export const FEATURE_TILE = 'bg-pop-lilac/25 text-ink';
export const MUTATOR_TILE = 'bg-pop-pink/30 text-ink';
export const BOUNTY_TILE = 'bg-pop-yellow/40 text-ink';

/** Each shop feature's icon: a bigger box, more partitions, a longer lane. */
export const FEATURE_ICON: Record<FeatureDef['id'], LucideIcon> = {
  tiers: Maximize2,
  shards: LayoutGrid,
  'wide-lanes': MoveHorizontal,
};

/** Each ticket kind's icon, so an inbox reads at a glance. */
export const TICKET_ICON: Record<TicketKind, IconName> = {
  feature: 'lightbulb',
  scale: 'maximize-2',
  compliance: 'scale',
  mobile: 'smartphone',
  region: 'earth',
  'api-version': 'git-branch',
  schema: 'database-backup',
  'data-move': 'arrow-right-left',
  deprecation: 'archive',
  security: 'shield-check',
  cost: 'receipt',
  incident: 'siren',
  reliability: 'life-buoy',
  analytics: 'bar-chart-3',
  performance: 'zap',
};

export const SENDER_LABEL: Record<TicketSender, string> = {
  pm: 'Product',
  cto: 'CTO',
  customer: 'Customer',
  legal: 'Legal',
  finance: 'Finance',
  sre: 'SRE',
  marketing: 'Marketing',
};

export const MODE_ICON: Record<GameMode, IconName> = { scale: 'activity', startup: 'rocket', incident: 'siren', legacy: 'building-2', cost: 'scissors' };
export const MODE_LABEL: Record<GameMode, string> = { scale: 'Scale or Fail', startup: 'Chaotic Startup', incident: 'On-call', legacy: 'Legacy rescue', cost: 'Cost crunch' };
/** What each mode asks of the player, in one line (the Arcade's design challenges). */
export const MODE_BLURB: Record<GameMode, string> = {
  scale: 'Keep the system up while traffic grows, wave after wave.',
  startup: 'The product changes under you: version the API and migrate the schema one step a wave.',
  incident: 'Every wave is a page: name the root cause, then fix it on the board.',
  legacy: 'Strangle a monolith one use case at a time without breaking its clients.',
  cost: 'Cut the cloud bill every wave without missing an SLO.',
};
