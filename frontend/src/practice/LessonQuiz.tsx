import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import deck from 'virtual:practice-cards';
import Markdown, { InlineMarkdown } from './Markdown';
import { clozeWithAnswers, type Card, type ChoiceCard, type ClozeCard, type EstimateCard, type FlipCard } from '../learn/cards';
import { formatFactor, formatNumber, gradeClozeAnswers, gradeEstimateAnswer, optionOrder, parseNumber } from '../learn/grade';
import { eyebrow, field, outlineButton, primaryButton } from '../components/Playground/ui';

/**
 * A lesson's ```quiz block: review cards answered right in the lesson, graded
 * on the spot with the card's explanation. Practice only: answers are not
 * reviews, so they leave the review schedule as it is.
 */
export default function LessonQuiz({ ids }: { ids: string[] }) {
  const cards = useMemo(() => {
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter((c): c is Card => c !== undefined && !c.retired);
  }, [ids]);
  if (!cards.length) return null;
  return (
    <section aria-label="Quick check" data-block="quiz" className="space-y-3 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
        <CircleHelp size={14} aria-hidden="true" />
        Quick check
        {cards.length > 1 && <span className="font-normal normal-case tracking-normal text-muted">· {cards.length} questions</span>}
      </p>
      {cards.map((card, i) => (
        <div key={card.id} data-card-id={card.id} data-card-type={card.type} className={i ? 'border-t-bw-1 border-dashed border-ink/30 pt-3' : ''}>
          <QuizCard card={card} />
        </div>
      ))}
    </section>
  );
}

function QuizCard({ card }: { card: Card }) {
  switch (card.type) {
    case 'flip':
      return <Flip card={card} />;
    case 'choice':
      return <Choice card={card} />;
    case 'estimate':
      return <Estimate card={card} />;
    case 'cloze':
      return <Cloze card={card} />;
  }
}

/** Right or wrong, then what explains it. */
function Verdict({ correct, children, explanation }: { correct: boolean; children: ReactNode; explanation?: ReactNode }) {
  return (
    <div role="status" className="mt-3 space-y-2">
      <p className={`flex items-start gap-2 text-sm font-semibold ${correct ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-300'}`}>
        {correct ? <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : <XCircle size={17} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
        <span>{children}</span>
      </p>
      {explanation}
    </div>
  );
}

function Why({ card }: { card: Card }) {
  if (!card.why) return null;
  return (
    <div className="rounded border-bw-1 border-ink/30 bg-paper p-3">
      <p className={eyebrow}>Why</p>
      <div className="mt-1">
        <Markdown source={card.why} />
      </div>
    </div>
  );
}

function Flip({ card }: { card: FlipCard }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Markdown source={card.front} />
      {shown ? (
        <div role="status" className="mt-3 space-y-2">
          <p className={eyebrow}>Answer</p>
          <Markdown source={card.back} />
          <Why card={card} />
        </div>
      ) : (
        <button type="button" onClick={() => setShown(true)} className={`mt-3 ${outlineButton}`}>
          Think, then show the answer
        </button>
      )}
    </>
  );
}

function Choice({ card }: { card: ChoiceCard }) {
  const order = useMemo(() => optionOrder(card), [card]);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const done = picked !== undefined;
  return (
    <>
      <Markdown source={card.question} />
      <div role="group" aria-label="Options" className="mt-3 grid gap-2">
        {order.map((i) => {
          const option = card.options[i];
          const tone = !done ? 'bg-surface hover:bg-pop-yellow/20' : option.correct ? 'bg-pass/25' : i === picked ? 'bg-pop-pink/30' : 'bg-surface opacity-70';
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              aria-pressed={i === picked}
              onClick={() => setPicked(i)}
              className={`rounded border-bw-1 border-ink px-3 py-2 text-left text-sm text-ink ${tone} disabled:cursor-default`}
            >
              <InlineMarkdown source={option.text} />
            </button>
          );
        })}
      </div>
      {done && (
        <Verdict correct={card.options[picked].correct} explanation={<Why card={card} />}>
          {card.options[picked].correct ? 'Right.' : 'Not quite: the highlighted option is the answer.'}
        </Verdict>
      )}
    </>
  );
}

function Estimate({ card }: { card: EstimateCard }) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState<number | undefined>(undefined);
  const invalid = typed.trim() !== '' && parseNumber(typed) === undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = parseNumber(typed);
    if (n !== undefined) setValue(n);
  };
  const result = value === undefined ? undefined : gradeEstimateAnswer(card, value);
  return (
    <>
      <Markdown source={card.question} />
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Your estimate in {card.unit}
        </label>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          disabled={result !== undefined}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="e.g. 2.5k"
          aria-invalid={invalid}
          className={`w-36 ${field}`}
        />
        <span className="text-sm text-ink/80">{card.unit}</span>
        {result === undefined && (
          <button type="submit" disabled={parseNumber(typed) === undefined} className={`${primaryButton} disabled:opacity-50`}>
            Check
          </button>
        )}
      </form>
      {invalid && <p className="mt-1 text-xs text-muted">A number, like 2300, 2.3k or 5M.</p>}
      {result && (
        <Verdict
          correct={result.correct}
          explanation={
            <>
              <div className="rounded border-bw-1 border-ink/30 bg-paper p-3">
                <p className={eyebrow}>Worked out</p>
                <div className="mt-1">
                  <Markdown source={card.solution} />
                </div>
              </div>
              <Why card={card} />
            </>
          }
        >
          {result.correct ? (result.factor <= 1.1 ? 'Correct' : 'Close enough') : `About ${formatFactor(result.factor)}× too ${result.direction}`}: the answer is about {formatNumber(card.answer)} {card.unit}.
        </Verdict>
      )}
    </>
  );
}

function Cloze({ card }: { card: ClozeCard }) {
  const base = useId();
  const [typed, setTyped] = useState<string[]>(() => card.blanks.map(() => ''));
  const [graded, setGraded] = useState<ReturnType<typeof gradeClozeAnswers> | undefined>(undefined);
  // Each gap shows as its number, filled in the inputs below.
  const prompt = useMemo(() => card.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `**[ ${Number(n) + 1} ]**`), [card.text]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setGraded(gradeClozeAnswers(card, typed));
  };
  return (
    <>
      <Markdown source={prompt} />
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        {card.blanks.map((_, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <label htmlFor={`${base}-${i}`} className="text-sm font-semibold tabular-nums text-ink/80">
              {i + 1}
            </label>
            <input
              id={`${base}-${i}`}
              autoComplete="off"
              value={typed[i]}
              disabled={graded !== undefined}
              onChange={(e) => setTyped((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
              aria-invalid={graded ? !graded.gaps[i] : undefined}
              className={`w-36 ${field}`}
            />
          </span>
        ))}
        {!graded && (
          <button type="submit" disabled={typed.some((t) => !t.trim())} className={`${primaryButton} disabled:opacity-50`}>
            Check
          </button>
        )}
      </form>
      {graded && (
        <Verdict
          correct={graded.correct}
          explanation={
            <>
              <div className="rounded border-bw-1 border-ink/30 bg-paper p-3">
                <p className={eyebrow}>Answer</p>
                <div className="mt-1">
                  <Markdown source={clozeWithAnswers(card)} />
                </div>
              </div>
              <Why card={card} />
            </>
          }
        >
          {graded.correct ? 'Right.' : `${graded.gaps.filter(Boolean).length} of ${graded.gaps.length} right.`}
        </Verdict>
      )}
    </>
  );
}
