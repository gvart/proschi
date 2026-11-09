import { useState } from 'react';
import { AlertCircle, ClipboardCheck, MessagesSquare } from 'lucide-react';
import type { SourceLoc } from '../dsl';
import { outlineButton } from '../components/Playground/ui';
import { REVIEW_SEVERITIES, type DesignReview, type DesignReviewIssue, type ReviewSeverity } from './contract';
import { buildReviewRequest, type ReviewInput } from './request';
import { ReviewUnavailableError, ruleReviewer, type DesignReviewer } from './reviewer';

interface ReviewPanelProps {
  /** The current source: a review of an older one is marked as such. */
  source: string;
  /** What to review, computed when the button is pressed. */
  input: () => ReviewInput;
  /** Jumps to a node the review names. */
  onSelect?: (loc: SourceLoc) => void;
  /** A reviewer of the caller's (tests); the rule reviewer by default. */
  reviewer?: DesignReviewer;
  /** Opens Design partner (src/partner), where there is one: offered under the review. */
  onOpenPartner?: () => void;
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
 * "Review my design": the automatic review, next to the tests, written by
 * the rule reviewer (./rules.ts) from the simulation and the test results.
 * Free, instant and on every build. Talking a design through, with changes
 * to accept, is Design partner's (src/partner), linked from here.
 */
export default function ReviewPanel({ source, input, onSelect, reviewer = ruleReviewer, onOpenPartner }: ReviewPanelProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const review = async () => {
    setState({ status: 'loading' });
    const reviewInput = input();
    const request = buildReviewRequest(reviewInput);
    const locs = new Map(reviewInput.parsed.diagram.nodes.filter((n) => n.loc.file === undefined).map((n) => [n.id, n.loc]));
    try {
      setState({ status: 'done', review: await reviewer.review(request), source: reviewInput.source, locs });
    } catch (e) {
      if (e instanceof ReviewUnavailableError) setState({ status: 'unavailable' });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const loading = state.status === 'loading';
  return (
    <div className="px-3 py-3 space-y-3 text-sm" data-testid="design-review" aria-busy={loading}>
      <p className="text-ink/80">An automatic review, based on the simulation and the tests.</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={() => void review()} disabled={loading} className={`${outlineButton} disabled:opacity-50`}>
          <ClipboardCheck size={14} />
          {loading ? 'Reviewing…' : 'Review my design'}
        </button>
      </div>

      {state.status === 'unavailable' && (
        <div role="status" className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-ink">
          <strong>No review is available in this version.</strong> The tests still check latency, availability, durability and cost.
        </div>
      )}
      {state.status === 'error' && (
        <p role="alert" className="flex gap-2 rounded-sm border-bw-1 border-fail bg-fail/10 px-3 py-2 text-ink">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          The review failed: {state.message}
        </p>
      )}
      {state.status === 'done' && <Review review={state.review} stale={state.source !== source} locs={state.locs} onSelect={onSelect} />}
      {onOpenPartner && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted" data-testid="review-partner-link">
          Want to talk it through, with changes you can accept?
          <button type="button" onClick={onOpenPartner} className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-ink/40 underline-offset-2 hover:decoration-ink">
            <MessagesSquare size={12} aria-hidden="true" />
            Open Design partner
          </button>
        </p>
      )}
    </div>
  );
}

function Review({ review, stale, locs, onSelect }: { review: DesignReview; stale: boolean; locs: Map<string, SourceLoc>; onSelect?: (loc: SourceLoc) => void }) {
  return (
    <div className="space-y-3" data-testid="review-result" data-by={review.by ?? 'rules'}>
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
        Every finding comes from the simulation and the tests; the tests are the verdict.
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
            <li key={i} className={`rounded-sm border-bw-1 px-3 py-2 ${SEVERITY_CLASS[issue.severity]}`}>
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
