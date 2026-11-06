import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { billingEnabled, pricingHref } from '../services/billing';

/** The look of an upgrade link in running text. */
export const UPGRADE_LINK = 'inline-flex items-start gap-1 font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink';

interface UpgradeHintProps {
  /** The link's text; "Upgrade to Pro" by default. */
  children?: ReactNode;
  /** The page's way to the site root, for the link to the pricing page. */
  base?: string;
  className?: string;
  /** The small sparkle before the text. */
  icon?: boolean;
  testId?: string;
}

/**
 * The way to Pro: a link to the pricing page, the one every upgrade hint uses
 * (<Feature> shows it in its `free` branch). Nothing without paid plans
 * (VITE_BILLING, services/billing.ts billingEnabled).
 */
export default function UpgradeHint({ children = 'Upgrade to Pro', base = '../', className = UPGRADE_LINK, icon = true, testId }: UpgradeHintProps) {
  if (!billingEnabled) return null;
  return (
    <a href={pricingHref(base)} data-testid={testId} className={className}>
      {icon && <Sparkles size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
      {children}
    </a>
  );
}
