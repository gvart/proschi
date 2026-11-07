import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ClipboardCheck, Hammer, Lightbulb, LogIn, MessagesSquare, Sparkles, SquarePen, TriangleAlert, X } from 'lucide-react';
import Markdown from '../practice/Markdown';
import { primaryButton, toolButton } from '../components/Playground/ui';
import { useFeature } from '../components/featureState';
import UpgradeHint from '../components/UpgradeHint';
import { billingEnabled, pricingHref } from '../services/billing';
import type { Account } from '../practice/useAccount';
import { useEstimates } from '../services/useCredits';
import { formatCredits, formatRange } from '../services/credits';
import ChangeCard from './ChangeCard';
import type { Diagram } from '../dsl/types';
import { estimateFor, type Intent, type PartnerContext, type Question, type Turn } from './contract';
import { confirm } from '../design/dialogs';
import { PARTNER_SHORTCUT } from './shortcut';
import { usePartner, type PartnerProblem } from './usePartner';

/**
 * Design partner (docs/design/paid-plans.md P29, P30): one conversation per
 * document or practice problem. It reviews, answers, asks clarifying
 * questions (tappable options), builds a system from a description and
 * proposes changes as cards (./ChangeCard.tsx). One composer takes every ask:
 * the starter chips above it pick what it sends (a review, a build, a hint),
 * and the estimate under it follows the pick. Each ask shows its estimate
 * first and its real cost after. On a practice problem it coaches: changes
 * come only from "Show me the changes", which marks the problem assisted.
 */

export interface PartnerPanelProps {
  /** `editor:<docId>` or `practice:<problemId>`: which conversation to resume. */
  storeKey: string;
  context: PartnerContext;
  account: Account;
  /** The page's way to the site root, for the pricing link. */
  base?: string;
  /** The source in the editor now. */
  source: string;
  getSource: () => string;
  /** The files the source imports, sent with each turn. */
  getFiles?: () => { name: string; source: string }[] | undefined;
  /** Replaces the source as one undo step (CodeEditorHandle.replace). */
  apply: (next: string) => void;
  /** The editor's undo; false when it had nothing to undo. */
  undo: () => boolean;
  onClose: () => void;
  /** Why the partner is off here (an interview is on). */
  offReason?: string;
  /** A turn came with changes on a practice problem. */
  onAssisted?: () => void;
  /** The diagram of a source (with this page's imports), for the change cards' previews. */
  diagramOf?: (source: string) => Diagram;
}

const MAX_MESSAGE = 4000;

/** What a turn is doing while it runs, by the second it starts at: a build takes about a minute, a review a few seconds. */
const STAGES: Record<Intent, [number, string][]> = {
  review: [
    [0, 'Reading your design and its tests…'],
    [4, 'Weighing the trade-offs…'],
    [12, 'Writing the review…'],
  ],
  build: [
    [0, 'Reading your description…'],
    [6, 'Drafting the design…'],
    [25, 'Checking it against the simulation…'],
    [40, 'Running the tests on it…'],
  ],
  solve: [
    [0, 'Reading your design and its tests…'],
    [5, 'Working out the changes…'],
    [20, 'Checking them against the simulation…'],
    [35, 'Running the tests on them…'],
  ],
  improve: [
    [0, 'Reading the change again…'],
    [5, 'Reworking it…'],
    [20, 'Checking it against the simulation…'],
  ],
  chat: [
    [0, 'Reading your design…'],
    [4, 'Thinking it through…'],
    [12, 'Writing the answer…'],
  ],
};

