import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Bot, CircleAlert, Code2, Coins, Hand, Mic, Send, X } from 'lucide-react';
import { confirm, notify } from '../../design/dialogs';
import { useToastClearance, useToastInset } from '../../design/toastClearance';
import { field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import MicButton, { type MicButtonHandle } from '../../voice/MicButton';
import { voiceSupported, type MicState } from '../../voice/recognizer';
import { speak, speechSupported, stopSpeaking } from '../../voice/speaker';
import { joinPhrase } from '../../voice/useVoiceDraft';
import { useCredits } from '../../services/useCredits';
import type { Engine } from '../../hld/engine';
import Markdown from '../Markdown';
import type { Problem } from '../types';
import { useNow } from '../modes/useNow';
import { PHASES, type Phase } from '../modes/session';
import { redactedStatement } from '../modes/interviewFile';
import { shownPhase, type AiMessage, type Hint, type TurnDone } from '../modes/ai/api';
import { HINT_ICON, HINT_LABEL, HINT_STYLE } from '../modes/ai/hints';
import { autoSendLeft } from './autoSend';
import { useCodePref, useRailFoldedPref, useSoundPref, useTalkPref } from './prefs';
import Room, { ChecksSheet, type RoomTab } from './Room';
import { useClockCues, useCues, usePhaseCue, useWhiteboard } from './useRoom';
import { useMockInterview, type MockSession } from './useMock';

/**
 * A mock interview in the room: the whiteboard, and the chat on the right
 * (P45). Text: a typed chat, with dictation on the mic. Voice: the mic
 * listens hands-free, an answer goes after a pause of silence (with a
 * countdown to cancel), and the interviewer's replies are spoken; the mic
 * pauses while it speaks, and Interrupt (or typing) cuts it off. Coaching
 * hints come as toasts clear of the chat and stay inline in it.
 */

const MAX_MESSAGE = 4000;
const MAX_HINT_TOASTS = 2;
const HINT_TOAST_MS = 15_000;
/** The rail's width on the desktop (Room.tsx w-[380px], 400 from xl), for the toasts' inset. */
const RAIL_PX = { base: 380, xl: 400 };

const phaseIndex = (p: Phase) => PHASES.findIndex((x) => x.id === p);

interface MockRoomProps {
  id: string;
  problem: Problem;
  engine: Engine;
  phone: boolean;
  /** Leaves the room; the session stays open on the server. */
  onExit: () => void;
  /** The verdict is in: the room gives way to the result. */
  onVerdict: (session: MockSession) => void;
  /** Back to the set-up after a session that could not go on. */
  onRestart: () => void;
}

export default function MockRoom({ id, problem, engine, phone, onExit, onVerdict, onRestart }: MockRoomProps) {
  const board = useWhiteboard(problem, engine);
  const [soundOn, setSound] = useSoundPref();
  const play = useCues(soundOn);
  const [talk, setTalk] = useTalkPref();
  const [codeShown, setCode] = useCodePref();
  const [folded, setFolded] = useRailFoldedPref();
  const [tab, setTab] = useState<RoomTab>('chat');
  const [unread, setUnread] = useState(false);
  const voiceOk = useMemo(() => voiceSupported(true), []);
  const voice = talk === 'voice' && voiceOk;
  const statement = useMemo(() => redactedStatement(problem.statement), [problem.statement]);
  const xl = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches;
  useToastInset(!phone && !folded ? (xl ? RAIL_PX.xl : RAIL_PX.base) + 8 : 0);

  // The coaching toasts: two at most, gone when the room is left.
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

  // Voice: what the mic is doing, and whether the interviewer is speaking (the mic waits meanwhile).
  const mic = useRef<MicButtonHandle>(null);
  const [micState, setMicState] = useState<MicState>('idle');
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  const listenAgain = useCallback(() => {
    setSpeaking(false);
    if (voiceRef.current) mic.current?.start();
  }, []);
  const interrupt = useCallback(() => {
    stopSpeaking();
    listenAgain();
  }, [listenAgain]);

  const chatShown = useRef(true);
  useEffect(() => {
    chatShown.current = phone ? tab === 'chat' : !folded;
    if (chatShown.current) setUnread(false);
  }, [phone, tab, folded]);
  const onReply = useCallback(
    (done: TurnDone) => {
      if (done.hint) {
        showHint(done.hint);
        play('hint');
      }
      if (document.hidden) play('reply');
      if (!chatShown.current) {
        setUnread(true);
        notify({ title: 'The interviewer replied', action: { label: 'Open the chat', onClick: () => (phone ? setTab('chat') : setFolded(false)) }, duration: 8000 });
      }
      if (voiceRef.current && speechSupported() && done.reply.trim()) {
        mic.current?.stop();
        setSpeaking(true);
        speak(done.reply, document.documentElement.lang || 'en-US', listenAgain);
      } else if (voiceRef.current) mic.current?.start();
    },
    [showHint, play, phone, setFolded, listenAgain],
  );
  const session = useMockInterview(id, onReply);
  const { interview, messages, streaming, busy, error } = session;

  const active = interview?.status === 'active';
  const now = useNow(active);
  const left = interview ? interview.minutes * 60_000 - (now - interview.startedAt) : 0;
  const timeUp = interview?.deadline !== undefined && now >= interview.deadline;
  const phase = interview ? shownPhase(interview, now) : 'clarify';
  const flash = useClockCues(left, active, play);
  const pulse = usePhaseCue(phase, play);
  const { credits } = useCredits(true);
  const outOfCredits = active && (session.outOfCredits || (credits !== undefined && credits.balance <= 0));

  // The verdict is in.
  useEffect(() => {
    if (interview?.status === 'finished' && interview.verdict) {
      play('finish');
      onVerdict(session);
    }
    // Once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.status, interview?.verdict]);

  // The composer's draft, with the words the mic is hearing after it.
  const [draft, setDraft] = useState('');
  const [interim, setInterim] = useState('');
  const [heardAt, setHeardAt] = useState<number>();
  const [cancelled, setCancelled] = useState(false);
  const onText = useCallback((text: string, final: boolean) => {
    setHeardAt(Date.now());
    setCancelled(false);
    if (final) {
      setInterim('');
      if (text) setDraft((d) => joinPhrase(d, text, MAX_MESSAGE));
    } else setInterim(text);
  }, []);
  const shown = interim ? joinPhrase(draft, interim, MAX_MESSAGE) : draft;
  const said = shown.trim();
  const onMicState = useCallback((s: MicState) => {
    setMicState(s);
    if (s === 'starting' || s === 'listening') stopSpeaking();
  }, []);

  // Talking hands-free: the mic starts with voice mode (and the session) and stops with text mode.
  useEffect(() => {
    if (!active) return;
    if (voice) mic.current?.start();
    else {
      mic.current?.stop();
      stopSpeaking();
      setSpeaking(false);
    }
  }, [voice, active]);

  const send = useCallback(
    async (input: { message: string; design?: string; advance?: boolean }) => {
      mic.current?.stop();
      stopSpeaking();
      setInterim('');
      setDraft('');
      setHeardAt(undefined);
      const kept = await session.send(input);
      if (!kept) setDraft(input.message);
      // A reply is spoken first (voice mode listens again after it); without one, listen now.
      if (!kept && voiceRef.current) mic.current?.start();
    },
    [session],
  );

  // Send on silence (voice mode): a countdown from the last words heard, ticking while due.
  const due = voice && !busy && !speaking && active && !timeUp ? autoSendLeft({ text: draft, interim, heardAt, cancelled }, Date.now()) : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (due === undefined) return;
    if (due === 0) {
      void send({ message: draft.trim() });
      return;
    }
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(100, due));
    return () => clearTimeout(timer);
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (said) void send({ message: said });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };
  const sendDesign = (message = said || 'Here is my design.') => void send({ message, design: board.getSource() });

  const finish = async () => {
    if (busy || !interview) return;
    if (!timeUp && !(await confirm({ title: 'Finish the interview and get the verdict?', body: 'You cannot continue it afterwards.', confirmLabel: 'Finish' }))) return;
    mic.current?.stop();
    stopSpeaking();
    await session.finish();
  };
  const exit = async () => {
    if (await confirm({ title: 'Leave the interview?', body: 'It stays open on the server: come back to it from Mock interview until you start another one.', confirmLabel: 'Leave' })) {
      mic.current?.stop();
      stopSpeaking();
      onExit();
    }
  };
  const check = () => {
    const result = board.check();
    if (!result.blocked) play(result.solved ? 'pass' : 'fail');
  };

  const clearToasts = useToastClearance();
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chat.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  if (session.loadError) {
    return (
      <Notice text={`This interview could not be loaded (${session.loadError}).`}>
        <button type="button" onClick={onRestart} className={primaryButton}>
          Set up a new interview
        </button>
        <button type="button" onClick={onExit} className={toolButton}>
          Leave
        </button>
      </Notice>
    );
  }
  if (!interview) return <p className="px-4 py-6 text-sm text-muted">Loading the interview…</p>;
  if (interview.status === 'failed') {
    return (
      <Notice text="The interviewer stopped working early in this interview. Answers that failed on our side were not charged. Start again when you are ready.">
        <button type="button" onClick={onRestart} className={primaryButton}>
          Set up a new interview
        </button>
        <button type="button" onClick={onExit} className={toolButton}>
          Leave
        </button>
      </Notice>
    );
  }

  const canTalk = active && !timeUp && !busy;
  const listening = micState === 'listening' || micState === 'transcribing';
  const nextPhase = phase !== 'wrapup' ? PHASES[phaseIndex(phase) + 1] : undefined;

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Mock interview" role="region">
      <div ref={chat} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite" aria-busy={busy === 'turn'}>
        <details className="rounded-sm border-bw-1 border-ink bg-surface" open={messages.length <= 1 || undefined}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-ink">The problem: {problem.title}</summary>
          <div className="border-t-bw-1 border-ink/30 px-3 py-2">
            <Markdown source={statement} />
          </div>
        </details>
        {outOfCredits && (
          <aside aria-label="Out of credits" data-testid="out-of-credits" className="flex items-start gap-2 rounded-sm border-bw-1 border-ink/40 bg-surface px-3 py-2 text-sm text-ink">
            <Coins size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>You&rsquo;re out of credits, so the interviewer is wrapping up. Your verdict is already paid for: finish when you&rsquo;re ready.</p>
          </aside>
        )}
        <ol aria-label="Conversation" className="space-y-3">
          {messages.map((m, i) => (
            <ChatMessage key={`${m.at}-${i}`} message={m} />
          ))}
          {streaming !== undefined && <ChatMessage message={{ role: 'interviewer', text: streaming || '…', at: 0 }} pending />}
        </ol>
      </div>

      <form ref={clearToasts} onSubmit={submit} aria-label="Your answer" className="shrink-0 space-y-2 border-t-bw-1 border-ink bg-surface px-3 py-2.5">
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {timeUp ? (
          <p className="text-sm text-ink">The interview has reached its 60 minutes. Get the verdict to see how it went.</p>
        ) : (
          <>
            {voice && (
              <VoiceStatus speaking={speaking} listening={listening} due={due} onInterrupt={interrupt} onCancel={() => setCancelled(true)} onSendNow={() => void send({ message: said })} />
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="interview-message" className="sr-only">
                Your answer
              </label>
              <textarea
                id="interview-message"
                value={shown}
                onChange={(e) => {
                  setInterim('');
                  setCancelled(true);
                  stopSpeaking();
                  setSpeaking(false);
                  setDraft(e.target.value.slice(0, MAX_MESSAGE));
                }}
                onKeyDown={onKey}
                rows={voice ? 2 : 3}
                placeholder={voice ? (listening ? 'Listening… say your answer' : 'Your words show here') : 'Ask a question or explain your thinking'}
                disabled={!active}
                className={`min-w-0 flex-1 resize-none ${field}`}
              />
              <div className="flex flex-col gap-1.5">
                <MicButton ref={mic} onText={onText} onState={onMicState} disabled={!active} />
                <button type="submit" disabled={!canTalk || !said} className={`${primaryButton} justify-center disabled:opacity-50`} aria-label="Send">
                  <Send size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" disabled={!canTalk} onClick={() => sendDesign()} className={`${toolButton} !px-2 disabled:opacity-50`} title="Send the whiteboard with your message; the interviewer sees it and its test results">
                <Code2 size={14} aria-hidden="true" />
                Send my design
              </button>
              {nextPhase && (
                <button
                  type="button"
                  disabled={!canTalk}
                  onClick={() => void send({ message: said || `I'd like to move on to the ${nextPhase.label.toLowerCase()} phase.`, advance: true })}
                  className={`${toolButton} !px-2 disabled:opacity-50`}
                  title="Move on to the next phase before the clock does"
                >
                  <ArrowRight size={14} aria-hidden="true" />
                  Next phase
                </button>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  );

  return (
    <Room
      problem={problem}
      board={board}
      phone={phone}
      phase={phase}
      pulse={pulse}
      clock={{ left, flash }}
      talk={{
        value: voice ? 'voice' : 'text',
        voiceOk,
        onChange: (t) => {
          setTalk(t);
          setCancelled(true);
        },
      }}
      sound={{ on: soundOn, onChange: setSound }}
      code={{ shown: codeShown, onChange: setCode }}
      onCheck={check}
      finish={{ label: 'Finish and get the verdict', busy: busy === 'finish', loud: timeUp || outOfCredits, disabled: !!busy || !active, onClick: () => void finish() }}
      onExit={() => void exit()}
      rail={{ title: 'Interview', content: rail, folded, onFold: setFolded, unread }}
      checks={
        board.run && (
          <ChecksSheet run={board.run.result} stale={board.run.source !== board.source} onClose={board.closeRun}>
            {canTalk && (
              <button
                type="button"
                onClick={() => {
                  board.closeRun();
                  sendDesign();
                }}
                className={outlineButton}
              >
                <Code2 size={14} aria-hidden="true" />
                Send my design to the interviewer
              </button>
            )}
          </ChecksSheet>
        )
      }
      tab={tab}
      onTab={setTab}
    />
  );
}

/** Voice mode's line over the box: listening, the countdown to send (with Cancel), or the interviewer speaking (with Interrupt). */
function VoiceStatus({ speaking, listening, due, onInterrupt, onCancel, onSendNow }: { speaking: boolean; listening: boolean; due?: number; onInterrupt: () => void; onCancel: () => void; onSendNow: () => void }) {
  if (speaking) {
    return (
      <div role="status" data-testid="voice-status" data-state="speaking" className="flex items-center gap-2 rounded-sm bg-pop-blue/15 px-2 py-1.5 text-xs font-semibold text-ink">
        <Bot size={14} aria-hidden="true" />
        <span className="flex-1">The interviewer is speaking; the mic waits.</span>
        <button type="button" onClick={onInterrupt} className={`${toolButton} !px-2 !py-1 text-xs`}>
          <Hand size={13} aria-hidden="true" />
          Interrupt
        </button>
      </div>
    );
  }
  if (due !== undefined) {
    const seconds = (due / 1000).toFixed(1);
    return (
      <div role="status" data-testid="voice-status" data-state="sending" className="relative overflow-hidden rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-2 py-1.5 text-xs font-semibold text-ink">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-pop-yellow/50 transition-[width] duration-100 ease-linear" style={{ width: `${100 - (due / 1800) * 100}%` }} />
        <span className="relative flex items-center gap-2">
          <Send size={13} aria-hidden="true" />
          <span className="flex-1 tabular-nums">Sending in {seconds} s</span>
          <button type="button" onClick={onSendNow} className="underline underline-offset-2">
            Send now
          </button>
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-0.5 underline underline-offset-2">
            <X size={12} aria-hidden="true" />
            Cancel
          </button>
        </span>
      </div>
    );
  }
  return (
    <p role="status" data-testid="voice-status" data-state={listening ? 'listening' : 'idle'} className="flex items-center gap-1.5 text-xs text-muted">
      <Mic size={13} aria-hidden="true" />
      {listening ? 'Listening. Pause for a moment and your answer is sent.' : 'Voice mode: tap the mic to listen.'}
    </p>
  );
}

function ChatMessage({ message, pending }: { message: AiMessage; pending?: boolean }) {
  const mine = message.role === 'candidate';
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'} gap-1.5`}>
      <div
        className={`max-w-[92%] rounded-sm border-bw-1 px-3 py-2 text-sm text-ink ${mine ? 'border-ink bg-pop-yellow/25' : 'border-ink/30 bg-surface'} ${pending ? 'opacity-90' : ''}`}
        aria-label={mine ? 'You' : 'Interviewer'}
      >
        <p className={`mb-0.5 text-xs font-bold ${mine ? 'text-ink/70' : 'text-muted'}`}>{mine ? 'You' : 'Interviewer'}</p>
        {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
        {message.design && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-muted">
            <Code2 size={12} aria-hidden="true" />
            Design sent
          </p>
        )}
      </div>
      {message.hint && <HintMarker hint={message.hint} />}
    </li>
  );
}

/** A coaching hint, inline under the reply it came with. */
function HintMarker({ hint }: { hint: Hint }) {
  const Icon = HINT_ICON[hint.kind];
  return (
    <aside aria-label={`Coaching: ${HINT_LABEL[hint.kind]}`} data-testid="coaching-card" className={`flex max-w-[92%] items-start gap-1.5 rounded-sm border-l-[6px] border-ink px-2.5 py-1.5 text-xs text-ink ${HINT_STYLE[hint.kind]}`}>
      <Icon size={13} className="mt-px shrink-0" aria-hidden="true" />
      <span>
        <strong>{HINT_LABEL[hint.kind]}:</strong> {hint.text}
      </span>
    </aside>
  );
}

function Notice({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <section aria-label="Mock interview" className="mx-auto max-w-xl space-y-3 px-4 py-10">
      <p role="alert" className="flex items-start gap-2 rounded-sm border-bw-1 border-ink bg-pop-pink/25 px-3 py-2 text-sm text-ink">
        <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        {text}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
