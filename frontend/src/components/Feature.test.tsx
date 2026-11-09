// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '../practice/useAccount';
import type { PlanInfo } from '../services/billing';
import { Feature } from './Feature';
import { FeaturesContext, useFeature, useFeatures } from './featureState';

const billing = vi.hoisted(() => ({ on: true, getPlan: vi.fn<() => Promise<Partial<PlanInfo>>>() }));
vi.mock('../services/billing', () => ({
  get billingEnabled() {
    return billing.on;
  },
  getPlan: billing.getPlan,
  PLAN_CHANGED: 'proschi:plan-changed',
  pricingHref: (base: string) => `${base}pricing/`,
}));

const SIGNED_IN: AccountState = { status: 'signed-in', user: { id: 'u1', displayName: 'Ada', publicProfile: false }, providers: [] };

function App({ account, children }: { account: AccountState; children: React.ReactNode }) {
  return <FeaturesContext.Provider value={useFeatures(account)}>{children}</FeaturesContext.Provider>;
}

function State() {
  const s = useFeature('ai_roadmap');
  return <output data-testid="state">{JSON.stringify(s)}</output>;
}

const review = (props: Partial<React.ComponentProps<typeof Feature>> = {}) => <Feature name="ai_roadmap" pro={<p>paid</p>} free={<p>rules</p>} {...props} />;

/** Renders signed in with `features` as GET /api/me/plan's, once it has answered. */
async function signedIn(features: PlanInfo['features'] | Partial<PlanInfo['features']>, ui = review()) {
  billing.getPlan.mockResolvedValue({ plan: 'free', features: features as PlanInfo['features'] });
  render(<App account={SIGNED_IN}>{ui}</App>);
  await act(async () => {});
}

beforeEach(() => {
  billing.on = true;
  billing.getPlan.mockReset();
});
afterEach(cleanup);

describe('<Feature>', () => {
  it('asks again when a purchase lands (PLAN_CHANGED)', async () => {
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } });
    expect(screen.getByText('rules')).toBeTruthy();
    billing.getPlan.mockResolvedValue({ plan: 'pro', features: { ai_roadmap: { ok: true } } as PlanInfo['features'] });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('proschi:plan-changed', { detail: 'pro' }));
    });
    expect(screen.getByText('paid')).toBeTruthy();
    expect(billing.getPlan).toHaveBeenCalledTimes(2);
  });

  it('renders pro when the server says ok', async () => {
    await signedIn({ ai_roadmap: { ok: true } });
    expect(screen.getByText('paid')).toBeTruthy();
    expect(screen.queryByText('rules')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders free with the upgrade hint for needs_pro', async () => {
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } });
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' }).getAttribute('href')).toBe('../pricing/');
  });

  it('renders free without the hint with hint={false}, with billing_off, or without paid plans', async () => {
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } }, review({ hint: false }));
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    await signedIn({ ai_roadmap: { ok: false, reason: 'billing_off' } });
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    billing.on = false;
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } });
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('places a custom hint where a free function puts it', async () => {
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } }, review({ free: (hint) => <p data-testid="box">Want it? {hint}</p>, hint: <a href="x">See Pro</a> }));
    expect(screen.getByTestId('box').textContent).toBe('Want it? See Pro');
  });

  it('renders both either way, also while loading', async () => {
    await signedIn({ ai_roadmap: { ok: true } }, review({ both: <p>always</p> }));
    expect(screen.getByText('always')).toBeTruthy();
    cleanup();
    await signedIn({ ai_roadmap: { ok: false, reason: 'needs_pro' } }, review({ both: <p>always</p> }));
    expect(screen.getByText('always')).toBeTruthy();
    cleanup();
    render(<App account={{ status: 'loading' }}>{review({ both: <p>always</p> })}</App>);
    expect(screen.getByText('always')).toBeTruthy();
  });

  it('shows neither branch while the account or its plan loads', async () => {
    render(
      <App account={{ status: 'loading' }}>
        {review()}
        <State />
      </App>,
    );
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByText('rules')).toBeNull();
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ ok: false, loading: true });
    cleanup();
    billing.getPlan.mockReturnValue(new Promise(() => undefined));
    render(<App account={SIGNED_IN}>{review()}</App>);
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByText('rules')).toBeNull();
  });

  it('signed out: free with the hint where paid plans are on, and the plan is not asked for', () => {
    render(
      <App account={{ status: 'signed-out', providers: [] }}>
        {review()}
        <State />
      </App>,
    );
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ ok: false, reason: 'signed_out', loading: false });
    expect(billing.getPlan).not.toHaveBeenCalled();
  });

  it('a plan that could not be read, or lacks the feature, is off without a hint', async () => {
    billing.getPlan.mockRejectedValue(new Error('offline'));
    render(<App account={SIGNED_IN}>{review()}</App>);
    await act(async () => {});
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    await signedIn({});
    expect(screen.getByText('rules')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('without paid plans, hides what spends credits whatever the server says, and follows it for the rest', async () => {
    billing.on = false;
    const on = { ok: true } as const;
    function States() {
      const ids = ['ai_interview', 'ai_roadmap', 'design_partner', 'deep_mode', 'interview_history', 'interview_report', 'interview_plan', 'share_links', 'design_diff'] as const;
      // eslint-disable-next-line react-hooks/rules-of-hooks -- a fixed list, called in the same order every render
      const states = ids.map((id) => [id, useFeature(id).ok]);
      return <output data-testid="states">{JSON.stringify(Object.fromEntries(states))}</output>;
    }
    await signedIn({ ai_interview: on, ai_roadmap: on, design_partner: on, deep_mode: on, interview_history: on, interview_report: on, interview_plan: on, share_links: on, design_diff: on }, <States />);
    expect(JSON.parse(screen.getByTestId('states').textContent!)).toEqual({
      ai_interview: false,
      ai_roadmap: false,
      design_partner: false,
      deep_mode: false,
      interview_history: true,
      interview_report: true,
      interview_plan: true,
      share_links: true,
      design_diff: true,
    });
  });
});
