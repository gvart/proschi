import { useState, type ReactNode } from 'react';
import { CreditCard, ShieldCheck, Sparkles, Volume2 } from 'lucide-react';
import { outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import UpgradeHint from '../../components/UpgradeHint';
import { billingEnabled, checkout, PRICES } from '../../services/billing';
import { formatCredits, formatRange, type Range } from '../../services/credits';
import { playCue } from './sounds';
import type { StepId } from './setupSteps';
import { Switch } from './wizard';

/**
 * The wizard's last screen (Setup.tsx): the set-up in rows, each one a way
 * back to its screen; for the interviewer, the credits against the balance,
 * the Deep verdict (Max) and the consent line. Start is in the wizard's bar.
 */

export interface ReviewRow {
  term: string;
  value: ReactNode;
  step: StepId;
  /** "Change the problem": the row's button, for a screen reader. */
  change: string;
}

interface SetupReviewProps {
  rows: readonly ReviewRow[];
  onEdit: (step: StepId) => void;
  soundOn: boolean;
  onSound: (on: boolean) => void;
  /** The interviewer's part; absent on your own, which is free. */
  mock?: {
    cost?: ReactNode;
    deep?: ReactNode;
  };
  error?: string;
  checking?: boolean;
}

export default function SetupReview({ rows, onEdit, soundOn, onSound, mock, error, checking }: SetupReviewProps) {
  return (
    <div className="space-y-5">
      <ul className="grid gap-px overflow-hidden rounded-sm border-bw-1 border-ink bg-ink/15 sm:grid-cols-2" aria-label="Your interview">
        {rows.map((r, i) => (
          <li key={r.term} className={`flex items-center gap-3 bg-surface px-4 py-2.5 ${rows.length % 2 && i === rows.length - 1 ? 'sm:col-span-2' : ''}`}>
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-muted">{r.term}</span>
              <span className="block font-semibold text-ink">{r.value}</span>
            </div>
            <span className="shrink-0">
              <button type="button" onClick={() => onEdit(r.step)} aria-label={r.change} className={`${toolButton} !py-1 text-xs`}>
                Change
              </button>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 bg-surface px-4 py-2.5 sm:col-span-2">
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-muted">Sound effects</span>
            <span className="block font-semibold text-ink">
              {soundOn ? 'On' : 'Off'} <span className="hidden text-xs font-normal text-muted sm:inline">· a new phase, the last minutes, a hint and the end</span>
            </span>
          </div>
          {soundOn && (
            <span className="shrink-0">
              <button type="button" onClick={() => playCue('phase')} className={`${toolButton} !py-1 text-xs`}>
                <Volume2 size={13} aria-hidden="true" />
                Play a sample
              </button>
            </span>
          )}
          <span className="shrink-0">
            <Switch checked={soundOn} onChange={onSound} testId="setup-sound" label="Sound effects" />
          </span>
        </li>
      </ul>

      {mock ? (
        <>
          {mock.cost}
          {mock.deep}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted" data-testid="consent-line">
            <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden="true" />
            <span>
              Your interviewer is Claude, an AI model made by Anthropic. Starting sends Anthropic what you type or say, the design you send and the problem; Proschi keeps the transcript 90 days.{' '}
              <a href="../docs/privacy/" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
                Privacy
              </a>
            </span>
          </p>
        </>
      ) : (
        <p className="rounded-sm border-bw-1 border-ink/20 bg-paper/60 px-4 py-3 text-sm text-ink" data-testid="solo-free">
          <strong>Free.</strong> <span className="text-ink/75">Your time per phase, answers and summary stay in this browser.</span>
        </p>
      )}
      {checking && <p className="text-xs text-muted">Checking the interviewer…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** Max's Deep verdict, or for Pro a quiet hint at it. */
export function DeepVerdict({ on, onChange, multiplier }: { on: boolean; onChange: (on: boolean) => void; multiplier: number }) {
  return (
    <label data-testid="interview-deep" className={`flex cursor-pointer items-start gap-3 rounded-sm border-bw-1 px-4 py-3 text-sm text-ink ${on ? 'border-ink bg-pop-lilac/25' : 'border-ink/25 hover:border-ink'}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-ink" />
      <span>
        <span className="flex items-center gap-1.5 font-semibold">
          <Sparkles size={13} aria-hidden="true" />
          Deep verdict
        </span>
        <span className="mt-0.5 block text-xs text-ink/75">A stronger model takes longer over your verdict. The interview itself is the same; the verdict costs about {formatCredits(multiplier)}× as much.</span>
      </span>
    </label>
  );
}

export function DeepVerdictHint() {
  return (
    <p data-testid="interview-deep-hint" className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
      Want a more thorough verdict? Deep verdicts come with Max.
      <UpgradeHint icon={false}>See Max</UpgradeHint>
    </p>
  );
}

/** What a mock interview of this length is likely to cost against the balance; without enough, the ways to get more. */
export function InterviewCost({ estimate, minutes, balance, short, notEnough }: { estimate: Range; minutes: number; balance: number; short?: { needed: number; balance: number }; notEnough: boolean }) {
  const [buying, setBuying] = useState(false);
  const [failed, setFailed] = useState<string>();
  const have = formatCredits(short?.balance ?? balance, { floor: true });
  if (!notEnough) {
    return (
      <div data-testid="ai-credits" className="rounded-sm border-bw-1 border-ink/25 bg-paper/60 px-4 py-3 text-sm text-ink">
        <p>
          <strong className="tabular-nums">{formatRange(estimate)} credits</strong> for {minutes} min; you have <strong className="tabular-nums">{have}</strong>.
        </p>
        <p className="mt-1 text-xs text-muted">
          You pay for what the interview uses
          {estimate.worst !== undefined && <span data-testid="ai-credits-cap">, never more than {formatCredits(Math.min(estimate.worst, short?.balance ?? balance), { floor: true })} credits</span>}. If you run out, the
          interviewer moves to the wrap-up and still gives you the verdict.
        </p>
      </div>
    );
  }
  const buy = () => {
    setBuying(true);
    setFailed(undefined);
    checkout('credits_1000').catch((e: unknown) => {
      setBuying(false);
      setFailed(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <div data-testid="ai-credits" data-enough="false" role="status" className="rounded-sm border-bw-1 border-ink bg-pop-yellow/15 px-4 py-3 text-sm text-ink">
      <p>
        You have <strong className="tabular-nums">{have} credits</strong>. A {minutes}-minute mock interview takes{' '}
        <strong className="tabular-nums">{short?.needed ? `at least ${formatCredits(short.needed)}` : formatRange(estimate)}</strong>.
      </p>
      <p className="mt-1 text-xs text-muted">Top-up credits never expire. A plan adds credits every month. Or change the interviewer to On my own, which is free.</p>
      {failed && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {failed}
        </p>
      )}
      {billingEnabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={buy} disabled={buying} className={`${primaryButton} disabled:opacity-50`}>
            <CreditCard size={14} aria-hidden="true" />
            {buying ? 'Opening…' : `Buy ${formatCredits(PRICES.topupCredits)} credits, €${PRICES.topup}`}
          </button>
          <UpgradeHint testId="ai-upgrade" className={outlineButton}>
            See plans
          </UpgradeHint>
        </div>
      )}
    </div>
  );
}
