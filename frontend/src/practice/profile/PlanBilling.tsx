import { useEffect, useState, type ReactNode } from 'react';
import { CreditCard, Sparkles, Zap } from 'lucide-react';
import { outlineButton, primaryButton } from '../../components/Playground/ui';
import { fetchTransport } from '../../playground/cloudSync';
import { formatCount, interviewsText, partnerText, planValue } from '../../pricing/planValue';
import { usePlan } from '../../pricing/usePlan';
import { billingEnabled, buyPlan, checkout, openPortal, PLAN_CHANGED, PLAN_CREDITS, PRICES, pricingHref, productPlan, type PlanInfo, type Product } from '../../services/billing';
import { formatCredits, formatRange, getUsage, TYPICAL_COSTS, USAGE_LABEL, type UsageItem } from '../../services/credits';
import { Section } from './settingsUi';

/**
 * "Plan & billing" on the settings page (`#/me`): the plan (its badge, the
 * subscription's renewal or end), the credits left (this month's with a
 * meter and the reset date, the sign-up and top-up ones), the diagrams kept
 * against the plan's limit, the ways to upgrade, top up or open Polar's
 * billing portal, and the latest charges (GET /api/credits/usage). Hidden
 * without VITE_BILLING. Back from a checkout, CheckoutStatus shows at the
 * top of the page (AccountRoute.tsx).
 */

const dateOf = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayOf = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const whenOf = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const PLAN_NAME: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max' };
const BADGE: Record<string, string> = { free: 'bg-paper', pro: 'bg-pop-yellow text-on-accent', max: 'bg-pop-lilac text-on-accent' };

function renewalText(plan: PlanInfo): string | undefined {
  const sub = plan.subscription;
  const name = PLAN_NAME[plan.plan];
  if (!sub || plan.plan === 'free' || !name) return undefined;
  const cadence = productPlan(sub.product)?.period ?? 'monthly';
  if (sub.status === 'past_due') return `${name} ${cadence}: the last payment failed; Polar is retrying it. Update your card in the billing portal.`;
  if (!sub.currentPeriodEnd) return `${name} ${cadence}.`;
  return sub.cancelAtPeriodEnd ? `${name} ${cadence}, canceled: it ends on ${dateOf(sub.currentPeriodEnd)}.` : `${name} ${cadence}, renews on ${dateOf(sub.currentPeriodEnd)}.`;
}

/** How many diagrams the account keeps now (GET /api/me/documents, asking for no changes), again on PLAN_CHANGED; undefined until known or when it fails. */
function useDiagramsUsed(): number | undefined {
  const [used, setUsed] = useState<number>();
  const asked = useAskAgain();
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

/** A count that goes up on PLAN_CHANGED, so a reader asks the API again. */
function useAskAgain(): number {
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(PLAN_CHANGED, again);
    return () => window.removeEventListener(PLAN_CHANGED, again);
  }, []);
  return asked;
}

