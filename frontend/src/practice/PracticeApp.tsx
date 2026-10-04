import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import problems from 'virtual:practice-listings';
import type { Engine } from '../hld/engine';
import PaneLoading from '../components/PaneLoading';
import ProblemList from './ProblemList';
import { loadProgress, saveProgress, type Progress } from './progress';
import { api, type Me } from '../services/api';
import { mergeServerProgress, progressToImport } from './account';
import { useAccount } from './useAccount';
import AccountMenu from './AccountMenu';
import LeaderboardPanel from './LeaderboardPanel';
import { useLeaderboard, useStatsSummary } from './useCommunity';
import HelpMenu from '../onboarding/HelpMenu';
import { requestTour } from '../onboarding/seen';

// The editor, canvas, simulation and problem files load when a problem is opened.
const ProblemRoute = lazy(() => import('./ProblemRoute'));

/** `#/` is the list, `#/<problem id>` a problem; hash routes work under any sub-path. */
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
      void (async () => {
        for (const { id, source, solved } of toImport) {
          await api(`/api/problems/${encodeURIComponent(id)}/runs`, { method: 'POST', body: { source, solved, imported: true } }).catch(() => undefined);
        }
      })();
    },
    [updateProgress],
  );
  const account = useAccount(onSignedIn);
  const stats = useStatsSummary();
  const leaderboard = useLeaderboard();

  const problem = route ? problems.find((p) => p.id === route) : undefined;
  useEffect(() => {
    document.title = problem ? `${problem.title} · Proschi practice` : 'Practice · Proschi';
  }, [problem]);

  if (problem) {
    return (
      <Suspense fallback={<div className="h-[100dvh]"><PaneLoading label={`Loading ${problem.title}…`} /></div>}>
        <ProblemRoute key={problem.id} id={problem.id} progress={progress} onProgress={updateProgress} engine={engine} account={account} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <header className="flex items-center gap-4 px-4 py-2.5 bg-white border-b border-gray-200">
        <a href="../" className="text-lg font-bold text-gray-900 hover:text-blue-700">
          Proschi
        </a>
        <span className="text-sm text-gray-500">Practice</span>
        <a href="../app/" className="ml-auto text-sm text-gray-700 hover:text-blue-700">
          Open the editor
        </a>
        <AccountMenu account={account} />
        <HelpMenu
          tourLabel="Take the practice tour"
          onTour={() => {
            // The tour runs on a problem page: open the first (easiest) problem with it.
            requestTour('practice');
            window.location.hash = `#/${problems[0]?.id ?? ''}`;
          }}
        />
      </header>
      {route && <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700">No problem called “{route}”. Pick one below.</p>}
      <ProblemList problems={problems} progress={progress} stats={stats}>
        {leaderboard && <LeaderboardPanel leaderboard={leaderboard} />}
      </ProblemList>
    </div>
  );
}
