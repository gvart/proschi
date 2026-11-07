import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Map as MapIcon, MessagesSquare, PartyPopper, RefreshCw, ScanSearch, X } from 'lucide-react';
import { eyebrow, outlineButton, toolButton } from '../../components/Playground/ui';
import {
  nextPollIn,
  onPlan,
  onTick,
  readCheckoutReturn,
  returnMessage,
  SLOW_AFTER,
  startReturn,
  withoutCheckoutReturn,
  type ReturnState,
} from '../../pricing/checkoutReturn';
import { announcePlanChanged, getPlan } from '../../services/billing';
import { Celebration } from '../Streak';
import { checkoutReturn } from './checkoutReturned';

/**
 * Back from Polar's checkout (`?checkout=done&product=…`) on the account
 * page: a banner that asks GET /api/me/plan on pricing/checkoutReturn.ts's
 * schedule until Polar's webhook has made the purchase show (activating,
 * slow after a minute, done). Done with Pro, a "Welcome to Pro" card with a
 * burst of confetti, once a purchase; with a pack, the banner alone.
 * Nothing on a normal visit. Self-contained, so the page mounts it in one line.
 */

/** The return's progress, kept across remounts (the return itself is read once a page load, checkoutReturned.ts). */
let kept: ReturnState | null = null;

/** Asks on the schedule until the purchase shows; `again` asks now. */
function useCheckoutReturn(): { state: ReturnState | null; checkoutId: string | null; again: () => void } {
  const [ret] = useState(checkoutReturn);
  const [state, setState] = useState<ReturnState | null>(() => (ret ? (kept ??= startReturn(ret, Date.now())) : null));
  const [tick, setTick] = useState(0);
  const update = useCallback((step: (s: ReturnState) => ReturnState) => setState((s) => (s ? (kept = step(s)) : s)), []);
  const ask = useCallback(() => {
    update((s) => onTick(s, Date.now()));
    getPlan().then(
      (plan) => update((s) => onPlan(s, plan)),
      () => undefined,
    );
  }, [update]);
  useEffect(() => {
    if (ret && kept?.phase !== 'done') ask();
  }, [ret, ask]);
  useEffect(() => {
    if (!state || state.phase === 'done') return;
    const wait = nextPollIn(state, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(() => {
      ask();
      setTick((n) => n + 1);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [state, tick, ask]);
  // Slow after a minute, whether or not an ask is due then.
  const activatingSince = state?.phase === 'activating' ? state.startedAt : undefined;
  useEffect(() => {
    if (activatingSince === undefined) return;
    const timer = window.setTimeout(() => update((s) => onTick(s, Date.now())), Math.max(0, activatingSince + SLOW_AFTER - Date.now()));
    return () => window.clearTimeout(timer);
  }, [activatingSince, update]);
  const doneKind = state?.phase === 'done' ? state.kind : undefined;
  useEffect(() => {
    if (!doneKind || !readCheckoutReturn(window.location.href)) return;
    // A reload doesn't show it again; the rest of the page reads the new plan.
    window.history.replaceState(window.history.state, '', withoutCheckoutReturn(window.location.href));
    announcePlanChanged(doneKind === 'pro' ? 'pro' : undefined);
  }, [doneKind]);
  return { state, checkoutId: ret?.checkoutId ?? null, again: ask };
}

/** The checkouts whose welcome was shown, in this browser. */
const WELCOMED = 'proschi:welcomed-checkouts';

function welcomed(id: string | null): boolean {
  if (!id) return false;
  try {
    return (JSON.parse(localStorage.getItem(WELCOMED) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}

function rememberWelcome(id: string | null): void {
  if (!id) return;
  try {
    const ids = JSON.parse(localStorage.getItem(WELCOMED) ?? '[]') as string[];
    localStorage.setItem(WELCOMED, JSON.stringify([...ids.filter((x) => x !== id), id].slice(-20)));
  } catch {
    // Storage off: it shows this time only, as the address no longer has the checkout.
  }
}

const TONE = { activating: 'bg-pop-blue/10', slow: 'bg-pop-lilac/20', done: 'bg-pop-yellow/30' } as const;

function Banner({ state, checkoutId, again }: { state: ReturnState; checkoutId: string | null; again: () => void }) {
  const Icon = state.phase === 'done' ? CheckCircle2 : state.phase === 'slow' ? Clock : Loader2;
  return (
    <div
      role="status"
      data-testid="checkout-return"
      data-phase={state.phase}
      className={`mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border-bw-2 border-ink px-3 py-2.5 text-sm text-ink shadow-brutal-sm ${TONE[state.phase]}`}
    >
      <Icon size={18} aria-hidden="true" className={`mt-0.5 shrink-0 ${state.phase === 'activating' ? 'motion-safe:animate-spin' : ''}`} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold">{returnMessage(state)}</p>
        {state.phase === 'slow' && checkoutId && <p className="mt-1 break-all text-xs text-muted">Checkout reference: {checkoutId}</p>}
      </div>
      {state.phase === 'slow' && (
        <button type="button" className={outlineButton} onClick={again}>
          <RefreshCw size={14} aria-hidden="true" />
          Check again
        </button>
      )}
    </div>
  );
}

/** Where Pro starts: links on the practice page (`#/…`, a problem opened on interview mode with the AI interviewer) and to the editor, whose Results tab has the AI review. */
const STARTS = [
  { href: '#/url-shortener?interview=ai', label: 'Start an AI interview', Icon: MessagesSquare },
  { href: '../app/', label: 'Review a design', Icon: ScanSearch },
  { href: '#/roadmap', label: 'See your roadmap', Icon: MapIcon },
] as const;

function WelcomePro({ state, onDismiss }: { state: ReturnState; onDismiss: () => void }) {
  return (
    <Celebration label="Welcome to Pro" tone="bg-pop-yellow/30" className="mt-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>Payment confirmed</p>
          <h3 className="mt-0.5 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <PartyPopper size={18} aria-hidden="true" />
            Welcome to Pro
          </h3>
          <p role="status" className="mt-1 text-sm text-ink/80">
            {returnMessage(state)}
          </p>
        </div>
        <button type="button" onClick={onDismiss} className={`-mr-2 -mt-1 ${toolButton}`} aria-label="Dismiss the welcome">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {STARTS.map(({ href, label, Icon }) => (
          <a key={href} href={href} className={outlineButton}>
            <Icon size={14} aria-hidden="true" />
            {label}
          </a>
        ))}
      </div>
    </Celebration>
  );
}

export default function CheckoutStatus() {
  const { state, checkoutId, again } = useCheckoutReturn();
  // This checkout's welcome shown before, in this browser: the banner alone.
  const [seen] = useState(() => welcomed(checkoutId));
  const [dismissed, setDismissed] = useState(false);
  const proDone = state?.phase === 'done' && state.kind === 'pro';
  useEffect(() => {
    if (proDone && !seen) rememberWelcome(checkoutId);
  }, [proDone, seen, checkoutId]);
  if (!state || dismissed) return null;
  if (proDone && !seen) return <WelcomePro state={state} onDismiss={() => setDismissed(true)} />;
  return <Banner state={state} checkoutId={checkoutId} again={again} />;
}
