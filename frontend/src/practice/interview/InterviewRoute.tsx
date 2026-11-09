import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultEngine, type Engine } from '../../hld/engine';
import { useIsPhone } from '../../onboarding/layout';
import PaneLoading from '../../components/PaneLoading';
import { loadProblem } from '../loadProblem';
import type { Problem } from '../types';
import { parseInterview } from '../modes/interviewFile';
import { interviewReducer, summarize, type InterviewAction, type InterviewSession, type InterviewSummary } from '../modes/session';
import { appendHistory, loadHistory, loadSession, saveSession } from '../modes/store';
import { loadActive, saveActive, type AiInterview } from '../modes/ai/api';
import type { AchievementsAnswer } from '../../learn/achievements';
import type { Achievements } from '../skills/useAchievements';
import { loadDesign, useSoundPref } from './prefs';
import { drewOn, sendSoloInterviews, soloSummaryCounts } from './record';
import ResultProgress from './ResultProgress';
import { roomHref, setupHref } from './links';
import { playCue } from './sounds';
import { billingEnabled } from '../../services/billing';
import Setup from './Setup';
import Result from './Result';
import MockRoom from './MockRoom';
import SoloRoom from './SoloRoom';

/**
 * The mock interview's pages (P45). `#/interview` is the set-up
 * (`?problem=<id>` preselects a problem, `?with=mock|solo` the interviewer);
 * `#/interview/<problem id>` is the room for the interview open on that
 * problem (a mock interview's id kept in this browser, or a session on your
 * own), and its result once it ends. With none open it goes back to the
 * set-up with the problem chosen.
 */

interface InterviewRouteProps {
  /** The route after `interview`: empty for the set-up, else the problem id. */
  problemId?: string;
  query: URLSearchParams;
  engine?: Engine;
  /** The site's header, over the set-up and the result (the room has its own bar). */
  header: ReactNode;
  /** The learner's progress (useAchievements): the result shows what the interview added to it. */
  achievements?: Achievements;
  /** Signed in: an interview on your own also goes to the account. */
  signedIn?: boolean;
}

export default function InterviewRoute({ problemId, query, engine = defaultEngine, header, achievements, signedIn = false }: InterviewRouteProps) {
  useEffect(() => {
    document.title = 'Mock interview · Proschi practice';
  }, []);
  if (!problemId) {
    const w = query.get('with');
    return (
      <Page header={header}>
        <Setup preselect={query.get('problem') ?? undefined} prefer={w === 'solo' ? 'solo' : w === 'mock' || w === 'ai' ? 'mock' : undefined} onStarted={(p) => (window.location.hash = roomHref(p))} />
      </Page>
    );
  }
  return <ProblemInterview key={problemId} id={problemId} engine={engine} header={header} achievements={achievements} signedIn={signedIn} />;
}

function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      {header}
      <div className="flex-1 bg-paper">{children}</div>
    </div>
  );
}

type Counting = { achievements?: Achievements; signedIn: boolean };

function ProblemInterview({ id, engine, header, ...counting }: { id: string; engine: Engine; header: ReactNode } & Counting) {
  const problem = use(loadProblem(id));
  if (!problem) {
    return (
      <Page header={header}>
        <p className="mx-auto max-w-4xl px-4 pt-6 text-sm text-red-700 dark:text-red-300">
          Problem “{id}” could not be loaded; reload the page to try again. <a href={setupHref()} className="underline">Set up an interview</a>
        </p>
      </Page>
    );
  }
  return <Interview problem={problem} engine={engine} header={header} {...counting} />;
}

function Interview({ problem, engine, header, achievements, signedIn }: { problem: Problem; engine: Engine; header: ReactNode } & Counting) {
  const phone = useIsPhone();
  const [soundOn] = useSoundPref();
  const file = useMemo(() => {
    if (problem.interview === undefined) return undefined;
    const read = parseInterview(problem.interview);
    return read.issues.length === 0 ? read.interview : undefined;
  }, [problem.interview]);
  const [mockId] = useState(() => (billingEnabled ? loadActive(problem.id) : undefined));
  const [session, setSession] = useState<InterviewSession | undefined>(() => (mockId ? undefined : loadSession(problem.id)));
  const [verdict, setVerdict] = useState<AiInterview>();
  const dispatch = useCallback((a: InterviewAction) => setSession((s) => s && interviewReducer(s, a)), []);
  const refresh = achievements?.refresh;

  // The progress while the room is open: the result compares against it (ResultProgress.tsx).
  const done = verdict !== undefined || session?.finishedAt !== undefined;
  const answerNow = achievements?.state.status === 'ready' ? achievements.state.answer : undefined;
  const [before, setBefore] = useState<AchievementsAnswer>();
  if (!done && answerNow && answerNow !== before) setBefore(answerNow);

  // A session on your own is kept as it goes; once finished, its summary joins the history.
  useEffect(() => {
    if (!session || !file) return;
    saveSession(session, problem.id);
    if (session.finishedAt !== undefined && !loadHistory().some((h) => h.problem === session.problem && h.startedAt === session.startedAt)) {
      const summary: InterviewSummary = { ...summarize(session, file, session.finishedAt), drew: drewOn(loadDesign(problem.id), problem.starter) };
      appendHistory(summary);
      if (soundOn) playCue('finish');
      // It counts towards the progress now: signed in, once the account has it.
      if (signedIn) void sendSoloInterviews([summary]).then(() => refresh?.(true));
      else refresh?.(true);
    }
  }, [session, file, problem.id, problem.starter, soundOn, signedIn, refresh]);

  const none = !mockId && !session;
  useEffect(() => {
    if (none) window.location.replace(setupHref(problem.id));
  }, [none, problem.id]);
  const exit = useCallback(() => (window.location.hash = setupHref()), []);

  const progress = (endedAt: number, counts = true) =>
    achievements && <ResultProgress state={achievements.state} before={before} endedAt={endedAt} counts={counts} onSeen={achievements.markSeen} />;

  if (verdict) {
    return (
      <Page header={header}>
        <Result kind="mock" problem={problem} interview={verdict} progress={progress(verdict.endedAt ?? Date.now())} />
      </Page>
    );
  }
  if (mockId) {
    return (
      <MockRoom
        id={mockId}
        problem={problem}
        engine={engine}
        phone={phone}
        onExit={exit}
        onVerdict={(s) => {
          saveActive(problem.id, undefined);
          setVerdict(s.interview);
          // The server counted it with the verdict.
          refresh?.(true);
        }}
        onRestart={() => {
          saveActive(problem.id, undefined);
          window.location.hash = setupHref(problem.id, 'mock');
        }}
      />
    );
  }
  if (!session || !file) return <PaneLoading label="Opening the set-up…" />;
  if (session.finishedAt !== undefined) {
    // As kept in the history when it finished (whether anything was drawn), else as it is now.
    const summary = loadHistory().find((h) => h.problem === session.problem && h.startedAt === session.startedAt) ?? { ...summarize(session, file, session.finishedAt), drew: drewOn(loadDesign(problem.id), problem.starter) };
    return (
      <Page header={header}>
        <Result kind="solo" problem={problem} summary={summary} progress={progress(session.finishedAt, soloSummaryCounts(summary))} />
      </Page>
    );
  }
  return <SoloRoom problem={problem} engine={engine} phone={phone} interview={file} session={session} dispatch={dispatch} onExit={exit} />;
}
