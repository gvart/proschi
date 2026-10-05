import { ArrowRight } from 'lucide-react';
import { CONTRIBUTE_PROBLEM_URL, SUGGEST_PROBLEM_URL } from '../design/site';

/**
 * The invitation at the end of the problem list: how to add a problem
 * (CONTRIBUTING.md) or, without writing one, how to suggest it (an issue).
 */
export default function ContributeCard() {
  return (
    <aside aria-label="Contribute a problem" className="mt-5 rounded-brutal border-bw-2 border-dashed border-ink/40 px-4 py-3.5 text-sm text-ink/80">
      Have a system design problem in mind?{' '}
      <a
        href={CONTRIBUTE_PROBLEM_URL}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1 font-semibold text-pop-blue hover:underline"
      >
        Contribute it
        <ArrowRight size={14} aria-hidden="true" />
      </a>{' '}
      <span className="text-muted">or</span>{' '}
      <a href={SUGGEST_PROBLEM_URL} target="_blank" rel="noopener" className="text-pop-blue hover:underline">
        suggest an idea
      </a>
      .
    </aside>
  );
}
