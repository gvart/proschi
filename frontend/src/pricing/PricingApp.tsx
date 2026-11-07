import { useEffect, useState, type ReactNode } from 'react';
import { Check, CreditCard, LogIn, Sparkles } from 'lucide-react';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { eyebrow, outlineButton, primaryButton } from '../components/Playground/ui';
import AccountMenu from '../practice/AccountMenu';
import { PROVIDER_LABEL } from '../practice/account';
import { useAccount, type Account } from '../practice/useAccount';
import { billingEnabled, checkout, FREE, openPortal, PRICES, type PlanInfo, type Product } from '../services/billing';
import { usePlan } from './usePlan';

/**
 * The pricing page (/pricing/): Free and Pro side by side, monthly or yearly,
 * and the interview pack. Buttons go to Polar's checkout (signed in) or sign
 * in first; on Pro, to the billing portal. Built only with VITE_BILLING=true
 * (vite.config.ts); docs/design/paid-plans.md P1.
 */

const noop = () => undefined;
const card = 'flex flex-col rounded-brutal border-bw-2 border-ink p-5 shadow-brutal-md';
const YEARLY_SAVING = Math.round((1 - PRICES.proYearly / (PRICES.proMonthly * 12)) * 100);

export default function PricingApp() {
  const account = useAccount(noop);
  const signedIn = account.state.status === 'signed-in';
  const { plan } = usePlan(signedIn);
  useEffect(() => {
    document.title = 'Pricing · Proschi';
  }, []);
  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      <Header base="../" current="pricing" actions={<AccountMenu account={account} />} />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 sm:py-14">
        <Pricing account={account} plan={plan} />
      </main>
      <Footer base="../" />
    </div>
  );
}

type Period = 'monthly' | 'yearly';

