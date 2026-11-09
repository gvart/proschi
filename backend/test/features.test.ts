import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, type User } from '../src/auth';
import type { Ctx } from '../src/context';
import type { Env } from '../src/env';
import { can, FEATURES, featureMap, requireFeature } from '../src/features';
import { FEATURE_IDS } from '../../frontend/src/services/featureContract';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';

/** The paid-feature registry (src/features.ts): can(), requireFeature and the map in GET /api/me/plan. */

const noBilling = { ...env, POLAR_ACCESS_TOKEN: '' } as Env;
const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();

describe('features', () => {
  beforeEach(resetDatabase);

  it('has an entry for every shared id, and only those', () => {
    expect(Object.keys(FEATURES).sort()).toEqual([...FEATURE_IDS].sort());
  });

  it('can(): ok, signed_out, needs_pro and billing_off', () => {
    expect(can({ plan: 'pro' }, 'share_links', env)).toEqual({ ok: true });
    expect(can(null, 'share_links', env)).toEqual({ ok: false, reason: 'signed_out' });
    expect(can({ plan: 'free' }, 'share_links', env)).toEqual({ ok: false, reason: 'needs_pro' });
    expect(can({ plan: 'free' }, 'share_links', noBilling)).toEqual({ ok: false, reason: 'billing_off' });
    // Billing off refuses nothing more: Pro keeps its features, and every plan keeps the AI interview.
    expect(can({ plan: 'pro' }, 'ai_roadmap', noBilling)).toEqual({ ok: true });
    expect(can({ plan: 'free' }, 'ai_interview', env)).toEqual({ ok: true });
    expect(can(null, 'ai_interview', env)).toEqual({ ok: false, reason: 'signed_out' });
    // An unknown plan counts as free.
    expect(can({ plan: 'team' }, 'ai_roadmap', env)).toEqual({ ok: false, reason: 'needs_pro' });
    expect(can({ plan: 'team' }, 'ai_interview', env)).toEqual({ ok: true });
  });

  it('requireFeature: 401 signed out, 402 plan_required with the feature, else the handler with the user and its arguments', async () => {
    const route = requireFeature('ai_roadmap', async (_request: Request, _ctx: Ctx, user: User, _pre: undefined, extra: string) => new Response(`${user.id} ${extra}`));
    const ctx = { env, exec: { waitUntil: () => undefined }, ip: '127.0.0.1', requestId: 'r', setCookies: [] } as unknown as Ctx;
    const request = (token?: string) => new Request(`${ORIGIN}/x`, token ? { headers: { Cookie: `${SESSION_COOKIE}=${token}` } } : {});
    await expect(route(request(), ctx, 'a')).rejects.toMatchObject({ status: 401 });
    const { id, token } = await signedInUser();
    const refused = await route(request(token), ctx, 'a');
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({ error: 'plan_required', feature: 'ai_roadmap', message: 'Your next steps are part of Pro' });
    await setPlan(id, 'pro');
    const allowed = await route(request(token), ctx, 'a');
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe(`${id} a`);
  });

  it('GET /api/me/plan answers every feature for the account', async () => {
    const { id, token } = await signedInUser();
    const plan = async () => ((await (await call('/api/me/plan', { token })).json()) as { features: unknown }).features;
    expect(await plan()).toEqual({
      ai_interview: { ok: true },
      interview_history: { ok: false, reason: 'needs_pro' },
      ai_roadmap: { ok: false, reason: 'needs_pro' },
      share_links: { ok: false, reason: 'needs_pro' },
      design_partner: { ok: true },
      deep_mode: { ok: false, reason: 'needs_pro' },
      interview_report: { ok: false, reason: 'needs_pro' },
      design_diff: { ok: false, reason: 'needs_pro' },
    });
    await setPlan(id, 'pro');
    // Pro has every feature but Max's two.
    expect(await plan()).toEqual(
      Object.fromEntries(FEATURE_IDS.map((f) => [f, f === 'deep_mode' || f === 'interview_report' ? { ok: false, reason: 'needs_pro' } : { ok: true }])),
    );
    await setPlan(id, 'max');
    expect(await plan()).toEqual(Object.fromEntries(FEATURE_IDS.map((f) => [f, { ok: true }])));
    expect(featureMap({ plan: 'free' }, noBilling).share_links).toEqual({ ok: false, reason: 'billing_off' });
  });
});
