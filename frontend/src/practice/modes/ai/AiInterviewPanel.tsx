import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Bot, CircleAlert, CircleCheck, CircleX, Code2, Coins, Flag, Lightbulb, Printer, Send, Sparkles, Target, Volume2, VolumeX, X } from 'lucide-react';
import { refreshCredits, useCredits } from '../../../services/useCredits';
import { confirm, notify } from '../../../design/dialogs';
import MicButton, { type MicButtonHandle } from '../../../voice/MicButton';
import type { MicState } from '../../../voice/recognizer';
import { useSpeaker } from '../../../voice/speaker';
import { useVoiceDraft } from '../../../voice/useVoiceDraft';
import Markdown from '../../Markdown';
import { useNow } from '../useNow';
import { eyebrow, field, outlineButton, primaryButton, toolButton } from '../../../components/Playground/ui';
import { formatClock, PHASES, type Phase } from '../session';
import { finishInterview, getInterview, sendTurn, shownPhase, SKILL_LABEL, SKILLS, TurnError, type AiInterview, type AiMessage, type Hint, type HintKind, type Skill, type Verdict } from './api';
import listings from 'virtual:practice-listings';
import { PICK_PENDING_MS } from '../../history/api';
import { useFeature } from '../../../components/featureState';
import { NoNewPicks, Picking, PickList } from '../../history/NextForYou';
import { useRoadmapNext } from '../../history/useRoadmapNext';

const InterviewReport = lazy(() => import('./InterviewReport'));

/**
 * Interview mode with the AI interviewer (backend/src/interviews.ts): a chat
 * beside the editor. The reply streams in, and with the speaker on it is
 * read aloud (the browser's own voice, P39). Each turn may bring a coaching
 * hint ("Focus now", "Can improve", "Wrap up"), shown as a toast (two at
 * most) and kept in the panel's coaching list. The mic listens hands-free
 * (src/voice). "Send my design" attaches the editor's source, which the
 * server runs the tests on. The session lives on the server, so a reload
 * picks it up again (GET /api/interviews/<id>).
 */

const MAX_MESSAGE = 4000;
/** Hint toasts on screen at once; an older one goes when a third comes. */
const MAX_HINT_TOASTS = 2;
const HINT_TOAST_MS = 15_000;

const phaseIndex = (p: Phase) => PHASES.findIndex((x) => x.id === p);

const HINT_LABEL: Record<HintKind, string> = { focus: 'Focus now', improve: 'Can improve', wrapup: 'Wrap up' };
const HINT_STYLE: Record<HintKind, string> = { focus: 'bg-pop-yellow/30', improve: 'bg-pop-blue/25', wrapup: 'bg-pop-pink/25' };
const HINT_ICON: Record<HintKind, typeof Target> = { focus: Target, improve: Lightbulb, wrapup: Flag };

interface Props {
  id: string;
  /** The problem statement without its scale and constraints. */
  statement: string;
  /** The editor's source now, for "Send my design". */
  getSource: () => string;
  /** Leaves interview mode. */
  onExit: () => void;
  /** Back to the start screen, to start another interview. */
  onRestart: () => void;
  /** Brings the chat into view (on phones, its tab), from a reply that came while it was hidden. */
  onShow?: () => void;
}

