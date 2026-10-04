import { BookOpen, FileCode, GraduationCap } from 'lucide-react';
import { STARTER_TEMPLATE } from './template';

interface StarterCardProps {
  /** Replaces the empty diagram with the starter template. */
  onTemplate: (source: string) => void;
  onExamples: () => void;
}

const optionClass =
  'group flex w-full items-start gap-3 rounded border-bw-1 border-ink bg-paper p-3 text-left hover:bg-pop-yellow/25 hover:shadow-brutal-sm hover:-translate-x-px hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue motion-safe:transition';

/** What an empty diagram shows instead of a blank canvas: three ways to start. */
export default function StarterCard({ onTemplate, onExamples }: StarterCardProps) {
  return (
    <section aria-labelledby="starter-title" className="w-full max-w-md rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
      <h2 id="starter-title" className="font-display text-xl font-extrabold tracking-[-0.02em] text-ink">
        Start a diagram
      </h2>
      <p className="mt-0.5 text-sm text-muted">
        Type in the code pane, e.g. <code className="rounded bg-ink/5 px-1">api -&gt; db</code>, or pick a start:
      </p>
      <div className="mt-3 space-y-2">
        <button type="button" onClick={() => onTemplate(STARTER_TEMPLATE)} className={optionClass}>
          <FileCode size={20} className="mt-0.5 flex-shrink-0 text-pop-blue" />
          <span>
            <span className="block text-sm font-medium text-ink">Template with a cheat-sheet</span>
            <span className="block text-xs text-muted">A tiny working system, with the syntax explained in comments.</span>
          </span>
        </button>
        <button type="button" onClick={onExamples} className={optionClass}>
          <BookOpen size={20} className="mt-0.5 flex-shrink-0 text-pop-blue" />
          <span>
            <span className="block text-sm font-medium text-ink">Start from an example</span>
            <span className="block text-xs text-muted">E-commerce, serverless, login, events, a full HLD…</span>
          </span>
        </button>
        <a href="../practice/" className={optionClass}>
          <GraduationCap size={20} className="mt-0.5 flex-shrink-0 text-pop-blue" />
          <span>
            <span className="block text-sm font-medium text-ink">Practice system design</span>
            <span className="block text-xs text-muted">Problems with tests that check whether your design scales.</span>
          </span>
        </a>
      </div>
    </section>
  );
}
