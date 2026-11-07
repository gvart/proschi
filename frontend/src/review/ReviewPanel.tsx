import { useEffect, useState } from 'react';
import { AlertCircle, ClipboardCheck, Sparkles } from 'lucide-react';
import type { SourceLoc } from '../dsl';
import { outlineButton } from '../components/Playground/ui';
import { Feature } from '../components/Feature';
import { useFeature } from '../components/featureState';
import UpgradeHint from '../components/UpgradeHint';
import { REVIEW_SEVERITIES, type DesignReview, type DesignReviewIssue, type ReviewSeverity, type ReviewUsage } from './contract';
import { buildReviewRequest, type ReviewInput } from './request';
import { aiReviewEnabled, apiReviewer, DailyLimitError, getReviewUsage, ReviewUnavailableError, ruleReviewer, type DesignReviewer } from './reviewer';

interface ReviewPanelProps {
  /** The current source: a review of an older one is marked as such. */
  source: string;
  /** What to review, computed when the button is pressed. */
  input: () => ReviewInput;
  /** Jumps to a node the review names. */
  onSelect?: (loc: SourceLoc) => void;
  /** A reviewer of the caller's (tests): used as is, without the plan's AI review or upgrade hint. */
  reviewer?: DesignReviewer;
}

/** Why the review shown is not the AI's, on an AI-capable panel. */
type Notice = { kind: 'limit'; usage?: ReviewUsage } | { kind: 'fallback' } | { kind: 'error'; message: string };

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'done'; review: DesignReview; source: string; locs: Map<string, SourceLoc>; notice?: Notice };

/** Whether this panel offers the AI review: `checking` until GET /api/review/usage answers. */
type Ai = { status: 'off' } | { status: 'checking' } | { status: 'on'; usage: ReviewUsage };

const SEVERITY_CLASS: Record<ReviewSeverity, string> = {
  critical: 'border-fail bg-fail/10',
  major: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
  minor: 'border-ink/30 bg-paper',
  info: 'border-ink/20 bg-paper',
};

const SEVERITY_TITLE: Record<ReviewSeverity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Notes' };
/** Most severe first. */
const SEVERITY_ORDER = [...REVIEW_SEVERITIES].reverse();

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * "Review my design": a review of the design's trade-offs, next to the
 * tests. Accounts with the ai_review feature (components/Feature.tsx) on the hosted site get an AI review (./reviewer.ts,
 * 20 a day, the count shown); everyone else, and Pro when the AI reviewer is
 * off, busy or used up for the day, gets the rule reviewer (./rules.ts),
 * which writes it from the simulation and the test results. Where paid plans
 * are on, everyone else sees a small hint that AI review is part of Pro.
 */
