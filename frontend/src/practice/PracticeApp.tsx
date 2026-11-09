import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useHashRoute } from './hashRoute';
import problems from 'virtual:practice-listings';
import { guides as guideMinutes, lessons } from 'virtual:practice-lessons';
import type { Engine } from '../hld/engine';
import PaneLoading from '../components/PaneLoading';
import ProblemList from './ProblemList';
import Roadmap, { RoadmapBanner } from './RoadmapView';
import NextForYou from './history/NextForYou';
import InterviewPlan from './plan/InterviewPlan';
import { verdictIdOf } from './history/api';
import { FeaturesContext, useFeatures } from '../components/featureState';
import { ROADMAP, roadmapAccess, roadmapFor, roadmapHref, roadmapState, roadmapTarget, routeLock } from './roadmap';
import { findGuide, GUIDES } from './guide/guides';
import { lessonsRead, loadProgress, markLessonsRead, onLessonsRead, saveProgress, type Progress } from './progress';
import { useLessonsRead } from './useLessonsRead';
import { api, ApiError, type Me } from '../services/api';
import { mergeServerProgress, progressToImport } from './account';
import { useAccount } from './useAccount';
import { summarize, useActivity } from './activity';
import { StreakChip } from './Streak';
import AccountMenu from './AccountMenu';
import Announcement from '../announcements/Announcement';
import LeaderboardPanel from './LeaderboardPanel';
import { useLeaderboard, useStatsSummary } from './useCommunity';
import HelpMenu from '../onboarding/HelpMenu';
import { requestTour } from '../onboarding/seen';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { useAchievements } from './skills/useAchievements';
import { notifyActivity } from './skills/activity';
import AchievementToast from './skills/AchievementToast';
import PracticeHub from './hub/PracticeHub';
import HomeExtras, { GoalSummary } from './hub/HomeExtras';
import { asksGoal, mergeAccountGoal, onGoalChange, useGoal, wantsInterview, wantsStreak, type AnnouncementState, type GoalState } from './hub/goal';
import { hubTabOf, type HubTab } from './hub/tabs';
import { continueTarget, loadLastProblem, saveLastProblem } from './hub/continue';
import { profileIdOf } from './profile/profile';
import { certificateIdOf } from './certificate/route';
import { track } from '../services/metrics';
import { setupHref } from './interview/links';
import { sendSoloInterviews } from './interview/record';
import { loadHistory } from './modes/store';
import { onMistakesChange, sendMistakes, syncMistakes } from './hub/recentMistakes';

// The editor, canvas, simulation and problem files load when a problem is opened.
const ProblemRoute = lazy(() => import('./ProblemRoute'));
// A roadmap article, e.g. "How to approach a system design interview".
const GuideRoute = lazy(() => import('./GuideRoute'));
// Daily review, with every card (virtual:practice-cards).
const loadReviewCode = () => import('./review/ReviewRoute');
const ReviewRoute = lazy(loadReviewCode);
// The daily challenge, with every card too.
const loadChallengeCode = () => import('./challenge/ChallengeRoute');
const ChallengeRoute = lazy(loadChallengeCode);
// Scale or Fail, the system design game: the engine, the simulation and the content.
const loadArcadeCode = () => import('../game/ui/ArcadeRoute');
const ArcadeRoute = lazy(loadArcadeCode);
// Progress: the level, streak, skill map, roadmap, badges and problems solved, with the cards' topics.
const loadProgressCode = () => import('./skills/ProgressRoute');
const ProgressRoute = lazy(loadProgressCode);
// The account and settings page; public profiles, with the cards' topics.
const AccountRoute = lazy(() => import('./profile/AccountRoute'));
const PublicProfileRoute = lazy(() => import('./profile/PublicProfileRoute'));
const CertificateRoute = lazy(() => import('./certificate/CertificateRoute'));
// The mock interview: the set-up, the room (editor, canvas, simulation) and the result.
const InterviewRoute = lazy(() => import('./interview/InterviewRoute'));

