import { kindOf } from '../../../frontend/src/dsl/kinds';
import type { DiagramNode, Kind } from '../../../frontend/src/dsl/types';
import { ICON_NAMES } from './techIcons.gen';

/**
 * A card's icon in one cell: the canvas's icon (techIcons.gen.ts, from
 * iconMapping.tsx) as its Nerd Font glyph, or, for terminals without a Nerd
 * Font, a plain symbol for the node's kind. Every glyph is in the Basic
 * Multilingual Plane (Devicons, Codicons, Font Awesome, Octicons), as a
 * terminal cell takes nothing wider.
 */

export type IconStyle = 'nerd-font' | 'symbols' | 'none';

/** Nerd Font code points by the canvas icon's component name (Lucide or react-icons). */
const NERD: Record<string, number> = {
  // Lucide
  Bell: 0xeaa2,
  Box: 0xf1b2,
  ChartColumn: 0xf080,
  Circle: 0xeabc,
  Cloud: 0xebaa,
  Container: 0xf4b7,
  Cpu: 0xf4bc,
  Database: 0xf1c0,
  Diamond: 0xf4bf,
  DoorOpen: 0xedf5,
  ExternalLink: 0xf08e,
  FileText: 0xf15c,
  FolderOpen: 0xf07c,
  Globe: 0xf0ac,
  HardDrive: 0xf0a0,
  KeyRound: 0xf084,
  Layers: 0xebd2,
  Mail: 0xeb1c,
  MessageSquare: 0xf27a,
  Monitor: 0xf108,
  Network: 0xef09,
  RadioTower: 0xeb34,
  Search: 0xea6d,
  Server: 0xf233,
  Shield: 0xf132,
  Shuffle: 0xf074,
  Smartphone: 0xed08,
  Square: 0xea72,
  StickyNote: 0xf249,
  User: 0xf007,
  Zap: 0xf0e7,
  // Brands
  GrOracle: 0xe859,
  SiAlgolia: 0xe70a,
  SiApachecassandra: 0xe789,
  SiApachekafka: 0xe72e,
  SiApachepulsar: 0xe872,
  SiClickhouse: 0xe8fe,
  SiCloudflare: 0xe792,
  SiCloudflareworkers: 0xe793,
  SiCouchbase: 0xe7a0,
  SiDjango: 0xe71d,
  SiDocker: 0xe7b0,
  SiDotnet: 0xe77f,
  SiElasticsearch: 0xe7ca,
  SiElixir: 0xe7cd,
  SiEnvoyproxy: 0xe7d1,
  SiFastapi: 0xe7d5,
  SiFirebase: 0xe787,
  SiFlask: 0xe7dc,
  SiGo: 0xe724,
  SiGooglecloud: 0xe7f1,
  SiGraphql: 0xe7f4,
  SiInfluxdb: 0xe800,
  SiKotlin: 0xe81b,
  SiKubernetes: 0xe81d,
  SiMariadb: 0xe828,
  SiMongodb: 0xe7a4,
  SiMysql: 0xe704,
  SiNatsdotio: 0xe8f0,
  SiNeo4J: 0xe839,
  SiNginx: 0xe776,
  SiNodedotjs: 0xe719,
  SiOkta: 0xe850,
  SiOpenjdk: 0xe738,
  SiPaypal: 0xf1ed,
  SiPhp: 0xe73d,
  SiPostgresql: 0xe76e,
  SiPrometheus: 0xe870,
  SiPython: 0xe73c,
  SiRabbitmq: 0xe882,
  SiRedis: 0xe76d,
  SiRubyonrails: 0xe73b,
  SiRust: 0xe7a8,
  SiSnowflake: 0xf2dc,
  SiSpringboot: 0xe8ac,
  SiSqlite: 0xe7c4,
  SiStripe: 0xed53,
  SiTraefikproxy: 0xe8c7,
  TbBrandOpenai: 0xec81,
  TbBrandTwilio: 0xe94e,
};

/** Without a Nerd Font: one symbol per kind, each a single cell wide everywhere. */
const SYMBOL: Record<Kind, string> = {
  client: '◯',
  edge: '◇',
  cdn: '◍',
  loadbalancer: '⇄',
  gateway: '⊐',
  dns: '⋔',
  service: '▣',
  function: '↯',
  cache: '≡',
  database: '◉',
  search: '⌕',
  analytics: '▥',
  storage: '▭',
  queue: '≋',
  broker: '◎',
  external: '↗',
  other: '▢',
};

export function iconOf(node: DiagramNode, style: IconStyle): string | undefined {
  if (style === 'none' || node.kind !== 'component') return undefined;
  if (style === 'symbols') return SYMBOL[kindOf(node)];
  const own = ICON_NAMES.tech[node.techStack];
  // A brand without a glyph of its own falls back to its component type's icon, as the canvas does for a tech without one.
  const name = own && NERD[own] ? own : (ICON_NAMES.type[node.type] ?? 'Server');
  return String.fromCodePoint(NERD[name] ?? NERD.Server);
}
