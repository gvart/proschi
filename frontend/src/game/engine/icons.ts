/**
 * The icons game content may use: kebab-case lucide names. No React here, so
 * the `proschi game` CLI can check content against the list; the Arcade page
 * maps each name to its component in ui/gameIcons.tsx.
 */
export const GAME_ICONS = [
  // Perks.
  'piggy-bank',
  'heart',
  'dices',
  'graduation-cap',
  'flask-conical',
  'bell-ring',
  // Cards.
  'workflow',
  'chevrons-up',
  'handshake',
  'landmark',
  'file-signature',
  'unplug',
  'cable',
  'list-ordered',
  'route',
  'refresh-ccw',
  'file-archive',
  'user-plus',
  'copy',
  'gauge',
  'upload',
  'merge',
  'calendar-clock',
  'ruler',
  'book-open',
  'tag',
  'layers',
  'coins',
  'timer',
  'package',
  // Events.
  'cloud-off',
  'server-crash',
  'snowflake',
  'database-zap',
  'bot',
  'flame',
  'rocket',
  'volume-2',
  'megaphone',
  'mail-warning',
  'hourglass',
  'trending-up',
  'hard-drive-upload',
  // Ticket kinds and modes.
  'lightbulb',
  'maximize-2',
  'scale',
  'smartphone',
  'earth',
  'git-branch',
  'database-backup',
  'arrow-right-left',
  'archive',
  'shield-check',
  'receipt',
  'siren',
  'life-buoy',
  'bar-chart-3',
  'zap',
  'activity',
  'building-2',
  'scissors',
] as const;

export type IconName = (typeof GAME_ICONS)[number];

export const isIconName = (name: string): name is IconName => (GAME_ICONS as readonly string[]).includes(name);
