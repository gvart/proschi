import { use, type ReactNode } from 'react';
import { defaultEngine, type Engine } from '../hld/engine';
import ProblemPage from './ProblemPage';
import { loadProblem } from './loadProblem';
import type { Progress } from './progress';
import type { Account } from './useAccount';

interface ProblemRouteProps {
  id: string;
  progress: Progress;
  onProgress: (update: (p: Progress) => Progress) => void;
  /** Defaults to the simulation in frontend/src/sim. */
  engine?: Engine;
  account: Account;
  /** Where the back link goes, when not to the list (e.g. the roadmap). */
  back?: { href: string; label: string };
  /** Shown under the header, e.g. the roadmap's banner. */
  banner?: ReactNode;
  /** Open on the lesson: see ProblemPage. */
  openLesson?: 'always' | 'unread';
}

/**
 * A problem with its editor, canvas and simulation. PracticeApp loads this
 * chunk only when a problem is opened, and it fetches only that problem's
 * files (suspending until they are there), so the list stays light.
 */
export default function ProblemRoute({ id, progress, onProgress, engine = defaultEngine, account, back, banner, openLesson }: ProblemRouteProps) {
  const problem = use(loadProblem(id));
  if (!problem) {
    return (
      <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700 dark:text-red-300">
        Problem “{id}” could not be loaded; reload the page to try again. <a href="#/" className="underline">Back to the list</a>
      </p>
    );
  }
  return <ProblemPage key={problem.id} problem={problem} progress={progress} onProgress={onProgress} engine={engine} account={account} back={back} banner={banner} openLesson={openLesson} />;
}