export default function ReviewPanel({ source, input, onSelect, reviewer: injected }: ReviewPanelProps) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const aiReview = useFeature('ai_review');
  const wantsAi = !injected && aiReviewEnabled && aiReview.ok;
  // GET /api/review/usage's answer: undefined until it comes, null when there is no AI review for this account.
  const [usage, setUsage] = useState<ReviewUsage | null | undefined>(undefined);
  useEffect(() => {
    if (!wantsAi) return;
    let cancelled = false;
    void getReviewUsage().then((u) => !cancelled && setUsage(u ?? null));
    return () => {
      cancelled = true;
    };
  }, [wantsAi]);
  const ai: Ai = !wantsAi || usage === null ? { status: 'off' } : usage === undefined ? { status: 'checking' } : { status: 'on', usage };

  const aiOn = ai.status === 'on';
  const reviewer = injected ?? (aiOn ? apiReviewer : ruleReviewer);
  const showsAi = injected ? injected.ai : aiOn;

  const review = async () => {
    setState({ status: 'loading' });
    const reviewInput = input();
    const request = buildReviewRequest(reviewInput);
    const locs = new Map(reviewInput.parsed.diagram.nodes.filter((n) => n.loc.file === undefined).map((n) => [n.id, n.loc]));
    const done = (review: DesignReview, notice?: Notice) => setState({ status: 'done', review, source: reviewInput.source, locs, notice });
    if (aiOn && ai.usage.remaining <= 0) return done(await ruleReviewer.review(request), { kind: 'limit', usage: ai.usage });
    try {
      const result = await reviewer.review(request);
      if (result.usage) setUsage(result.usage);
      done(result);
    } catch (e) {
      if (!aiOn) {
        if (e instanceof ReviewUnavailableError) setState({ status: 'unavailable' });
        else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      // The AI review did not come: the automatic one instead, saying why.
      let notice: Notice;
      if (e instanceof DailyLimitError) {
        notice = { kind: 'limit', usage: e.usage };
        if (e.usage) setUsage(e.usage);
      } else if (e instanceof ReviewUnavailableError) notice = { kind: 'fallback' };
      else notice = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      done(await ruleReviewer.review(request), notice);
    }
  };

  const loading = state.status === 'loading';
  return (
    <div className="px-3 py-3 space-y-3 text-sm" data-testid="design-review" aria-busy={loading || ai.status === 'checking'}>
      <p className="text-ink/80">
        {showsAi
          ? 'An in-depth review: Claude, by Anthropic, reads your design, the server’s run of its tests and the simulation’s numbers, and comments on the trade-offs.'
          : 'An automatic review, based on the simulation and the tests.'}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={() => void review()} disabled={loading || ai.status === 'checking'} className={`${outlineButton} disabled:opacity-50`}>
          {showsAi ? <Sparkles size={14} /> : <ClipboardCheck size={14} />}
          {loading ? 'Reviewing…' : 'Review my design'}
        </button>
        {aiOn && (
          <span className="text-xs text-muted tabular-nums" data-testid="reviews-left">
            {ai.usage.remaining > 0 ? `${ai.usage.remaining} of ${ai.usage.limit} in-depth reviews left today` : `No in-depth reviews left today · more at ${time(ai.usage.resetAt)}`}
          </span>
        )}
      </div>
      {loading && showsAi && (
        <p role="status" className="text-xs text-muted">
          Reading your design and its test results; this can take up to a minute.
        </p>
      )}
      {!injected && (
        <Feature
          name="ai_review"
          hint={<UpgradeHint>The in-depth review is part of Pro</UpgradeHint>}
          free={(hint) =>
            hint && (
              <p className="text-xs text-muted" data-testid="review-upgrade-hint">
                Want an in-depth review that explains your design’s trade-offs? {hint}
              </p>
            )
          }
        />
      )}

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
      {state.status === 'done' && state.notice && <NoticeLine notice={state.notice} />}
      {state.status === 'done' && <Review review={state.review} stale={state.source !== source} locs={state.locs} onSelect={onSelect} />}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (notice.kind === 'error') {
    return (
      <p role="alert" className="flex gap-2 rounded-sm border-bw-1 border-fail bg-fail/10 px-3 py-2 text-ink" data-testid="review-notice">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>
          The in-depth review failed ({notice.message}), so here is the automatic review. Try the in-depth review again in a minute.
        </span>
      </p>
    );
  }
  return (
    <p role="status" className="rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-ink" data-testid="review-notice">
      {notice.kind === 'limit'
        ? `You have used today’s ${notice.usage?.limit ?? 20} in-depth reviews${notice.usage ? `; more at ${time(notice.usage.resetAt)}` : ''}. Here is the automatic review meanwhile.`
        : 'The in-depth review is not available right now, so here is the automatic review.'}
    </p>
  );
}

function Review({ review, stale, locs, onSelect }: { review: DesignReview; stale: boolean; locs: Map<string, SourceLoc>; onSelect?: (loc: SourceLoc) => void }) {
  return (
    <div className="space-y-3" data-testid="review-result" data-by={review.by ?? 'ai'}>
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
        {review.by === 'rules' ? 'Every finding comes from the simulation and the tests; the tests are the verdict.' : 'The in-depth review can be wrong; the tests are the verdict.'}
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
