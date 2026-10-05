import {
  Activity,
  Archive,
  ArrowRightLeft,
  BellRing,
  BookOpen,
  Bot,
  Building2,
  Cable,
  CalendarClock,
  ChartColumn,
  ChevronsUp,
  CloudOff,
  Coins,
  Copy,
  DatabaseBackup,
  DatabaseZap,
  Dices,
  Earth,
  FileArchive,
  FilePenLine,
  Flame,
  FlaskConical,
  Gauge,
  GitBranch,
  GraduationCap,
  Handshake,
  HardDriveUpload,
  Heart,
  Hourglass,
  Landmark,
  Layers,
  LifeBuoy,
  Lightbulb,
  ListOrdered,
  MailWarning,
  Maximize2,
  Megaphone,
  Merge,
  Package,
  PiggyBank,
  Receipt,
  RefreshCcw,
  Rocket,
  Route,
  Ruler,
  Scale,
  Scissors,
  ServerCrash,
  ShieldCheck,
  Siren,
  Smartphone,
  Snowflake,
  Tag,
  Timer,
  TrendingUp,
  Unplug,
  Upload,
  UserPlus,
  Volume2,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { IconName } from '../engine/icons';

/**
 * The lucide component behind every name in engine/icons.ts. Named imports
 * keep the bundle to these icons. `file-signature` and `bar-chart-3` are
 * lucide's old names for FilePenLine and ChartColumn.
 */
// The map is the point of this module, next to the component that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export const GAME_ICON: Record<IconName, LucideIcon> = {
  'piggy-bank': PiggyBank,
  heart: Heart,
  dices: Dices,
  'graduation-cap': GraduationCap,
  'flask-conical': FlaskConical,
  'bell-ring': BellRing,
  workflow: Workflow,
  'chevrons-up': ChevronsUp,
  handshake: Handshake,
  landmark: Landmark,
  'file-signature': FilePenLine,
  unplug: Unplug,
  cable: Cable,
  'list-ordered': ListOrdered,
  route: Route,
  'refresh-ccw': RefreshCcw,
  'file-archive': FileArchive,
  'user-plus': UserPlus,
  copy: Copy,
  gauge: Gauge,
  upload: Upload,
  merge: Merge,
  'calendar-clock': CalendarClock,
  ruler: Ruler,
  'book-open': BookOpen,
  tag: Tag,
  layers: Layers,
  coins: Coins,
  timer: Timer,
  package: Package,
  'cloud-off': CloudOff,
  'server-crash': ServerCrash,
  snowflake: Snowflake,
  'database-zap': DatabaseZap,
  bot: Bot,
  flame: Flame,
  rocket: Rocket,
  'volume-2': Volume2,
  megaphone: Megaphone,
  'mail-warning': MailWarning,
  hourglass: Hourglass,
  'trending-up': TrendingUp,
  'hard-drive-upload': HardDriveUpload,
  lightbulb: Lightbulb,
  'maximize-2': Maximize2,
  scale: Scale,
  smartphone: Smartphone,
  earth: Earth,
  'git-branch': GitBranch,
  'database-backup': DatabaseBackup,
  'arrow-right-left': ArrowRightLeft,
  archive: Archive,
  'shield-check': ShieldCheck,
  receipt: Receipt,
  siren: Siren,
  'life-buoy': LifeBuoy,
  'bar-chart-3': ChartColumn,
  zap: Zap,
  activity: Activity,
  'building-2': Building2,
  scissors: Scissors,
};

/** A content item's icon, decorative: the item's name is always next to it. */
export function GameIcon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Icon = GAME_ICON[name];
  return Icon ? <Icon size={size} aria-hidden="true" className={className} /> : null;
}

const TILE_SIZE = { sm: 'h-5 w-5', md: 'h-7 w-7', lg: 'h-9 w-9' } as const;
const ICON_SIZE = { sm: 12, md: 16, lg: 20 } as const;

/** An icon in a small bordered tile, the look of the board's nodes. */
export function IconTile({ name, tone, size = 'md', className = '' }: { name: IconName; tone: string; size?: keyof typeof TILE_SIZE; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex flex-shrink-0 items-center justify-center rounded border-bw-1 border-ink ${TILE_SIZE[size]} ${tone} ${className}`}>
      <GameIcon name={name} size={ICON_SIZE[size]} />
    </span>
  );
}
