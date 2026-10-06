import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import problems from 'virtual:practice-listings';
import { guides as guideMinutes, lessons } from 'virtual:practice-lessons';
import type { Engine } from '../hld/engine';
import PaneLoading from '../components/PaneLoading';
import ProblemList from './ProblemList';
import Roadmap, { RoadmapBanner } from './RoadmapView';
import { ROADMAP, roadmapAccess, roadmapFor, roadmapState, roadmapTarget, stepLock } from './roadmap';
import { findGuide, GUIDES } from './guide/guides';
import { loadProgress, saveProgress, type Progress } from './progress';
import { api, ApiError, type Me } from '../services/api';
import { mergeServerProgress, progressToImport } from './account';
import { useAccount } from './useAccount';
import { summarize, useActivity } from './activity';
import { StreakInvite, StreakWidget } from './Streak';
import AccountMenu from './AccountMenu';
import LeaderboardPanel from './LeaderboardPanel';
import { useLeaderboard, useStatsSummary } from './useCommunity';
import HelpMenu from '../onboarding/HelpMenu';
import { requestTour } from '../onboarding/seen';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { useAchievements } from './skills/useAchievements';
import AchievementToast from './skills/AchievementToast';
import PracticeHub from './hub/PracticeHub';
import TodayPanel from './hub/TodayPanel';
import { hubTabOf } from './hub/tabs';
import { continueTarget, loadLastProblem, saveLastProblem } from './hub/continue';
import { profileIdOf } from './profile/profile';
import { track } from '../services/metrics';

// The editor, canvas, simulation and problem files load when a problem is opened.
const ProblemRoute = lazy(() => import('./ProblemRoute'));
// A roadmap article, e.g. "How to approach a system design interview".
const GuideRoute = lazy(() => import('./GuideRoute'));
// Daily review, with every card (virtual:practice-cards).
const ReviewRoute = lazy(() => import('./review/ReviewRoute'));
// The daily challenge, with every card too.
const ChallengeRoute = lazy(() => import('./challenge/ChallengeRoute'));
// Scale or Fail, the system design game: the engine, the simulation and the content.
const ArcadeRoute = lazy(() => import('../game/ui/ArcadeRoute'));
// The skill map and badges, with the cards' topics.
const ProgressRoute = lazy(() => import('./skills/ProgressRoute'));
// The account page and public profiles, with the cards' topics.
const AccountRoute = lazy(() => import('./profile/AccountRoute'));
const PublicProfileRoute = lazy(() => import('./profile/PublicProfileRoute'));

/** The roadmap's stages with the problems this build has. */
const roadmap = roadmapFor(ROADMAP, problems.map((p) => p.id));

/** The roadmap's "Read first" article. */
const firstGuide = GUIDES[0] && { ...GUIDES[0], minutes: guideMinutes[GUIDES[0].id] };

