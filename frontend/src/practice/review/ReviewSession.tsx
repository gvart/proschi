import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, X, XCircle } from 'lucide-react';
import type { Card, ChoiceCard, ClozeCard, EstimateCard, FlipCard, Topic } from '../../learn/cards';
import { previewIntervals, RATINGS, type CardState, type Rating } from '../../learn/fsrs';
import { formatFactor, formatNumber, gradeClozeAnswers, gradeEstimateAnswer, optionOrder, parseNumber } from '../../learn/grade';
import { autoRating, formatInterval, type SessionItem } from '../../learn/review';
import Markdown, { InlineMarkdown } from '../Markdown';
import { eyebrow, field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';

/** One answered card of a session, for the summary. */
export interface SessionResult {
  cardId: string;
  rating: Rating;
}

interface SessionProps {
  items: SessionItem[];
  states: Record<string, CardState>;
  topics: Topic[];
  /** Called once per card with the rating and the time from showing the card to answering it. */
  onReview: (card: Card, rating: Rating, durationMs: number) => void;
  onDone: (results: SessionResult[]) => void;
  onQuit: (results: SessionResult[]) => void;
}

const TYPE_LABEL: Record<Card['type'], string> = { flip: 'Recall', choice: 'Pick one', estimate: 'Estimate', cloze: 'Fill the gaps' };

/** A review session: one card at a time, each rated, then the summary. */
export default function ReviewSession({ items, states, topics, onReview, onDone, onQuit }: SessionProps) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<SessionResult[]>([]);
  const item = items[index];

  const rate = (rating: Rating, durationMs: number) => {
    onReview(item.card, rating, durationMs);
    const next = [...results, { cardId: item.card.id, rating }];
    setResults(next);
    if (index + 1 >= items.length) onDone(next);
    else setIndex(index + 1);
  };

  if (!item) return null;
  const topic = topics.find((t) => t.id === item.card.topic);
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onQuit(results)} className={`-ml-2.5 ${toolButton}`}>
          <X size={14} aria-hidden="true" />
          End session
        </button>
        <span className="ml-auto text-sm tabular-nums text-muted">
          {index + 1} of {items.length}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Session progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={index}
        className="mt-2 h-2.5 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
      >
        <div className="h-full bg-pass transition-[width] duration-d2" style={{ width: `${(index / items.length) * 100}%` }} />
      </div>
      <CardView
        key={`${index}-${item.card.id}`}
        card={item.card}
        isNew={item.isNew}
        topic={topic?.title ?? item.card.topic}
        state={states[item.card.id]}
        position={`Card ${index + 1} of ${items.length}`}
        onRate={rate}
      />
    </main>
  );
}

/** Keys typed into a field or on a button belong to it, not to the shortcuts. */
function ownKey(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return e.altKey || e.ctrlKey || e.metaKey || !!el?.closest('input, textarea, select, button, a, [contenteditable="true"]');
}

/** Shortcuts while a card is shown; `handlers` maps a key (e.key) to its action. */
function useKeys(handlers: Record<string, (() => void) | undefined>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ownKey(e)) return;
      const handler = ref.current[e.key];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

interface CardViewProps {
  card: Card;
  isNew: boolean;
  topic: string;
  state?: CardState;
  position: string;
  onRate: (rating: Rating, durationMs: number) => void;
}

/** An auto-graded card's outcome once answered: right or wrong, and the explanation to show. */
interface Outcome {
  correct: boolean;
  feedback: ReactNode;
  /** Shown under the feedback: the solution and the card's Why. */
  explanation?: ReactNode;
}