export default function AiInterviewPanel({ id, statement, getSource, onExit, onRestart, onShow }: Props) {
  const [interview, setInterview] = useState<AiInterview>();
  const [loadError, setLoadError] = useState<string>();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState<string>();
  const [busy, setBusy] = useState<'turn' | 'finish'>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  /** A turn was refused for want of credits; the server has moved the interview to its wrap-up. */
  const [refused, setOutOfCredits] = useState(false);
  const [listening, setListening] = useState(false);
  const { credits } = useCredits(true);
  const chat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getInterview(id).then(
      ({ interview }) => {
        if (!live) return;
        setInterview(interview);
        setMessages(interview.messages ?? []);
      },
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const el = chat.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const mic = useRef<MicButtonHandle>(null);
  const voice = useVoiceDraft(setDraft, MAX_MESSAGE);
  const speaker = useSpeaker();
  const stopSpeaking = speaker.stop;
  // Talking stops the interviewer's voice; so does typing (below).
  const onMicState = useCallback(
    (s: MicState) => {
      if (s === 'starting' || s === 'listening') stopSpeaking();
      setListening(s === 'listening' || s === 'transcribing');
    },
    [stopSpeaking],
  );
  const toasts = useRef<(() => void)[]>([]);
  const showHint = useCallback((hint: Hint) => {
    const Icon = HINT_ICON[hint.kind];
    toasts.current.push(
      notify({
        title: HINT_LABEL[hint.kind],
        body: (
          <span className="inline-flex items-start gap-1.5" data-testid="hint-toast" data-kind={hint.kind}>
            <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {hint.text}
          </span>
        ),
        duration: HINT_TOAST_MS,
      }),
    );
    while (toasts.current.length > MAX_HINT_TOASTS) toasts.current.shift()!();
  }, []);
  useEffect(() => {
    const open = toasts.current;
    return () => open.splice(0).forEach((dismiss) => dismiss());
  }, []);

  const active = interview?.status === 'active';
  const now = useNow(active);

  if (loadError) {
    return (
      <section aria-label="Mock interview" className="px-4 py-4 space-y-3">
        <p role="alert" className="text-sm text-ink">
          This interview could not be loaded ({loadError}).
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRestart} className={outlineButton}>
            Start again
          </button>
          <button type="button" onClick={onExit} className={toolButton}>
            Leave interview mode
          </button>
        </div>
      </section>
    );
  }
  if (!interview) return <p className="px-4 py-4 text-sm text-muted">Loading the interview…</p>;
  if (interview.status === 'finished' && interview.verdict) return <VerdictView picksFor={interview.id} endedAt={interview.endedAt} deep={interview.deep} verdict={interview.verdict} onRestart={onRestart} onExit={onExit} />;

  const left = interview.minutes * 60_000 - (now - interview.startedAt);
  const timeUp = interview.deadline !== undefined && now >= interview.deadline;
  const phase = shownPhase(interview, now);
  const hints = messages.flatMap((m) => (m.role === 'interviewer' && m.hint ? [m.hint] : [])).reverse();

  const said = voice.shown(draft).trim();
  const send = async (input: { message: string; design?: string; advance?: boolean }) => {
    if (busy || !active) return;
    mic.current?.stop();
    voice.clear();
    stopSpeaking();
    setBusy('turn');
    setError(undefined);
    const sentAt = Date.now();
    setMessages((m) => [...m, { role: 'candidate', text: input.message, at: sentAt, ...(input.design !== undefined ? { design: true } : {}) }]);
    setDraft('');
    let text = '';
    setStreaming('');
    try {
      const done = await sendTurn(interview.id, input, (piece) => {
        text += piece;
        setStreaming(text);
      });
      setMessages((m) => [...m, { role: 'interviewer', text: done.reply, at: Date.now(), ...(done.hint ? { hint: done.hint } : {}) }]);
      setInterview((i) => i && { ...i, phase: done.phase, turns: done.turns });
      speaker.say(done.reply);
      if (done.hint) showHint(done.hint);
      // The chat is out of sight (on phones, another tab): say so, with a way back.
      if (onShow && chat.current && chat.current.offsetParent === null) notify({ title: 'The interviewer replied', action: { label: 'Open the interview', onClick: onShow }, duration: 8000 });
    } catch (e) {
      // The turn was not kept: take the message back into the box.
      setMessages((m) => m.filter((x) => x.at !== sentAt));
      setDraft(input.message);
      if (e instanceof TurnError && e.refunded) {
        setInterview((i) => i && { ...i, status: 'failed' });
      } else if (e instanceof TurnError && (e.code === 'no_credits' || e.status === 402)) {
        setOutOfCredits(true);
      } else setError(turnErrorText(e));
    } finally {
      setStreaming(undefined);
      setBusy(undefined);
      refreshCredits();
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (said) void send({ message: said });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const finish = async () => {
    if (busy) return;
    if (!timeUp && !(await confirm({ title: 'Finish the interview and get the verdict?', body: 'You cannot continue it afterwards.', confirmLabel: 'Finish' }))) return;
    mic.current?.stop();
    stopSpeaking();
    setBusy('finish');
    setError(undefined);
    try {
      const { interview: done } = await finishInterview(interview.id);
      setInterview((i) => i && { ...i, ...done });
    } catch (e) {
      setError(`The verdict could not be written (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`);
    } finally {
      setBusy(undefined);
      refreshCredits();
    }
  };

  if (interview.status === 'failed') {
    return (
      <section aria-label="Mock interview" className="px-4 py-4 space-y-3">
        <p role="alert" className="flex items-start gap-2 rounded-sm border-bw-1 border-ink bg-pop-pink/25 px-3 py-2 text-sm text-ink">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          The interviewer stopped working early in this interview. Answers that failed on our side were not charged. Start again when you are ready.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRestart} className={primaryButton}>
            Start again
          </button>
          <button type="button" onClick={onExit} className={toolButton}>
            Leave interview mode
          </button>
        </div>
      </section>
    );
  }

  const canTalk = active && !timeUp && !busy;
  const outOfCredits = active && (refused || (credits !== undefined && credits.balance <= 0));
  return (
    <section aria-label="Mock interview" className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 border-b-bw-1 border-ink bg-surface px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`${eyebrow} inline-flex items-center gap-1`}>
            <Bot size={13} aria-hidden="true" />
            Mock interview
          </span>
          <span role="timer" aria-label="Time left" className={`font-mono text-base font-bold tabular-nums ${left < 0 ? 'text-red-700 dark:text-red-300' : 'text-ink'}`}>
            {formatClock(left)}
          </span>
          {left < 0 && <span className="text-xs font-semibold text-red-700 dark:text-red-300">over time</span>}
          {speaker.supported && (
            <button
              type="button"
              onClick={() => speaker.setOn(!speaker.on)}
              aria-pressed={speaker.on}
              data-testid="speaker-toggle"
              className={`ml-auto ${toolButton} ${speaker.on ? '!bg-pop-yellow/40' : ''}`}
              aria-label={speaker.on ? 'Stop reading replies aloud' : 'Read replies aloud'}
              title={speaker.on ? 'Replies are read aloud; click to stop' : 'Read the interviewer’s replies aloud'}
            >
              {speaker.on ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
              <span className="hidden sm:inline">{speaker.on ? 'Voice on' : 'Voice off'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => (await confirm({ title: 'Leave interview mode?', body: 'The interview stays open on the server until you start another one.', confirmLabel: 'Leave' })) && onExit()}
            className={`${speaker.supported ? '' : 'ml-auto '}${toolButton}`}
            aria-label="Leave interview mode"
            title="Leave interview mode"
          >
            <X size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
        <ol aria-label="Phases" className="flex gap-1 text-xs font-semibold">
          {PHASES.map((p, i) => (
            <li
              key={p.id}
              aria-current={p.id === phase ? 'step' : undefined}
              className={`flex-1 rounded-sm border-bw-1 px-1.5 py-0.5 text-center ${p.id === phase ? 'border-ink bg-pop-yellow text-on-accent' : i < phaseIndex(phase) ? 'border-ink/40 text-ink' : 'border-ink/20 text-muted'}`}
            >
              {i + 1}. {p.label}
            </li>
          ))}
        </ol>
        {outOfCredits ? (
          <aside aria-label="Out of credits" data-testid="out-of-credits" className="flex items-start gap-2 rounded-sm border-bw-1 border-ink/40 bg-paper px-3 py-2 text-sm text-ink">
            <Coins size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              You&rsquo;re out of credits, so the interviewer is wrapping up. Your verdict is already paid for: finish when you&rsquo;re ready.
            </p>
          </aside>
        ) : null}
      </div>

      <div ref={chat} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3" aria-live="polite" aria-busy={busy === 'turn'}>
        <details className="rounded-sm border-bw-1 border-ink/40 bg-paper">
          <summary className="cursor-pointer px-3 py-1.5 text-sm font-semibold text-ink">The problem</summary>
          <div className="border-t-bw-1 border-ink/40 px-3 py-2">
            <Markdown source={statement} />
          </div>
        </details>
        {hints.length > 0 && (
          <details className="rounded-sm border-bw-1 border-ink/40 bg-paper" data-testid="coaching-history">
            <summary className="cursor-pointer px-3 py-1.5 text-sm font-semibold text-ink">
              Coaching <span className="font-normal text-muted tabular-nums">({hints.length})</span>
            </summary>
            <ol className="space-y-2 border-t-bw-1 border-ink/40 px-3 py-2">
              {hints.map((h, i) => (
                <li key={i}>
                  <CoachingCard hint={h} />
                </li>
              ))}
            </ol>
          </details>
        )}
        <ol aria-label="Conversation" className="space-y-3">
          {messages.map((m, i) => (
            <ChatBubble key={`${m.at}-${i}`} message={m} />
          ))}
          {streaming !== undefined && <ChatBubble message={{ role: 'interviewer', text: streaming || '…', at: 0 }} pending />}
        </ol>
      </div>

      <form onSubmit={submit} className="border-t-bw-1 border-ink bg-surface px-3 py-2 space-y-2">
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {timeUp ? (
          <p className="text-sm text-ink">The interview has reached its 60 minutes. Get the verdict to see how it went.</p>
        ) : (
          <div className="flex items-end gap-2">
            <label htmlFor="ai-interview-message" className="sr-only">
              Your answer
            </label>
            <textarea
              id="ai-interview-message"
              value={voice.shown(draft)}
              onChange={(e) => {
                voice.clear();
                stopSpeaking();
                setDraft(e.target.value.slice(0, MAX_MESSAGE));
              }}
              onKeyDown={onKey}
              rows={2}
              placeholder={listening ? 'Listening… speak your answer' : 'Ask a question or explain your thinking'}
              disabled={!active}
              className={`flex-1 min-w-0 resize-y ${field}`}
            />
            <MicButton ref={mic} onText={voice.onText} onState={onMicState} disabled={!active} />
            <button type="submit" disabled={!canTalk || !said} className={`${primaryButton} disabled:opacity-50`} aria-label="Send">
              <Send size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {!timeUp && (
            <>
              <button
                type="button"
                disabled={!canTalk}
                onClick={() => void send({ message: said, design: getSource() })}
                className={`${toolButton} disabled:opacity-50`}
                title="Send the design in the editor with your message; the server runs the tests on it"
              >
                <Code2 size={14} aria-hidden="true" />
                Send my design
              </button>
              {phase !== 'wrapup' && (
                <button
                  type="button"
                  disabled={!canTalk}
                  onClick={() => void send({ message: said || `I'd like to move on to the ${PHASES[phaseIndex(phase) + 1].label.toLowerCase()} phase.`, advance: true })}
                  className={`${toolButton} disabled:opacity-50`}
                  title="Move on to the next phase before the clock does"
                >
                  <ArrowRight size={14} aria-hidden="true" />
                  Next phase
                </button>
              )}
            </>
          )}
          <button type="button" disabled={!!busy || !active} onClick={() => void finish()} className={`ml-auto ${timeUp || outOfCredits ? primaryButton : outlineButton} disabled:opacity-50`}>
            <Flag size={14} aria-hidden="true" />
            {busy === 'finish' ? 'Writing the verdict…' : 'Finish and get the verdict'}
          </button>
        </div>
      </form>
    </section>
  );
}

function turnErrorText(e: unknown): string {
  if (e instanceof TurnError) {
    if (e.code === 'time') return 'The interview has reached its 60 minutes. Get the verdict.';
    if (e.code === 'budget' || e.code === 'turns') return 'This interview has used what one session may. Get the verdict.';
    if (e.code === 'message') return 'Say something first, at most 4,000 characters.';
    if (e.code === 'design') return 'The design is too large to send (at most 64 KiB).';
    if (e.code === 'turn_in_progress') return 'Still answering your last message.';
    if (e.status === 429) return 'Too many messages; wait a minute.';
  }
  return 'The interviewer did not answer. Send it again in a moment.';
}

export function CoachingCard({ hint }: { hint: Hint }) {
  const Icon = HINT_ICON[hint.kind];
  return (
    <aside aria-label={`Coaching: ${HINT_LABEL[hint.kind]}`} data-testid="coaching-card" className={`rounded-sm border-bw-1 border-ink px-3 py-2 text-sm text-ink ${HINT_STYLE[hint.kind]}`}>
      <p className={`${eyebrow} !text-ink inline-flex items-center gap-1`}>
        <Icon size={13} aria-hidden="true" />
        {HINT_LABEL[hint.kind]}
      </p>
      <p className="mt-0.5">{hint.text}</p>
    </aside>
  );
}

function ChatBubble({ message, pending }: { message: AiMessage; pending?: boolean }) {
  const mine = message.role === 'candidate';
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-sm border-bw-1 px-3 py-2 text-sm text-ink ${mine ? 'border-ink bg-pop-yellow/20' : 'border-ink/40 bg-paper'} ${pending ? 'opacity-90' : ''}`}
        aria-label={mine ? 'You' : 'Interviewer'}
      >
        <p className={`${eyebrow} mb-0.5`}>{mine ? 'You' : 'Interviewer'}</p>
        {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
        {message.design && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-muted">
            <Code2 size={12} aria-hidden="true" />
            Design sent
          </p>
        )}
      </div>
    </li>
  );
}

const problemTitle = (id: string) => listings.find((p) => p.id === id)?.title;

/**
 * The verdict: pass or fail, a score per skill, what went well and wrong, and
 * what to practise next, with the AI roadmap's picks made after it linked
 * (`picksFor`, the session's id; with the ai_roadmap feature only). In interview mode it
 * ends with Start again and Leave; on the progress page's history without them.
 * A Deep verdict (Max) says so; with interview_report (Max) the session's
 * printable report opens from it.
 */
export function VerdictView({ picksFor, endedAt, deep, verdict, onRestart, onExit }: { picksFor?: string; endedAt?: number; deep?: boolean; verdict: Verdict; onRestart?: () => void; onExit?: () => void }) {
  // A verdict that just ended may still be getting its picks: they are asked for again a few times.
  const [wait] = useState(() => endedAt !== undefined && Date.now() - endedAt < PICK_PENDING_MS);
  const roadmap = useFeature('ai_roadmap');
  const picks = useRoadmapNext(roadmap.ok && !!picksFor, { interview: picksFor, wait });
  const report = useFeature('interview_report');
  const [printing, setPrinting] = useState(false);
  const closeReport = useCallback(() => setPrinting(false), []);
  return (
    <section aria-label="Interview verdict" className="px-4 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Interview verdict</h2>
        {deep && (
          <span data-testid="verdict-deep" className="inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink bg-pop-lilac/30 px-1.5 py-0.5 text-xs font-semibold text-ink">
            <Sparkles size={12} aria-hidden="true" />
            Deep verdict
          </span>
        )}
        {report.ok && picksFor && (
          <button type="button" onClick={() => setPrinting(true)} className={`ml-auto ${toolButton}`} data-testid="verdict-report" title="A printable report of this interview; save it as a PDF from the print dialog">
            <Printer size={14} aria-hidden="true" />
            Print report
          </button>
        )}
      </div>
      {printing && picksFor && (
        <Suspense fallback={null}>
          <InterviewReport id={picksFor} onClose={closeReport} />
        </Suspense>
      )}
      <p
        data-testid="verdict-result"
        className={`inline-flex items-center gap-2 rounded-sm border-bw-1 border-ink px-3 py-1.5 text-base font-bold ${verdict.passed ? 'bg-pass/20 text-ink' : 'bg-fail/20 text-ink'}`}
      >
        {verdict.passed ? <CircleCheck size={18} aria-hidden="true" /> : <CircleX size={18} aria-hidden="true" />}
        {verdict.passed ? 'Pass' : 'Not yet a pass'}
      </p>
      <table className="w-full text-sm">
        <caption className={`${eyebrow} text-left`}>Scores per skill, out of 5</caption>
        <tbody>
          {SKILLS.map((s) => (
            <tr key={s} className="border-b border-ink/15">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                {SKILL_LABEL[s]}
              </th>
              <td className="py-1.5 w-full">
                <span className="flex items-center gap-2">
                  <span className="flex flex-1 gap-0.5" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className={`h-2.5 flex-1 rounded-[2px] border border-ink/60 ${n <= verdict.scores[s] ? (verdict.scores[s] >= 3 ? 'bg-pass' : 'bg-fail') : 'bg-transparent'}`} />
                    ))}
                  </span>
                  <span className="w-8 text-right font-mono tabular-nums">{verdict.scores[s]}/5</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NoteList title="What went well" notes={verdict.wentWell} empty="Nothing stood out yet." />
      <NoteList title="What went wrong" notes={verdict.wentWrong} empty="Nothing went wrong." />
      {verdict.nextSteps.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ink">Next steps</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
            {verdict.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {(picks.status === 'picking' || (picks.status === 'ready' && (picks.next || picks.missed))) && (
        <div className="space-y-2" data-testid="verdict-picks">
          <h3 className="text-sm font-semibold text-ink">Practise them here</h3>
          {picks.status !== 'ready' ? <Picking /> : picks.next ? <PickList picks={picks.next.picks} problemTitle={problemTitle} /> : <NoNewPicks />}
        </div>
      )}
      {(onRestart || onExit) && (
        <div className="flex flex-wrap gap-2">
          {onRestart && (
            <button type="button" onClick={onRestart} className={outlineButton}>
              Start again
            </button>
          )}
          {onExit && (
            <button type="button" onClick={onExit} className={toolButton}>
              Leave interview mode
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function NoteList({ title, notes, empty }: { title: string; notes: { skill: Skill; text: string }[]; empty: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {notes.length ? (
        <ul className="space-y-1.5 text-sm text-ink">
          {notes.map((n, i) => (
            <li key={i} className="rounded-sm border-bw-1 border-ink/30 bg-paper px-3 py-1.5">
              <span className={`${eyebrow} mr-1`}>{SKILL_LABEL[n.skill]}</span> {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}
