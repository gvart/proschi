import { useEffect, useState, type ReactNode } from 'react';
import { Check, CreditCard, Hammer, LogIn, MessagesSquare, ScanSearch, Sparkles, Zap } from 'lucide-react';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { eyebrow, outlineButton, primaryButton } from '../components/Playground/ui';
import AccountMenu from '../practice/AccountMenu';
import { PROVIDER_LABEL } from '../practice/account';
import { useAccount, type Account } from '../practice/useAccount';
import { billingEnabled, buyPlan, FREE, openPortal, PLAN_CREDITS, PRICES, productPlan, type PlanInfo, type Product } from '../services/billing';
import { formatCredits, formatRange, type CreditEstimates, type Range } from '../services/credits';
import { useEstimates } from '../services/useCredits';
import { usePlan } from './usePlan';

/**
 * The pricing page (/pricing/): Free, Pro and Max side by side, monthly or
 * yearly, what credits buy, and the top-up. Buttons go to Polar's checkout,
 * or switch the subscription when there is one (signed in), or sign in first.
 * Built only with VITE_BILLING=true (vite.config.ts); docs/design/paid-plans.md
 * P26–P28, P31.
 */

const noop = () => undefined;
const card = 'flex flex-col rounded-brutal border-bw-2 border-ink p-5 shadow-brutal-md';
const saving = (monthly: number, yearly: number) => Math.round((1 - yearly / (monthly * 12)) * 100);
const SAVING = { pro: saving(PRICES.proMonthly, PRICES.proYearly), max: saving(PRICES.maxMonthly, PRICES.maxYearly) };

export default function PricingApp() {
  const account = useAccount(noop);
  const signedIn = account.state.status === 'signed-in';
  const { plan } = usePlan(signedIn);
  const estimates = useEstimates(signedIn);
  useEffect(() => {
    document.title = 'Pricing · Proschi';
  }, []);
  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      <Header base="../" current="pricing" actions={<AccountMenu account={account} />} />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 sm:py-14">
        <Pricing account={account} plan={plan} estimates={estimates} />
      </main>
      <Footer base="../" />
    </div>
  );
}

type Period = 'monthly' | 'yearly';
type Busy = Product | 'portal' | null;

/** How many full mock interviews `credits` make, at the estimate's high and low end: "13–17". */
function interviews(credits: number, { min, max }: Range): string {
  const few = Math.floor(credits / max);
  const many = Math.floor(credits / min);
  return few === many ? `${few}` : `${few}–${many}`;
}

