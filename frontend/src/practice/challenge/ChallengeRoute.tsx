import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, LogIn, PartyPopper, RotateCcw, Trophy, X, Zap } from 'lucide-react';
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
  type ChallengeAnswerItem,
  type ChallengeCard,
} from '../../learn/challenge';
import { autoRating, localDay, type CardReview } from '../../learn/review';
import { addDays } from '../../learn/streak';
import { celebrate } from '../../design/celebrate';
import { copyText } from '../../services/share';
import { track } from '../../services/metrics';
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
  challengeProgress,
  clearChallengeProgress,
  clearGuestChallenge,
  guestChallenge,
  localResults,
  localStreak,
  saveChallengeProgress,
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
      /** Answers given before a reload: the challenge resumes after them. */
      resume?: ChallengeAnswerItem[];
      /** Signed in: when the challenge's first card was shown, on any device (null before). */
      startedAt?: number | null;
    };

/** A challenge in progress at midnight is still sent for yesterday this long after 00:00 UTC, as the server allows. */
const GRACE_SECONDS = 15 * 60;

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
  /** Whose challenge in progress this browser keeps. */
  const owner = mode === 'account' ? (userId ?? 'account') : (mode ?? 'loading');

  useEffect(() => {
    document.title = 'Daily challenge · Proschi practice';
  }, []);

  /**
   * Signed in: sends answers, with the local date they were given on (for
   * the daily streak); the result kept (also when one was kept already), or
   * the error.
   */
  const submit = useCallback(async (day: string, answers: ChallengeAnswerItem[], playedOn: string = localDay(new Date())): Promise<ChallengeAttemptAnswer> => {
    try {
      return await api<ChallengeAttemptAnswer>('/api/challenge/today/attempt', { method: 'POST', body: { day, answers, localDay: playedOn } });
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

  /** Signed in: records that the first card is shown (once a day; a reload or another device keeps the first time). */
  const recordStart = useCallback((day: string) => {
    if (mode === 'account') void api('/api/challenge/today/start', { method: 'POST', body: { day } }).catch(() => undefined);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    /**
     * Today's challenge in progress in this browser, to resume. One of
     * another day is dropped, or, within GRACE_SECONDS of midnight, sent for
     * yesterday as it stands (signed in or without accounts).
     */
    const inProgress = async (day: string, played: boolean): Promise<ChallengeAnswerItem[] | undefined> => {
      const p = challengeProgress(owner);
      if (!p) return undefined;
      if (p.day === day && !played) {
        // Answers given but not moved on from before the reload are reviews too.
        const cards = cardsFor(p.answers.map((a) => a.cardId)) ?? [];
        guestReviews.current = p.reviews;
        p.answers.slice(p.reviewed).forEach((a, i) => {
          const card = cards[p.reviewed + i];
          if (card) onReview(card, autoRating(gradeChallengeAnswer(card, a.answer)), a.ms);
        });
        saveChallengeProgress(owner, { ...p, reviewed: p.answers.length, reviews: guestReviews.current });
        return p.answers;
      }
      clearChallengeProgress(owner);
      const inGrace = p.day === addDays(day, -1) && nowSeconds() - Date.parse(`${day}T00:00:00Z`) / 1000 < GRACE_SECONDS;
      if (inGrace && mode !== 'guest') {
        const cards = pickChallenge(deck.cards, p.day);
        const all = [...p.answers, ...cards.slice(p.answers.length).map((c) => ({ cardId: c.id, answer: null, ms: 0 }))];
        if (mode === 'local') saveLocalResult(scoreLocally(p.day, cards, all));
        else await submit(p.day, all).catch(() => undefined);
      }
      return undefined;
    };
    /** Ready; straight back into the session when resuming. */
    const ready = (next: Extract<Setup, { status: 'ready' }>) => {
      if (cancelled) return;
      setSetup(next);
      if (next.resume && !next.result) {
        recordStart(next.day);
        setView('session');
      }
    };
    setSetup({ status: 'loading' });
    const local = () => {
      const day = challengeDay();
      return { day, cards: pickChallenge(deck.cards, day), endsAt: challengeEndsAt(day) };
    };
    void (async () => {
      if (mode === 'local') {
        const today = local();
        const result = localResults()[today.day];
        const resume = await inProgress(today.day, !!result);
        ready({ status: 'ready', ...today, result: localResults()[today.day], streak: localStreak(today.day), resume });
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
        const resume = await inProgress(today.day, !!guestToday);
        ready({ status: 'ready', ...today, cards: today.cards, result: guestToday?.result, resume });
        return;
      }
      // Signed in. Played already, or played signed out before signing in: save that now.
      if (answer?.attempt || !guestToday) {
        if (guest) clearGuestChallenge();
        const resume = await inProgress(today.day, !!answer?.attempt);
        ready({ status: 'ready', ...today, cards: today.cards, result: answer?.attempt ?? undefined, streak: answer?.streak, startedAt: answer?.startedAt, resume });
        return;
      }
      clearChallengeProgress(owner);
      try {
        const saved = await submit(today.day, guestToday.answers, guestToday.result.localDay);
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
  }, [mode, owner, attempt, submit, store, afterwards, onReview, recordStart]);

  if (!mode || setup.status === 'loading') return <PaneLoading label={!mode ? 'Checking your sign-in…' : 'Loading today’s challenge…'} />;

  if (setup.status === 'error') {
    return (
      <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
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
    track('challenge_complete');
    clearChallengeProgress(owner);
    setSetup({ ...setup, resume: undefined });
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

  if (view === 'session') {
    return (
      <ChallengeSession
        day={day}
        cards={cards}
        initial={setup.resume ?? []}
        onReview={onReview}
        onProgress={(answers, reviewed) => saveChallengeProgress(owner, { day, answers, reviewed, reviews: guestReviews.current })}
        onDone={(answers) => void finish(answers)}
      />
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      {/* The practice hub's tabs lead to daily review and the rest. */}
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
        <Intro
          cards={cards}
          endsAt={endsAt}
          streak={setup.streak}
          mode={mode}
          startedAt={setup.startedAt ?? undefined}
          onStart={() => {
            recordStart(day);
            setView('session');
          }}
        />
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

/**
 * The challenge streak, as a sub-stat: the daily streak (the flame at the
 * top of interview prep) is the one streak, and a completed challenge keeps
 * it like any other practice. This counts only challenge days in a row (UTC
 * days, no freezes), for the challenge badges and the profile.
 */
function ChallengeStreakLine({ streak }: { streak?: ChallengeStreakAnswer }) {
  if (!streak) return null;
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  return (
    <p role="group" aria-label="Challenge streak" className="mt-3 text-sm text-ink/80">
      <span className="font-semibold text-ink">Challenge:</span> {streak.current > 0 ? `${days(streak.current)} in a row` : 'no days in a row yet'}
      {streak.longest > streak.current && <span className="text-muted"> · best {days(streak.longest)}</span>}
    </p>
  );
}

function Intro({
  cards,
  endsAt,
  streak,
  mode,
  startedAt,
  onStart,
}: {
  cards: ChallengeCard[];
  endsAt: number;
  streak?: ChallengeStreakAnswer;
  mode: Mode;
  /** Signed in: started already, on another device or before this browser's storage was cleared. */
  startedAt?: number;
  onStart: () => void;
}) {
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
        <li>Finishing it meets your daily goal and keeps your streak, and each answer also counts as a review of its card.</li>
        {mode === 'guest' && <li>Signed out, your score stays in this browser; sign in afterwards to save it and join the leaderboard.</li>}
        {mode === 'local' && <li>Your scores are kept in this browser.</li>}
      </ul>
      <div className="mt-3">
        <NextReset endsAt={endsAt} />
      </div>
      <ChallengeStreakLine streak={streak} />
      {startedAt !== undefined && (
        <p className="mt-3 text-sm font-semibold text-ink">
          You started today’s challenge at {new Date(startedAt * 1000).toISOString().slice(11, 16)} UTC, maybe on another device. Its answers are not in this
          browser, so it starts again from the first card.
        </p>
      )}
      <button type="button" onClick={onStart} disabled={cards.length === 0} className={`mt-4 flex w-full justify-center min-h-[48px] sm:w-auto ${primaryButton}`}>
        {startedAt !== undefined ? 'Continue the challenge' : 'Start the challenge'}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

/**
 * The five cards, one at a time, with the review page's card view. Each
 * answer is kept the moment it is given (`onProgress`), so a reload resumes
 * at the next card unanswered, never replaying one whose answer was shown.
 */
function ChallengeSession({
  day,
  cards,
  initial,
  onReview,
  onProgress,
  onDone,
}: {
  day: string;
  cards: ChallengeCard[];
  /** Answers given before a reload, the first cards' in order. */
  initial: ChallengeAnswerItem[];
  onReview: (card: Card, rating: Rating, durationMs: number) => void;
  /** The answers so far, and how many of them were reviewed (moved on from). */
  onProgress: (answers: ChallengeAnswerItem[], reviewed: number) => void;
  onDone: (answers: ChallengeAnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(() => Math.min(initial.length, cards.length));
  const answers = useRef<ChallengeAnswerItem[]>(initial.slice(0, cards.length));
  const shownAt = useRef(Date.now());
  const card = cards[index];
  const round = challengeRound(day);
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone(answers.current);
  }, [onDone]);
  // Every card was answered before a reload: straight to the result.
  useEffect(() => {
    if (index >= cards.length) finish();
  }, [index, cards.length, finish]);

  const next = (rating: Rating, durationMs: number) => {
    onReview(card, rating, durationMs);
    onProgress(answers.current, index + 1);
    if (index + 1 >= cards.length) finish();
    else {
      shownAt.current = Date.now();
      setIndex(index + 1);
    }
  };
  /** Ends early: the card on screen keeps its answer, if given; the rest count as unanswered (and score 0). */
  const end = () => {
    const given = answers.current[index];
    // An answer on screen not moved on from is still a review of its card.
    if (given) onReview(card, autoRating(gradeChallengeAnswer(card, given.answer)), given.ms);
    for (const c of cards.slice(answers.current.length)) answers.current.push({ cardId: c.id, answer: null, ms: 0 });
    finish();
  };

  if (!card) return null;
  const topic = deck.topics.find((t) => t.id === card.topic);
  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
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
          if (answers.current.length > index) return;
          answers.current.push({ cardId: card.id, answer, ms: Date.now() - shownAt.current });
          onProgress(answers.current, index);
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
            This score is kept in this browser only. Sign in to save it to your account, appear on today’s leaderboard and keep your daily streak.
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
          {board.entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#/u/${encodeURIComponent(e.id)}`}
                aria-label={`${e.displayName}: rank ${e.rank}, ${e.score} points, ${e.correct} of ${CHALLENGE_SIZE} right. See their profile`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-pop-yellow/25 focus-visible:outline-none focus-visible:bg-pop-yellow/25"
              >
                <span className="w-6 text-right tabular-nums text-muted">{e.rank}</span>
                <span className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:underline">{e.displayName}</span>
                <span className="hidden tabular-nums text-ink/75 sm:inline" aria-hidden="true">
                  {'✅'.repeat(Math.min(e.correct, CHALLENGE_SIZE))}
                </span>
                <span className="w-16 text-right font-semibold tabular-nums text-ink">{e.score}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