/** The latest charges; undefined while loading, null when they could not be read. */
function useUsage(): UsageItem[] | null | undefined {
  const [items, setItems] = useState<UsageItem[] | null>();
  const asked = useAskAgain();
  useEffect(() => {
    if (!billingEnabled) return;
    let cancelled = false;
    getUsage(50).then(
      ({ items }) => !cancelled && setItems(items),
      () => !cancelled && setItems(null),
    );
    return () => {
      cancelled = true;
    };
  }, [asked]);
  return items;
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

/** What the credits left are worth: mock interviews first, then Design partner (pricing/planValue.ts); nothing when they don't cover an interview. */
function Worth({ credits }: { credits: number }) {
  if (planValue(credits).interviews.hi < 1) return null;
  return (
    <p data-testid="credits-worth" className="mt-2 text-xs text-ink/80">
      Enough for {interviewsText(credits)}, or {partnerText(credits)} with Design partner.
    </p>
  );
}

/** Where the credits left come from: this month's, the sign-up ones, the top-ups. */
function Breakdown({ plan }: { plan: PlanInfo }) {
  const { monthly, signup, topup } = plan.credits;
  const rows: [string, string, string?][] = [];
  if (monthly) rows.push(['This month', `${formatCredits(monthly.left, { floor: true })} of ${formatCredits(monthly.allowance)}`, `resets on ${dayOf(monthly.resetsAt)}`]);
  if (signup > 0 || !monthly) rows.push(['Sign-up', formatCredits(signup, { floor: true }), `of ${PLAN_CREDITS.free}, never expire`]);
  if (topup > 0) rows.push(['Top-ups', formatCredits(topup, { floor: true }), 'never expire']);
  return (
    <dl data-testid="credits" className="mt-3 space-y-1 text-xs">
      {rows.map(([label, value, note]) => (
        <div key={label} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="w-20 shrink-0 text-muted">{label}</dt>
          <dd className="font-semibold tabular-nums text-ink">{value}</dd>
          {note && <dd className="text-muted">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Usage({ items }: { items: UsageItem[] | null | undefined }) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-ink">Recent use</h3>
      {items === undefined ? (
        <p className="mt-1 text-sm text-muted">Loading…</p>
      ) : items === null ? (
        <p className="mt-1 text-sm text-muted">Your recent use could not be loaded. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">
          Nothing spent yet. A mock interview uses {formatRange(TYPICAL_COSTS.mock_interview)} credits, a Design partner review {formatRange(TYPICAL_COSTS.partner_review)}.</p>
      ) : (
        <div className="mt-2 max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Credits spent, newest first</caption>
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th scope="col" className="sm:w-36 py-1.5 pr-3 font-semibold">
                  When
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  What
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  Credits
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {items.map((item) => (
                <tr key={`${item.at}-${item.ref}-${item.action}`}>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs tabular-nums text-muted">{whenOf(item.at)}</td>
                  <td className="py-1.5 pr-3 text-ink">
                    {USAGE_LABEL[item.action] ?? item.action}
                    {item.deep && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded-sm border-bw-1 border-ink bg-pop-lilac px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-on-accent">
                        <Zap size={10} aria-hidden="true" />
                        Deep
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink">{formatCredits(item.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PlanBilling() {
  const { plan, error } = usePlan(billingEnabled);
  const used = useDiagramsUsed();
  const usage = useUsage();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!billingEnabled) return null;

  const go = (run: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    run().then(
      (went) => went === false && setBusy(false),
      (e: unknown) => {
        setBusy(false);
        setFailed(e instanceof Error ? e.message : String(e));
      },
    );
  };
  const name = plan ? (PLAN_NAME[plan.plan] ?? 'Free') : 'Free';
  const toMax: Product = productPlan(plan?.subscription?.product)?.period === 'yearly' ? 'max_yearly' : 'max_monthly';

  return (
    <Section id="plan" title="Plan & billing" description="Your plan, the credits you have left and what they went on.">
      {!plan ? (
        <p className="p-4 text-sm text-muted">{error ? `Could not load your plan: ${error}` : 'Loading your plan…'}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
              <span className={`rounded-sm border-bw-1 border-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${BADGE[plan.plan] ?? BADGE.free}`}>{name}</span>
              {renewalText(plan) ??
                `Pro covers ${interviewsText(PLAN_CREDITS.pro)} a month (${formatCredits(PLAN_CREDITS.pro)} credits); Max about ${formatCount(planValue(PLAN_CREDITS.max).interviews)}, with the Deep verdict and printable reports.`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {plan.plan === 'free' && (
                <a href={pricingHref('../')} className={primaryButton}>
                  <Sparkles size={14} aria-hidden="true" />
                  See plans
                </a>
              )}
              {plan.plan === 'pro' && plan.billing && (
                <button type="button" className={primaryButton} disabled={busy} onClick={() => go(() => buyPlan(toMax, plan, '../'))}>
                  <Sparkles size={14} aria-hidden="true" />
                  Upgrade to Max
                </button>
              )}
              {plan.billing && plan.customer && (
                <button type="button" className={outlineButton} disabled={busy} onClick={() => go(openPortal)}>
                  <CreditCard size={14} aria-hidden="true" />
                  Manage in Polar
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
            <Figure label="Credits left" value={formatCredits(plan.credits.balance, { floor: true })}>
              {plan.credits.monthly ? (
                <Meter label="Monthly credits left" value={plan.credits.monthly.left} max={plan.credits.monthly.allowance} />
              ) : (
                <Meter label="Sign-up credits left" value={plan.credits.signup} max={PLAN_CREDITS.free} />
              )}
              <Worth credits={plan.credits.balance} />
              <Breakdown plan={plan} />
              {plan.billing && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" className={outlineButton} disabled={busy} onClick={() => go(() => checkout('credits_1000'))}>
                    <CreditCard size={14} aria-hidden="true" />
                    Buy {formatCredits(PRICES.topupCredits)} credits, €{PRICES.topup}
                  </button>
                  <span className="text-xs text-muted">Adds {interviewsText(PRICES.topupCredits)}</span>
                </div>
              )}
            </Figure>
            <Figure label="Diagrams in your account" value={used ?? '–'} unit={plan.limits.documents === null ? 'kept, no limit' : `of ${plan.limits.documents}`}>
              {plan.limits.documents !== null && <Meter label="Diagrams in your account" value={used ?? 0} max={plan.limits.documents} />}
              <p className="mt-2 text-xs text-muted">
                {plan.limits.versionsPerDocument === null ? 'Unlimited versions of each.' : `Up to ${plan.limits.versionsPerDocument} versions of each.`}
              </p>
            </Figure>
          </div>
          <Usage items={usage} />
          <p className="px-4 py-3 text-xs text-muted">
            Monthly credits reset each month and don&rsquo;t roll over; sign-up and top-up credits never expire. Payments are handled by Polar, our merchant of
            record. Canceling keeps your plan to the end of the paid period, and every diagram.
          </p>
        </>
      )}
    </Section>
  );
}
