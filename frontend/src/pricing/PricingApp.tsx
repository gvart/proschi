import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronRight, CreditCard, Hammer, LogIn, MessagesSquare, ScanSearch, Sparkles, Wand2, Zap } from 'lucide-react';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { eyebrow, outlineButton, primaryButton } from '../components/Playground/ui';
import AccountMenu from '../practice/AccountMenu';
import { PROVIDER_LABEL } from '../practice/account';
import { useAccount, type Account } from '../practice/useAccount';
import { billingEnabled, buyPlan, FREE, openPortal, PLAN_CREDITS, PRICES, productPlan, type PlanInfo, type Product } from '../services/billing';
import { formatCredits, formatRange, type CreditEstimates, type Range } from '../services/credits';
import { useEstimates } from '../services/useCredits';
import { formatCount, interviewsText, partnerText, planValue } from './planValue';
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
      <h1 className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Walk into your system design interview ready.</h1>
      <p className="mt-3 max-w-2xl text-ink/80">
        Practise with mock interviews: an interviewer who asks the follow-ups, coaches you when you&rsquo;re stuck and grades each skill at the end.
        Each plan covers a number of them a month, and Design partner when you just want to design. The editor, the simulation and every practice
        problem stay free and open source.
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
          tagline="Try a mock interview."
          price={<Price amount={0} unit="forever" note="No card needed." />}
          value={<Value credits={PLAN_CREDITS.free} when="once" creditsWhen="once, at sign-up" estimates={estimates} />}
          items={[
            'A verdict on each skill after every mock interview',
            'Coaching hints when you’re stuck',
            'Voice or text: answer out loud, hear the interviewer',
            'The editor, simulation and every practice problem',
            `${FREE.documents} diagrams in your account, ${FREE.versions} versions each`,
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
          value={<Value credits={PLAN_CREDITS.pro} when="a month" creditsWhen="a month" estimates={estimates} />}
          items={['Everything in Free', 'Every verdict kept, and how each skill trends', 'Your next steps, picked after each interview', 'Unlimited diagrams and versions', 'Private, revocable share links']}
          footer={planAction('pro')}
        />
        <PlanCard
          id="max"
          name="Max"
          tagline="For the weeks before the real one."
          ribbon={<Ribbon className="bg-pop-lilac">Most credits</Ribbon>}
          tone="bg-pop-lilac/15 dark:bg-pop-lilac/10"
          price={
            <Price
              amount={period === 'yearly' ? PRICES.maxYearly : PRICES.maxMonthly}
              unit={period === 'yearly' ? 'a year' : 'a month'}
              note={period === 'yearly' ? `${monthly(PRICES.maxYearly)}, save ${SAVING.max}%` : 'Billed monthly'}
            />
          }
          value={<Value credits={PLAN_CREDITS.max} when="a month" creditsWhen="a month" estimates={estimates} />}
          items={['Everything in Pro', 'Deep verdict: the strongest model grades you, at its price', 'A printable interview report, saved as PDF', 'Deep mode for Design partner too']}
          footer={planAction('max')}
        />
      </div>

      <p className="mt-8 text-sm text-ink/80">
        Mock interviews and Design partner share the same credits, so spend them on either. The counts are for 45-minute interviews; shorter ones go
        further.
      </p>

      <section aria-labelledby="pricing-credits" className="mt-3">
        <details className="group rounded-sm border-bw-1 border-ink/30 bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink hover:bg-ink/5 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={16} className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
            <h2 id="pricing-credits">How credits work</h2>
          </summary>
          <div className="border-t-bw-1 border-ink/15 px-4 pb-4 pt-3">
            <p className="max-w-2xl text-sm text-ink/80">
              One credit is one cent of use. An action costs what it took to answer, so it varies a little; each one shows its estimate before it starts
              and its real cost afterwards, in Settings. Typical costs:
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Cost icon={<MessagesSquare size={14} aria-hidden="true" />} title="Mock interview" detail="45 minutes, with the verdict" range={estimates.mock_interview} />
              <Cost icon={<ScanSearch size={14} aria-hidden="true" />} title="Design review" detail="Of one diagram, with changes to try" range={estimates.partner_review} />
              <Cost icon={<Hammer size={14} aria-hidden="true" />} title="Build a system" detail="From a description, tested and simulated" range={estimates.partner_build} />
              <Cost icon={<Wand2 size={14} aria-hidden="true" />} title="Refine a design" detail="A question, or one more change" range={estimates.partner_turn} />
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Zap size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              Deep mode (Max) uses the strongest model and costs about {formatCredits(estimates.deepMultiplier)}× as much. It is off unless you switch it on.
            </p>
          </div>
        </details>
      </section>

      <section aria-labelledby="plan-topup" className={`mt-8 ${card} bg-surface sm:flex-row sm:items-center sm:gap-6`}>
        <div className="flex-1">
          <h2 id="plan-topup" className="font-display text-xl font-bold text-ink">
            Top-up: {interviewsText(PRICES.topupCredits, estimates)} for €{PRICES.topup}
          </h2>
          <p className="mt-1 text-sm text-ink/80">
            {formatCredits(PRICES.topupCredits)} credits, which also cover {partnerText(PRICES.topupCredits, estimates)} with Design partner. On any
            plan, Free too. Top-up credits never expire, and your monthly credits are spent first.
          </p>
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
            the estimate before you start and the real cost after, and nothing costs more than its cap: a Design partner review never more than{' '}
            {formatCredits(estimates.partner_review.worst ?? estimates.partner_review.max, { floor: true })} credits, a 45-minute mock interview never more than{' '}
            {formatCredits(estimates.mock_interview.worst ?? estimates.mock_interview.max, { floor: true })} credits (30 or 60 minutes in proportion), nor more than the credits you have.
          </Faq>
          <Faq q={`Why “about ${formatCount(planValue(PLAN_CREDITS.pro, estimates).interviews)}”, and not a fixed number of interviews?`}>
            Because you pay for what you use. An interview costs what the interviewer wrote, so a quick one costs less than a long, talkative one, and a
            30-minute interview less than a 60-minute one. The counts take a 45-minute interview with its verdict at the low and the high end of what it
            usually costs. The plan only sets how many credits come each month; with credits you can use every feature that runs on them.
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
  value,
  items,
  footer,
}: {
  id: string;
  name: string;
  tagline: string;
  ribbon?: ReactNode;
  tone?: string;
  price: ReactNode;
  value: ReactNode;
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
      {value}
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

/** `text` with each "38–61" kept on one line. */
const keepRanges = (text: string): ReactNode[] =>
  text.split(/(\d+–\d+)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap tabular-nums">
        {part}
      </span>
    ) : (
      part
    ),
  );

/** What the plan's credits cover: mock interviews first, Design partner second, and the credits themselves small (planValue.ts). */
function Value({ credits, when, creditsWhen, estimates }: { credits: number; when: string; creditsWhen: string; estimates: CreditEstimates }) {
  const headline = interviewsText(credits, estimates);
  return (
    <div data-testid="plan-value" className="mt-3 rounded-sm border-bw-1 border-ink/30 bg-paper/60 px-3 py-2.5">
      <p className="font-display text-lg font-bold leading-snug text-ink">
        {keepRanges(headline.charAt(0).toUpperCase() + headline.slice(1))} {when}
      </p>
      <p className="mt-1 text-sm leading-snug text-ink/80">or {keepRanges(partnerText(credits, estimates))} with Design partner</p>
      <p className="mt-1.5 text-xs tabular-nums text-muted">
        {formatCredits(credits)} credits {creditsWhen}
      </p>
    </div>
  );
}

function Cost({ icon, title, detail, range }: { icon: ReactNode; title: string; detail: string; range: Range }) {
  return (
    <li className="rounded-sm border-bw-1 border-ink/30 bg-paper/60 px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5 text-ink">
        <span className="text-sm text-muted">about</span>
        <span className="font-display text-lg font-bold tabular-nums">{formatRange(range).replace('about ', '')}</span>
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