export function Pricing({ account, plan, estimates }: { account: Account; plan?: PlanInfo; estimates: CreditEstimates }) {
  const [period, setPeriod] = useState<Period>('yearly');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const current = plan ? (plan.plan === 'max' ? 'max' : plan.plan === 'pro' ? 'pro' : 'free') : undefined;
  const currentPeriod = productPlan(plan?.subscription?.product)?.period;

  const run = (what: Exclude<Busy, null>) => {
    setBusy(what);
    setError(null);
    const going = what === 'portal' ? openPortal().then(() => true) : buyPlan(what, plan, '../');
    going.then(
      (went) => !went && setBusy(null),
      (e: unknown) => {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };

  /** A buy button; signed out, a sign-in button per provider instead (back to this page). */
  const action = (label: string, what: Product, primary: boolean, signInLabel: string) => {
    const { state } = account;
    if (!billingEnabled || state.status === 'off') return <p className="text-sm text-muted">Paid plans are not available on this site.</p>;
    if (state.status === 'loading') return <p className="text-sm text-muted">Checking your sign-in…</p>;
    if (state.status === 'signed-out') {
      return (
        <div className="flex flex-col gap-2">
          {state.providers.map((p, i) => (
            <button key={p} type="button" className={`${primary && i === 0 ? primaryButton : outlineButton} justify-center`} onClick={() => account.signIn(p)}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with {PROVIDER_LABEL[p]} to {signInLabel}
            </button>
          ))}
        </div>
      );
    }
    return (
      <button type="button" className={`${primary ? primaryButton : outlineButton} justify-center`} disabled={busy !== null} onClick={() => run(what)}>
        {what === 'credits_1000' ? <CreditCard size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {busy === what ? 'Opening…' : label}
      </button>
    );
  };

  const manage = plan?.customer && (
    <button type="button" className={`${outlineButton} justify-center`} disabled={busy !== null} onClick={() => run('portal')}>
      <CreditCard size={14} aria-hidden="true" />
      {busy === 'portal' ? 'Opening…' : 'Manage in Polar'}
    </button>
  );

  /** A paid plan's button: on it in this period, "Your plan"; otherwise buy, upgrade or switch. */
  const planAction = (id: 'pro' | 'max') => {
    const product: Product = `${id}_${period}`;
    const name = id === 'max' ? 'Max' : 'Pro';
    const price = id === 'max' ? (period === 'yearly' ? PRICES.maxYearly : PRICES.maxMonthly) : period === 'yearly' ? PRICES.proYearly : PRICES.proMonthly;
    const unit = period === 'yearly' ? 'a year' : 'a month';
    if (current === id && (!currentPeriod || currentPeriod === period)) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">You are on {name}.</p>
          {manage}
        </div>
      );
    }
    const label = current === id ? `Switch to ${period}, €${price} ${unit}` : current === 'pro' && id === 'max' ? `Upgrade to Max, €${price} ${unit}` : current === 'max' && id === 'pro' ? `Switch to Pro, €${price} ${unit}` : `Get ${name}, €${price} ${unit}`;
    return action(label, product, id === 'pro' && current !== 'max', `get ${name}`);
  };

  const monthly = (yearly: number) => `€${(yearly / 12).toFixed(2)} a month, billed yearly`;

  return (
    <>
      <p className={eyebrow}>Pricing</p>
      <h1 className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Free to design. Credits for the coaching.</h1>
      <p className="mt-3 max-w-2xl text-ink/80">
        The editor, the simulation and every practice problem stay free and open source. Mock interviews and Design partner run on credits, so you pay
        for what you use: a short review costs a few, a full interview {formatRange(estimates.mock_interview)}.
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
            {p === 'monthly' ? 'Monthly' : `Yearly, save up to ${Math.max(SAVING.pro, SAVING.max)}%`}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-3 md:items-stretch">
        <PlanCard
          id="free"
          name="Free"
          tagline="Design, simulate, practise."
          price={<Price amount={0} unit="forever" note="No card needed." />}
          credits={<Credits amount={PLAN_CREDITS.free} when="once, at sign-up" note={`about ${interviews(PLAN_CREDITS.free, estimates.mock_interview)} mock interviews to try it`} />}
          items={[
            'The editor, simulation and every practice problem',
            'Unlimited diagrams in your browser',
            `${FREE.documents} diagrams in your account, ${FREE.versions} versions each`,
            'Design partner and mock interviews, on your credits',
          ]}
          footer={current === 'free' ? <p className="text-sm font-semibold text-ink">Your plan</p> : null}
        />
        <PlanCard
          id="pro"
          name="Pro"
          tagline="For steady interview prep."
          ribbon={<Ribbon className="bg-pop-yellow">Recommended</Ribbon>}
          tone="bg-pop-yellow/15 dark:bg-pop-yellow/10 md:-my-2 md:py-7 shadow-brutal-lg"
          price={
            <Price
              amount={period === 'yearly' ? PRICES.proYearly : PRICES.proMonthly}
              unit={period === 'yearly' ? 'a year' : 'a month'}
              note={period === 'yearly' ? `${monthly(PRICES.proYearly)}, save ${SAVING.pro}%` : 'Billed monthly'}
            />
          }
          credits={<Credits amount={PLAN_CREDITS.pro} when="every month" note={`about ${interviews(PLAN_CREDITS.pro, estimates.mock_interview)} mock interviews a month`} />}
          items={['Everything in Free', 'Unlimited diagrams and versions', 'Interview history and trends per skill', 'Your next steps, picked after each interview', 'Private, revocable share links']}
          footer={planAction('pro')}
        />
        <PlanCard
          id="max"
          name="Max"
          tagline="The most credits and the strongest model."
          ribbon={<Ribbon className="bg-pop-lilac">Most credits</Ribbon>}
          tone="bg-pop-lilac/15 dark:bg-pop-lilac/10"
          price={
            <Price
              amount={period === 'yearly' ? PRICES.maxYearly : PRICES.maxMonthly}
              unit={period === 'yearly' ? 'a year' : 'a month'}
              note={period === 'yearly' ? `${monthly(PRICES.maxYearly)}, save ${SAVING.max}%` : 'Billed monthly'}
            />
          }
          credits={<Credits amount={PLAN_CREDITS.max} when="every month" note={`about ${interviews(PLAN_CREDITS.max, estimates.mock_interview)} mock interviews a month`} />}
          items={['Everything in Pro', 'Deep mode: the strongest model for verdicts and Design partner, charged at its price', 'Printable interview reports, saved as PDF']}
          footer={planAction('max')}
        />
      </div>

      <section aria-labelledby="pricing-costs" className="mt-12">
        <h2 id="pricing-costs" className="font-display text-xl font-bold text-ink">
          What credits buy
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink/80">
          One credit is one cent of use. Every action shows its estimate before it starts and its real cost afterwards, in Settings.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          <Cost icon={<MessagesSquare size={16} aria-hidden="true" />} title="Mock interview" detail="45 minutes, with the verdict" range={estimates.mock_interview} />
          <Cost icon={<ScanSearch size={16} aria-hidden="true" />} title="Design partner review" detail="Of one diagram, with changes to try" range={estimates.partner_review} />
          <Cost icon={<Hammer size={16} aria-hidden="true" />} title="Build a system" detail="From a description, tested and simulated" range={estimates.partner_build} />
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
          <Zap size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Deep mode (Max) uses the strongest model and costs about {formatCredits(estimates.deepMultiplier)}× as much. It is off unless you switch it on.
        </p>
      </section>

      <section aria-labelledby="plan-topup" className={`mt-8 ${card} bg-surface sm:flex-row sm:items-center sm:gap-6`}>
        <div className="flex-1">
          <h2 id="plan-topup" className="font-display text-xl font-bold text-ink">
            Top-up: {formatCredits(PRICES.topupCredits)} credits for €{PRICES.topup}
          </h2>
          <p className="mt-1 text-sm text-ink/80">On any plan, Free too. Top-up credits never expire, and your monthly credits are spent first.</p>
          {plan && (
            <p className="mt-1 text-sm text-muted" data-testid="pricing-balance">
              You have {formatCredits(plan.credits.balance, { floor: true })} credits.
            </p>
          )}
        </div>
        <div className="mt-4 shrink-0 sm:mt-0">{action(`Buy ${formatCredits(PRICES.topupCredits)} credits, €${PRICES.topup}`, 'credits_1000', false, 'buy')}</div>
      </section>

      <section aria-labelledby="pricing-faq" className="mt-12 max-w-3xl">
        <h2 id="pricing-faq" className="font-display text-xl font-bold text-ink">
          Questions
        </h2>
        <dl className="mt-3 space-y-4 text-sm">
          <Faq q="What is a credit?">
            One cent of use. A mock interview or a Design partner answer costs what it took to write, so a short answer costs less than a long one. You see
            the estimate before you start and the real cost after.
          </Faq>
          <Faq q="Why credits, and not a number of interviews?">
            You pay for what you use: a short review costs less than a full interview, and a 30-minute interview less than a 60-minute one. The plan only
            sets how many credits come each month; everyone with credits can use every feature that runs on them.
          </Faq>
          <Faq q="Do unused credits roll over?">
            Monthly credits reset at the start of each month and don&rsquo;t roll over. The {PLAN_CREDITS.free} sign-up credits and top-ups never expire.
            Monthly credits are spent first, then sign-up credits, then top-ups.
          </Faq>
          <Faq q="What if I run out during an interview?">
            The interviewer moves to the wrap-up and still gives you the verdict. You can top up at any time.
          </Faq>
          <Faq q="What is Deep mode?">
            A switch on Max that runs the verdict and Design partner on the strongest model. It is charged at that model&rsquo;s price, about{' '}
            {formatCredits(estimates.deepMultiplier)}× the usual, so use it when the answer matters most.
          </Faq>
          <Faq q="Can I switch plans or cancel?">
            Any time. Switching between Pro and Max, or monthly and yearly, changes your subscription at once and Polar settles the difference. Canceling
            keeps the plan to the end of the period you paid for. Your diagrams are all kept: past the free plan&rsquo;s {FREE.documents}, the ones you
            saved least recently become read-only until you delete some or come back. Top-up credits stay yours.
          </Faq>
          <Faq q="Who takes the payment?">
            Polar, our merchant of record, runs the checkout, charges VAT where it applies and sends the invoices. Proschi never sees your card.
          </Faq>
          <Faq q="Who is the interviewer?">
            Claude, made by Anthropic. A mock interview sends Anthropic your answers and diagram, and Design partner sends the diagram and your messages.
            See the{' '}
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

function PlanCard({
  id,
  name,
  tagline,
  ribbon,
  tone = 'bg-surface',
  price,
  credits,
  items,
  footer,
}: {
  id: string;
  name: string;
  tagline: string;
  ribbon?: ReactNode;
  tone?: string;
  price: ReactNode;
  credits: ReactNode;
  items: string[];
  footer: ReactNode;
}) {
  return (
    <section aria-labelledby={`plan-${id}`} className={`${card} relative ${tone}`}>
      {ribbon}
      <h2 id={`plan-${id}`} className="font-display text-2xl font-bold text-ink">
        {name}
      </h2>
      <p className="mt-0.5 text-sm text-muted">{tagline}</p>
      {price}
      {credits}
      <Features items={items} />
      <div className="mt-auto pt-5">{footer}</div>
    </section>
  );
}

function Ribbon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`absolute -top-3 right-4 rounded-sm border-bw-1 border-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-on-accent ${className}`}>
      {children}
    </span>
  );
}

