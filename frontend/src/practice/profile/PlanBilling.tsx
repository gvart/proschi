import { useEffect, useState, type ReactNode } from 'react';
import { CreditCard, Sparkles } from 'lucide-react';
import { outlineButton, primaryButton } from '../../components/Playground/ui';
import { fetchTransport } from '../../playground/cloudSync';
import { usePlan } from '../../pricing/usePlan';
import { billingEnabled, checkout, openPortal, PLAN_CHANGED, PRICES, pricingHref, type PlanInfo } from '../../services/billing';
import { Section } from './settingsUi';

/**
 * "Plan & billing" on the settings page (`#/me`): a summary of the plan
 * (its badge, the subscription's renewal or end), the AI interviews left
 * and the diagrams kept against the plan's limit, each with a small meter,
 * and the ways to upgrade, buy a pack or open Polar's billing portal.
 * Hidden without VITE_BILLING. Back from a checkout, CheckoutStatus shows
 * at the top of the page (AccountRoute.tsx).
 */

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

/** How many diagrams the account keeps now (GET /api/me/documents, asking for no changes), again on PLAN_CHANGED; undefined until known or when it fails. */
function useDiagramsUsed(): number | undefined {
  const [used, setUsed] = useState<number>();
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(PLAN_CHANGED, again);
    return () => window.removeEventListener(PLAN_CHANGED, again);
  }, []);
  useEffect(() => {
    if (!billingEnabled) return;
    let cancelled = false;
    fetchTransport.list(Date.now()).then(
      (answer) => !cancelled && typeof answer.used === 'number' && setUsed(answer.used),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [asked]);
  return used;
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="mt-2 h-2 overflow-hidden rounded-full border-bw-1 border-ink bg-paper">
      <div className="h-full bg-ink" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/** One figure of the summary: a label, the number, a line and a meter. */
function Figure({ label, value, unit, children }: { label: string; value: number | string; unit?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 font-sans text-sm font-normal text-muted">{unit}</span>}
      </p>
      {children}
    </div>
  );
}

/** Where the interviews left come from: "3 of 4 this month, 1 free one." */
function creditsText(plan: PlanInfo): string {
  const text = creditParts(plan).join(', ');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : 'None left.';
}

export default function PlanBilling() {
  const { plan, error } = usePlan(billingEnabled);
  const used = useDiagramsUsed();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
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

  return (
    <Section id="plan" title="Plan & billing" description="Your plan, what is left of it this month, and your invoices.">
      {!plan ? (
        <p className="p-4 text-sm text-muted">{error ? `Could not load your plan: ${error}` : 'Loading your plan…'}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
              <span className={`rounded-sm border-bw-1 border-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${pro ? 'bg-pop-yellow text-on-accent' : 'bg-paper'}`}>
                {pro ? 'Pro' : 'Free'}
              </span>
              {renewalText(plan) ?? `Pro adds unlimited diagrams and ${PRICES.proInterviews} mock interviews a month.`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {!pro && (
                <a href={pricingHref('../')} className={primaryButton}>
                  <Sparkles size={14} aria-hidden="true" />
                  Upgrade to Pro
                </a>
              )}
              {plan.billing && (
                <button type="button" className={outlineButton} disabled={busy} onClick={() => go(() => checkout('pack_5'))}>
                  <CreditCard size={14} aria-hidden="true" />
                  Buy {PRICES.packInterviews} mock interviews, €{PRICES.pack}
                </button>
              )}
              {plan.billing && plan.customer && (
                <button type="button" className={outlineButton} disabled={busy} onClick={() => go(openPortal)}>
                  <CreditCard size={14} aria-hidden="true" />
                  Manage billing and invoices
                </button>
              )}
            </div>
          </div>
          {failed && (
            <p role="alert" className="px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {failed}
            </p>
          )}
          <div className="grid divide-y divide-ink/15 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <Figure label="Mock interviews left" value={plan.credits.total}>
              <Meter label="Mock interviews left" value={plan.credits.total} max={Math.max(plan.credits.total, plan.limits.interviewsPerMonth + plan.credits.trial + plan.credits.pack)} />
              <p className="mt-2 text-xs text-muted" data-testid="credits">
                {creditsText(plan)}
              </p>
            </Figure>
            <Figure
              label="Diagrams in your account"
              value={used ?? '–'}
              unit={plan.limits.documents === null ? 'kept, no limit' : `of ${plan.limits.documents}`}
            >
              {plan.limits.documents !== null && <Meter label="Diagrams in your account" value={used ?? 0} max={plan.limits.documents} />}
              <p className="mt-2 text-xs text-muted">
                {plan.limits.versionsPerDocument === null ? 'Unlimited versions of each.' : `Up to ${plan.limits.versionsPerDocument} versions of each.`}
              </p>
            </Figure>
          </div>
          <p className="px-4 py-3 text-xs text-muted">
            Payments are handled by Polar, our merchant of record. Canceling keeps Pro to the end of the paid period, and every diagram.
          </p>
        </>
      )}
    </Section>
  );
}