/** The hub's sections whose code loads on first use: pointing at one's link starts loading it, so the click rarely waits. */
const SECTION_CODE: Partial<Record<HubTab, () => Promise<unknown>>> = { review: loadReviewCode, challenge: loadChallengeCode, arcade: loadArcadeCode, progress: loadProgressCode };
const preloadSection = (tab: HubTab) => void SECTION_CODE[tab]?.().catch(() => undefined);

/** A page whose code is still loading: holds a screen's height, so the footer does not jump up and back down when it arrives. */
function PageLoading({ label }: { label: string }) {
  return (
    <div className="min-h-[100dvh] pt-10">
      <PaneLoading label={label} />
    </div>
  );
}

/** The roadmap's stages with the problems this build has. */
const roadmap = roadmapFor(ROADMAP, problems.map((p) => p.id));
/** The roadmap's problems in order, for the interview-date plan. */
const roadmapOrder = roadmap.flatMap((s) => s.problems);

/** The roadmap's "Read first" article. */
const firstGuide = GUIDES[0] && { ...GUIDES[0], minutes: guideMinutes[GUIDES[0].id] };

/**
 * `#/` is the list, `#/<problem id>` a problem (on its lesson until read; `#/<problem id>/lesson` always opens
 * on its lesson; `#/<problem id>?interview=mock` on interview mode, the mock interview chosen, nothing started; `?interview=ai` is an alias), `#/roadmap` the roadmap, `#/roadmap/<problem id>` a problem
 * opened from it, `#/roadmap/<guide id>` an article of the roadmap,
 * `#/review` daily review (`#/review/<topic>` one topic of it), `#/arcade` the
 * system design game (`#/arcade/daily` on today's daily run), `#/challenge`
 * the daily challenge, `#/progress` progress (level, skills, badges, streak),
 * `#/me` the account and settings page, `#/u/<user id>` a public profile and `#/c/<id>` a mastery certificate; hash routes work under
 * any sub-path. The list (with what the visitor's goal adds above it,
 * hub/HomeExtras.tsx), the roadmap, review, challenge, Arcade and progress
 * pages are the practice hub's sections (hub/tabs.ts). useHashRoute (hashRoute.ts) reads it, and scrolls to the
 * top on a new address or back to where it was on back/forward.
 */

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

/** Tells the account which lessons were read (POST /api/me/lessons); a failure is dropped: the next sign-in sends them again. */
async function sendLessonsRead(ids: string[]): Promise<void> {
  try {
    await api('/api/me/lessons', { method: 'POST', body: { ids } });
    // A reading badge may be earned now.
    notifyActivity();
  } catch {
    // Kept in this browser; onSignedIn sends what the account lacks.
  }
}

/** Keeps the learning goal with the account (PATCH /api/me); a failure is dropped: it stays in this browser, and the next change sends it again. */
async function sendGoal(goal: GoalState): Promise<void> {
  try {
    await api('/api/me', { method: 'PATCH', body: { practiceGoal: goal } });
  } catch {
    // Kept in this browser.
  }
}

