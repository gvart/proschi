import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ClipboardCheck, Hammer, Lightbulb, LogIn, MessagesSquare, Sparkles, SquarePen, TriangleAlert, X } from 'lucide-react';
import Markdown from '../practice/Markdown';
import { field, primaryButton, toolButton } from '../components/Playground/ui';
import { useFeature } from '../components/featureState';
import UpgradeHint from '../components/UpgradeHint';
import { billingEnabled, pricingHref } from '../services/billing';
import type { Account } from '../practice/useAccount';
import { useEstimates } from './credits';
import ChangeCard from './ChangeCard';
import { estimateFor, formatCredits, formatRange, type Intent, type PartnerContext, type Question, type Turn } from './contract';
import { PARTNER_SHORTCUT } from './shortcut';
import { usePartner, type PartnerProblem } from './usePartner';

/**
 * Design partner (docs/design/paid-plans.md P29, P30): one conversation per
 * document or practice problem. It reviews, answers, asks clarifying
 * questions (tappable options), builds a system from a description and
 * proposes changes as cards (./ChangeCard.tsx). Each ask shows its estimate
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
}

const MAX_MESSAGE = 4000;

const THINKING: Partial<Record<Intent, string>> = {
  review: 'Reading your design, its tests and the simulation…',
  build: 'Drafting the system and checking it against the simulation…',
  solve: 'Working out the changes and running the tests on them…',
  improve: 'Reworking the change and checking it again…',
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

function Conversation({ storeKey, context, base = '../', source, getSource, getFiles, apply, undo, onClose, onAssisted, deepAllowed }: PartnerPanelProps & { deepAllowed: boolean }) {
  const practice = context.kind === 'practice';
  const { state, send, decide, reset, dismiss } = usePartner({ storeKey, context, enabled: true, getSource, getFiles, onAssisted });
  const estimates = useEstimates();
  const [deepChoice, setDeepChoice] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const deep = deepAllowed && (state.sessionId ? state.sessionDeep : deepChoice);
  const busy = state.status !== 'idle';

  // The newest message in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.turns.length, state.status]);

  // The composer grows with its text, up to about six lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [draft]);

  const estimate = (intent: Intent) => (estimates ? formatRange(estimateFor(estimates, intent, deep)) : undefined);

  const ask = async (intent: Intent, message: string, changeId?: string) => {
    const ok = await send(intent, message, { deep, ...(changeId ? { changeId } : {}) });
    return ok;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    if (!(await ask('chat', text))) setDraft((d) => d || text);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) void submit(e);
  };

  const toggleDeep = () => {
    if (state.turns.length > 0 && !window.confirm(deep ? 'Turn Deep off? That starts a new conversation.' : 'Turn on Deep? That starts a new conversation.')) return;
    if (state.sessionId) reset();
    setDeepChoice(!deep);
  };

  const newConversation = () => {
    if (window.confirm('Start a new conversation? This one is closed.')) reset();
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
            onClick={toggleDeep}
            aria-pressed={deep}
            disabled={busy}
            title={`Deep: a stronger model that thinks longer, about ${formatCredits(estimates?.deepMultiplier ?? 3)}× the credits`}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border-bw-1 border-ink/30 px-2 text-xs font-semibold text-ink hover:border-ink aria-pressed:border-ink aria-pressed:bg-pop-lilac aria-pressed:text-on-accent disabled:opacity-50"
            data-testid="partner-deep"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${deep ? 'bg-on-accent' : 'bg-ink/30'}`} aria-hidden="true" />
            Deep
            {estimates && <span className="font-mono font-normal opacity-70">×{formatCredits(estimates.deepMultiplier)}</span>}
          </button>
        )}
        {state.turns.length > 0 && (
          <button type="button" onClick={newConversation} disabled={busy} aria-label="New conversation" title="New conversation" className="grid h-8 w-8 place-items-center rounded-sm text-muted hover:bg-ink/10 hover:text-ink disabled:opacity-50">
            <SquarePen size={15} aria-hidden="true" />
          </button>
        )}
      </PanelHeader>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto overscroll-contain" aria-busy={busy}>
        {state.status === 'resuming' ? (
          <div className="p-4">
            <Skeleton label="Loading your conversation…" />
          </div>
        ) : empty ? (
          <EmptyState practice={practice} busy={busy} estimate={estimate} onAsk={ask} />
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
                    />
                  ))}
                </PartnerMessage>
              ),
            )}
            {state.status === 'sending' && <Thinking text={(state.sending && THINKING[state.sending]) ?? 'Thinking…'} />}
          </ol>
        )}
      </div>

      <form onSubmit={(e) => void submit(e)} className="shrink-0 border-t-bw-1 border-ink bg-surface px-3 pb-3 pt-2.5">
        {state.problem && <ProblemLine problem={state.problem} base={base} onDismiss={dismiss} />}
        {!empty && state.status !== 'resuming' && <QuickActions practice={practice} busy={busy} estimate={estimate} onAsk={ask} />}
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
            placeholder={openQuestions?.length ? 'Answer in your own words, or pick an option' : practice ? 'Ask about the problem or your design' : 'Ask about your design'}
            className="max-h-[148px] min-h-[36px] flex-1 min-w-0 resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" title="Send (Enter)" className={`${primaryButton} !h-9 !w-9 !justify-center !p-0 disabled:opacity-40`}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted tabular-nums" data-testid="partner-footnote">
          <span>{estimate('chat') ? `A message: ${estimate('chat')}` : 'Enter to send, Shift+Enter for a new line'}</span>
          {state.balance !== undefined && <span data-testid="partner-balance">{formatCredits(state.balance)} credits left</span>}
        </p>
      </form>
    </>
  );
}

type Ask = (intent: Intent, message: string, changeId?: string) => Promise<boolean>;

const MESSAGES = {
  review: 'Review my design.',
  hint: 'Give me a hint for the next step.',
  solve: 'Show me the changes that solve this problem.',
} as const;

function EmptyState({ practice, busy, estimate, onAsk }: { practice: boolean; busy: boolean; estimate: (i: Intent) => string | undefined; onAsk: Ask }) {
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState('');

  const build = async (e: FormEvent) => {
    e.preventDefault();
    const text = description.trim();
    if (text && (await onAsk('build', text))) setDescription('');
  };

  return (
    <div className="px-4 py-5">
      <p className="text-sm leading-relaxed text-ink/80">
        {practice
          ? 'Your coach for this problem: it reviews your design, answers questions and gives hints, and keeps the answer back until you ask for it.'
          : 'Get a review, ask a question, or describe a system to build. Changes come as cards: you see the code and the numbers before anything touches your design.'}
      </p>
      <div className="mt-4 space-y-2.5">
        <StarterAction icon={<ClipboardCheck size={16} />} title="Review my design" detail={practice ? 'What works, what fails and where to look next.' : 'Trade-offs, risks and what to change, from the tests and the simulation.'} estimate={estimate('review')} disabled={busy} onClick={() => void onAsk('review', MESSAGES.review)} />
        {practice ? (
          <StarterAction icon={<Lightbulb size={16} />} title="Give me a hint" detail="A nudge for the next step, not the answer." estimate={estimate('chat')} disabled={busy} onClick={() => void onAsk('chat', MESSAGES.hint)} />
        ) : (
          <div className={`rounded-sm border-bw-1 border-ink bg-surface ${describing ? 'shadow-brutal-sm' : ''}`}>
            <StarterAction
              flush
              icon={<Hammer size={16} />}
              title="Build a system from a description"
              detail="Say what it does and how big it gets; you get the design as a change to accept."
              estimate={estimate('build')}
              disabled={busy}
              expanded={describing}
              onClick={() => setDescribing((d) => !d)}
            />
            {describing && (
              <form onSubmit={(e) => void build(e)} className="space-y-2 border-t-bw-1 border-ink/15 p-3">
                <label htmlFor="partner-describe" className="sr-only">
                  Describe the system
                </label>
                <textarea
                  id="partner-describe"
                  autoFocus
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_MESSAGE))}
                  placeholder="e.g. A URL shortener: 100M new links a month, 10:1 reads to writes, redirects under 50 ms."
                  className={`block w-full resize-y ${field}`}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted tabular-nums">{estimate('build')}</span>
                  <button type="submit" disabled={busy || !description.trim()} className={`${primaryButton} disabled:opacity-40`}>
                    <Hammer size={14} aria-hidden="true" />
                    Build it
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
      {practice && <SolveAction busy={busy} estimate={estimate('solve')} onAsk={onAsk} className="mt-5" />}
      <p className="mt-5 text-xs text-muted">Or ask anything below. Design partner can be wrong; the tests are the verdict.</p>
    </div>
  );
}

function StarterAction({ icon, title, detail, estimate, disabled, onClick, flush, expanded }: { icon: ReactNode; title: string; detail: string; estimate?: string; disabled: boolean; onClick: () => void; flush?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={`group flex w-full items-start gap-3 p-3 text-left disabled:opacity-50 ${flush ? 'rounded-sm hover:bg-pop-yellow/15' : 'rounded-sm border-bw-1 border-ink bg-surface transition-[translate,box-shadow] duration-d1 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-sm active:translate-x-0 active:translate-y-0 active:shadow-none'}`}
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm border-bw-1 border-ink bg-paper text-ink group-hover:bg-pop-yellow group-hover:text-on-accent" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{detail}</span>
        {estimate && <span className="mt-1 block font-mono text-[11px] text-muted tabular-nums">{estimate}</span>}
      </span>
    </button>
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
              void onAsk('solve', MESSAGES.solve);
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

function QuickActions({ practice, busy, estimate, onAsk }: { practice: boolean; busy: boolean; estimate: (i: Intent) => string | undefined; onAsk: Ask }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <button type="button" disabled={busy} onClick={() => void onAsk('review', MESSAGES.review)} title={estimate('review')} className={`${toolButton} !px-2 !py-1 !text-xs`}>
        <ClipboardCheck size={13} aria-hidden="true" />
        Review again
      </button>
      {practice && (
        <>
          <button type="button" disabled={busy} onClick={() => void onAsk('chat', MESSAGES.hint)} title={estimate('chat')} className={`${toolButton} !px-2 !py-1 !text-xs`}>
            <Lightbulb size={13} aria-hidden="true" />
            Hint
          </button>
          <SolveAction busy={busy} estimate={estimate('solve')} onAsk={onAsk} compact className="basis-full sm:basis-auto" />
        </>
      )}
    </div>
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
    <li aria-label="Design partner" data-testid="partner-turn">
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
                  className="rounded-full border-bw-1 border-ink bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors duration-d1 hover:bg-pop-yellow/40 aria-pressed:bg-pop-yellow aria-pressed:text-on-accent disabled:border-ink/25 disabled:text-muted disabled:hover:bg-surface"
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

function Thinking({ text }: { text: string }) {
  return (
    <li role="status" className="flex items-center gap-2.5 text-sm text-muted" data-testid="partner-thinking">
      <span className="inline-flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/50 motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </span>
      {text}
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

