import { legacyVersions } from './legacy';
import { migrations } from './migrations';
import type { ModeRules } from './mode';

/**
 * Startup (Pawprint): design first, then the product changes under you, one
 * ticket a wave. Schema changes are migrations (migrations.ts) and the old
 * API version stays up until its clients have moved (legacy.ts).
 */
export const startup: ModeRules = {
  id: 'startup',
  draft: false,
  twists: false,
  leanRefund: false,
  mechanics: [legacyVersions, migrations],
};