/** `engine` defaults to the simulation in frontend/src/sim (loaded with the problem page). */
export default function PracticeApp({ engine }: { engine?: Engine }) {
  const hash = useHashRoute();
  // A query after the route: `#/interview?problem=<id>`; the older `#/<problem id>?interview=mock` (or `?interview=ai`) goes to the mock interview's set-up with the problem chosen.
  const [route, query = ''] = hash.split('?', 2);
  const params = new URLSearchParams(query);
  const interviewParam = params.get('interview');
  const interviewLink = interviewParam === 'mock' || interviewParam === 'ai';
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
      // Lessons read: the account's join this browser's, and this browser's the account lacks are sent.
      const remote = new Set(me.lessons ?? []);
      const missing = lessonsRead().filter((id) => !remote.has(id));
      markLessonsRead([...remote], 'account');
      if (me.lessons && missing.length) void sendLessonsRead(missing);
      // Interviews on your own done in this browser: the account keeps each once, and its interview badges count them.
      const solo = loadHistory();
      if (solo.length) void sendSoloInterviews(solo).then(notifyActivity);
      // Known mistakes failed runs matched: the account's join this browser's (the retry step on every device), and this browser's it lacks are sent.
      void syncMistakes();
      // The learning goal: the account's wins; an account without one gets this browser's.
      const goalToSend = mergeAccountGoal(me.user.practiceGoal);
      if (goalToSend) void sendGoal(goalToSend);
    },
    [updateProgress],
  );
  const account = useAccount(onSignedIn);
  // The paid features (components/Feature.tsx), for every page below.
  const features = useFeatures(account.state);
  const signedIn = account.state.status === 'signed-in';
  // One card above the problem list at a time: the announcement, then the goal question.
  const [announcement, setAnnouncement] = useState<AnnouncementState>('loading');
  const onAnnouncement = useCallback((shown: boolean) => setAnnouncement(shown ? 'shown' : 'none'), []);
  // Signed in, each lesson read here goes to the account too; without accounts, the badges are checked here at once.
  const accountsOff = account.state.status === 'off';
  // Signed in, each change of the learning goal goes to the account too.
  useEffect(() => {
    if (!signedIn) return;
    onGoalChange((g) => void sendGoal(g));
    return () => onGoalChange(undefined);
  }, [signedIn]);
  // Signed in, each mistake recorded here goes to the account too.
  useEffect(() => {
    if (signedIn) return onMistakesChange((added, source) => source === 'here' && void sendMistakes(added));
  }, [signedIn]);
  useEffect(() => {
    if (signedIn) return onLessonsRead((ids, source) => source === 'here' && void sendLessonsRead(ids));
    if (accountsOff) return onLessonsRead(() => notifyActivity());
  }, [signedIn, accountsOff]);
  const lessonsReadIds = useLessonsRead();
  const stats = useStatsSummary();
  const leaderboard = useLeaderboard();

  // The roadmap's first stage is open to everyone (progress in this browser), the rest takes an account, and its challenges open in order: a locked
  // challenge, `#/roadmap/<id>`, shows the roadmap with what unlocks it (sign-in comes back to the same address).
  // Reading is never gated: the roadmap's guides and every lesson (`#/roadmap/<id>/lesson`, `#/<id>/lesson`) are open to everyone.
  const access = roadmapAccess(account.state);
  const fromRoadmap = route.startsWith('roadmap/');
  const guide = fromRoadmap ? findGuide(route.slice('roadmap/'.length)) : undefined;
  const target = guide ? undefined : roadmapTarget(route);
  const roadmapNow = roadmapState(roadmap, progress);
  const lock = target ? routeLock(roadmapNow, target, access) : undefined;
  const onRoadmap = !guide && (route === 'roadmap' || (fromRoadmap && lock?.kind !== 'open'));
  const onReview = route === 'review' || route.startsWith('review/');
  const verdictId = verdictIdOf(route);
  const onProgress = route === 'progress' || verdictId !== undefined;
  const onChallenge = route === 'challenge';
  const onArcade = route === 'arcade' || route === 'arcade/daily';
  const onMe = route === 'me';
  const onInterview = route === 'interview' || route.startsWith('interview/');
  const profileId = profileIdOf(route);
  const certificateId = certificateIdOf(route);
  const onProfile = onMe || profileId !== undefined || certificateId !== undefined;
  /** A page other than the list or a problem. */
  const onPage = onRoadmap || !!guide || onReview || onProgress || onChallenge || onArcade || onProfile || onInterview;
  const lessonRoute = fromRoadmap ? !!target?.lesson : route.endsWith('/lesson');
  const problemId = fromRoadmap ? (target?.id ?? '') : lessonRoute ? route.slice(0, -'/lesson'.length) : route;
  const problem = problemId && !onPage ? problems.find((p) => p.id === problemId) : undefined;
  // Read again on each page but a problem's: a solve or a session there changes it.
  const activity = useActivity(account, { key: route, enabled: !problem });
  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  // The streak and daily nudges show only to those who want them (a daily habit, or switched on in Settings).
  const goal = useGoal();
  const showStreak = wantsStreak(goal);
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  const streak = !showStreak ? undefined : ready ? (
    <StreakChip streak={summarize(ready).streak} goal={ready.goal} />
  ) : activity.state.status === 'sign-in' && providers.length > 0 ? (
    <p className="text-sm text-muted">
      <button type="button" onClick={() => account.signIn(providers[0])} className="font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
        Sign in
      </button>{' '}
      to count your streak
    </p>
  ) : undefined;
  const achievements = useAchievements(account.state, progress);
  // The practice hub's tab: the list (also under an unknown problem's address), the roadmap (with its guides), daily review, the challenge, the Arcade or progress.
  const hubTab = onRoadmap || guide || onReview || onChallenge || onArcade || onProgress ? hubTabOf(route) : onProfile ? undefined : 'problems';
  // "Continue" on the home: the last problem opened here, while unsolved, else (for interview prep) the roadmap's next step.
  const problemOpen = problem?.id;
  useEffect(() => {
    if (problemOpen) saveLastProblem({ id: problemOpen, roadmap: fromRoadmap });
  }, [problemOpen, fromRoadmap]);
  const next = hubTab === 'problems' ? continueTarget({ last: loadLastProblem(), progress, known: new Set(problems.map((p) => p.id)), roadmap: roadmapNow, access, roadmapStep: wantsInterview(goal) }) : undefined;
  const { refresh: refreshAchievements } = achievements;
  // A new page checks for new badges (signed in, at most every few seconds).
  useEffect(() => refreshAchievements(), [route, refreshAchievements]);
  const unseen = achievements.state.status === 'ready' ? achievements.state.answer.achievements.filter((a) => a.unseen) : [];
  // The free "Your next steps" (hub/RuleSteps.tsx), on the roadmap: the skill map once known, else computed from the cards and solves.
  const stepsData = {
    progress,
    skills: achievements.state.status === 'ready' ? achievements.state.answer.skills.topics : undefined,
    streak: ready ? summarize(ready).streak.current : undefined,
  };
  useEffect(() => {
    // The review, challenge, progress and profile pages name themselves.
    if (onReview || onProgress || onChallenge || onArcade || onProfile || onInterview) return;
    document.title = problem
      ? `${problem.title} · Proschi practice`
      : guide
        ? `${guide.title} · Proschi practice`
        : onRoadmap
          ? 'Interview prep roadmap · Proschi practice'
          : 'System design practice problems with automatic tests · Proschi';
  }, [problem, guide, onRoadmap, onReview, onProgress, onChallenge, onArcade, onProfile, onInterview]);

  const redirect = problem && interviewLink ? setupHref(problem.id, 'mock') : undefined;
  useEffect(() => {
    if (redirect) window.location.replace(redirect);
  }, [redirect]);
  if (redirect) return null;

  if (problem) {
    return (
      <FeaturesContext.Provider value={features}>
        <Suspense fallback={<div className="h-[100dvh]"><PaneLoading label={`Loading ${problem.title}…`} /></div>}>
          <ProblemRoute
            key={problem.id}
            id={problem.id}
            progress={progress}
            onProgress={updateProgress}
            engine={engine}
            account={account}
            {...(fromRoadmap
              ? { back: { href: '#/roadmap', label: 'Roadmap' }, banner: <RoadmapBanner id={problem.id} stages={roadmap} problems={problems} progress={progress} />, staged: true, openLesson: lessonRoute ? ('always' as const) : undefined }
              : { openLesson: lessonRoute ? ('always' as const) : undefined })}
          />
        </Suspense>
      </FeaturesContext.Provider>
    );
  }

  const header = (
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
  );

  if (onInterview) {
    return (
      <FeaturesContext.Provider value={features}>
        <Suspense fallback={<PageLoading label="Loading the mock interview…" />}>
          <InterviewRoute problemId={route.slice('interview/'.length) || undefined} query={params} engine={engine} header={header} achievements={achievements} signedIn={signedIn} />
        </Suspense>
      </FeaturesContext.Provider>
    );
  }

  const page = (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      {header}
      <div className="flex-1 bg-paper">
        {route && !onPage && (
          <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700 dark:text-red-300">No problem called “{problemId}”. Pick one below.</p>
        )}
        {/* The streak chip by the bar, except where the page shows the streak itself: the home's Today panel and the progress page's summary. */}
        {hubTab ? (
          <PracticeHub tab={hubTab} onIntent={preloadSection} aside={hubTab === 'problems' || onProgress ? undefined : streak}>
            {signedIn && <Announcement onChange={onAnnouncement} />}
            {hubTab === 'problems' ? (
              <ProblemList
                problems={problems}
                progress={progress}
                stats={stats}
                meta={<GoalSummary goal={goal} />}
                top={<HomeExtras goal={goal} ask={asksGoal(goal, account.state.status, announcement)} account={account} next={next} nextTitle={next && problems.find((p) => p.id === next.id)?.title} streak={streak} />}
              >
                {leaderboard && <LeaderboardPanel leaderboard={leaderboard} />}
              </ProblemList>
            ) : onProgress ? (
              <Suspense fallback={<PageLoading label="Loading your progress…" />}>
                <ProgressRoute account={account} showStreak={showStreak} achievements={achievements} roadmap={roadmapNow} stages={roadmap} activity={activity} progress={progress} verdictId={verdictId} />
              </Suspense>
            ) : onArcade ? (
              <Suspense fallback={<PageLoading label="Loading Scale or Fail…" />}>
                <ArcadeRoute account={account} activity={activity} focusDaily={route === 'arcade/daily'} />
              </Suspense>
            ) : onChallenge ? (
              <Suspense fallback={<PageLoading label="Loading today’s challenge…" />}>
                <ChallengeRoute account={account} activity={activity} />
              </Suspense>
            ) : onReview ? (
              <Suspense fallback={<PageLoading label="Loading your cards…" />}>
                <ReviewRoute account={account} activity={activity} topic={route.slice('review/'.length) || undefined} />
              </Suspense>
            ) : guide ? (
              <Suspense fallback={<PageLoading label={`Loading ${guide.title}…`} />}>
                <GuideRoute guide={guide} startHref={roadmapNow.next ? roadmapHref(roadmapNow.next.id) : '#/roadmap'} startLabel={roadmapNow.next ? `${roadmapNow.solved === 0 ? 'Start' : 'Continue'}: ${problems.find((p) => p.id === roadmapNow.next?.id)?.title ?? roadmapNow.next.id}` : 'Go to the roadmap'} />
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
                read={lessonsReadIds}
                nextForYou={
                  <>
                    <InterviewPlan account={account} progress={progress} skills={stepsData.skills} roadmap={roadmapOrder} />
                    <NextForYou problemTitle={(id) => problems.find((p) => p.id === id)?.title} steps={{ account, ...stepsData }} />
                  </>
                }
              />
            )}
          </PracticeHub>
        ) : onMe ? (
          <Suspense fallback={<PageLoading label="Loading your settings…" />}>
            <AccountRoute account={account} activity={activity} />
          </Suspense>
        ) : certificateId !== undefined ? (
          <Suspense fallback={<PageLoading label="Loading the certificate…" />}>
            <CertificateRoute id={certificateId} signedIn={account.state.status === 'signed-in'} />
          </Suspense>
        ) : (
          profileId !== undefined && (
            <Suspense fallback={<PageLoading label="Loading the profile…" />}>
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
  return <FeaturesContext.Provider value={features}>{page}</FeaturesContext.Provider>;
}
