import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultEngine, type Engine } from '../../hld/engine';
import { useIsPhone } from '../../onboarding/layout';
import PaneLoading from '../../components/PaneLoading';
import { loadProblem } from '../loadProblem';
import type { Problem } from '../types';
import { parseInterview } from '../modes/interviewFile';
import { interviewReducer, summarize, type InterviewAction, type InterviewSession } from '../modes/session';
import { appendHistory, loadHistory, loadSession, saveSession } from '../modes/store';
import { loadActive, saveActive, type AiInterview } from '../modes/ai/api';
import { useSoundPref } from './prefs';
import { roomHref, setupHref } from './links';
import { playCue } from './sounds';
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
}

export default function InterviewRoute({ problemId, query, engine = defaultEngine, header }: InterviewRouteProps) {
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
  return <ProblemInterview key={problemId} id={problemId} engine={engine} header={header} />;
}

function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      {header}
      <div className="flex-1 bg-paper">{children}</div>
    </div>
  );
}

function ProblemInterview({ id, engine, header }: { id: string; engine: Engine; header: ReactNode }) {
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
  return <Interview problem={problem} engine={engine} header={header} />;
}

function Interview({ problem, engine, header }: { problem: Problem; engine: Engine; header: ReactNode }) {
  const phone = useIsPhone();
  const [soundOn] = useSoundPref();
  const file = useMemo(() => {
    if (problem.interview === undefined) return undefined;
    const read = parseInterview(problem.interview);
    return read.issues.length === 0 ? read.interview : undefined;
  }, [problem.interview]);
  const [mockId] = useState(() => loadActive(problem.id));
  const [session, setSession] = useState<InterviewSession | undefined>(() => (mockId ? undefined : loadSession(problem.id)));
  const [verdict, setVerdict] = useState<AiInterview>();
  const dispatch = useCallback((a: InterviewAction) => setSession((s) => s && interviewReducer(s, a)), []);

  // A session on your own is kept as it goes; once finished, its summary joins the history.
  useEffect(() => {
    if (!session || !file) return;
    saveSession(session, problem.id);
    if (session.finishedAt !== undefined && !loadHistory().some((h) => h.problem === session.problem && h.startedAt === session.startedAt)) {
      appendHistory(summarize(session, file, session.finishedAt));
      if (soundOn) playCue('finish');
    }
  }, [session, file, problem.id, soundOn]);

  const none = !mockId && !session;
  useEffect(() => {
    if (none) window.location.replace(setupHref(problem.id));
  }, [none, problem.id]);
  const exit = useCallback(() => (window.location.hash = setupHref()), []);

  if (verdict) {
    return (
      <Page header={header}>
        <Result kind="mock" problem={problem} interview={verdict} />
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
    return (
      <Page header={header}>
        <Result kind="solo" problem={problem} summary={summarize(session, file, session.finishedAt)} />
      </Page>
    );
  }
  return <SoloRoom problem={problem} engine={engine} phone={phone} interview={file} session={session} dispatch={dispatch} onExit={exit} />;
}