function Price({ amount, unit, note }: { amount: number; unit: string; note: string }) {
  return (
    <div className="mt-3">
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-extrabold text-ink">€{amount}</span>
        <span className="text-sm text-muted">{unit}</span>
      </p>
      <p className="mt-0.5 min-h-[1.25rem] text-xs text-muted">{note}</p>
    </div>
  );
}

/** The plan's credits: the number, when they come, and what they are about worth. */
function Credits({ amount, when, note }: { amount: number; when: string; note: string }) {
  return (
    <div className="mt-3 rounded-sm border-bw-1 border-ink/30 bg-paper/60 px-3 py-2">
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-xl font-bold tabular-nums text-ink">{formatCredits(amount)}</span>
        <span className="text-sm font-semibold text-ink">credits</span>
        <span className="text-sm text-muted">{when}</span>
      </p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

function Cost({ icon, title, detail, range }: { icon: ReactNode; title: string; detail: string; range: Range }) {
  return (
    <li className="rounded-sm border-bw-1 border-ink bg-surface p-4 shadow-brutal-sm">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </p>
      <p className="mt-2 flex items-baseline gap-1.5 text-ink">
        <span className="text-sm text-muted">about</span>
        <span className="font-display text-2xl font-bold tabular-nums">{formatRange(range).replace('about ', '')}</span>
        <span className="text-sm text-muted">credits</span>
      </p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </li>
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