/**
 * `#/` is the list, `#/<problem id>` a problem (`#/<problem id>/lesson` opens
 * on its lesson), `#/roadmap` the roadmap, `#/roadmap/<problem id>` a problem
 * opened from it, `#/roadmap/<guide id>` an article of the roadmap,
 * `#/review` daily review (`#/review/<topic>` one topic of it), `#/arcade` the
 * system design game (`#/arcade/daily` on today's daily run), `#/challenge`
 * the daily challenge, `#/progress` the skill map and badges, `#/me` the
 * account page and `#/u/<user id>` a public profile; hash routes work under
 * any sub-path. The list (with the Today panel above it), the roadmap,
 * review, challenge, Arcade and progress pages are the practice hub's tabs
 * (hub/tabs.ts).
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
  useEffect(() => track('practice_open', { once: 'session' }), []);
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

  // The roadmap's first stage is open to everyone (progress in this browser), the rest takes an account, and its steps open in order: a locked step, `#/roadmap/<id>` or
  // `#/roadmap/<id>/lesson`, shows the roadmap with what unlocks it (sign-in comes back to the same address).
  // The roadmap's guides, and lessons opened from the problem list (`#/<id>/lesson`), are open to everyone.
  const access = roadmapAccess(account.state);
  const fromRoadmap = route.startsWith('roadmap/');
  const guide = fromRoadmap ? findGuide(route.slice('roadmap/'.length)) : undefined;
  const target = guide ? undefined : roadmapTarget(route);
  const roadmapNow = roadmapState(roadmap, progress);
  const lock = target ? stepLock(roadmapNow, target.id, access) : undefined;
  const onRoadmap = !guide && (route === 'roadmap' || (fromRoadmap && lock?.kind !== 'open'));
  const onReview = route === 'review' || route.startsWith('review/');
  const onProgress = route === 'progress';
  const onChallenge = route === 'challenge';
  const onArcade = route === 'arcade' || route === 'arcade/daily';
  const onMe = route === 'me';
  const profileId = profileIdOf(route);
  const onProfile = onMe || profileId !== undefined;
  /** A page other than the list or a problem. */
  const onPage = onRoadmap || !!guide || onReview || onProgress || onChallenge || onArcade || onProfile;
  const lessonRoute = fromRoadmap ? !!target?.lesson : route.endsWith('/lesson');
  const problemId = fromRoadmap ? (target?.id ?? '') : lessonRoute ? route.slice(0, -'/lesson'.length) : route;
  const problem = problemId && !onPage ? problems.find((p) => p.id === problemId) : undefined;
  // Read again on each page but a problem's: a solve or a session there changes it.
  const activity = useActivity(account, { key: route, enabled: !problem });
  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  const streak = ready ? (
    <StreakWidget streak={summarize(ready).streak} goal={ready.goal} />
  ) : activity.state.status === 'sign-in' ? (
    <StreakInvite account={account} compact />
  ) : undefined;
  // The Today panel's: the same, with the sign-in invitation saying what a streak needs.
  const streakFull = activity.state.status === 'sign-in' ? <StreakInvite account={account} /> : streak;
  const achievements = useAchievements(account.state, progress);
  // The practice hub's tab: the list (also under an unknown problem's address), the roadmap (with its guides), daily review, the challenge, the Arcade or progress.
  const hubTab = onRoadmap || guide || onReview || onChallenge || onArcade || onProgress ? hubTabOf(route) : onProfile ? undefined : 'problems';
  // "Continue" on the Today panel: the last problem opened here, while unsolved, else the roadmap's next step.
  const problemOpen = problem?.id;
  useEffect(() => {
    if (problemOpen) saveLastProblem({ id: problemOpen, roadmap: fromRoadmap });
  }, [problemOpen, fromRoadmap]);
  const next = hubTab === 'problems' ? continueTarget({ last: loadLastProblem(), progress, known: new Set(problems.map((p) => p.id)), roadmap: roadmapNow, access }) : undefined;
  const { refresh: refreshAchievements } = achievements;
  // A new page checks for new badges (signed in, at most every few seconds).
  useEffect(() => refreshAchievements(), [route, refreshAchievements]);
  const unseen = achievements.state.status === 'ready' ? achievements.state.answer.achievements.filter((a) => a.unseen) : [];
  useEffect(() => {
    // The review, challenge, progress and profile pages name themselves.
    if (onReview || onProgress || onChallenge || onArcade || onProfile) return;
    document.title = problem
      ? `${problem.title} · Proschi practice`
      : guide
        ? `${guide.title} · Proschi practice`
        : onRoadmap
          ? 'Interview prep roadmap · Proschi practice'
          : 'System design practice problems with automatic tests · Proschi';
  }, [problem, guide, onRoadmap, onReview, onProgress, onChallenge, onArcade, onProfile]);

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
            ? { back: { href: '#/roadmap', label: 'Roadmap' }, banner: <RoadmapBanner id={problem.id} stages={roadmap} problems={problems} progress={progress} />, openLesson: lessonRoute ? ('always' as const) : ('unread' as const) }
            : lessonRoute
              ? { openLesson: 'always' as const }
              : {})}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      <Header
        base="../"
        current={onProfile ? undefined : 'practice'}
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
        {route && !onPage && (
          <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700 dark:text-red-300">No problem called “{problemId}”. Pick one below.</p>
        )}
        {hubTab ? (
          <PracticeHub
            tab={hubTab}
            streak={streak}
            today={
              hubTab === 'problems' ? (
                <TodayPanel account={account} streak={streakFull} next={next} nextTitle={next && problems.find((p) => p.id === next.id)?.title} />
              ) : undefined
            }
          >
            {hubTab === 'problems' ? (
              <ProblemList problems={problems} progress={progress} stats={stats}>
                {leaderboard && <LeaderboardPanel leaderboard={leaderboard} />}
              </ProblemList>
            ) : onProgress ? (
              <Suspense fallback={<PaneLoading label="Loading your progress…" />}>
                <ProgressRoute account={account} achievements={achievements} roadmap={roadmapNow} stages={roadmap} />
              </Suspense>
            ) : onArcade ? (
              <Suspense fallback={<PaneLoading label="Loading Scale or Fail…" />}>
                <ArcadeRoute account={account} activity={activity} focusDaily={route === 'arcade/daily'} />
              </Suspense>
            ) : onChallenge ? (
              <Suspense fallback={<PaneLoading label="Loading today’s challenge…" />}>
                <ChallengeRoute account={account} activity={activity} />
              </Suspense>
            ) : onReview ? (
              <Suspense fallback={<PaneLoading label="Loading your cards…" />}>
                <ReviewRoute account={account} activity={activity} topic={route.slice('review/'.length) || undefined} />
              </Suspense>
            ) : guide ? (
              <Suspense fallback={<PaneLoading label={`Loading ${guide.title}…`} />}>
                <GuideRoute guide={guide} startHref="#/roadmap" startLabel="Go to the roadmap" />
              </Suspense>
            ) : (
              <Roadmap
                stages={roadmap}
                problems={problems}
                progress={progress}
                access={access}
                providers={account.state.status === 'signed-out' ? account.state.providers : []}
                onSignIn={account.signIn}
                lessons={lessons}
                guide={firstGuide}
                locked={target && lock && lock.kind !== 'open' ? { id: target.id, lock } : undefined}
              />
            )}
          </PracticeHub>
        ) : onMe ? (
          <Suspense fallback={<PaneLoading label="Loading your profile…" />}>
            <AccountRoute account={account} activity={activity} achievements={achievements} progress={progress} />
          </Suspense>
        ) : (
          profileId !== undefined && (
            <Suspense fallback={<PaneLoading label="Loading the profile…" />}>
              <PublicProfileRoute id={profileId} />
            </Suspense>
          )
        )}
      </div>
      <Footer base="../" />
      {/* New badges are celebrated here, never over a problem's editor: a solve's badge shows on the way back. */}
      <AchievementToast
        unseen={unseen}
        onSeen={achievements.markSeen}
        profileId={account.state.status === 'signed-in' && account.state.user.publicProfile ? account.state.user.id : undefined}
      />
    </div>
  );
}
