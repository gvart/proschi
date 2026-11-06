import UpgradeHint, { UPGRADE_LINK } from '../UpgradeHint';
import { cloudFull, type CloudState } from './useCloudSync';

/**
 * Where the account is full (409 document_limit), the way to Pro's unlimited
 * diagrams: the upgrade hint (components/UpgradeHint.tsx). Nothing without
 * VITE_BILLING, or while the account has room.
 */
export default function CloudUpgradeHint({ state, className = '' }: { state: CloudState; className?: string }) {
  if (!cloudFull(state)) return null;
  return (
    <UpgradeHint testId="upgrade-hint" className={`${UPGRADE_LINK} ${className}`}>
      Upgrade to Pro for unlimited diagrams
    </UpgradeHint>
  );
}
