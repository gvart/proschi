import { useEffect, useState } from 'react';
import { CreditCard, Sparkles } from 'lucide-react';
import { outlineButton, primaryButton } from '../../components/Playground/ui';
import { usePlan } from '../../pricing/usePlan';
import { billingEnabled, checkout, openPortal, PRICES, pricingHref, type PlanInfo } from '../../services/billing';

/**
 * "Plan & billing" on the account page (`#/me`): the plan, the
 * subscription's renewal or end, the AI interviews left, and the ways to
 * upgrade, buy a pack or open Polar's billing portal. Hidden without
 * VITE_BILLING. Back from a checkout (`?checkout=done`), it thanks and asks
 * again for a few seconds, while Polar's webhook arrives.
 */

const card = 'mt-8 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md';

function takeCheckoutDone(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get('checkout') !== 'done') return false;
  url.searchParams.delete('checkout');
  window.history.replaceState(window.history.state, '', url.toString());
  return true;
}

const dateOf = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function renewalText(plan: PlanInfo): string | undefined {
  const sub = plan.subscription;
  if (!sub || plan.plan !== 'pro') return undefined;
  const cadence = sub.product === 'pro_yearly' ? 'yearly' : 'monthly';
  if (sub.status === 'past_due') return `Pro ${cadence}: the last payment failed; Polar is retrying it. Update your card in the billing portal.`;
  if (!sub.currentPeriodEnd) return `Pro ${cadence}.`;
  return sub.cancelAtPeriodEnd ? `Pro ${cadence}, canceled: it ends on ${dateOf(sub.currentPeriodEnd)}.` : `Pro ${cadence}, renews on ${dateOf(sub.currentPeriodEnd)}.`;
}

function creditParts({ credits, limits }: PlanInfo): string[] {
  return [
    limits.interviewsPerMonth > 0 ? `${credits.monthly} of ${limits.interviewsPerMonth} this month` : '',
    credits.trial > 0 ? `${credits.trial} free one` : '',
    credits.pack > 0 ? `${credits.pack} from packs` : '',
  ].filter(Boolean);
}

export default function PlanBilling() {
  const [thanks] = useState(takeCheckoutDone);
  const { plan, error, reload } = usePlan(billingEnabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!thanks) return;
    const timers = [2000, 5000, 10000].map((ms) => window.setTimeout(reload, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [thanks, reload]);
  if (!billingEnabled) return null;

  const go = (run: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    run().catch((e: unknown) => {
      setBusy(false);
      setFailed(e instanceof Error ? e.message : String(e));
    });
  };
  const pro = plan?.plan === 'pro';
  const credits = plan?.credits;

  return (
    <section aria-labelledby="plan-billing" className={card}>
      <h2 id="plan-billing" className="font-display text-xl font-bold text-ink">
        Plan &amp; billing
      </h2>
      {thanks && (
        <p role="status" className="mt-2 rounded-sm border-bw-1 border-ink bg-pop-yellow/30 px-3 py-2 text-sm text-ink">
          Thank you! Your purchase shows here as soon as Polar confirms it, usually within seconds.
        </p>
      )}
      {!plan ? (
        <p className="mt-2 text-sm text-muted">{error ? `Could not load your plan: ${error}` : 'Loading your plan…'}</p>
      ) : (
        <>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
            <span className={`rounded-sm border-bw-1 border-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${pro ? 'bg-pop-yellow text-on-accent' : 'bg-paper'}`}>
              {pro ? 'Pro' : 'Free'}
            </span>
            {renewalText(plan) ??
              `${plan.limits.documents ?? 'Unlimited'} diagrams in your account, ${plan.limits.versionsPerDocument ?? 'unlimited'} versions each.`}
          </p>
          {credits && (
            <p className="mt-2 text-sm text-ink/80" data-testid="credits">
              AI interviews left: <strong className="text-ink">{credits.total}</strong>
              {creditParts(plan).length ? ` (${creditParts(plan).join(', ')})` : ''}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!pro && (
              <a href={pricingHref('../')} className={primaryButton}>
                <Sparkles size={14} aria-hidden="true" />
                Upgrade to Pro
              </a>
            )}
            {plan.billing && (
              <button type="button" className={outlineButton} disabled={busy} onClick={() => go(() => checkout('pack_5'))}>
                <CreditCard size={14} aria-hidden="true" />
                Buy {PRICES.packInterviews} interviews, €{PRICES.pack}
              </button>
            )}
            {plan.billing && plan.customer && (
              <button type="button" className={outlineButton} disabled={busy} onClick={() => go(openPortal)}>
                <CreditCard size={14} aria-hidden="true" />
                Manage billing and invoices
              </button>
            )}
          </div>
          {failed && (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
              {failed}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Payments are handled by Polar, our merchant of record. Canceling keeps Pro to the end of the paid period, and every diagram.
          </p>
        </>
      )}
    </section>
  );
}