export default function PartnerPanel(props: PartnerPanelProps) {
  const { account, context, offReason, onClose } = props;
  const feature = useFeature('design_partner');
  const deepFeature = useFeature('deep_mode');
  const signedOut = account.state.status === 'signed-out';
  const on = feature.ok && !offReason;

  return (
    <section aria-label="Design partner" className="flex h-full min-h-0 flex-col bg-surface text-ink" data-testid="partner-panel">
      {on ? (
        <Conversation {...props} deepAllowed={deepFeature.ok} />
      ) : (
        <>
          <PanelHeader practice={context.kind === 'practice'} onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {offReason ? (
              <Notice icon={<TriangleAlert size={16} aria-hidden="true" />} title="Off during an interview">
                {offReason}
              </Notice>
            ) : feature.loading ? (
              <Skeleton />
            ) : signedOut ? (
              <SignIn account={account} />
            ) : (
              <Notice icon={<Sparkles size={16} aria-hidden="true" />} title="Not on for this account">
                Design partner isn’t available on your account right now.{' '}
                {billingEnabled && <UpgradeHint base={props.base}>See the plans</UpgradeHint>}
              </Notice>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function PanelHeader({ practice, onClose, children }: { practice: boolean; onClose: () => void; children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b-bw-1 border-ink bg-surface pl-3 pr-1.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border-bw-1 border-ink bg-pop-lilac text-on-accent" aria-hidden="true">
        <MessagesSquare size={15} />
      </span>
      <h2 className="font-display text-base font-bold tracking-tight">Design partner</h2>
      {practice && <span className="rounded-sm border border-ink/40 px-1.5 py-px text-[11px] font-semibold text-muted">Coach</span>}
      <div className="ml-auto flex items-center gap-0.5">
        {children}
        <button type="button" onClick={onClose} aria-label="Close Design partner" title={`Close (${PARTNER_SHORTCUT})`} className="grid h-8 w-8 place-items-center rounded-sm text-muted hover:bg-ink/10 hover:text-ink">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function Conversation({ storeKey, context, account, base = '../', source, getSource, getFiles, apply, undo, onClose, onAssisted, diagramOf, deepAllowed }: PartnerPanelProps & { deepAllowed: boolean }) {
  const practice = context.kind === 'practice';
  const { state, send, decide, reset, dismiss } = usePartner({ storeKey, context, enabled: true, getSource, getFiles, onAssisted });
  const estimates = useEstimates(account.state.status === 'signed-in');
  const [deepChoice, setDeepChoice] = useState(false);
  const [draft, setDraft] = useState('');
  /** What the composer sends: picked with a starter chip, back to a plain message once sent. */
  const [starter, setStarter] = useState<Starter>('chat');
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const deep = deepAllowed && (state.sessionId ? state.sessionDeep : deepChoice);
  const busy = state.status !== 'idle';

  // A new answer is read from its top; anything else (a message sent, the thinking line) brings the end into view.
  const newest = state.turns[state.turns.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const answer = newest?.role === 'partner' && state.status === 'idle' ? el.querySelector<HTMLElement>(`[data-turn="${CSS.escape(newest.id)}"]`) : null;
    el.scrollTo({ top: answer ? answer.offsetTop - 16 : el.scrollHeight, behavior: 'smooth' });
  }, [newest, state.status]);

  // The composer grows with its text, up to about six lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [draft]);

  const estimate = (intent: Intent) => `${formatRange(estimateFor(estimates, intent, deep))} credits`;

  const ask = async (intent: Intent, message: string, changeId?: string) => {
    const ok = await send(intent, message, { deep, ...(changeId ? { changeId } : {}) });
    return ok;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const picked = starter;
    setDraft('');
    setStarter('chat');
    if (!(await ask(STARTERS[picked].intent, text))) {
      setDraft((d) => d || text);
      setStarter(picked);
    }
  };

  const pick = (next: Starter) => {
    const was = STARTERS[starter].prefill;
    const off = next === starter;
    setStarter(off ? 'chat' : next);
    // A prefill the user didn't edit follows the pick; their own words stay.
    if (!draft.trim() || draft === was) setDraft(off ? '' : STARTERS[next].prefill);
    requestAnimationFrame(() => {
      const el = input.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) void submit(e);
  };

  const toggleDeep = async () => {
    if (state.turns.length > 0 && !(await confirm({ title: deep ? 'Turn Deep off?' : 'Turn on Deep?', body: 'That starts a new conversation.', confirmLabel: deep ? 'Turn off' : 'Turn on' }))) return;
    if (state.sessionId) reset();
    setDeepChoice(!deep);
  };

  const newConversation = async () => {
    if (!(await confirm({ title: 'Start a new conversation?', body: 'This one is closed.', confirmLabel: 'Start new' }))) return;
    reset();
  };

  // Only the newest partner turn's questions take answers.
  const lastTurn = state.turns[state.turns.length - 1];
  const openQuestions = lastTurn?.role === 'partner' && !busy ? lastTurn.questions : undefined;
  const empty = state.turns.length === 0 && state.status !== 'resuming';

  return (
    <>
      <PanelHeader practice={practice} onClose={onClose}>
        {deepAllowed && (
          <button
            type="button"
            onClick={() => void toggleDeep()}
            aria-pressed={deep}
            disabled={busy}
            title={`Deep: a stronger model that thinks longer, about ${formatCredits(estimates.deepMultiplier)}× the credits`}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border-bw-1 border-ink/30 px-2 text-xs font-semibold text-ink hover:border-ink aria-pressed:border-ink aria-pressed:bg-pop-lilac aria-pressed:text-on-accent disabled:opacity-50"
            data-testid="partner-deep"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${deep ? 'bg-on-accent' : 'bg-ink/30'}`} aria-hidden="true" />
            Deep
            <span className="font-mono font-normal opacity-70">×{formatCredits(estimates.deepMultiplier)}</span>
          </button>
        )}
        {state.turns.length > 0 && (
          <button type="button" onClick={() => void newConversation()} disabled={busy} aria-label="New conversation" title="New conversation" className="grid h-8 w-8 place-items-center rounded-sm text-muted hover:bg-ink/10 hover:text-ink disabled:opacity-50">
            <SquarePen size={15} aria-hidden="true" />
          </button>
        )}
      </PanelHeader>

      <div ref={scroller} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain" aria-busy={busy}>
        {state.status === 'resuming' ? (
          <div className="p-4">
            <Skeleton label="Loading your conversation…" />
          </div>
        ) : empty ? (
          <EmptyState practice={practice} />
        ) : (
          <ol aria-label="Conversation" aria-live="polite" className="space-y-5 px-4 py-4">
            {state.turns.map((turn) =>
              turn.role === 'user' ? (
                <UserMessage key={turn.id} turn={turn} />
              ) : (
                <PartnerMessage
                  key={turn.id}
                  turn={turn}
                  charge={state.charges[turn.id]}
                  questions={turn === lastTurn ? openQuestions : undefined}
                  onAnswer={(text) => void ask('chat', text)}
                >
                  {turn.changes?.map((c) => (
                    <ChangeCard
                      key={c.id}
                      change={c}
                      source={source}
                      decision={state.decisions[c.id]}
                      busy={busy}
                      onAccept={(next) => {
                        apply(next);
                        decide(c.id, 'accepted');
                      }}
                      onReject={() => decide(c.id, 'rejected')}
                      onUndo={(before) => {
                        if (!undo()) apply(before);
                        decide(c.id, undefined);
                      }}
                      onImprove={(message) => ask('improve', message, c.id)}
                      improved={state.improved.includes(c.id)}
                      diagramOf={diagramOf}
                    />
                  ))}
                </PartnerMessage>
              ),
            )}
            {state.status === 'sending' && <Thinking intent={state.sending ?? 'chat'} />}
          </ol>
        )}
      </div>

      <form onSubmit={(e) => void submit(e)} className="shrink-0 border-t-bw-1 border-ink bg-surface px-3 pb-3 pt-2.5">
        {state.problem && <ProblemLine problem={state.problem} base={base} onDismiss={dismiss} />}
        {state.status !== 'resuming' && <StarterChips practice={practice} busy={busy} starter={starter} onPick={pick} estimate={estimate} onAsk={ask} />}
        <div className="flex items-end gap-1.5 rounded-sm border-bw-1 border-ink bg-paper p-1 transition-shadow duration-d1 focus-within:shadow-brutal-sm">
          <label htmlFor={`partner-message-${storeKey}`} className="sr-only">
            Message Design partner
          </label>
          <textarea
            id={`partner-message-${storeKey}`}
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE))}
            onKeyDown={onKey}
            rows={1}
            placeholder={starter !== 'chat' ? STARTERS[starter].placeholder : openQuestions?.length ? 'Answer in your own words, or pick an option' : practice ? 'Ask about the problem or your design' : 'Ask about your design'}
            className="max-h-[148px] min-h-[36px] flex-1 min-w-0 resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          {/* Slot for the shared MicButton (src/voice): <MicButton onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} /> */}
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" title="Send (Enter)" className={`${primaryButton} !h-9 !w-9 !justify-center !p-0 disabled:opacity-40`}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted tabular-nums" data-testid="partner-footnote">
          <span>{estimate(STARTERS[starter].intent) ? `${STARTERS[starter].cost}: ${estimate(STARTERS[starter].intent)}` : 'Enter to send, Shift+Enter for a new line'}</span>
          {state.balance !== undefined && <span data-testid="partner-balance">{formatCredits(state.balance, { floor: true })} credits left</span>}
        </p>
      </form>
    </>
  );
}

type Ask = (intent: Intent, message: string, changeId?: string) => Promise<boolean>;

const SOLVE_MESSAGE = 'Show me the changes that solve this problem.';

type Starter = 'chat' | 'review' | 'build' | 'hint';

/** What each starter chip sends: its intent, the words it puts in the composer, the composer's hint and the estimate's label. */
const STARTERS: Record<Starter, { intent: Intent; label: string; prefill: string; placeholder: string; cost: string }> = {
  chat: { intent: 'chat', label: '', prefill: '', placeholder: '', cost: 'A message' },
  review: { intent: 'review', label: 'Review my design', prefill: 'Review my design.', placeholder: 'Anything to focus on? e.g. the read path, the cost', cost: 'A review' },
  build: {
    intent: 'build',
    label: 'Build a system from a description',
    prefill: '',
    placeholder: 'Describe the system: what it does and how big it gets, e.g. a URL shortener, 100M new links a month, redirects under 50 ms',
    cost: 'A build',
  },
  hint: { intent: 'chat', label: 'Give me a hint', prefill: 'Give me a hint for the next step.', placeholder: 'What are you stuck on?', cost: 'A hint' },
};

function EmptyState({ practice }: { practice: boolean }) {
  return (
    <div className="px-4 py-5">
      <p className="text-sm leading-relaxed text-ink/80">
        {practice
          ? 'Your coach for this problem: it reviews your design, answers questions and gives hints, and keeps the answer back until you ask for it.'
          : 'Get a review, ask a question, or describe a system to build. Changes come as cards: you see the new design and the numbers before anything touches yours.'}
      </p>
      <p className="mt-3 text-xs text-muted">Pick a starting point below or just ask. Design partner can be wrong; the tests are the verdict.</p>
    </div>
  );
}

const STARTER_ICONS: Record<Exclude<Starter, 'chat'>, ReactNode> = {
  review: <ClipboardCheck size={13} aria-hidden="true" />,
  build: <Hammer size={13} aria-hidden="true" />,
  hint: <Lightbulb size={13} aria-hidden="true" />,
};

/** The chips that pick what the one composer sends; on practice also "Show me the changes". */
function StarterChips({ practice, busy, starter, onPick, estimate, onAsk }: { practice: boolean; busy: boolean; starter: Starter; onPick: (s: Starter) => void; estimate: (i: Intent) => string | undefined; onAsk: Ask }) {
  const chips: Exclude<Starter, 'chat'>[] = practice ? ['review', 'hint'] : ['review', 'build'];
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Start with" data-testid="partner-starters">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={starter === c}
          disabled={busy}
          onClick={() => onPick(c)}
          title={estimate(STARTERS[c].intent)}
          className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink/30 bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors duration-d1 hover:border-ink hover:bg-pop-yellow/30 aria-pressed:border-ink aria-pressed:bg-pop-yellow aria-pressed:text-on-accent disabled:opacity-50"
        >
          {STARTER_ICONS[c]}
          {STARTERS[c].label}
        </button>
      ))}
      {practice && <SolveAction busy={busy} estimate={estimate('solve')} onAsk={onAsk} compact className="basis-full sm:basis-auto" />}
    </div>
  );
}

/** "Show me the changes" on a practice problem, behind a one-line confirm that it marks the problem assisted. */
function SolveAction({ busy, estimate, onAsk, className = '', compact = false }: { busy: boolean; estimate?: string; onAsk: Ask; className?: string; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div role="group" aria-label="Show me the changes" className={`rounded-sm border-bw-1 border-ink bg-pop-yellow/20 px-3 py-2 text-xs text-ink ${className}`}>
        <p>
          You’ll get the full changes, and this problem is marked <strong>assisted</strong>.{estimate ? ` ${estimate[0].toUpperCase()}${estimate.slice(1)}.` : ''}
        </p>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              void onAsk('solve', SOLVE_MESSAGE);
            }}
            className={`${primaryButton} !py-1 !text-xs`}
          >
            Show the changes
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={`${toolButton} !py-1 !text-xs`}>
            Not yet
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={`${toolButton} ${compact ? '!px-2 !py-1 !text-xs' : '!px-0 !text-xs text-muted hover:!px-2.5'} ${className}`} data-testid="partner-solve">
      <Sparkles size={13} aria-hidden="true" />
      Show me the changes
    </button>
  );
}

function UserMessage({ turn }: { turn: Turn }) {
  return (
    <li className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink" aria-label="You">
        {turn.message}
      </p>
    </li>
  );
}

function PartnerMessage({ turn, charge, questions, onAnswer, children }: { turn: Turn; charge?: number; questions?: Question[]; onAnswer: (text: string) => void; children?: ReactNode }) {
  return (
    <li aria-label="Design partner" data-testid="partner-turn" data-turn={turn.id}>
      {turn.message && <Markdown source={turn.message} />}
      {turn.questions && <Questions questions={turn.questions} active={!!questions} onAnswer={onAnswer} />}
      {children && <div className="mt-3 space-y-3">{children}</div>}
      {turn.assisted && <p className="mt-2 text-[11px] font-semibold text-muted">This problem is now marked assisted.</p>}
      {charge !== undefined && (
        <p className="mt-2 font-mono text-[11px] text-muted tabular-nums" data-testid="partner-charge">
          {formatCredits(charge)} credits
        </p>
      )}
    </li>
  );
}

/** Clarifying questions: one tap answers a single question; several collect a pick each, then send together. */
function Questions({ questions, active, onAnswer }: { questions: Question[]; active: boolean; onAnswer: (text: string) => void }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const single = questions.length === 1;
  const ready = useMemo(() => questions.filter((q) => picked[q.id]), [questions, picked]);

  const choose = (q: Question, option: string) => {
    if (single) return onAnswer(option);
    setPicked((p) => ({ ...p, [q.id]: p[q.id] === option ? '' : option }));
  };

  return (
    <div className="mt-3 space-y-3" data-testid="partner-questions">
      {questions.map((q) => (
        <div key={q.id} role="group" aria-label={q.text}>
          <p className={`text-sm font-semibold ${active ? 'text-ink' : 'text-muted'}`}>{q.text}</p>
          {q.options && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={!active}
                  aria-pressed={single ? undefined : picked[q.id] === o}
                  onClick={() => choose(q, o)}
                  className="rounded-full border-bw-1 border-ink bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors duration-d1 hover:bg-pop-yellow/40 aria-pressed:bg-pop-yellow aria-pressed:text-on-accent disabled:border-ink/25 disabled:bg-transparent disabled:text-muted"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {active && !single && ready.length > 0 && (
        <button type="button" onClick={() => onAnswer(ready.map((q) => `${q.text} ${picked[q.id]}`).join('\n'))} className={`${primaryButton} !py-1 !text-xs`}>
          Send {ready.length === questions.length ? 'answers' : `${ready.length} of ${questions.length} answers`}
        </button>
      )}
    </div>
  );
}

function Thinking({ intent }: { intent: Intent }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - started) / 1000);
  const stages = STAGES[intent];
  const current = stages.filter(([at]) => seconds >= at).length - 1;
  return (
    <li className="rounded-sm border-bw-1 border-ink/15 bg-paper px-3 py-2.5 text-sm" data-testid="partner-thinking">
      <p role="status" className="flex items-center gap-2.5 text-ink">
        <span className="inline-flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/50 motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />
          ))}
        </span>
        <span className="flex-1">{stages[current][1]}</span>
        <span className="font-mono text-[11px] text-muted tabular-nums" aria-hidden="true">
          {seconds} s
        </span>
      </p>
      {stages.length > 1 && (
        <ol className="mt-2 flex gap-1" aria-hidden="true">
          {stages.map(([at], i) => (
            <li key={at} className={`h-1 flex-1 rounded-full transition-colors duration-d2 ${i < current ? 'bg-ink/50' : i === current ? 'bg-pop-lilac' : 'bg-ink/10'}`} />
          ))}
        </ol>
      )}
      {seconds >= 15 && <p className="mt-2 text-xs text-muted">{intent === 'build' || intent === 'solve' ? 'Changes are checked against the tests before they show, so this takes up to a minute.' : 'Almost there.'} You can keep editing meanwhile.</p>}
    </li>
  );
}

function ProblemLine({ problem, base, onDismiss }: { problem: PartnerProblem; base: string; onDismiss: () => void }) {
  if (problem.kind === 'no_credits') {
    return (
      <div role="alert" className="mb-2 rounded-sm border-bw-1 border-ink bg-pop-yellow/30 px-3 py-2 text-xs text-ink" data-testid="partner-no-credits">
        <p>
          <strong className="font-semibold">Not enough credits.</strong> This needs about {formatCredits(problem.needed)}; you have {formatCredits(problem.balance)}.
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <a href={pricingHref(base)} className="inline-flex items-center gap-1 font-semibold underline decoration-ink decoration-2 underline-offset-2">
            Top up or upgrade
          </a>
          <button type="button" onClick={onDismiss} className="ml-auto text-muted hover:text-ink">
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  const text =
    problem.kind === 'busy'
      ? 'Still answering your last message (maybe in another tab). It shows here when it’s ready.'
      : problem.kind === 'signed_out'
        ? 'You’re signed out. Sign in again to keep talking.'
        : problem.message;
  return (
    <p role={problem.kind === 'busy' ? 'status' : 'alert'} className="mb-2 flex items-start gap-2 text-xs text-ink/80" data-testid="partner-problem">
      <TriangleAlert size={13} className="mt-px shrink-0 text-muted" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-ink">
        <X size={13} aria-hidden="true" />
      </button>
    </p>
  );
}

function SignIn({ account }: { account: Account }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink">Sign in to work with Design partner</p>
      <p className="text-sm leading-relaxed text-ink/80">It reviews your design, answers questions and proposes changes you accept or reject. New accounts start with 100 free credits.</p>
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button key={p} type="button" onClick={() => account.signIn(p)} className={primaryButton}>
            <LogIn size={14} aria-hidden="true" />
            Sign in with {p === 'github' ? 'GitHub' : 'Google'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-sm border-bw-1 border-ink bg-paper p-3 text-sm text-ink">
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 leading-relaxed text-ink/80">{children}</p>
      </div>
    </div>
  );
}

function Skeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2.5">
      {[90, 75, 82].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded-sm bg-ink/10" style={{ width: `${w}%` }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

