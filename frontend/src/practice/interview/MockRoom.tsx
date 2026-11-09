import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, ChevronUp, CircleAlert, Code2, Coins, Hand, MessagesSquare, Mic, Send, Table2, X } from 'lucide-react';
import { confirm, notify } from '../../design/dialogs';
import { useToastClearance, useToastInset } from '../../design/toastClearance';
import { field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import MicButton, { type MicButtonHandle } from '../../voice/MicButton';
import { voiceSupported, type MicState } from '../../voice/recognizer';
import { speak, speechSupported, stopSpeaking } from '../../voice/speaker';
import { joinPhrase } from '../../voice/useVoiceDraft';
import { useCredits } from '../../services/useCredits';
import type { Engine } from '../../hld/engine';
import type { Problem } from '../types';
import { useNow } from '../modes/useNow';
import type { Phase } from '../modes/session';
import { redactedStatement } from '../modes/interviewFile';
import { shownPhase, type AiMessage, type Hint, type TurnDone } from '../modes/ai/api';
import { HINT_ICON, HINT_LABEL, HINT_STYLE } from '../modes/ai/hints';
import { AUTO_SEND_MS, autoSendLeft } from './autoSend';
import { useCodePref, useRailFoldedPref, useSoundPref, useTalkPref } from './prefs';
import Room, { ChecksSheet, type RoomTab } from './Room';
import { Brief, PinnedBrief, RequirementsCard, StageContext, StageHeading, StartClarifying, Worksheet, EstimatesSummary } from './StageParts';
import { loadBriefRead, loadStage, loadWorksheet, nextStage, saveBriefRead, saveStage, saveWorksheet, splitByStage, stageLabel, STARTER_ROWS, worksheetPayload, type WorksheetRow } from './stages';
import { useClockCues, useCues, usePhaseCue, useStageNudge, useWhiteboard } from './useRoom';
import { useMockInterview, type MockSession } from './useMock';

/**
 * A mock interview in the room (P45), a screen per stage (P49): Clarify
 * types the brief out (and reads it aloud in voice mode), then pins it over
 * a centred chat; Estimate puts the requirements learned and a worksheet
 * beside the chat, and each turn sends the worksheet and the stage; Design
 * and Wrap-up are the whiteboard with the chat on the right. Text: a typed
 * chat, with dictation on the mic. Voice: the mic listens hands-free, an
 * answer goes after a pause of silence (with a countdown to cancel), and the
 * interviewer's replies are spoken; the mic pauses while it speaks, and
 * Interrupt (or typing) cuts it off. Coaching hints come as toasts clear of
 * the chat and stay inline in it.
 */

const MAX_MESSAGE = 4000;
const MAX_HINT_TOASTS = 2;
const HINT_TOAST_MS = 15_000;
/** The rail's width on the desktop (Room.tsx), for the toasts' inset. */
const RAIL_PX = { base: 380, xl: 400, wide: 440, wideXl: 520, estimate: 420 };

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

  // The stage the user is on (P49): theirs to move on, kept in this browser per interview.
  const [savedStage] = useState(() => loadStage(id));
  const [chosen, setChosen] = useState<Phase>();
  const [viewing, setViewing] = useState<Phase>();
  const [briefRead, setBriefRead] = useState(() => loadBriefRead(id));
  const [rows, setRowsState] = useState<WorksheetRow[]>(() => loadWorksheet(id) ?? STARTER_ROWS.map((r) => ({ ...r })));
  const setRows = useCallback(
    (next: WorksheetRow[]) => {
      setRowsState(next);
      saveWorksheet(id, next);
    },
    [id],
  );

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
  const [speaking, setSpeakingState] = useState(false);
  const speakingRef = useRef(false);
  const setSpeaking = useCallback((on: boolean) => {
    speakingRef.current = on;
    setSpeakingState(on);
  }, []);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  const listenAgain = useCallback(() => {
    setSpeaking(false);
    if (voiceRef.current) mic.current?.start();
  }, [setSpeaking]);
  const interrupt = useCallback(() => {
    stopSpeaking();
    listenAgain();
  }, [listenAgain]);
  const say = useCallback(
    (text: string) => {
      if (!voiceRef.current || !speechSupported() || !text.trim()) return false;
      mic.current?.stop();
      setSpeaking(true);
      speak(text, document.documentElement.lang || 'en-US', listenAgain);
      return true;
    },
    [listenAgain, setSpeaking],
  );

  const replied = useRef<(done: TurnDone) => void>(() => {});
  const session = useMockInterview(id, useCallback((done: TurnDone) => replied.current(done), []));
  const { interview, messages, streaming, busy, error } = session;
  const stage: Phase = chosen ?? savedStage ?? interview?.phase ?? 'clarify';
  // The stage is fixed once the session loads: only Next moves it, never the server's clock (P49).
  useEffect(() => {
    if (interview && chosen === undefined) setChosen(stage);
  }, [interview, chosen, stage]);
  const shown = viewing ?? stage;
  const boardStage = stage === 'design' || stage === 'wrapup';

  const chatShown = useRef(true);
  useEffect(() => {
    chatShown.current = viewing ? false : phone ? stage === 'clarify' || tab === 'chat' : boardStage ? !folded : true;
    if (chatShown.current) setUnread(false);
  }, [phone, tab, folded, stage, viewing, boardStage]);
  const onReply = (done: TurnDone) => {
    if (done.hint) {
      showHint(done.hint);
      play('hint');
    }
    if (document.hidden) play('reply');
    if (!chatShown.current) {
      setUnread(true);
      notify({
        title: 'The interviewer replied',
        action: {
          label: 'Open the chat',
          onClick: () => {
            setViewing(undefined);
            if (phone) setTab('chat');
            else setFolded(false);
          },
        },
        duration: 8000,
      });
    }
    if (!say(done.reply) && voiceRef.current) mic.current?.start();
  };
  useEffect(() => {
    replied.current = onReply;
  });

  const active = interview?.status === 'active';
  const now = useNow(active);
  const left = interview ? interview.minutes * 60_000 - (now - interview.startedAt) : 0;
  const timeUp = interview?.deadline !== undefined && now >= interview.deadline;
  const flash = useClockCues(left, active, play);
  const pulse = usePhaseCue(stage, play);
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
  const typed = interim ? joinPhrase(draft, interim, MAX_MESSAGE) : draft;
  const said = typed.trim();
  const onMicState = useCallback((s: MicState) => {
    setMicState(s);
    if (s === 'starting' || s === 'listening') stopSpeaking();
  }, []);

  // Where the composer is: it moves with the stage, so the hands-free mic starts again where it lands.
  // The brief is typed out once, before the first question (not again for an interview already under way).
  const briefShown = stage === 'clarify' && !briefRead && !messages.some((m) => m.role === 'candidate');
  const composerAt = viewing || briefShown ? 'none' : boardStage ? 'rail' : stage;
  useEffect(() => {
    if (!active) return;
    if (voice) {
      if (!speakingRef.current) mic.current?.start();
    } else {
      mic.current?.stop();
      stopSpeaking();
      setSpeaking(false);
    }
  }, [voice, active, composerAt, setSpeaking]);

  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const send = useCallback(
    async (input: { message: string; design?: string; stage: Phase }) => {
      mic.current?.stop();
      stopSpeaking();
      setInterim('');
      setDraft('');
      setHeardAt(undefined);
      // The interviewer sees the stage and, from Estimate on, the worksheet (P49).
      const worksheet = input.stage !== 'clarify' ? worksheetPayload(rowsRef.current) : [];
      const kept = await session.send({ ...input, ...(worksheet.length ? { worksheet } : {}) });
      if (!kept) setDraft(input.message);
      // A reply is spoken first (voice mode listens again after it); without one, listen now.
      if (!kept && voiceRef.current) mic.current?.start();
    },
    [session],
  );

  // Send on silence (voice mode): a countdown from the last words heard, ticking while due.
  const due = voice && !busy && !speaking && active && !timeUp && composerAt !== 'none' ? autoSendLeft({ text: draft, interim, heardAt, cancelled }, Date.now()) : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (due === undefined) return;
    if (due === 0) {
      void send({ message: draft.trim(), stage });
      return;
    }
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(100, due));
    return () => clearTimeout(timer);
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (said) void send({ message: said, stage });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };
  const sendDesign = (message = said || 'Here is my design.') => void send({ message, design: board.getSource(), stage });

  const canTalk = active && !timeUp && !busy;
  const following = nextStage(stage);
  /** Next: the user moves on; the interviewer hears of it in a turn (with what is in the box), when one can go. */
  const goNext = () => {
    if (!following) return;
    setChosen(following);
    saveStage(id, following);
    setViewing(undefined);
    setTab('chat');
    if (canTalk && !outOfCredits) void send({ message: said || `I'm ready to move on to the ${stageLabel(following).toLowerCase()} stage.`, stage: following });
  };
  // The clock nudges when its phase passes the stage (the user still decides).
  useStageNudge(interview ? shownPhase({ minutes: interview.minutes, startedAt: interview.startedAt }, now) : 'clarify', stage, active && !timeUp, goNext, play);

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

  const xl = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches;
  const inset = phone || viewing ? 0 : boardStage ? (folded ? 0 : stage === 'wrapup' ? (xl ? RAIL_PX.wideXl : RAIL_PX.wide) : xl ? RAIL_PX.xl : RAIL_PX.base) : stage === 'estimate' ? RAIL_PX.estimate : 0;
  useToastInset(inset ? inset + 8 : 0);

  const clearToasts = useToastClearance();
  const chat = useRef<HTMLDivElement>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  useEffect(() => setEarlierOpen(false), [shown]);
  useEffect(() => {
    const el = chat.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, composerAt]);

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

  const listening = micState === 'listening' || micState === 'transcribing';
  const requirements = interview.known ?? [];

  /** The conversation of one stage, with the earlier stages behind an expander. */
  const log = (of: Phase, live: boolean, lead?: ReactNode) => {
    const { earlier, here } = splitByStage(messages, of);
    return (
      <div ref={live ? chat : undefined} className="min-h-0 flex-1 overflow-y-auto" aria-live={live ? 'polite' : undefined} aria-busy={live && busy === 'turn'}>
        <div className={`space-y-3 py-3 ${boardStage && live ? 'px-3' : 'mx-auto w-full max-w-2xl px-4'}`}>
          {lead}
          {earlier.length > 0 && (
            <div className="space-y-3">
              <button type="button" aria-expanded={earlierOpen} onClick={() => setEarlierOpen(!earlierOpen)} className="mx-auto flex items-center gap-1 rounded-full border-bw-1 border-ink/30 bg-surface px-3 py-1 text-xs font-semibold text-ink hover:border-ink" data-testid="show-earlier">
                <ChevronUp size={13} aria-hidden="true" className={earlierOpen ? '' : 'rotate-180'} />
                {earlierOpen ? 'Hide earlier stages' : `Show earlier stages (${earlier.length})`}
              </button>
              {earlierOpen && (
                <ol aria-label="Earlier stages" className="space-y-3 opacity-80">
                  {earlier.map((m, i) => (
                    <ChatMessage key={`${m.at}-${i}`} message={m} />
                  ))}
                </ol>
              )}
            </div>
          )}
          {live && outOfCredits && (
            <aside aria-label="Out of credits" data-testid="out-of-credits" className="flex items-start gap-2 rounded-sm border-bw-1 border-ink/40 bg-surface px-3 py-2 text-sm text-ink">
              <Coins size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>You&rsquo;re out of credits, so the interviewer is wrapping up. Your verdict is already paid for: finish when you&rsquo;re ready.</p>
            </aside>
          )}
          <ol aria-label={`Conversation: ${stageLabel(of)}`} className="space-y-3">
            {here.map((m, i) => (
              <ChatMessage key={`${m.at}-${i}`} message={m} />
            ))}
            {live && streaming !== undefined && <ChatMessage message={{ role: 'interviewer', text: streaming || '…', at: 0 }} pending />}
          </ol>
          {here.length === 0 && streaming === undefined && <p className="py-4 text-center text-sm text-muted">{live ? 'Nothing said on this stage yet.' : 'Nothing was said on this stage.'}</p>}
        </div>
      </div>
    );
  };

  const placeholder: Record<Phase, string> = {
    clarify: 'Ask a clarifying question',
    estimate: 'Walk through your numbers, or ask',
    design: 'Explain your design, or ask',
    wrapup: 'Talk through trade-offs and bottlenecks',
  };
  const composer = (
    <form ref={clearToasts} onSubmit={submit} aria-label="Your answer" className={`shrink-0 border-t-bw-1 border-ink bg-surface ${boardStage ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
      <div className={`space-y-2 ${boardStage ? '' : 'mx-auto w-full max-w-2xl'}`}>
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {timeUp ? (
          <p className="text-sm text-ink">The interview has reached its 60 minutes. Get the verdict to see how it went.</p>
        ) : (
          <>
            {voice && <VoiceStatus speaking={speaking} listening={listening} due={due} onInterrupt={interrupt} onCancel={() => setCancelled(true)} onSendNow={() => void send({ message: said, stage })} />}
            <div className="flex items-end gap-2">
              <label htmlFor="interview-message" className="sr-only">
                Your answer
              </label>
              <textarea
                id="interview-message"
                value={typed}
                onChange={(e) => {
                  setInterim('');
                  setCancelled(true);
                  stopSpeaking();
                  setSpeaking(false);
                  setDraft(e.target.value.slice(0, MAX_MESSAGE));
                }}
                onKeyDown={onKey}
                rows={voice ? 2 : 3}
                placeholder={voice ? (listening ? 'Listening… say your answer' : 'Your words show here') : placeholder[stage]}
                disabled={!active}
                className={`min-w-0 flex-1 resize-none ${field}`}
              />
              <div className="flex flex-col gap-1.5">
                <MicButton ref={mic} onText={onText} onState={onMicState} disabled={!active} />
                <button type="submit" disabled={!canTalk || !said} className={`${primaryButton} h-9 min-w-9 shrink-0 justify-center !p-0 !shadow-none disabled:opacity-50`} aria-label="Send">
                  <Send size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            {boardStage && (
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" disabled={!canTalk} onClick={() => sendDesign()} className={`${toolButton} !px-2 disabled:opacity-50`} title="Send the whiteboard with your message; the interviewer sees it and its test results">
                  <Code2 size={14} aria-hidden="true" />
                  Send my design
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );

  // The screens.
  let screen: ReactNode;
  if (viewing) {
    screen = (
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="past-stage">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6">
          <StageHeading stage={viewing} title={`${stageLabel(viewing)}, as it was`}>
            Read-only. The chat of {stageLabel(stage)} stays live: go back to ask or answer.
          </StageHeading>
          {viewing === 'clarify' && <PinnedBrief title={problem.title} source={statement} defaultOpen />}
          {viewing === 'estimate' && (
            <>
              <RequirementsCard items={requirements} />
              <Worksheet rows={rows} readOnly />
            </>
          )}
          {viewing === 'design' && <EstimatesSummary rows={rows} />}
          <section aria-label="Transcript" className="flex min-h-0 flex-col rounded-sm border-bw-1 border-ink/40 bg-paper">
            <h3 className="border-b border-ink/15 px-4 py-2 text-sm font-bold text-ink">What was said</h3>
            {log(viewing, false)}
          </section>
        </div>
      </div>
    );
  } else if (stage === 'clarify') {
    screen = briefShown ? (
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
        <Brief
          title={problem.title}
          source={statement}
          reveal
          onRevealStart={(text) => say(text)}
          footer={
            <StartClarifying
              note="The scale and the constraints aren't in the brief: ask the interviewer for them."
              onStart={() => {
                // Ready to talk: the reading stops, and in voice mode the mic listens.
                stopSpeaking();
                setSpeaking(false);
                setBriefRead(true);
                saveBriefRead(id);
              }}
            />
          }
        />
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-ink/10 bg-paper px-4 pb-3 pt-4">
          <div className="mx-auto w-full max-w-2xl space-y-3">
            <StageHeading stage="clarify" title="Ask about the requirements">
              Find the scale and the constraints before you estimate.
            </StageHeading>
            <PinnedBrief title={problem.title} source={statement} />
          </div>
        </div>
        <div role="region" aria-label="Mock interview" className="flex min-h-0 flex-1 flex-col">
          {log('clarify', true)}
          {composer}
        </div>
      </div>
    );
  } else if (stage === 'estimate') {
    const sheet = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
          <StageHeading stage="estimate" title="Back-of-the-envelope numbers">
            Write down the numbers the design needs. The interviewer sees the worksheet with each message.
          </StageHeading>
          <RequirementsCard items={requirements} empty="Nothing learned yet beyond the brief: ask in the chat." />
          <Worksheet rows={rows} onChange={setRows} />
        </div>
      </div>
    );
    const talkPane = (
      <div role="region" aria-label="Mock interview" className="flex h-full min-h-0 flex-col bg-paper">
        {log('estimate', true)}
        {composer}
      </div>
    );
    screen = phone ? (
      <>
        <div role="tablist" aria-label="Estimate" className="ps-tabs ps-tabs--fill flex bg-surface">
          {(
            [
              ['board', 'Worksheet', Table2],
              ['chat', 'Chat', MessagesSquare],
            ] as const
          ).map(([t, label, Icon]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="ps-tab relative !px-2">
              <Icon size={15} className="hidden min-[420px]:block" aria-hidden="true" />
              {label}
              {t === 'chat' && unread && tab !== 'chat' && <span aria-label="New message" className="absolute right-3 top-2 h-2 w-2 rounded-full bg-pop-pink" />}
            </button>
          ))}
        </div>
        <div className={tab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{talkPane}</div>
        <div className={tab !== 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{sheet}</div>
      </>
    ) : (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{sheet}</div>
        <aside aria-label="Chat" className="flex w-[420px] shrink-0 flex-col border-l-bw-1 border-ink" data-testid="interview-rail">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b-bw-1 border-ink bg-surface px-3">
            <MessagesSquare size={15} aria-hidden="true" />
            <h3 className="text-sm font-bold text-ink">Chat</h3>
          </div>
          {talkPane}
        </aside>
      </div>
    );
  }

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Mock interview" role="region">
      <StageContext requirements={requirements} rows={rows} />
      {log(
        stage,
        true,
        stage === 'wrapup' ? (
          <p className="rounded-sm border-l-[6px] border-ink bg-pop-yellow/20 px-3 py-2 text-sm text-ink">
            <strong>Wrap-up.</strong> Talk through the bottleneck, failure modes and one trade-off; the diagram stays editable.
          </p>
        ) : undefined,
      )}
      {composer}
    </div>
  );

  return (
    <Room
      problem={problem}
      board={board}
      phone={phone}
      phase={stage}
      viewing={viewing}
      onView={setViewing}
      next={following ? { label: `Next: ${stageLabel(following)}`, onClick: goNext, disabled: busy === 'finish' } : undefined}
      screen={screen}
      railWide={stage === 'wrapup'}
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
      rail={{ title: 'Chat', content: rail, folded, onFold: setFolded, unread }}
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
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-pop-yellow/50 transition-[width] duration-100 ease-linear" style={{ width: `${100 - (due / AUTO_SEND_MS) * 100}%` }} />
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
