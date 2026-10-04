import { useCallback, useEffect, useState } from 'react';
import { defaultEngine, type Engine } from '../hld/engine';
import ProblemList from './ProblemList';
import ProblemPage from './ProblemPage';
import { findProblem, problems } from './catalog';
import { loadProgress, saveProgress, type Progress } from './progress';

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

export default function PracticeApp({ engine = defaultEngine }: { engine?: Engine }) {
  const route = useHashRoute();
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const updateProgress = useCallback((update: (p: Progress) => Progress) => {
    setProgress((p) => {
      const next = update(p);
      if (JSON.stringify(next) !== JSON.stringify(p)) saveProgress(next);
      return next;
    });
  }, []);

  const problem = route ? findProblem(route) : undefined;
  useEffect(() => {
    document.title = problem ? `${problem.title} · Proschi practice` : 'Practice · Proschi';
  }, [problem]);

  if (problem) return <ProblemPage key={problem.id} problem={problem} progress={progress} onProgress={updateProgress} engine={engine} />;

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
      </header>
      {route && <p className="max-w-4xl mx-auto px-4 pt-6 text-sm text-red-700">No problem called “{route}”. Pick one below.</p>}
      <ProblemList problems={problems} progress={progress} />
    </div>
  );
}
