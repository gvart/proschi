import { Award, Brain, Calculator, Check, Coins, Database, Flame, Layers, Map as MapIcon, Radio, Shield, Star, Target, Trophy, Zap, type LucideIcon } from 'lucide-react';
import type { Icon, Tier } from '../../learn/achievements';

/** The lucide icon for each icon name achievements.json may use (ICONS in src/learn/achievements.ts). */
const ICON: Record<Icon, LucideIcon> = {
  layers: Layers,
  brain: Brain,
  flame: Flame,
  trophy: Trophy,
  check: Check,
  zap: Zap,
  coins: Coins,
  calculator: Calculator,
  target: Target,
  map: MapIcon,
  database: Database,
  radio: Radio,
  shield: Shield,
  star: Star,
};

/** The medal colour of each tier; a badge without a tier is lilac. Filled, with dark ink, so they read in both themes. */
const TIER_FILL: Record<Tier | 'none', string> = {
  bronze: 'bg-[#e3a46f]',
  silver: 'bg-[#cfd4dc]',
  gold: 'bg-pop-yellow',
  none: 'bg-pop-lilac',
};

/** A badge's round medal: in its tier's colour once earned, grey while locked. */
export default function AchievementIcon({ icon, tier, earned, size = 'md' }: { icon: Icon; tier?: Tier; earned: boolean; size?: 'md' | 'lg' }) {
  const Glyph = ICON[icon] ?? Award;
  const box = size === 'lg' ? 'h-14 w-14' : 'h-11 w-11';
  return (
    <span
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center rounded-full border-bw-2 ${box} ${
        earned ? `border-ink text-on-accent shadow-brutal-sm ${TIER_FILL[tier ?? 'none']}` : 'border-dashed border-ink/35 bg-paper text-ink/40'
      }`}
    >
      <Glyph size={size === 'lg' ? 26 : 20} strokeWidth={2.25} />
    </span>
  );
}
