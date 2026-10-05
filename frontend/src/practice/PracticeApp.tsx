import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import problems from 'virtual:practice-listings';
import type { Engine } from '../hld/engine';
import PaneLoading from '../components/PaneLoading';
import ProblemList from './ProblemList';
import Roadmap, { RoadmapBanner } from './RoadmapView';
import { ROADMAP, roadmapAccess, roadmapFor } from './roadmap';
import { loadProgress, saveProgress, type Progress } from './progress';
import { api, ApiError, type Me } from '../services/api';
import { mergeServerProgress, progressToImport } from './account';
import { useAccount } from './useAccount';
import AccountMenu from './AccountMenu';
import LeaderboardPanel from './LeaderboardPanel';
import { useLeaderboard, useStatsSummary } from './useCommunity';
import HelpMenu from '../onboarding/HelpMenu';
import { requestTour } from '../onboarding/seen';
import Footer from '../design/Footer';
import Header from '../design/Header';

// The editor, canvas, simulation and problem files load when a problem is opened.
const ProblemRoute = lazy(() => import('./ProblemRoute'));

/** The roadmap's stages with the problems this build has. */
const roadmap = roadmapFor(ROADMAP, problems.map((p) => p.id));

/**
 * `#/` is the list, `#/<problem id>` a problem, `#/roadmap` the roadmap and
 * `#/roadmap/<problem id>` a problem opened from it; hash routes work under any sub-path.
 */
function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * Uploads the browser's progress in one request. Signing in again and again
 * within a minute hits the server's rate limit (429): then it waits, at least
 * as long as the server asks, and tries again a few times.
 */
async function importProgress(items: { problemId: string; source: string; solved: boolean }[]): Promise<void> {
  for (const backoff of [1, 4, 16, undefined]) {
    try {
      await api('/api/me/import', { method: 'POST', body: { items } });
      return;
    } catch (e) {
      if (backoff === undefined || !(e instanceof ApiError && e.status === 429)) return;
      const wait = Math.max(backoff, e.retryAfter ?? 0);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
}

/** `engine` defaults to the simulation in frontend/src/sim (loaded with the problem page). */
export default function PracticeApp({ engine }: { engine?: Engine }) {
  const route = useHashRoute();
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const updateProgress = useCallback((update: (p: Progress) => Progress) => {
    setProgress((p) => {
      const next = update(p);
      if (JSON.stringify(next) !== JSON.stringify(p)) saveProgress(next);
      return next;
    });
  }, []);

  // Signed in: the server's progress joins the browser's, and the browser's designs the server lacks are uploaded (it checks the solves).
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const onSignedIn = useCallback(
    (me: Me) => {
      const toImport = progressToImport(progressRef.current, me.progress).filter((item) => problems.some((p) => p.id === item.id));
      updateProgress((p) => mergeServerProgress(p, me.progress));
      if (toImport.length) void importProgress(toImport.map(({ id, source, solved }) => ({ problemId: id, source, solved })));
    },
    [updateProgress],
  );
  const account = useAccount(onSignedIn);
  const stats = useStatsSummary();
  const leaderboard = useLeaderboard();

  // Starting the roadmap takes an account: signed out, `#/roadmap/<id>` shows the roadmap (sign-in comes back to the same address).
  const access = roadmapAccess(account.state);
  const fromRoadmap = route.startsWith('roadmap/');
  const onRoadmap = route === 'roadmap' || (fromRoadmap && access !== 'open');
  const problemId = fromRoadmap ? route.slice('roadmap/'.length) : route;
  const problem = problemId && !onRoadmap ? problems.find((p) => p.id === problemId) : undefined;
  useEffect(() => {
    document.title = problem
      ? `${problem.title} · Proschi practice`
      : onRoadmap
        ? 'Interview prep roadmap · Proschi practice'
        : 'System design practice problems with automatic tests · Proschi';
  }, [problem, onRoadmap]);

  if (problem) {
    return (
      <Suspense fallback={<div className="h-[100dvh]"><PaneLoading label={`Loading ${problem.title}…`} /></div>}>
        <ProblemRoute
          key={problem.id}
          id={problem.id}
          progress={progress}
          onProgress={updateProgress}
          engine={engine}
          account={account}
          {...(fromRoadmap
            ? { back: { href: '#/roadmap', label: 'Roadmap' }, banner: <RoadmapBanner id={problem.id} stages={roadmap} problems={problems} progress={progress} /> }
            : {})}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      <Header
        base="../"
        current={onRoadmap ? 'roadmap' : 'practice'}
        actions={
          <>
            <AccountMenu account={account} />
            <HelpMenu
              tourLabel="Take the practice tour"
              onTour={() => {
                // The tour runs on a problem page: open the first (easiest) problem with it.
                requestTour('practice');
                window.location.hash = `#/${problems[0]?.id ?? ''}`;
              }}
            />
          </>
        }
      />
      <div className="flex-1 bg-paper">
        {route && !onRoadmap && (
          <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700 dark:text-red-300">No problem called “{problemId}”. Pick one below.</p>
        )}
        {onRoadmap ? (
          <Roadmap
            stages={roadmap}
            problems={problems}
            progress={progress}
            access={access}
            providers={account.state.status === 'signed-out' ? account.state.providers : []}
            onSignIn={account.signIn}
          />
        ) : (
          <ProblemList problems={problems} progress={progress} stats={stats}>
            {leaderboard && <LeaderboardPanel leaderboard={leaderboard} />}
          </ProblemList>
        )}
      </div>
      <Footer base="../" />
    </div>
  );
}
