import {
  Archive,
  Cloud,
  Cog,
  Database,
  DoorOpen,
  Globe,
  Inbox,
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

/** Fill for a utilisation: calm paper, then yellow, pink, red. */
export function heat(u: number | undefined, down = false): string {
  if (down) return 'rgb(var(--c-muted) / 0.35)';
  if (u === undefined || u < 0.4) return 'rgb(var(--c-surface))';
  if (u < 0.7) return 'rgb(var(--c-yellow) / 0.45)';
  if (u < 0.9) return 'rgb(var(--c-yellow))';
  if (u < 1) return 'rgb(var(--c-pink))';
  return 'rgb(var(--c-fail))';
}


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
