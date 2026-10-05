import { ArrowRight, Map as MapIcon } from 'lucide-react';
import type { ProblemListing } from './listing';
import type { Progress } from './progress';
import { ROADMAP, roadmapFor, roadmapState } from './roadmap';
import { eyebrow } from '../components/Playground/ui';

/**
 * The interview prep roadmap's card at the top of the problem list: what it
 * is, where the learner is on it (from this browser's progress) and the way in.
 */
export default function RoadmapCard({ problems, progress }: { problems: ProblemListing[]; progress: Progress }) {
  const stages = roadmapFor(ROADMAP, problems.map((p) => p.id));
  if (stages.length === 0) return null;
  const state = roadmapState(stages, progress);
  const total = state.steps.length;
  const started = state.solved > 0;
  const done = state.solved === total;
  const current = stages[state.currentStage];

  return (
    <div className="mt-7 rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md overflow-hidden">
      <div className="h-3 bg-pop-pink border-b-bw-2 border-ink" aria-hidden="true" />
      <div className="p-5 sm:p-6 flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>For system design interviews</p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold leading-tight text-ink">
            <MapIcon size={22} aria-hidden="true" className="shrink-0" />
            Interview prep roadmap
          </h2>
          <p className="mt-2 text-sm text-ink/80">
            {total} problems in {stages.length} stages, each with a lesson, a hands-on challenge checked by the simulation and a review of your design.
          </p>
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {stages.map((stage, i) => {
              const steps = state.steps.filter((s) => s.stage === i);
              const solved = steps.filter((s) => s.status === 'solved').length;
              return (
                <span key={stage.id} title={stage.title} className="h-2.5 flex-1 overflow-hidden rounded-sm border-bw-1 border-ink bg-paper">
                  <span className="block h-full bg-pass" style={{ width: `${(solved / steps.length) * 100}%` }} />
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {state.solved} of {total} done{started && !done && current ? ` · Stage ${state.currentStage + 1}: ${current.title}` : ''}
          </p>
        </div>
        <a
          href="#/roadmap"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start sm:self-auto min-h-[44px] px-4 rounded border-bw-2 border-ink bg-pop-yellow text-on-accent font-bold shadow-brutal-sm hover:shadow-brutal-md transition-[box-shadow,transform] duration-d1 hover:-translate-x-px hover:-translate-y-px"
        >
          {done ? 'Open the roadmap' : started ? 'Continue interview prep' : 'Start interview prep'}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
