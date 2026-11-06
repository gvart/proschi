import { Sparkles } from 'lucide-react';
import { billingEnabled, pricingHref } from '../../services/billing';
import { cloudFull, type CloudState } from './useCloudSync';

/**
 * Where the account is full (409 document_limit), the way to Pro's unlimited
 * diagrams: a link to the pricing page. Nothing without VITE_BILLING, or
 * while the account has room.
 */
export default function UpgradeHint({ state, className = '' }: { state: CloudState; className?: string }) {
  if (!billingEnabled || !cloudFull(state)) return null;
  return (
    <a
      href={pricingHref('../')}
      data-testid="upgrade-hint"
      className={`inline-flex items-start gap-1 font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink ${className}`}
    >
      <Sparkles size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      Upgrade to Pro for unlimited diagrams
    </a>
  );
}