export function Pricing({ account, plan }: { account: Account; plan?: PlanInfo }) {
  const [period, setPeriod] = useState<Period>('yearly');
  const [busy, setBusy] = useState<Product | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPro = plan?.plan === 'pro';

  const run = (what: Product | 'portal') => {
    setBusy(what);
    setError(null);
    (what === 'portal' ? openPortal() : checkout(what)).catch((e: unknown) => {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  /** A buy button: signed out, the sign-in buttons instead (back to this page). */
  const action = (label: string, what: Product, primary: boolean) => {
    const { state } = account;
    if (!billingEnabled || state.status === 'off') return <p className="text-sm text-muted">Paid plans are not available on this site.</p>;
    if (state.status === 'loading') return <p className="text-sm text-muted">Checking your sign-in…</p>;
    if (state.status === 'signed-out') {
      return (
        <div className="flex flex-wrap gap-2">
          {state.providers.map((p) => (
            <button key={p} type="button" className={primary ? primaryButton : outlineButton} onClick={() => account.signIn(p)}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with {PROVIDER_LABEL[p]} to {what === 'pack_5' ? 'buy' : 'upgrade'}
            </button>
          ))}
        </div>
      );
    }
    return (
      <button type="button" className={primary ? primaryButton : outlineButton} disabled={busy !== null} onClick={() => run(what)}>
        {what === 'pack_5' ? <CreditCard size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {busy === what ? 'Opening checkout…' : label}
      </button>
    );
  };

  const price = period === 'yearly' ? PRICES.proYearly : PRICES.proMonthly;

  return (
    <>
      <p className={eyebrow}>Pricing</p>
      <h1 className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Free to design. Pro to go further.</h1>
      <p className="mt-3 max-w-2xl text-ink/80">
        The editor, the simulation and every practice problem stay free and open source. Pro adds room in your account and mock interviews that coach you
        while they test you.
      </p>

      <div role="radiogroup" aria-label="Billing period" className="mt-6 inline-flex rounded-sm border-bw-1 border-ink bg-surface p-0.5 shadow-brutal-sm">
        {(['monthly', 'yearly'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={period === p}
            onClick={() => setPeriod(p)}
            className={`rounded-[3px] px-3 py-1.5 text-sm font-semibold ${period === p ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/10'}`}
          >
            {p === 'monthly' ? 'Monthly' : `Yearly, save ${YEARLY_SAVING}%`}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <section aria-labelledby="plan-free" className={`${card} bg-surface`}>
          <h2 id="plan-free" className="font-display text-2xl font-bold text-ink">
            Free
          </h2>
          <Price amount={0} unit="forever" />
          <Features
            items={[
              'The editor, simulation and every practice problem',
              'Unlimited diagrams in your browser',
              `${FREE.documents} diagrams in your account, synced across devices`,
              `${FREE.versions} versions per diagram, ${FREE.sizeKiB} KiB each`,
              `${FREE.interviews} mock interview, to try it`,
            ]}
          />
          <div className="mt-auto pt-5">
            {plan && !isPro ? <p className="text-sm font-semibold text-ink">Your plan</p> : <p className="text-sm text-muted">No card needed.</p>}
          </div>
        </section>

        <section aria-labelledby="plan-pro" className={`${card} relative bg-pop-yellow/15 dark:bg-pop-yellow/10`}>
          <span className="absolute -top-3 right-4 rounded-sm border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-on-accent">
            Interview prep
          </span>
          <h2 id="plan-pro" className="font-display text-2xl font-bold text-ink">
            Pro
          </h2>
          <Price amount={price} unit={period === 'yearly' ? 'a year' : 'a month'} note={period === 'yearly' ? `€${(PRICES.proYearly / 12).toFixed(2)} a month, billed yearly` : 'Billed monthly'} />
          <Features
            items={[
              'Everything in Free',
              'Unlimited diagrams and versions in your account',
              `${PRICES.proInterviews} mock interviews a month, with live coaching`,
              'In-depth review of any diagram, on its trade-offs',
              'Interview history and your next steps, picked after each interview',
              'Private, revocable share links',
            ]}
          />
          <div className="mt-auto pt-5">
            {isPro ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink">You are on Pro.</p>
                {plan?.customer && (
                  <button type="button" className={outlineButton} disabled={busy !== null} onClick={() => run('portal')}>
                    <CreditCard size={14} aria-hidden="true" />
                    {busy === 'portal' ? 'Opening…' : 'Manage billing'}
                  </button>
                )}
              </div>
            ) : (
              action(`Upgrade to Pro, €${price} ${period === 'yearly' ? 'a year' : 'a month'}`, period === 'yearly' ? 'pro_yearly' : 'pro_monthly', true)
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="plan-pack" className={`mt-5 ${card} bg-surface sm:flex-row sm:items-center sm:gap-6`}>
        <div className="flex-1">
          <h2 id="plan-pack" className="font-display text-xl font-bold text-ink">
            Mock interview pack
          </h2>
          <p className="mt-1 text-sm text-ink/80">
            {PRICES.packInterviews} more mock interviews for €{PRICES.pack}, on any plan. Pack interviews never expire; Pro uses its monthly ones first.
          </p>
          {plan && plan.credits.total > 0 && (
            <p className="mt-1 text-sm text-muted">
              You have {plan.credits.total} mock interview{plan.credits.total === 1 ? '' : 's'} left.
            </p>
          )}
        </div>
        <div className="mt-4 sm:mt-0">{action(`Buy ${PRICES.packInterviews} mock interviews, €${PRICES.pack}`, 'pack_5', false)}</div>
      </section>

      <section aria-labelledby="pricing-faq" className="mt-10 max-w-3xl">
        <h2 id="pricing-faq" className="font-display text-xl font-bold text-ink">
          Questions
        </h2>
        <dl className="mt-3 space-y-4 text-sm">
          <Faq q="Who takes the payment?">
            Polar, our merchant of record, runs the checkout, charges VAT where it applies and sends the invoices. Proschi never sees your card.
          </Faq>
          <Faq q="What happens if I cancel?">
            Pro lasts until the end of the period you paid for. Your diagrams and versions are all kept: past the free plan&rsquo;s {FREE.documents}, the
            ones you saved least recently become read-only until you delete some or come back to Pro. Pack interviews stay yours.
          </Faq>
          <Faq q="Do unused interviews carry over?">Pro&rsquo;s {PRICES.proInterviews} a month don&rsquo;t; pack interviews never expire.</Faq>
          <Faq q="Who is the interviewer?">
            Claude, made by Anthropic. A mock interview sends Anthropic your answers and diagram, and an in-depth review sends the diagram. See the{' '}
            <a href="../docs/privacy/" className="font-semibold underline underline-offset-2">
              privacy page
            </a>{' '}
            and the{' '}
            <a href="../docs/terms/" className="font-semibold underline underline-offset-2">
              terms
            </a>
            .
          </Faq>
        </dl>
      </section>
    </>
  );
}

function Price({ amount, unit, note }: { amount: number; unit: string; note?: string }) {
  return (
    <div className="mt-2">
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-extrabold text-ink">€{amount}</span>
        <span className="text-sm text-muted">{unit}</span>
      </p>
      <p className="mt-0.5 min-h-[1.25rem] text-xs text-muted">{note ?? ''}</p>
    </div>
  );
}

function Features({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm text-ink">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check size={16} className="mt-0.5 shrink-0 text-pass" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{q}</dt>
      <dd className="mt-1 text-ink/80">{children}</dd>
    </div>
  );
}
