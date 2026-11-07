import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, CreditCard, Dices, Keyboard, Mic, RotateCcw, ShieldCheck, Sparkles, TextSearch, Timer, User, Volume2, VolumeX } from 'lucide-react';
import listings from 'virtual:practice-listings';
import { eyebrow, field, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { apiEnabled } from '../../services/api';
import { showsUpgrade, useFeature } from '../../components/featureState';
import UpgradeHint from '../../components/UpgradeHint';
import { billingEnabled, checkout, PRICES } from '../../services/billing';
import { formatCredits, formatRange, interviewEstimate, type Range } from '../../services/credits';
import { refreshCredits, useCredits, useEstimates } from '../../services/useCredits';
import { voiceSupported } from '../../voice/recognizer';
import { DIFFICULTIES, type Problem } from '../types';
import { DifficultyBadge } from '../Badges';
import { DEFAULT_DURATION, DURATIONS, PHASES, PHASE_SHARE, startSession, type Duration } from '../modes/session';
import { loadSession, saveSession } from '../modes/store';
import { giveConsent, listInterviews, saveActive, startError, startInterview, type AiInterview } from '../modes/ai/api';
import { interviewPool, pickProblem, poolTopics } from './pick';
import { loadDone, loadLast, recordStart, saveDesign, useSoundPref, useTalkPref, type Kind } from './prefs';
import { playCue } from './sounds';
import MicCheck from './MicCheck';
import ProblemPicker from './ProblemPicker';

/**
 * Step 1 of the mock interview (docs/design/paid-plans.md P45): who
 * interviews you (the interviewer, or on your own for free), the problem
 * ("Surprise me" by default: a random one not done yet, kept hidden until the
 * room), the length, voice or text with a mic check, sound, and what it
 * costs. Start opens the room.
 */

type ProblemChoice = 'surprise' | 'choose' | 'last';

interface SetupProps {
  /** `?problem=<id>`: the problem page's "Interview mode", or a deep link. */
  preselect?: string;
  /** `?with=mock` (or the older `?interview=mock` on a problem): the interviewer chosen. */
  prefer?: Kind;
  /** The interview has started on `problem`: open the room. */
  onStarted: (problem: string) => void;
}

const titleOf = (id: string) => listings.find((p) => p.id === id)?.title ?? id;

export default function Setup({ preselect, prefer, onStarted }: SetupProps) {
  const aiFeature = useFeature('ai_interview');
  const ai = aiFeature.ok && apiEnabled;
  /** The server's sessions: whether it has the interviewer, the problems done, one still open. */
  const [server, setServer] = useState<{ interviews: AiInterview[] } | null>();
  useEffect(() => {
    if (!ai) return;
    let live = true;
    void listInterviews().then((r) => live && setServer(r ?? null));
    return () => {
      live = false;
    };
  }, [ai]);
  const { credits } = useCredits(ai);
  const canMock = ai && !!server && !!credits;
  const [kindChoice, setKind] = useState<Kind>(prefer ?? 'mock');
  const kind: Kind = canMock ? kindChoice : 'solo';

  const known = preselect && listings.some((p) => p.id === preselect) ? preselect : undefined;
  const [last] = useState(loadLast);
  const [choice, setChoice] = useState<ProblemChoice>(known ? 'choose' : 'surprise');
  const [chosen, setChosen] = useState<string | undefined>(known);
  const [picking, setPicking] = useState(false);
  const [difficulty, setDifficulty] = useState<Problem['difficulty']>();
  const [topic, setTopic] = useState('');
  const topics = useMemo(() => poolTopics(listings), []);
  const pool = useMemo(() => interviewPool(listings, { difficulty, topic: topic || undefined }), [difficulty, topic]);
  const done = useMemo(() => [...new Set([...(server?.interviews.map((i) => i.problem) ?? []), ...loadDone()])], [server]);

  const [duration, setDuration] = useState<Duration>(last?.minutes ?? DEFAULT_DURATION);
  const [talk, setTalk] = useTalkPref();
  const voiceOk = useMemo(() => voiceSupported(true), []);
  const [soundOn, setSound] = useSoundPref();

  const deepFeature = useFeature('deep_mode');
  const [deepChoice, setDeep] = useState(false);
  const deep = deepFeature.ok && deepChoice;
  const estimates = useEstimates(ai);
  const estimate = interviewEstimate(estimates, duration, deep);
  const [short, setShort] = useState<{ needed: number; balance: number }>();
  const balance = credits?.balance ?? 0;
  const notEnough = kind === 'mock' && (short !== undefined || (credits !== undefined && balance < estimate.min));

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  /** A start refused because a mock interview is open (409 active_session): resume it, or end it and start this one. */
  const [conflict, setConflict] = useState<{ id: string; problem: string; next: string }>();
  const open = server?.interviews.find((i) => i.status === 'active' || i.status === 'finishing');
  const soloOpen = useMemo(() => listings.map((p) => loadSession(p.id)).find((s) => s && s.finishedAt === undefined), []);

  const resume = (problem: string, id?: string) => {
    if (id) saveActive(problem, id);
    onStarted(problem);
  };

  const problemFor = (): string | undefined => {
    if (choice === 'choose') return chosen;
    if (choice === 'last') return last?.problem;
    return pickProblem(pool, done, Math.random, last?.problem);
  };

  const begin = (problem: string) => {
    saveDesign(problem, undefined);
    recordStart({ problem, kind, minutes: duration });
    onStarted(problem);
  };

  const startMock = async (problem: string, replace = false) => {
    setStarting(true);
    setError(undefined);
    try {
      giveConsent();
      const { interview } = await startInterview(problem, duration, replace, deep);
      refreshCredits();
      saveActive(problem, interview.id);
      begin(problem);
    } catch (e) {
      const why = startError(e);
      if (why.code === 'active_session') setConflict({ id: why.id, problem: why.problem, next: problem });
      else if (why.code === 'no_credits') {
        setShort({ needed: why.needed, balance: why.balance });
        refreshCredits();
      } else setError(`The interview could not start (${why.message}). Try again in a moment.`);
    } finally {
      setStarting(false);
    }
  };

  const start = () => {
    const problem = problemFor();
    if (!problem) return setError(choice === 'choose' ? 'Choose a problem first.' : 'No problem matches these filters; clear one of them.');
    if (kind === 'solo') {
      saveSession(startSession(problem, duration, Date.now()), problem);
      return begin(problem);
    }
    void startMock(problem);
  };

  const problemSummary = choice === 'surprise' ? 'A surprise, shown in the room' : choice === 'last' && last ? titleOf(last.problem) : chosen ? titleOf(chosen) : 'Not chosen yet';

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:pt-10">
      <StepTrail />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Mock interview</h1>
          <p className="mt-1 max-w-xl text-base text-ink/80">A system design interview on a whiteboard, with a clock and an interviewer to talk to. Set it up, then step into the room.</p>
        </div>
      </div>

      {open && (
        <Banner icon={<Bot size={16} aria-hidden="true" />} testId="open-interview">
          <span className="flex-1">You have a mock interview in progress ({titleOf(open.problem)}).</span>
          <button type="button" onClick={() => resume(open.problem, open.id)} className={primaryButton}>
            Resume it
          </button>
        </Banner>
      )}
      {!open && soloOpen && (
        <Banner icon={<User size={16} aria-hidden="true" />} testId="open-solo">
          <span className="flex-1">You have an interview on your own in progress ({titleOf(soloOpen.problem)}).</span>
          <button type="button" onClick={() => resume(soloOpen.problem)} className={outlineButton}>
            Resume it
          </button>
        </Banner>
      )}

      {conflict ? (
        <section aria-label="Mock interview in progress" className="mt-6 max-w-xl space-y-3 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-sm">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <Bot size={18} aria-hidden="true" />
            You have a mock interview in progress
          </h2>
          <p className="text-sm text-ink">It is on {titleOf(conflict.problem)}. You can have one mock interview at a time.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" autoFocus onClick={() => resume(conflict.problem, conflict.id)} className={primaryButton}>
              Resume it
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => {
                const next = conflict.next;
                setConflict(undefined);
                void startMock(next, true);
              }}
              className={`${outlineButton} disabled:opacity-50`}
            >
              End it and start a new one
            </button>
            <button type="button" onClick={() => setConflict(undefined)} className={toolButton}>
              Back
            </button>
          </div>
          <p className="text-xs text-muted">The credits the old interview used are not returned, and it gets no verdict.</p>
        </section>
      ) : (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label="Set up the interview" className="space-y-6">
            {canMock && (
              <Field legend="Interviewer">
                <div role="radiogroup" aria-label="Interviewer" className="grid gap-2 sm:grid-cols-2">
                  <Choice checked={kind === 'mock'} onSelect={() => setKind('mock')} icon={<Bot size={16} aria-hidden="true" />} title="Mock interview">
                    A live interviewer who answers, follows up, coaches you and gives a verdict.
                  </Choice>
                  <Choice checked={kind === 'solo'} onSelect={() => setKind('solo')} icon={<User size={16} aria-hidden="true" />} title="On my own (free, no interviewer)">
                    The same room and clock; pick questions from a list and check your estimates.
                  </Choice>
                </div>
              </Field>
            )}

            <Field legend="Problem">
              <div role="radiogroup" aria-label="Problem" className="flex flex-wrap gap-2">
                <Pill checked={choice === 'surprise'} onSelect={() => setChoice('surprise')} icon={<Dices size={14} aria-hidden="true" />}>
                  Surprise me
                </Pill>
                <Pill
                  checked={choice === 'choose'}
                  onSelect={() => {
                    setChoice('choose');
                    if (!chosen) setPicking(true);
                  }}
                  icon={<TextSearch size={14} aria-hidden="true" />}
                >
                  Choose a problem
                </Pill>
                {last && (
                  <Pill checked={choice === 'last'} onSelect={() => setChoice('last')} icon={<RotateCcw size={14} aria-hidden="true" />}>
                    Same as last time
                  </Pill>
                )}
              </div>
              {choice === 'surprise' && (
                <div className="mt-3 space-y-3 rounded-sm border-bw-1 border-ink/25 bg-surface p-3">
                  <p className="text-sm text-ink/80">A random problem you haven&rsquo;t done in an interview yet, revealed when the interview starts, as in a real one.</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div role="radiogroup" aria-label="Difficulty" className="flex flex-wrap items-center gap-1">
                      <span className={`${eyebrow} mr-1`}>Difficulty</span>
                      {[undefined, ...DIFFICULTIES].map((d) => (
                        <button
                          key={d ?? 'any'}
                          type="button"
                          role="radio"
                          aria-checked={difficulty === d}
                          onClick={() => setDifficulty(d)}
                          className={`rounded-sm border-bw-1 px-2 py-0.5 text-xs font-semibold capitalize ${difficulty === d ? 'border-ink bg-ink text-paper' : 'border-ink/30 text-ink hover:border-ink'}`}
                        >
                          {d ?? 'Any'}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2">
                      <span className={eyebrow}>Topic</span>
                      <select value={topic} onChange={(e) => setTopic(e.target.value)} className={`${field} !py-1`}>
                        <option value="">Any</option>
                        {topics.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-muted" data-testid="pool-size">
                    {pool.length === 0 ? 'No problem matches these filters.' : `${pool.length} problem${pool.length === 1 ? '' : 's'} to draw from, ${pool.filter((p) => !done.includes(p.id)).length} not done yet.`}
                  </p>
                </div>
              )}
              {choice === 'choose' && chosen && (
                <div className="mt-3 flex items-center gap-3 rounded-sm border-bw-1 border-ink bg-surface p-3" data-testid="chosen-problem">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{titleOf(chosen)}</span>
                    <span className="block truncate text-xs text-muted">{listings.find((p) => p.id === chosen)?.summary}</span>
                  </span>
                  <DifficultyBadge difficulty={listings.find((p) => p.id === chosen)?.difficulty ?? 'easy'} />
                  <button type="button" onClick={() => setPicking(true)} className={toolButton}>
                    Change
                  </button>
                </div>
              )}
              {choice === 'last' && last && <p className="mt-2 text-sm text-ink/80">{titleOf(last.problem)} again.</p>}
            </Field>

            <Field legend="Length">
              <div role="radiogroup" aria-label="Interview length" className="flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={duration === d}
                    onClick={() => {
                      setDuration(d);
                      setShort(undefined);
                    }}
                    className={`rounded-sm border-bw-1 px-3 py-1.5 text-sm font-semibold ${duration === d ? 'border-ink bg-ink text-paper' : 'border-ink/40 text-ink hover:border-ink'}`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
              <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Time per phase">
                {PHASES.map((p, i) => (
                  <li key={p.id}>
                    <span className="font-semibold text-ink">
                      {i + 1}. {p.label}
                    </span>{' '}
                    about {Math.round(duration * PHASE_SHARE[p.id])} min
                  </li>
                ))}
              </ol>
            </Field>

            {kind === 'mock' && (
              <Field legend="How you talk">
                <div role="radiogroup" aria-label="How you talk" className="grid gap-2 sm:grid-cols-2">
                  <Choice checked={talk === 'voice' && voiceOk} disabled={!voiceOk} onSelect={() => setTalk('voice')} icon={<Mic size={16} aria-hidden="true" />} title="Voice">
                    {voiceOk ? 'Speak your answers hands-free; the interviewer answers out loud.' : 'This browser cannot listen; use text.'}
                  </Choice>
                  <Choice checked={talk === 'text' || !voiceOk} onSelect={() => setTalk('text')} icon={<Keyboard size={16} aria-hidden="true" />} title="Text">
                    Type your answers, as in a chat. You can switch at any time.
                  </Choice>
                </div>
                {talk === 'voice' && voiceOk && (
                  <div className="mt-3 rounded-sm border-bw-1 border-ink/25 bg-surface p-3">
                    <MicCheck />
                  </div>
                )}
              </Field>
            )}

            <Field legend="Sound">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
                <input type="checkbox" role="switch" checked={soundOn} onChange={(e) => setSound(e.target.checked)} className="h-4 w-4 accent-ink" data-testid="setup-sound" />
                {soundOn ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
                <span>
                  Sound effects <span className="text-muted">for a new phase, the last minutes, a hint and the end</span>
                </span>
              </label>
              {soundOn && (
                <button type="button" onClick={() => playCue('phase')} className={`${toolButton} mt-1 !px-1.5 !py-0.5 text-xs`}>
                  Play a sample
                </button>
              )}
            </Field>

            {kind === 'mock' && deepFeature.ok && (
              <label data-testid="interview-deep" className={`flex cursor-pointer items-start gap-2.5 rounded-sm border-bw-1 px-3 py-2 text-sm text-ink ${deep ? 'border-ink bg-pop-lilac/25' : 'border-ink/30 hover:border-ink'}`}>
                <input
                  type="checkbox"
                  checked={deep}
                  onChange={(e) => {
                    setDeep(e.target.checked);
                    setShort(undefined);
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Sparkles size={13} aria-hidden="true" />
                    Deep verdict
                  </span>
                  <span className="mt-0.5 block text-xs text-ink/80">
                    A stronger model takes longer over your verdict. The interview itself is the same; the verdict costs about {formatCredits(estimates.deepMultiplier)}× as much.
                  </span>
                </span>
              </label>
            )}
            {kind === 'mock' && !deepFeature.ok && showsUpgrade(deepFeature) && (
              <p data-testid="interview-deep-hint" className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                Want a more thorough verdict? Deep verdicts come with Max.
                <UpgradeHint icon={false}>See Max</UpgradeHint>
              </p>
            )}
          </section>

          <aside aria-label="Your interview" className="lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-4 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
              <dl className="space-y-2 text-sm">
                <Row term="Interviewer">{kind === 'mock' ? 'Mock interview' : 'On your own'}</Row>
                <Row term="Problem">{problemSummary}</Row>
                <Row term="Length">{duration} min</Row>
                {kind === 'mock' && <Row term="You talk by">{talk === 'voice' && voiceOk ? 'Voice' : 'Text'}</Row>}
              </dl>
              {kind === 'mock' && credits ? (
                <InterviewCost estimate={estimate} minutes={duration} balance={balance} short={short} notEnough={notEnough} />
              ) : (
                <p className="text-xs text-muted">Free. Your time per phase, answers and summary stay in this browser.</p>
              )}
              {kind === 'mock' && (
                <p className="flex items-start gap-1.5 text-xs text-muted" data-testid="consent-line">
                  <ShieldCheck size={13} className="mt-px shrink-0" aria-hidden="true" />
                  <span>
                    Your interviewer is Claude, an AI model made by Anthropic. Starting sends Anthropic what you type or say, the design you send and the problem; Proschi keeps the transcript 90 days.{' '}
                    <a href="../docs/privacy/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
                      Privacy
                    </a>
                  </span>
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}
              <button type="button" onClick={start} disabled={starting || notEnough || (kind === 'mock' && !credits)} className={`${primaryButton} w-full justify-center !py-2.5 text-base disabled:opacity-50`}>
                {kind === 'mock' ? <Bot size={16} aria-hidden="true" /> : <Timer size={16} aria-hidden="true" />}
                {starting ? 'Starting…' : kind === 'mock' ? 'Start the mock interview' : 'Start the interview'}
              </button>
              {ai && server === undefined && <p className="text-xs text-muted">Checking the interviewer…</p>}
            </div>
          </aside>
        </div>
      )}
      {picking && (
        <ProblemPicker
          problems={listings}
          done={done}
          chosen={chosen}
          onPick={(id) => {
            setChosen(id);
            setChoice('choose');
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
            if (!chosen) setChoice('surprise');
          }}
        />
      )}
    </main>
  );
}

/** Where the set-up sits in the three steps. */
export function StepTrail({ at = 0 }: { at?: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-2 text-xs font-semibold text-muted">
      {['Set up', 'Interview', 'Result'].map((label, i) => (
        <li key={label} aria-current={i === at ? 'step' : undefined} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-ink/25" />}
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-bw-1 font-mono text-[11px] ${i === at ? 'border-ink bg-pop-yellow text-on-accent' : i < at ? 'border-ink bg-ink text-paper' : 'border-ink/30'}`}>{i + 1}</span>
          <span className={i === at ? 'text-ink' : ''}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Banner({ icon, testId, children }: { icon: ReactNode; testId: string; children: ReactNode }) {
  return (
    <div role="status" data-testid={testId} className="mt-5 flex flex-wrap items-center gap-3 rounded-sm border-bw-1 border-ink bg-pop-blue/15 px-3 py-2 text-sm text-ink">
      {icon}
      {children}
    </div>
  );
}

function Field({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 font-display text-base font-bold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right font-semibold text-ink">{children}</dd>
    </div>
  );
}

function Choice({ checked, disabled, onSelect, title, icon, children }: { checked: boolean; disabled?: boolean; onSelect: () => void; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-sm border-bw-1 px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'border-ink bg-pop-yellow/30 shadow-brutal-sm' : 'border-ink/40 bg-surface hover:border-ink'}`}
    >
      <span className="flex items-center gap-1.5 font-semibold text-ink">
        {icon}
        {title}
      </span>
      <span className="mt-0.5 block text-xs text-ink/80">{children}</span>
    </button>
  );
}

function Pill({ checked, onSelect, icon, children }: { checked: boolean; onSelect: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`inline-flex items-center gap-1.5 rounded-sm border-bw-1 px-3 py-1.5 text-sm font-semibold ${checked ? 'border-ink bg-ink text-paper' : 'border-ink/40 bg-surface text-ink hover:border-ink'}`}
    >
      {icon}
      {children}
    </button>
  );
}

/** What a mock interview of this length is likely to cost against the balance; without enough, the ways to get more. */
function InterviewCost({ estimate, minutes, balance, short, notEnough }: { estimate: Range; minutes: number; balance: number; short?: { needed: number; balance: number }; notEnough: boolean }) {
  const [buying, setBuying] = useState(false);
  const [failed, setFailed] = useState<string>();
  const have = formatCredits(short?.balance ?? balance, { floor: true });
  if (!notEnough) {
    return (
      <div data-testid="ai-credits" className="rounded-sm border-bw-1 border-ink/30 bg-paper px-3 py-2 text-sm text-ink">
        <p>
          <strong className="tabular-nums">{formatRange(estimate)} credits</strong> for {minutes} min; you have <strong className="tabular-nums">{have}</strong>.
        </p>
        <p className="mt-0.5 text-xs text-muted">
          You pay for what the interview uses
          {estimate.worst !== undefined && <span data-testid="ai-credits-cap">, never more than {formatCredits(Math.min(estimate.worst, short?.balance ?? balance), { floor: true })} credits</span>}. If you run out, the
          interviewer moves to the wrap-up and still gives you the verdict.
        </p>
      </div>
    );
  }
  const buy = () => {
    setBuying(true);
    setFailed(undefined);
    checkout('credits_1000').catch((e: unknown) => {
      setBuying(false);
      setFailed(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <div data-testid="ai-credits" data-enough="false" role="status" className="rounded-sm border-bw-1 border-ink bg-pop-yellow/15 px-3 py-2 text-sm text-ink">
      <p>
        You have <strong className="tabular-nums">{have} credits</strong>. A {minutes}-minute mock interview takes{' '}
        <strong className="tabular-nums">{short?.needed ? `at least ${formatCredits(short.needed)}` : formatRange(estimate)}</strong>.
      </p>
      <p className="mt-0.5 text-xs text-muted">Top-up credits never expire. A plan adds credits every month.</p>
      {failed && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {failed}
        </p>
      )}
      {billingEnabled && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={buy} disabled={buying} className={`${primaryButton} disabled:opacity-50`}>
            <CreditCard size={14} aria-hidden="true" />
            {buying ? 'Opening…' : `Buy ${formatCredits(PRICES.topupCredits)} credits, €${PRICES.topup}`}
          </button>
          <UpgradeHint testId="ai-upgrade" className={outlineButton}>
            See plans
          </UpgradeHint>
        </div>
      )}
    </div>
  );
}

