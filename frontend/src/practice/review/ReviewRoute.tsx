import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Layers, LogIn, PartyPopper, RotateCcw } from 'lucide-react';
import deck from 'virtual:practice-cards';
import type { Card } from '../../learn/cards';
import { nextState, type Rating } from '../../learn/fsrs';
import { buildSession, isNew, localDay, NEW_PER_DAY, overview, SESSION_SIZE, type CardReview, type CardStates, type DayCounts, type SessionItem } from '../../learn/review';
import type { Account } from '../useAccount';
import { PROVIDER_LABEL } from '../account';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, primaryButton, toolButton } from '../../components/Playground/ui';
import { accountStore, localStore, memoryStore, signedOutError, type CardStore } from './store';
import ReviewSession, { type SessionResult } from './ReviewSession';

/**
 * Daily review (`#/review`, `#/review/<topic>`): today's due and new cards,
 * per topic, and a session through them. Signed in, every card is reviewed
 * and scheduled, and the reviews are stored on the server; signed out, the
 * free sample deck can be tried, kept in memory only; a build without
 * accounts reviews every card and keeps the reviews in this browser.
 *
 * Loaded lazily with the cards (virtual:practice-cards), so the problem list
 * does not ship them.
 */

/** Unsent reviews go out once this many wait, and when a session ends or the page is hidden. */
const FLUSH_AT = 5;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A random id for a review; randomUUID needs a secure context, which a local preview over http may not be. */
function reviewId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "later today", "tomorrow", "in 5 days". */
function dueIn(due: number, now: number): string {
  const days = Math.ceil((due - now) / 86_400);
  if (due <= now) return 'now';
  if (localDay(new Date(due * 1000)) === localDay(new Date(now * 1000))) return 'later today';
  if (days <= 1) return 'tomorrow';
  return `in ${days} days`;
}

type Load = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

type View = { kind: 'home' } | { kind: 'session'; items: SessionItem[] } | { kind: 'summary'; results: SessionResult[] };