function CardView({ card, isNew, topic, state, position, onRate }: CardViewProps) {
  const shownAt = useRef(Date.now());
  const answeredAfter = useRef<number | undefined>(undefined);
  const box = useRef<HTMLElement>(null);
  // The new card is announced to screen readers and takes keyboard focus from the last one's buttons.
  useEffect(() => box.current?.focus({ preventScroll: true }), []);
  const answered = () => {
    answeredAfter.current ??= Date.now() - shownAt.current;
  };
  const rate = (rating: Rating) => onRate(rating, answeredAfter.current ?? Date.now() - shownAt.current);

  return (
    <article
      ref={box}
      tabIndex={-1}
      aria-label={position}
      data-card-type={card.type}
      className="mt-5 rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md focus:outline-none"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b-bw-1 border-ink px-4 py-2.5 sm:px-5">
        <span className={eyebrow}>{topic}</span>
        <span className="text-muted" aria-hidden="true">
          ·
        </span>
        <span className={eyebrow}>{TYPE_LABEL[card.type]}</span>
        {isNew && <span className="ml-auto rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 text-[11px] font-bold text-on-accent">New</span>}
      </div>
      <div className="p-4 sm:p-5">
        {card.type === 'flip' ? (
          <FlipBody card={card} state={state} onShow={answered} onRate={rate} />
        ) : card.type === 'choice' ? (
          <ChoiceBody card={card} round={state?.reps ?? 0} onAnswer={answered} onRate={rate} />
        ) : card.type === 'estimate' ? (
          <EstimateBody card={card} onAnswer={answered} onRate={rate} />
        ) : (
          <ClozeBody card={card} onAnswer={answered} onRate={rate} />
        )}
      </div>
    </article>
  );
}

const RATING_LABEL: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
const RATING_TONE: Record<Rating, string> = { 1: 'bg-pop-pink/40', 2: 'bg-surface', 3: 'bg-pass/30', 4: 'bg-pop-blue/25' };
const ratingButton =
  'flex min-h-[52px] flex-col items-center justify-center rounded border-bw-1 border-ink px-1 py-1.5 text-sm font-bold text-ink shadow-brutal-sm transition-[transform,box-shadow] duration-d1 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-md active:translate-x-0.5 active:translate-y-0.5 active:shadow-none';

function Why({ card }: { card: Card }) {
  if (!card.why) return null;
  return (
    <div className="mt-4 rounded border-bw-1 border-ink/30 bg-paper p-3">
      <p className={eyebrow}>Why</p>
      <div className="mt-1">
        <Markdown source={card.why} />
      </div>
    </div>
  );
}

/** A focusable region for what is revealed after answering, so it is read out and keyboard focus lands there. */
function Revealed({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div ref={ref} tabIndex={-1} role="region" aria-label={label} className="mt-4 border-t-bw-1 border-dashed border-ink/40 pt-4 focus:outline-none">
      {children}
    </div>
  );
}

