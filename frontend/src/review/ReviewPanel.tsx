import { useState } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { SourceLoc } from '../dsl';
import { outlineButton } from '../components/Playground/ui';
import type { DesignReview, DesignReviewIssue } from './contract';
import { buildReviewRequest, type ReviewInput } from './request';
import { defaultReviewer, ReviewUnavailableError, type DesignReviewer } from './reviewer';

interface ReviewPanelProps {
  /** The current source: a review of an older one is marked as such. */
  source: string;
  /** What to review, computed when the button is pressed. */
  input: () => ReviewInput;
  /** Jumps to a node the review names. */
  onSelect?: (loc: SourceLoc) => void;
  reviewer?: DesignReviewer;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'coming-soon' }
  | { status: 'error'; message: string }
  | { status: 'done'; review: DesignReview; source: string; locs: Map<string, SourceLoc> };

const SEVERITY_CLASS: Record<DesignReviewIssue['severity'], string> = {
  critical: 'border-fail bg-fail/10',
  major: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
  minor: 'border-ink/30 bg-paper',
  info: 'border-ink/20 bg-paper',
};

/**
 * "Review my design": an AI review of the design's trade-offs, next to the
 * tests. A placeholder until an LLM is wired in (./reviewer.ts): the panel
 * then says the review is coming soon and gives no feedback of any kind.
 */
export default function ReviewPanel({ source, input, onSelect, reviewer = defaultReviewer }: ReviewPanelProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const review = async () => {
    setState({ status: 'loading' });
    try {
      const reviewInput = input();
      const result = await reviewer.review(buildReviewRequest(reviewInput));
      const locs = new Map(reviewInput.parsed.diagram.nodes.filter((n) => n.loc.file === undefined).map((n) => [n.id, n.loc]));
      setState({ status: 'done', review: result, source: reviewInput.source, locs });
    } catch (e) {
      if (e instanceof ReviewUnavailableError) setState({ status: 'coming-soon' });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="px-3 py-3 space-y-3 text-sm" data-testid="ai-review">
      <p className="text-ink/80">
        {reviewer.available ? 'An AI reviewer reads' : 'Coming soon: an AI reviewer that reads'} your design, its test results and the simulation&rsquo;s cost,
        p99 and availability, and comments on the trade-offs: what holds up, what to worry about and what to try next.
      </p>
      <button onClick={() => void review()} disabled={state.status === 'loading'} className={`${outlineButton} disabled:opacity-50`}>
        <Sparkles size={14} />
        {state.status === 'loading' ? 'Reviewing…' : 'Review my design'}
      </button>

      {state.status === 'coming-soon' && (
        <div role="status" className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-ink">
          <strong>AI review is coming soon.</strong> It is not available in this version yet, so there is no feedback to show. The tests still check
          latency, availability, durability and cost.
        </div>
      )}
      {state.status === 'error' && (
        <p role="alert" className="flex gap-2 rounded border-bw-1 border-fail bg-fail/10 px-3 py-2 text-ink">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          The review failed: {state.message}
        </p>
      )}
      {state.status === 'done' && <Review review={state.review} stale={state.source !== source} locs={state.locs} onSelect={onSelect} />}
    </div>
  );
}

function Review({ review, stale, locs, onSelect }: { review: DesignReview; stale: boolean; locs: Map<string, SourceLoc>; onSelect?: (loc: SourceLoc) => void }) {
  return (
    <div className="space-y-3">
      {stale && <p className="text-xs text-muted">Of an earlier version of your design.</p>}
      <p className="text-ink">{review.summary}</p>
      {review.strengths.length > 0 && (
        <section>
          <h3 className="font-semibold text-ink">Strengths</h3>
          <ul className="mt-1 list-disc pl-5 text-ink/80">
            {review.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      {review.issues.length > 0 && (
        <section>
          <h3 className="font-semibold text-ink">Issues</h3>
          <ul className="mt-1 space-y-1.5">
            {review.issues.map((issue, i) => {
              const loc = issue.nodeId ? locs.get(issue.nodeId) : undefined;
              return (
                <li key={i} className={`rounded border-bw-1 px-3 py-2 ${SEVERITY_CLASS[issue.severity]}`}>
                  <p className="font-medium text-ink">
                    <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-muted">{issue.severity}</span>
                    {issue.title}
                    {issue.nodeId &&
                      (loc && onSelect ? (
                        <button onClick={() => onSelect(loc)} className="ml-1 font-mono text-xs text-pop-blue hover:underline">
                          {issue.nodeId}
                        </button>
                      ) : (
                        <span className="ml-1 font-mono text-xs text-muted">{issue.nodeId}</span>
                      ))}
                  </p>
                  <p className="text-ink/75">{issue.detail}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {review.suggestions.length > 0 && (
        <section>
          <h3 className="font-semibold text-ink">Suggestions</h3>
          <ul className="mt-1 list-disc pl-5 text-ink/80">
            {review.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted">AI feedback can be wrong; the tests are the verdict.</p>
    </div>
  );
}
