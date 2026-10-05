import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Flame, LogIn, PartyPopper, RotateCcw, Trophy, X, Zap } from 'lucide-react';
import deck from 'virtual:practice-cards';
import type { Card } from '../../learn/cards';
import { clozeWithAnswers } from '../../learn/cards';
import type { Rating } from '../../learn/fsrs';
import {
  CHALLENGE_SIZE,
  challengeDay,
  challengeEndsAt,
  challengeRound,
  describeAnswer,
  describeRightAnswer,
  gradeChallengeAnswer,
  isChallengeCard,
  MAX_CARD_MS,
  MAX_SCORE,
  pickChallenge,
  POINTS_CORRECT,
  shareText,
  SPEED_BONUS_MAX,
  SPEED_FULL_MS,
  SPEED_ZERO_MS,
  type ChallengeAnswer,
  type ChallengeAnswerItem,
  type ChallengeCard,
} from '../../learn/challenge';
import { autoRating, localDay, type CardReview } from '../../learn/review';
import { celebrate } from '../../design/celebrate';
import { api, ApiError, apiEnabled, type ChallengeAttemptAnswer, type ChallengeLeaderboard, type ChallengeStreakAnswer, type ChallengeToday } from '../../services/api';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import Markdown, { InlineMarkdown } from '../Markdown';
import { PROVIDER_LABEL } from '../account';
import type { Activity } from '../activity';
import { announceCelebration } from '../celebrating';
import { CardView } from '../review/ReviewSession';
import { TYPE_LABEL } from '../review/labels';
import { accountStore, localStore, reviewId, signedOutError, type CardStore } from '../review/store';
import { notifyActivity } from '../skills/activity';
import type { Account } from '../useAccount';
import {
  clearGuestChallenge,
  guestChallenge,
  localResults,
  localStreak,
  saveGuestChallenge,
  saveLocalResult,
  scoreLocally,
  type ChallengeResult,
} from './store';

/**
 * The daily challenge (`#/challenge`): five auto-graded cards, the same for
 * everyone each UTC day (src/learn/challenge.ts), scored for accuracy and a
 * little for speed. Signed in, the server picks the cards, grades the answers,
 * keeps the first attempt and ranks it; signed out, the challenge is scored in
 * the browser and can be saved after signing in; a build without accounts
 * keeps every result and the challenge streak in this browser.
 *
 * Every answer is also a review of its card (src/practice/review/store.ts),
 * so it counts toward the daily goal and streak.
 */

type Mode = 'local' | 'guest' | 'account';

type Setup =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      day: string;
      cards: ChallengeCard[];
      endsAt: number;
      result?: ChallengeResult;
      streak?: ChallengeStreakAnswer;
      /** Signed in, a result the server does not have yet (it could not be reached). */
      unsaved?: ChallengeAnswerItem[];
    };

const nowSeconds = () => Math.floor(Date.now() / 1000);
const cardsById = new Map<string, Card>(deck.cards.map((c) => [c.id, c]));

/** The day's cards from their ids; undefined when this copy of the page lacks one (it is older than the server's). */
function cardsFor(ids: readonly string[]): ChallengeCard[] | undefined {
  const cards = ids.map((id) => cardsById.get(id));
  return cards.every((c): c is ChallengeCard => !!c && isChallengeCard(c)) ? cards : undefined;
}