export default function ReviewRoute({ account, topic: topicId }: { account: Account; topic?: string }) {
  const { state } = account;
  const userId = state.status === 'signed-in' ? state.user.id : undefined;
  const signedOut = state.status === 'signed-out';
  const store = useMemo<CardStore | undefined>(
    () => (state.status === 'off' ? localStore() : signedOut ? memoryStore() : userId ? accountStore(userId) : undefined),
    [state.status, signedOut, userId],
  );
  /** Signed out: the free sample deck only. */
  const sampleOnly = signedOut ? ('sample' as const) : undefined;

  const [states, setStates] = useState<CardStates>({});
  // The latest states for onReview, which runs between renders.
  const statesRef = useRef(states);
  statesRef.current = states;
  const [today, setToday] = useState<DayCounts>({ reviews: 0, new: 0 });
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ kind: 'home' });

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    store.load(localDay(new Date())).then(
      (loaded) => {
        if (cancelled) return;
        setStates(loaded.states);
        setToday(loaded.today);
        setLoad({ status: 'ready' });
      },
      (e: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'error',
          message: signedOutError(e) ? 'Your session has expired; sign in again to review.' : 'Could not reach the server. Reviews you made are kept in this browser until it answers.',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, attempt]);

  // Unsent reviews go out when the page is hidden (a phone locking, a tab switch); what fails stays in the outbox for next time.
  const waiting = useRef(0);
  const flush = useCallback(() => {
    if (!store || store.kind !== 'account') return;
    waiting.current = 0;
    void store.flush().catch(() => undefined);
  }, [store]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  const onReview = useCallback(
    (card: Card, rating: Rating, durationMs: number) => {
      if (!store) return;
      const at = nowSeconds();
      const day = localDay(new Date(at * 1000));
      const review: CardReview = { id: reviewId(), cardId: card.id, version: card.version, rating, reviewedAt: at, durationMs: Math.round(durationMs), day };
      store.add(review);
      const before = statesRef.current[card.id];
      const after = nextState(before, rating, at, card.version);
      statesRef.current = { ...statesRef.current, [card.id]: after };
      setStates(statesRef.current);
      setToday((t) => ({ reviews: t.reviews + 1, new: t.new + (isNew(card, before) ? 1 : 0) }));
      if (++waiting.current >= FLUSH_AT) flush();
    },
    [store, flush],
  );

  const topic = topicId ? deck.topics.find((t) => t.id === topicId) : undefined;
  const now = nowSeconds();
  const stats = overview(deck.cards, states, deck.topics, { now, deck: sampleOnly });
  const scope = topic ? stats.topics.find((t) => t.topic.id === topic.id) : undefined;
  // Training one topic is asked for: its new cards are not held to the daily allowance.
  const newLimit = topic ? SESSION_SIZE : Math.max(0, NEW_PER_DAY - today.new);
  const items = buildSession(deck.cards, states, deck.topics, { now, topic: topic?.id, deck: sampleOnly, newLimit });

  useEffect(() => {
    document.title = topic ? `Review: ${topic.title} · Proschi practice` : 'Daily review · Proschi practice';
  }, [topic]);
  // A new address (another topic, or back to all) leaves a session.
  useEffect(() => setView({ kind: 'home' }), [topicId]);

  if (state.status === 'loading' || (load.status === 'loading' && store)) {
    return <PaneLoading label={state.status === 'loading' ? 'Checking your sign-in…' : 'Loading your cards…'} />;
  }

  const end = (results: SessionResult[]) => {
    flush();
    setView(results.length ? { kind: 'summary', results } : { kind: 'home' });
  };

  if (view.kind === 'session') {
    return <ReviewSession items={view.items} states={states} topics={deck.topics} onReview={onReview} onDone={end} onQuit={end} />;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <a href={topic ? '#/review' : '#/'} className={`-ml-2.5 ${toolButton}`}>
        {topic ? 'All topics' : 'All problems'}
      </a>
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">{topic ? `Review: ${topic.title}` : 'Daily review'}</h1>
      <p className="mt-3 max-w-2xl text-base text-ink/80">
        {topic
          ? topic.summary
          : 'Short questions on system design: recall an idea, pick an option, estimate a number or fill a gap. Each card comes back just before you would forget it, so a few minutes a day keep it fresh.'}
      </p>

      {topicId && !topic && <p className="mt-4 text-sm text-red-700 dark:text-red-300">No topic called “{topicId}”. Pick one below.</p>}

      {signedOut && <SignInInvite account={account} sample={stats.total} />}

      {load.status === 'error' ? (
        <section aria-label="Today" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
          <p role="alert" className="text-sm text-ink">
            {load.message}
          </p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-3 ${primaryButton}`}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        </section>
      ) : view.kind === 'summary' ? (
        <Summary results={view.results} more={items.length} nextDue={stats.nextDue} now={now} onMore={() => setView({ kind: 'session', items })} onHome={() => setView({ kind: 'home' })} />
      ) : (
        <section aria-label="Today" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Count label="Due" value={(scope ?? stats).due} />
            <Count label="New" value={items.filter((i) => i.isNew).length} />
            <Count label="Reviewed today" value={today.reviews} />
            <Count label={topic ? 'Cards in this topic' : 'Cards'} value={(scope ?? stats).total} />
          </dl>
          {items.length > 0 ? (
            <button type="button" onClick={() => setView({ kind: 'session', items })} className={`mt-4 w-full justify-center min-h-[48px] sm:w-auto ${primaryButton}`}>
              Start review · {items.length} {items.length === 1 ? 'card' : 'cards'}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <PartyPopper size={16} aria-hidden="true" />
              All caught up{stats.nextDue !== undefined ? `: the next card is due ${dueIn(stats.nextDue, now)}.` : '.'}
              {!topic && today.new >= NEW_PER_DAY && ' New cards open again tomorrow; train a topic below to learn more today.'}
            </p>
          )}
        </section>
      )}

      {view.kind === 'home' && !topic && (
        <section aria-labelledby="review-topics" className="mt-8">
          <h2 id="review-topics" className="font-display text-xl font-bold text-ink">
            Train a topic
          </h2>
          <ul className="mt-3 divide-y-2 divide-ink overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
            {stats.topics.map((t) => (
              <li key={t.topic.id}>
                <a
                  href={`#/review/${t.topic.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-[background-color,box-shadow] duration-d1 hover:bg-pop-yellow/25 hover:shadow-[inset_6px_0_0_rgb(var(--c-ink))] focus-visible:outline-none focus-visible:bg-pop-yellow/25 focus-visible:shadow-[inset_6px_0_0_rgb(var(--c-blue))]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-bold leading-tight text-ink">{t.topic.title}</span>
                    <span className="mt-0.5 block text-sm text-ink/75">{t.topic.summary}</span>
                  </span>
                  <span className="flex-shrink-0 text-right text-xs tabular-nums text-muted">
                    {t.due > 0 && <span className="block font-semibold text-ink">{t.due} due</span>}
                    <span className="block">
                      {t.new} new · {t.total} {t.total === 1 ? 'card' : 'cards'}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className={eyebrow}>{label}</dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Signed out: what an account adds, and the sign-in buttons. */
function SignInInvite({ account, sample }: { account: Account; sample: number }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <section aria-label="Sign in to save your reviews" className="mt-6 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Layers size={16} aria-hidden="true" />
        Trying the free sample deck: {sample} cards
      </p>
      <p className="mt-1 max-w-2xl text-sm text-ink/80">
        Reviews made signed out are not saved. Sign in to review every card, have each one scheduled for you and keep your progress across devices.
      </p>
      {providers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {providers.map((p) => (
            <button key={p} type="button" onClick={() => account.signIn(p)} className={primaryButton}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Summary({ results, more, nextDue, now, onMore, onHome }: { results: SessionResult[]; more: number; nextDue?: number; now: number; onMore: () => void; onHome: () => void }) {
  const remembered = results.filter((r) => r.rating > 1).length;
  const again = results.length - remembered;
  return (
    <section aria-label="Session summary" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink">
        <PartyPopper size={18} aria-hidden="true" />
        Session done
      </h2>
      <p className="mt-2 text-sm text-ink">
        You reviewed {results.length} {results.length === 1 ? 'card' : 'cards'}: {remembered} remembered
        {again > 0 && `, ${again} to see again soon`}.
        {nextDue !== undefined && more === 0 && ` The next card is due ${dueIn(nextDue, now)}.`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {more > 0 && (
          <button type="button" onClick={onMore} className={`min-h-[44px] ${primaryButton}`}>
            Keep going · {more} more
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        <button type="button" onClick={onHome} className={`min-h-[44px] ${more > 0 ? toolButton : primaryButton}`}>
          Back to review
        </button>
      </div>
    </section>
  );
}
