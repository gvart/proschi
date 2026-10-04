import { BookOpen, FileCode, GraduationCap } from 'lucide-react';
import { STARTER_TEMPLATE } from './template';

interface StarterCardProps {
  /** Replaces the empty diagram with the starter template. */
  onTemplate: (source: string) => void;
  onExamples: () => void;
}

const optionClass =
  'group flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-blue-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-safe:transition';

/** What an empty diagram shows instead of a blank canvas: three ways to start. */
export default function StarterCard({ onTemplate, onExamples }: StarterCardProps) {
  return (
    <section aria-labelledby="starter-title" className="w-full max-w-md rounded-xl border border-gray-200 bg-white/95 p-4 shadow-sm">
      <h2 id="starter-title" className="text-base font-semibold text-gray-900">
        Start a diagram
      </h2>
      <p className="mt-0.5 text-sm text-gray-500">
        Type in the code pane, e.g. <code className="rounded bg-gray-100 px-1">api -&gt; db</code>, or pick a start:
      </p>
      <div className="mt-3 space-y-2">
        <button type="button" onClick={() => onTemplate(STARTER_TEMPLATE)} className={optionClass}>
          <FileCode size={20} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <span>
            <span className="block text-sm font-medium text-gray-900">Template with a cheat-sheet</span>
            <span className="block text-xs text-gray-500">A tiny working system, with the syntax explained in comments.</span>
          </span>
        </button>
        <button type="button" onClick={onExamples} className={optionClass}>
          <BookOpen size={20} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <span>
            <span className="block text-sm font-medium text-gray-900">Start from an example</span>
            <span className="block text-xs text-gray-500">E-commerce, serverless, login, events, a full HLD…</span>
          </span>
        </button>
        <a href="../practice/" className={optionClass}>
          <GraduationCap size={20} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <span>
            <span className="block text-sm font-medium text-gray-900">Practice system design</span>
            <span className="block text-xs text-gray-500">Problems with tests that check whether your design scales.</span>
          </span>
        </a>
      </div>
    </section>
  );
}