function FlipBody({ card, state, onShow, onRate }: { card: FlipCard; state?: CardState; onShow: () => void; onRate: (r: Rating) => void }) {
  const [shown, setShown] = useState(false);
  const hints = useMemo(() => previewIntervals(state, Math.floor(Date.now() / 1000), card.version), [state, card.version]);
  const show = () => {
    onShow();
    setShown(true);
  };
  useKeys(shown ? { 1: () => onRate(1), 2: () => onRate(2), 3: () => onRate(3), 4: () => onRate(4) } : { ' ': show, Enter: show });

  return (
    <>
      <Markdown source={card.front} large />
      {!shown ? (
        <button type="button" onClick={show} className={`mt-5 w-full justify-center min-h-[48px] ${primaryButton}`}>
          Show answer
        </button>
      ) : (
        <>
          <Revealed label="Answer">
            <Markdown source={card.back} large />
            <Why card={card} />
          </Revealed>
          <p className="mt-5 text-sm text-ink/80">How well did you remember it?</p>
          <div className="mt-2 grid grid-cols-4 gap-2" role="group" aria-label="Rate your recall">
            {RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRate(r)}
                className={`${ratingButton} ${RATING_TONE[r]}`}
                aria-label={`${RATING_LABEL[r]}, next in ${formatInterval(hints[r])}`}
                title={`Key ${r}`}
              >
                {RATING_LABEL[r]}
                <span className="text-xs font-normal tabular-nums text-ink/75">{formatInterval(hints[r])}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** After an automatically graded answer: right or wrong, the explanation, and Next (or Easy, when it was right). */
function Graded({ outcome, onRate }: { outcome: Outcome; onRate: (r: Rating) => void }) {
  useKeys({ Enter: () => onRate(autoRating(outcome.correct)), ' ': () => onRate(autoRating(outcome.correct)) });
  return (
    <Revealed label={outcome.correct ? 'Correct' : 'Not quite'}>
      <p className={`flex items-start gap-2 font-semibold ${outcome.correct ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-300'}`}>
        {outcome.correct ? <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : <XCircle size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
        <span>{outcome.feedback}</span>
      </p>
      {outcome.explanation}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onRate(autoRating(outcome.correct))} className={`flex-1 justify-center min-h-[48px] ${primaryButton}`}>
          Next
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        {outcome.correct && (
          <button type="button" onClick={() => onRate(autoRating(true, true))} className={`justify-center min-h-[48px] ${outlineButton}`} title="It was easy: see it again later than usual">
            Too easy
          </button>
        )}
      </div>
    </Revealed>
  );
}

function ChoiceBody({ card, round, onAnswer, onRate }: { card: ChoiceCard; round: number; onAnswer: () => void; onRate: (r: Rating) => void }) {
  const order = useMemo(() => optionOrder(card, round), [card, round]);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const pick = (i: number) => {
    if (picked !== undefined) return;
    onAnswer();
    setPicked(i);
  };
  useKeys(picked === undefined ? Object.fromEntries(order.map((option, n) => [String(n + 1), () => pick(option)])) : {});
  const correct = picked !== undefined && card.options[picked].correct;

  return (
    <>
      <Markdown source={card.question} large />
      <ul className="mt-4 space-y-2">
        {order.map((i, n) => {
          const option = card.options[i];
          const state = picked === undefined ? 'open' : option.correct ? 'right' : i === picked ? 'wrong' : 'other';
          const tone = { open: 'bg-surface hover:bg-pop-yellow/25', right: 'bg-pass/30', wrong: 'bg-pop-pink/40', other: 'bg-surface opacity-70' }[state];
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(i)}
                disabled={picked !== undefined}
                className={`flex w-full min-h-[48px] items-start gap-3 rounded border-bw-1 border-ink px-3 py-2.5 text-left text-sm text-ink shadow-brutal-sm transition-[background-color] duration-d1 [overflow-wrap:anywhere] disabled:cursor-default ${tone}`}
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm border-bw-1 border-ink/40 font-mono text-[11px] text-muted" aria-hidden="true">
                  {state === 'right' ? <Check size={12} /> : state === 'wrong' ? <X size={12} /> : n + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <InlineMarkdown source={option.text} />
                  {state === 'right' && <span className="sr-only"> (the right answer)</span>}
                  {state === 'wrong' && <span className="sr-only"> (your answer)</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked !== undefined && (
        <Graded outcome={{ correct, feedback: correct ? 'Correct.' : 'Not quite: the right answer is marked.', explanation: <Why card={card} /> }} onRate={onRate} />
      )}
    </>
  );
}

function EstimateBody({ card, onAnswer, onRate }: { card: EstimateCard; onAnswer: () => void; onRate: (r: Rating) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [value, setValue] = useState<number | undefined>(undefined);
  const check = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseNumber(text);
    if (parsed === undefined || !(parsed > 0)) {
      setError('Enter a number above 0, for example 2300, 2,300, 2.3k or 1e6.');
      return;
    }
    onAnswer();
    setError(undefined);
    setValue(parsed);
  };
  const answer = `${formatNumber(card.answer)} ${card.unit}`;
  const result = value !== undefined ? gradeEstimateAnswer(card, value) : undefined;

  return (
    <>
      <Markdown source={card.question} large />
      <form onSubmit={check} className="mt-4">
        <label htmlFor={`estimate-${card.id}`} className="text-sm font-semibold text-ink">
          Your estimate
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id={`estimate-${card.id}`}
            type="text"
            inputMode="text"
            autoComplete="off"
            enterKeyHint="done"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={value !== undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={`estimate-${card.id}-hint`}
            placeholder="e.g. 2.3k"
            className={`w-40 min-h-[44px] text-base ${field}`}
          />
          <span className="text-sm text-ink/80">{card.unit}</span>
          {value === undefined && (
            <button type="submit" className={`min-h-[44px] ${primaryButton}`}>
              Check
            </button>
          )}
        </div>
        <p id={`estimate-${card.id}-hint`} className={`mt-1 text-xs ${error ? 'text-red-700 dark:text-red-300' : 'text-muted'}`} role={error ? 'alert' : undefined}>
          {error ?? `Within ${formatFactor(card.tolerance)}× of the answer counts as right.`}
        </p>
      </form>
      {result && (
        <Graded
          outcome={{
            correct: result.correct,
            feedback: result.correct
              ? `Close enough: the answer is ${answer}.`
              : `About ${formatFactor(result.factor)}× too ${result.direction === 'high' ? 'high' : 'low'}: the answer is ${answer}.`,
            explanation: (
              <>
                <div className="mt-3">
                  <p className={eyebrow}>Solution</p>
                  <div className="mt-1">
                    <Markdown source={card.solution} />
                  </div>
                </div>
                <Why card={card} />
              </>
            ),
          }}
          onRate={onRate}
        />
      )}
    </>
  );
}

/** A cloze card's text with each gap shown as a numbered blank, or filled with its first answer. */
function clozeSource(card: ClozeCard, filled: boolean): string {
  return filled ? card.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `**${card.blanks[Number(n)]?.[0] ?? ''}**`) : card.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `**[ ${Number(n) + 1} ]**`);
}

function ClozeBody({ card, onAnswer, onRate }: { card: ClozeCard; onAnswer: () => void; onRate: (r: Rating) => void }) {
  const [typed, setTyped] = useState<string[]>(() => card.blanks.map(() => ''));
  const [result, setResult] = useState<{ correct: boolean; gaps: boolean[]; gaveUp: boolean } | undefined>(undefined);
  const check = (e: FormEvent) => {
    e.preventDefault();
    onAnswer();
    setResult({ ...gradeClozeAnswers(card, typed), gaveUp: false });
  };
  const giveUp = () => {
    onAnswer();
    setResult({ correct: false, gaps: card.blanks.map(() => false), gaveUp: true });
  };

  return (
    <>
      <Markdown source={clozeSource(card, !!result)} large />
      <form onSubmit={check} className="mt-4 space-y-3">
        {card.blanks.map((answers, i) => (
          <div key={i}>
            <label htmlFor={`gap-${card.id}-${i}`} className="text-sm font-semibold text-ink">
              Gap {i + 1}
            </label>
            <input
              id={`gap-${card.id}-${i}`}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              enterKeyHint={i === card.blanks.length - 1 ? 'done' : 'next'}
              spellCheck={false}
              value={typed[i]}
              readOnly={!!result}
              onChange={(e) => setTyped(typed.map((t, j) => (j === i ? e.target.value : t)))}
              className={`mt-1 block w-full min-h-[44px] text-base ${field}`}
            />
            {result && !result.gaveUp && (
              <p className={`mt-1 text-xs font-semibold ${result.gaps[i] ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-300'}`}>
                {result.gaps[i] ? 'Right' : `Expected: ${answers[0]}`}
                {answers.length > 1 && <span className="font-normal text-muted"> (also accepted: {answers.slice(1).join(', ')})</span>}
              </p>
            )}
          </div>
        ))}
        {!result && (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={`flex-1 justify-center min-h-[48px] ${primaryButton}`}>
              Check
            </button>
            <button type="button" onClick={giveUp} className={`justify-center min-h-[48px] ${outlineButton}`}>
              Show answer
            </button>
          </div>
        )}
      </form>
      {result && (
        <Graded
          outcome={{
            correct: result.correct,
            feedback: result.correct ? 'Correct.' : result.gaveUp ? 'The answers are filled in above; the card comes back soon.' : 'Not quite: see the expected answers above.',
            explanation: <Why card={card} />,
          }}
          onRate={onRate}
        />
      )}
    </>
  );
}