/** "5 h 12 min", "12 min", "less than a minute". */
function untilText(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 1) return 'less than a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** The time now, again every `ms`. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const id = setInterval(() => setNow(nowSeconds()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Copies text, with a fallback for pages where the Clipboard API is not allowed. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export default function ChallengeRoute({ account, activity }: { account: Account; activity: Activity }) {
  const { state } = account;
  const userId = state.status === 'signed-in' ? state.user.id : undefined;
  const mode: Mode | undefined = state.status === 'off' ? 'local' : userId ? 'account' : state.status === 'signed-out' ? 'guest' : undefined;
  const store = useMemo<CardStore | undefined>(() => (mode === 'local' ? localStore() : mode === 'account' && userId ? accountStore(userId) : undefined), [mode, userId]);
  const [setup, setSetup] = useState<Setup>({ status: 'loading' });
  const [view, setView] = useState<'intro' | 'session'>('intro');
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = activity;

  useEffect(() => {
    document.title = 'Daily challenge · Proschi practice';
  }, []);

  /** Signed in: sends answers; the result kept (also when one was kept already), or the error. */
  const submit = useCallback(async (day: string, answers: ChallengeAnswerItem[]): Promise<ChallengeAttemptAnswer> => {
    try {
      return await api<ChallengeAttemptAnswer>('/api/challenge/today/attempt', { method: 'POST', body: { day, answers } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === 'object' && 'attempt' in e.body && (e.body as ChallengeAttemptAnswer).attempt) {
        return e.body as ChallengeAttemptAnswer;
      }
      throw e;
    }
  }, []);

  /** After a challenge: the streak and new badges again once the server has its reviews. */
  const afterwards = useCallback(() => {
    const flushed = store?.kind === 'account' ? store.flush().catch(() => undefined) : Promise.resolve();
    void flushed.then(() => {
      refresh();
      notifyActivity();
    });
  }, [store, refresh]);

  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    setSetup({ status: 'loading' });
    const local = () => {
      const day = challengeDay();
      return { day, cards: pickChallenge(deck.cards, day), endsAt: challengeEndsAt(day) };
    };
    void (async () => {
      if (mode === 'local') {
        const today = local();
        setSetup({ status: 'ready', ...today, result: localResults()[today.day], streak: localStreak(today.day) });
        return;
      }
      let answer: ChallengeToday | undefined;
      try {
        answer = await api<ChallengeToday>('/api/challenge/today');
      } catch (e) {
        if (cancelled) return;
        if (mode === 'account') {
          setSetup({ status: 'error', message: signedOutError(e) ? 'Your session has expired; sign in again to play.' : 'Could not reach the server; try again in a moment.' });
          return;
        }
      }
      if (cancelled) return;
      const today = answer ? { day: answer.day, cards: cardsFor(answer.cardIds), endsAt: answer.endsAt } : local();
      if (!today.cards) {
        setSetup({ status: 'error', message: 'Today’s challenge has cards this page does not know yet. Reload the page to get them.' });
        return;
      }
      const guest = guestChallenge();
      const guestToday = guest && guest.result.day === today.day ? guest : undefined;
      if (mode === 'guest') {
        setSetup({ status: 'ready', ...today, cards: today.cards, result: guestToday?.result });
        return;
      }
      // Signed in. Played already, or played signed out before signing in: save that now.
      if (answer?.attempt || !guestToday) {
        if (guest) clearGuestChallenge();
        setSetup({ status: 'ready', ...today, cards: today.cards, result: answer?.attempt ?? undefined, streak: answer?.streak });
        return;
      }
      try {
        const saved = await submit(today.day, guestToday.answers);
        if (store) for (const review of guestToday.reviews) store.add(review);
        clearGuestChallenge();
        afterwards();
        if (!cancelled) setSetup({ status: 'ready', ...today, cards: today.cards, result: saved.attempt, streak: saved.streak });
      } catch {
        if (!cancelled) setSetup({ status: 'ready', ...today, cards: today.cards, result: guestToday.result, streak: answer?.streak, unsaved: guestToday.answers });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, attempt, submit, store, afterwards]);

  /** Every challenge answer is a review of its card too. */
  const guestReviews = useRef<CardReview[]>([]);
  const onReview = useCallback(
    (card: Card, rating: Rating, durationMs: number) => {
      const at = nowSeconds();
      const review: CardReview = { id: reviewId(), cardId: card.id, version: card.version, rating, reviewedAt: at, durationMs: Math.round(durationMs), day: localDay(new Date(at * 1000)) };
      if (store) store.add(review);
      else guestReviews.current.push(review);
    },
    [store],
  );

  if (!mode || setup.status === 'loading') return <PaneLoading label={!mode ? 'Checking your sign-in…' : 'Loading today’s challenge…'} />;

  if (setup.status === 'error') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-14">
        <Heading />
        <section aria-label="Today’s challenge" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
          <p role="alert" className="text-sm text-ink">
            {setup.message}
          </p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-3 ${primaryButton}`}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        </section>
      </main>
    );
  }

  const { day, cards, endsAt } = setup;

  const finish = async (answers: ChallengeAnswerItem[]) => {
    const local = scoreLocally(day, cards, answers);
    setView('intro');
    if (mode === 'local') {
      setSetup({ ...setup, result: saveLocalResult(local), streak: localStreak(day) });
      afterwards();
      return;
    }
    if (mode === 'guest') {
      saveGuestChallenge({ result: local, answers, reviews: guestReviews.current });
      guestReviews.current = [];
      setSetup({ ...setup, result: local });
      return;
    }
    setSubmitting(true);
    try {
      const saved = await submit(day, answers);
      setSetup({ ...setup, result: saved.attempt, streak: saved.streak, unsaved: undefined });
    } catch {
      setSetup({ ...setup, result: local, unsaved: answers });
    } finally {
      setSubmitting(false);
      afterwards();
    }
  };

  const retrySave = async () => {
    if (!setup.unsaved) return;
    setSubmitting(true);
    try {
      const saved = await submit(day, setup.unsaved);
      setSetup({ ...setup, result: saved.attempt, streak: saved.streak, unsaved: undefined });
    } catch {
      // Still unsaved: the button stays.
    } finally {
      setSubmitting(false);
    }
  };

  if (view === 'session') return <ChallengeSession day={day} cards={cards} onReview={onReview} onDone={(answers) => void finish(answers)} />;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href="#/" className={`-ml-2.5 ${toolButton}`}>
          All problems
        </a>
        <a href="#/review" className={toolButton}>
          Daily review
        </a>
      </div>
      <Heading day={day} />
      {submitting ? (
        <PaneLoading label="Scoring your answers…" />
      ) : setup.result ? (
        <Result
          result={setup.result}
          streak={setup.streak}
          mode={mode}
          account={account}
          endsAt={endsAt}
          unsaved={!!setup.unsaved}
          onRetrySave={() => void retrySave()}
        />
      ) : (
        <Intro cards={cards} endsAt={endsAt} streak={setup.streak} mode={mode} onStart={() => setView('session')} />
      )}
      {apiEnabled && <Leaderboard day={day} refresh={setup.result?.score ?? -1} />}
    </main>
  );
}

function Heading({ day }: { day?: string }) {
  return (
    <>
      <h1 className="mt-3 flex items-center gap-2 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">
        <Zap className="h-[0.8em] w-[0.8em] shrink-0" aria-hidden="true" />
        Daily challenge
      </h1>
      {day && <p className="mt-2 font-mono text-sm text-muted">{day} (UTC)</p>}
    </>
  );
}

/** "Next challenge in 5 h 12 min, at 00:00 UTC." */
function NextReset({ endsAt }: { endsAt: number }) {
  const now = useNow();
  return (
    <p className="text-sm text-ink/80">
      A new challenge starts at 00:00 UTC, in <span className="font-semibold tabular-nums">{untilText(endsAt - now)}</span>.
    </p>
  );
}

function ChallengeStreakLine({ streak }: { streak?: ChallengeStreakAnswer }) {
  if (!streak) return null;
  return (
    <div role="group" aria-label="Challenge streak" className="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-full border-bw-1 border-ink bg-surface px-3 py-1 text-sm font-semibold text-ink">
      <Flame size={16} aria-hidden="true" className={streak.current > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted'} />
      {streak.current > 0 ? `${streak.current}-day challenge streak` : 'No challenge streak yet'}
      {streak.longest > streak.current && <span className="font-normal text-muted">· best {streak.longest}</span>}
    </div>
  );
}

function Intro({ cards, endsAt, streak, mode, onStart }: { cards: ChallengeCard[]; endsAt: number; streak?: ChallengeStreakAnswer; mode: Mode; onStart: () => void }) {
  return (
    <section aria-label="Today’s challenge" className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md sm:p-5">
      <p className="text-base text-ink">
        {cards.length} cards, the same for everyone today: pick an option, estimate a number or fill a gap. Only your first attempt counts.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>
          {POINTS_CORRECT} points for each right answer, plus up to {SPEED_BONUS_MAX} for speed: all of it within {SPEED_FULL_MS / 1000} s, fading to none at{' '}
          {SPEED_ZERO_MS / 1000} s. At most {MAX_SCORE} points.
        </li>
        <li>Each answer also counts as a review of its card, toward your daily goal.</li>
        {mode === 'guest' && <li>Signed out, your score stays in this browser; sign in afterwards to save it and join the leaderboard.</li>}
        {mode === 'local' && <li>Your score and challenge streak are kept in this browser.</li>}
      </ul>
      <div className="mt-3">
        <NextReset endsAt={endsAt} />
      </div>
      <ChallengeStreakLine streak={streak} />
      <button type="button" onClick={onStart} disabled={cards.length === 0} className={`mt-4 flex w-full justify-center min-h-[48px] sm:w-auto ${primaryButton}`}>
        Start the challenge
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

/** The five cards, one at a time, with the review page's card view. */
function ChallengeSession({
  day,
  cards,
  onReview,
  onDone,
}: {
  day: string;
  cards: ChallengeCard[];
  onReview: (card: Card, rating: Rating, durationMs: number) => void;
  onDone: (answers: ChallengeAnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const answers = useRef<ChallengeAnswerItem[]>([]);
  const shownAt = useRef(Date.now());
  const current = useRef<{ answer: ChallengeAnswer; ms: number } | undefined>(undefined);
  const card = cards[index];
  const round = challengeRound(day);

  const record = () => {
    const given = current.current;
    answers.current.push({ cardId: card.id, answer: given?.answer ?? null, ms: given ? given.ms : MAX_CARD_MS });
    current.current = undefined;
  };
  const next = (rating: Rating, durationMs: number) => {
    record();
    onReview(card, rating, durationMs);
    if (index + 1 >= cards.length) onDone(answers.current);
    else {
      shownAt.current = Date.now();
      setIndex(index + 1);
    }
  };
  /** Ends early: the card on screen keeps its answer, if given; the rest count as unanswered. */
  const end = () => {
    // An answer on screen not moved on from is still a review of its card.
    if (current.current) onReview(card, autoRating(gradeChallengeAnswer(card, current.current.answer)), current.current.ms);
    record();
    for (const c of cards.slice(index + 1)) answers.current.push({ cardId: c.id, answer: null, ms: MAX_CARD_MS });
    onDone(answers.current);
  };

  if (!card) return null;
  const topic = deck.topics.find((t) => t.id === card.topic);
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="flex items-center gap-3">
        <button type="button" onClick={end} className={`-ml-2.5 ${toolButton}`} aria-describedby="challenge-end-hint">
          <X size={14} aria-hidden="true" />
          End challenge
        </button>
        <span id="challenge-end-hint" className="sr-only">
          Cards not answered count as wrong.
        </span>
        <span className="ml-auto text-sm tabular-nums text-muted">
          {index + 1} of {cards.length}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Challenge progress"
        aria-valuemin={0}
        aria-valuemax={cards.length}
        aria-valuenow={index}
        className="mt-2 h-2.5 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
      >
        <div className="h-full bg-pop-pink transition-[width] duration-d2" style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>
      <CardView
        key={`${index}-${card.id}`}
        card={card}
        isNew={false}
        topic={topic?.title ?? card.topic}
        position={`Challenge card ${index + 1} of ${cards.length}`}
        round={round}
        onAnswer={(answer) => {
          current.current ??= { answer, ms: Date.now() - shownAt.current };
        }}
        onRate={next}
      />
    </main>
  );
}

/** The marks of a result: ✅ for right, ❌ for wrong. */
function Marks({ results }: { results: ChallengeResult['results'] }) {
  return (
    <p className="mt-1 text-2xl tracking-[0.15em]">
      <span aria-hidden="true">{results.map((r) => (r.correct ? '✅' : '❌')).join('')}</span>
      <span className="sr-only">{results.map((r, i) => `Card ${i + 1} ${r.correct ? 'right' : 'wrong'}`).join(', ')}</span>
    </p>
  );
}

function Result({
  result,
  streak,
  mode,
  account,
  endsAt,
  unsaved,
  onRetrySave,
}: {
  result: ChallengeResult;
  streak?: ChallengeStreakAnswer;
  mode: Mode;
  account: Account;
  endsAt: number;
  unsaved: boolean;
  onRetrySave: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const text = shareText(
    result.day,
    result.score,
    result.results.map((r) => r.correct),
  );
  const [copied, setCopied] = useState<'yes' | 'no' | undefined>(undefined);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (result.perfect && box.current) {
      // Pop-ups wait for this moment to pass; celebrate() does nothing under reduced motion.
      announceCelebration();
      void celebrate(box.current, { count: 28 });
    }
  }, [result.perfect]);
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  const bonus = result.results.reduce((n, r) => n + r.bonus, 0);

  return (
    <>
      <section
        ref={box}
        aria-label="Your result"
        className={`mt-6 rounded-brutal border-bw-2 border-ink p-4 shadow-brutal-md sm:p-5 motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)] ${result.perfect ? 'bg-pop-yellow/30' : 'bg-surface'}`}
      >
        <h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 font-display text-xl font-bold text-ink focus:outline-none">
          {result.perfect ? <PartyPopper size={18} aria-hidden="true" /> : <Trophy size={18} aria-hidden="true" />}
          {result.perfect ? 'Perfect score!' : 'Challenge done'}
        </h2>
        <p className="mt-2 font-display text-4xl font-extrabold tabular-nums text-ink">
          {result.score}
          <span className="text-xl font-bold text-muted"> / {result.maxScore}</span>
        </p>
        <Marks results={result.results} />
        <p className="mt-2 text-sm text-ink/80">
          {result.correct} of {result.results.length} right: {result.correct * POINTS_CORRECT} points, and {bonus} for speed.
        </p>
        {mode === 'account' && result.rank !== undefined && result.players !== undefined && (
          <p className="mt-2 text-base font-semibold text-ink">
            Rank {result.rank} of {result.players} {result.players === 1 ? 'player' : 'players'} today
          </p>
        )}
        {unsaved && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
            Not saved yet: the server could not be reached.{' '}
            <button type="button" onClick={onRetrySave} className="font-semibold underline">
              Try again
            </button>
          </p>
        )}
        {mode === 'local' && <p className="mt-2 text-sm text-muted">Scored in this browser.</p>}
        <ChallengeStreakLine streak={streak} />

        <div className="mt-4">
          <p className={eyebrow}>Share</p>
          <p id="challenge-share-text" className="mt-1 break-words rounded border-bw-1 border-ink/30 bg-paper px-3 py-2 font-mono text-sm text-ink">
            {text}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyText(text).then((ok) => setCopied(ok ? 'yes' : 'no'))}
              aria-describedby="challenge-share-text"
              className={`min-h-[44px] ${outlineButton}`}
            >
              {copied === 'yes' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              Copy result
            </button>
            <span role="status" className="text-sm text-muted">
              {copied === 'yes' ? 'Copied to the clipboard.' : copied === 'no' ? 'Could not copy; select the text above instead.' : ''}
            </span>
          </div>
        </div>
        <div className="mt-4">
          <NextReset endsAt={endsAt} />
        </div>
      </section>

      {mode === 'guest' && (
        <section aria-label="Sign in to save your score" className="mt-6 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md">
          <p className="font-semibold text-ink">Save your score</p>
          <p className="mt-1 text-sm text-ink/80">
            This score is kept in this browser only. Sign in to save it to your account, appear on today’s leaderboard and keep a challenge streak.
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
      )}

      <Breakdown result={result} />
    </>
  );
}

/** The question of a card as the breakdown shows it: a cloze card's text with its answers filled in. */
const questionOf = (card: ChallengeCard) => (card.type === 'cloze' ? clozeWithAnswers(card) : card.question);

function Breakdown({ result }: { result: ChallengeResult }) {
  return (
    <section aria-labelledby="challenge-answers" className="mt-8">
      <h2 id="challenge-answers" className="font-display text-xl font-bold text-ink">
        The answers
      </h2>
      <ol className="mt-3 space-y-3">
        {result.results.map((r, i) => {
          const card = cardsById.get(r.cardId);
          if (!card || !isChallengeCard(card)) return null;
          return (
            <li key={r.cardId} className="rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-sm" data-correct={r.correct}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span aria-hidden="true">{r.correct ? '✅' : '❌'}</span>
                <span className="sr-only">{r.correct ? 'Right:' : 'Wrong:'}</span>
                <span className={eyebrow}>
                  {i + 1} · {deck.topics.find((t) => t.id === card.topic)?.title ?? card.topic} · {TYPE_LABEL[card.type]}
                </span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-ink">
                  {r.points} {r.points === 1 ? 'point' : 'points'}
                  {r.correct && (
                    <span className="font-normal text-muted">
                      {' '}
                      ({POINTS_CORRECT} + {r.bonus} speed)
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2">
                <Markdown source={questionOf(card)} />
              </div>
              <dl className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="font-semibold text-ink">Your answer</dt>
                <dd className={`[overflow-wrap:anywhere] ${r.correct ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-300'}`}>
                  <InlineMarkdown source={describeAnswer(card, r.answer)} />
                  {r.answer !== null && <span className="text-muted"> · {r.ms >= MAX_CARD_MS ? 'over an hour' : `${(r.ms / 1000).toFixed(1)} s`}</span>}
                </dd>
                <dt className="font-semibold text-ink">Right answer</dt>
                <dd className="[overflow-wrap:anywhere] text-ink">
                  <InlineMarkdown source={describeRightAnswer(card)} />
                </dd>
              </dl>
              {(card.why || card.type === 'estimate') && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-semibold text-ink">Why</summary>
                  <div className="mt-2 space-y-2">
                    {card.type === 'estimate' && <Markdown source={card.solution} />}
                    {card.why && <Markdown source={card.why} />}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The day's leaderboard: those who opted in, ranked among everyone, and your own rank signed in. */
function Leaderboard({ day, refresh }: { day: string; refresh: number }) {
  const [board, setBoard] = useState<ChallengeLeaderboard | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    // Without an answer (offline, rate limited) the section stays hidden.
    api<ChallengeLeaderboard>(`/api/challenge/leaderboard?day=${encodeURIComponent(day)}`).then(
      (b) => !cancelled && setBoard(b),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [day, refresh]);
  if (!board) return null;
  return (
    <section aria-labelledby="challenge-leaderboard" className="mt-8">
      <h2 id="challenge-leaderboard" className="flex items-center gap-2 font-display text-xl font-bold text-ink">
        <Trophy size={18} aria-hidden="true" className="text-amber-500 dark:text-amber-400" />
        Today’s leaderboard
      </h2>
      <p className="mt-1 text-sm text-muted">
        {board.players} {board.players === 1 ? 'player' : 'players'} so far. Only those who chose “Show me on the leaderboard” in the account menu are listed.
      </p>
      {board.you && (
        <p className="mt-2 text-sm font-semibold text-ink">
          You: rank {board.you.rank} of {board.you.players}, {board.you.score} points
        </p>
      )}
      {board.entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nobody listed yet today.</p>
      ) : (
        <ol className="mt-3 divide-y divide-ink/15 rounded-lg border border-ink/15 bg-surface text-sm">
          {board.entries.map((e, i) => (
            <li key={`${e.rank}-${e.displayName}-${i}`} className="flex items-center gap-3 px-4 py-2">
              <span className="w-6 text-right tabular-nums text-muted">{e.rank}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{e.displayName}</span>
              <span className="hidden tabular-nums text-ink/75 sm:inline">
                <span aria-hidden="true">{'✅'.repeat(Math.min(e.correct, CHALLENGE_SIZE))}</span>
                <span className="sr-only">
                  {e.correct} of {CHALLENGE_SIZE} right
                </span>
              </span>
              <span className="w-16 text-right font-semibold tabular-nums text-ink">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
