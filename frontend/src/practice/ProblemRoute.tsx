import { use } from 'react';
import { defaultEngine, type Engine } from '../hld/engine';
import ProblemPage from './ProblemPage';
import { loadProblem } from './loadProblem';
import type { Progress } from './progress';

interface ProblemRouteProps {
  id: string;
  progress: Progress;
  onProgress: (update: (p: Progress) => Progress) => void;
  /** Defaults to the simulation in frontend/src/sim. */
  engine?: Engine;
}

/**
 * A problem with its editor, canvas and simulation. PracticeApp loads this
 * chunk only when a problem is opened, and it fetches only that problem's
 * files (suspending until they are there), so the list stays light.
 */
export default function ProblemRoute({ id, progress, onProgress, engine = defaultEngine }: ProblemRouteProps) {
  const problem = use(loadProblem(id));
  if (!problem) {
    return (
      <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700">
        Problem “{id}” could not be loaded; reload the page to try again. <a href="#/" className="underline">Back to the list</a>
      </p>
    );
  }
  return <ProblemPage key={problem.id} problem={problem} progress={progress} onProgress={onProgress} engine={engine} />;
}
