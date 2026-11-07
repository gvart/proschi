import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantSignupCredits } from '../src/credits';
import type { Env } from '../src/env';
import { voiceMc, WHISPER } from '../src/meter';
import { billedSeconds, MAX_BYTES, MAX_SECONDS } from '../src/voice';
import { SESSION_COOKIE } from '../src/auth';
import { ORIGIN, resetDatabase, signedInUser } from './helpers';

const e = env as Env;

/** POSTs `bytes` of audio as `type`, signed in with `token`. */
function post(token: string | undefined, bytes: number, { type = 'audio/webm;codecs=opus', query = 'seconds=10' } = {}) {
  const headers: Record<string, string> = { 'Content-Type': type, Origin: ORIGIN, 'CF-Connecting-IP': `test-${crypto.randomUUID()}` };
  if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(`${ORIGIN}/api/voice/transcribe?${query}`, { method: 'POST', headers, body: new Uint8Array(bytes).fill(7) }));
}

const charges = async (userId: string) =>
  (await env.DB.prepare("SELECT action, ref, charged_mc, cost_usd FROM credit_charges WHERE user_id = ? AND action = 'voice'").bind(userId).all<{ action: string; ref: string; charged_mc: number; cost_usd: number }>()).results;

describe('voice transcription (P39)', () => {
  type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;
  let run: ReturnType<typeof vi.fn<Run>>;
  beforeEach(async () => {
    await resetDatabase();
    run = vi.fn<Run>(async () => ({ text: ' How many redirects a second? ' }));
    e.AI = { run };
  });
  afterEach(() => {
    delete e.AI;
  });

  it('bills the longer of the declared length and what the size implies, at most a minute', () => {
    expect(billedSeconds(40_000, 12)).toBe(12);
    expect(billedSeconds(80_000, 2)).toBe(20);
    expect(billedSeconds(10, Number.NaN)).toBe(1);
    expect(billedSeconds(MAX_BYTES, 500)).toBe(MAX_SECONDS);
    // About 0.1 credit a minute: 2x $0.000513 at 0.95 EUR/USD.
    expect(voiceMc(60, e)).toBe(98);
  });

  it('transcribes a chunk with Whisper and charges it as voice', async () => {
    const u = await signedInUser();
    await grantSignupCredits(env, u.id, `github\n${u.id}`);
    const res = await post(u.token, 40_000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; credits: number };
    expect(body.text).toBe('How many redirects a second?');
    expect(run).toHaveBeenCalledWith(WHISPER, expect.objectContaining({ task: 'transcribe', language: 'en', audio: expect.any(String) }));
    const [charge] = await charges(u.id);
    expect(charge).toMatchObject({ action: 'voice', ref: 'voice', charged_mc: voiceMc(10, e) });
    expect(body.credits).toBe(voiceMc(10, e) / 1000);
    expect(charge.cost_usd).toBeCloseTo((10 / 60) * 0.000513, 9);
  });

  it('answers 401 signed out, 402 without credits, 413 too large, 415 for another type', async () => {
    expect((await post(undefined, 100)).status).toBe(401);
    const poor = await signedInUser();
    const refused = await post(poor.token, 100);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'no_credits' });
    await grantSignupCredits(env, poor.id, `github\n${poor.id}`);
    expect((await post(poor.token, MAX_BYTES + 1)).status).toBe(413);
    expect((await post(poor.token, 100, { type: 'text/plain' })).status).toBe(415);
    expect((await post(poor.token, 100, { query: 'lang=english' })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('charges nothing when the transcription fails, and answers 501 without the AI binding', async () => {
    const u = await signedInUser();
    await grantSignupCredits(env, u.id, `github\n${u.id}`);
    run.mockRejectedValueOnce(new Error('InferenceUpstreamError'));
    const res = await post(u.token, 1000);
    expect(res.status).toBe(502);
    expect(await charges(u.id)).toEqual([]);
    const held = await env.DB.prepare('SELECT COUNT(*) AS n FROM credit_holds WHERE user_id = ?').bind(u.id).first<{ n: number }>();
    expect(held!.n).toBe(0);
    delete e.AI;
    expect((await post(u.token, 1000)).status).toBe(501);
  });
});
