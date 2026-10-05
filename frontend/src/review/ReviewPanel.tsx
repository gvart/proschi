import { useState } from 'react';
import { AlertCircle, ClipboardCheck } from 'lucide-react';
import type { SourceLoc } from '../dsl';
import { outlineButton } from '../components/Playground/ui';
import { REVIEW_SEVERITIES, type DesignReview, type DesignReviewIssue, type ReviewSeverity } from './contract';
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
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'done'; review: DesignReview; source: string; locs: Map<string, SourceLoc> };

const SEVERITY_CLASS: Record<ReviewSeverity, string> = {
  critical: 'border-fail bg-fail/10',
  major: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
  minor: 'border-ink/30 bg-paper',
  info: 'border-ink/20 bg-paper',
};

const SEVERITY_TITLE: Record<ReviewSeverity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Notes' };
/** Most severe first. */
const SEVERITY_ORDER = [...REVIEW_SEVERITIES].reverse();

/**
 * "Review my design": a review of the design's trade-offs, next to the
 * tests. By default the rule reviewer (./rules.ts) writes it from the
 * simulation and the test results; builds with VITE_AI_REVIEW=true ask an
 * LLM first (./reviewer.ts).
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
      if (e instanceof ReviewUnavailableError) setState({ status: 'unavailable' });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="px-3 py-3 space-y-3 text-sm" data-testid="design-review">
      <p className="text-ink/80">
        {reviewer.ai
          ? 'An AI reviewer reads your design, its test results and the simulation’s numbers, and comments on the trade-offs.'
          : 'An automatic review, based on the simulation and the tests. An AI reviewer is coming.'}
      </p>
      <button onClick={() => void review()} disabled={state.status === 'loading'} className={`${outlineButton} disabled:opacity-50`}>
        <ClipboardCheck size={14} />
        {state.status === 'loading' ? 'Reviewing…' : 'Review my design'}
      </button>

      {state.status === 'unavailable' && (
        <div role="status" className="rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-ink">
          <strong>No review is available in this version.</strong> The tests still check latency, availability, durability and cost.
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
    <div className="space-y-3" data-testid="review-result">
      {stale && <p className="text-xs text-muted">Of an earlier version of your design.</p>}
      <p className="text-ink">{review.summary}</p>
      {SEVERITY_ORDER.map((severity) => {
        const issues = review.issues.filter((i) => i.severity === severity);
        return issues.length > 0 && <Issues key={severity} severity={severity} issues={issues} locs={locs} onSelect={onSelect} />;
      })}
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
      {review.suggestions.length > 0 && (
        <section>
          <h3 className="font-semibold text-ink">Next steps</h3>
          <ol className="mt-1 list-decimal pl-5 text-ink/80">
            {review.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
      <p className="text-xs text-muted">
        {review.by === 'rules' ? 'Every finding comes from the simulation and the tests; the tests are the verdict.' : 'AI feedback can be wrong; the tests are the verdict.'}
      </p>
    </div>
  );
}

function Issues({ severity, issues, locs, onSelect }: { severity: ReviewSeverity; issues: DesignReviewIssue[]; locs: Map<string, SourceLoc>; onSelect?: (loc: SourceLoc) => void }) {
  return (
    <section>
      <h3 className="font-semibold text-ink">
        {SEVERITY_TITLE[severity]} <span className="font-normal text-muted tabular-nums">({issues.length})</span>
      </h3>
      <ul className="mt-1 space-y-1.5">
        {issues.map((issue, i) => {
          const loc = issue.nodeId ? locs.get(issue.nodeId) : undefined;
          return (
            <li key={i} className={`rounded border-bw-1 px-3 py-2 ${SEVERITY_CLASS[issue.severity]}`}>
              <p className="font-medium text-ink">
                {issue.title}
                {issue.nodeId &&
                  (loc && onSelect ? (
                    <button onClick={() => onSelect(loc)} title={`Go to ${issue.nodeId} in the code`} className="ml-1.5 font-mono text-xs text-pop-blue hover:underline">
                      {issue.nodeId}
                    </button>
                  ) : (
                    <span className="ml-1.5 font-mono text-xs text-muted">{issue.nodeId}</span>
                  ))}
              </p>
              <p className="text-ink/75">{issue.detail}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
