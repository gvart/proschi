import { describe, expect, it } from 'vitest';
import { aiEnabled, AiError, collect, createClient, HAIKU, SONNET, type MessageRequest } from '../../src/ai/client';
import { messageResponse, mockFetch, sseResponse, streamEvents } from './mockClaude';

const env = { ANTHROPIC_API_KEY: 'sk-test' };
const req = (model: MessageRequest['model'] = SONNET): MessageRequest => ({
  model,
  max_tokens: 100,
  system: [{ type: 'text', text: 'You are terse.', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Hi' }],
});

async function caught(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error('expected an AiError');
}

describe('Claude client', () => {
  it('is off without a key', async () => {
    expect(aiEnabled({})).toBe(false);
    expect(aiEnabled(env)).toBe(true);
    const { fetch, calls } = mockFetch(() => messageResponse('x'));
    expect((await caught(createClient({}, { fetch }).create(req()))).kind).toBe('disabled');
    expect(calls).toHaveLength(0);
  });

  it('posts to the Claude API with the key, version and fallback, and returns the text and usage', async () => {
    const { fetch, calls } = mockFetch(() => messageResponse('Hello', { usage: { cache_read_input_tokens: 900 } }));
    const result = await createClient(env, { fetch }).create(req());
    expect(result).toMatchObject({ text: 'Hello', stopReason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    expect(calls[0].body).toMatchObject({ model: SONNET, fallbacks: 'default', system: req().system });
    expect(calls[0].body.stream).toBeUndefined();
  });

  it('goes through AI Gateway when its URL is set, and sends Haiku no fallback', async () => {
    const { fetch, calls } = mockFetch(() => messageResponse('ok'));
    await createClient({ ...env, AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic/' }, { fetch }).create(req(HAIKU));
    expect(calls[0].url).toBe('https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic/v1/messages');
    expect(calls[0].body.fallbacks).toBeUndefined();
    expect(calls[0].headers['anthropic-beta']).toBeUndefined();
    expect(calls[0].headers['cf-aig-authorization']).toBeUndefined();
  });

  it('authenticates to AI Gateway with its token, and never sends the token to the Claude API', async () => {
    const { fetch, calls } = mockFetch(() => messageResponse('ok'));
    await createClient({ ...env, AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic', AI_GATEWAY_TOKEN: 'cf-token' }, { fetch }).create(req());
    await createClient({ ...env, AI_GATEWAY_TOKEN: 'cf-token' }, { fetch }).create(req());
    expect(calls[0].headers['cf-aig-authorization']).toBe('Bearer cf-token');
    expect(calls[0].headers['x-api-key']).toBe('sk-test');
    expect(calls[1].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[1].headers['cf-aig-authorization']).toBeUndefined();
  });

  it('maps HTTP errors, retrying only the transient ones', async () => {
    const status = (s: number, type = 'error') => () => Response.json({ type: 'error', error: { type, message: `failed ${s}` } }, { status: s });
    for (const [code, kind, retried] of [
      [400, 'bad_request', false],
      [401, 'auth', false],
      [413, 'too_large', false],
      [429, 'rate_limit', true],
      [500, 'server', true],
      [529, 'overloaded', true],
    ] as const) {
      const { fetch, calls } = mockFetch(status(code));
      const err = await caught(createClient(env, { fetch, retryDelayMs: 1 }).create(req()));
      expect(err).toMatchObject({ kind, status: code, message: `failed ${code}`, retryable: retried });
      expect(calls).toHaveLength(retried ? 3 : 1);
    }
  });

  it('succeeds when a retry does', async () => {
    const { fetch, calls } = mockFetch((_, n) => (n === 0 ? new Response('<html>busy</html>', { status: 529 }) : messageResponse('second time')));
    expect((await createClient(env, { fetch, retryDelayMs: 1 }).create(req())).text).toBe('second time');
    expect(calls).toHaveLength(2);
  });

  it('times out', async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const err = await caught(createClient(env, { fetch: hang, timeoutMs: 5, maxRetries: 0 }).create(req()));
    expect(err.kind).toBe('timeout');
    expect(err.retryable).toBe(true);
  });

  it('turns a refusal or a cut-off answer into an error that carries the usage', async () => {
    let { fetch } = mockFetch(() => messageResponse('', { stop: 'refusal' }));
    expect(await caught(createClient(env, { fetch }).create(req()))).toMatchObject({ kind: 'refusal', usage: { input_tokens: 100 } });
    ({ fetch } = mockFetch(() => messageResponse('half', { stop: 'max_tokens' })));
    expect((await caught(createClient(env, { fetch }).create(req()))).kind).toBe('truncated');
  });

  it('marks what the model answered as charged (P34), and an infrastructure failure as free', async () => {
    let { fetch } = mockFetch(() => messageResponse('half', { stop: 'max_tokens', model: 'claude-opus-5-5', usage: { output_tokens: 100 } }));
    expect((await caught(createClient(env, { fetch }).create(req()))).charge).toEqual([{ model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }]);
    ({ fetch } = mockFetch(() => sseResponse(streamEvents('a long answer', { stop: 'max_tokens' }))));
    expect((await caught(collect(createClient(env, { fetch }).stream(req())))).charge).toEqual([expect.objectContaining({ model: SONNET, input_tokens: 100, output_tokens: 50 })]);
    ({ fetch } = mockFetch(() => Response.json({ error: { message: 'bad' } }, { status: 400 })));
    expect((await caught(createClient(env, { fetch }).create(req()))).charge).toEqual([]);
    ({ fetch } = mockFetch(() => sseResponse([streamEvents('hi')[0], { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }])));
    expect((await caught(collect(createClient(env, { fetch }).stream(req())))).charge).toEqual([]);
  });

  it('streams text across chunk boundaries and totals the usage', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(streamEvents('What is the read to write ratio?', { usage: { cache_read_input_tokens: 5000, output_tokens: 12 } }), 3));
    const pieces: string[] = [];
    const result = await collect(createClient(env, { fetch }).stream(req()), (t) => pieces.push(t));
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.join('')).toBe('What is the read to write ratio?');
    expect(result).toMatchObject({ text: 'What is the read to write ratio?', stopReason: 'end_turn', usage: { input_tokens: 100, output_tokens: 12, cache_read_input_tokens: 5000 } });
    expect(calls[0].body.stream).toBe(true);
  });

  it('fails a stream on an error event, a broken event or an early end', async () => {
    let { fetch } = mockFetch(() => sseResponse([streamEvents('hi')[0], { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]));
    expect(await caught(collect(createClient(env, { fetch }).stream(req())))).toMatchObject({ kind: 'overloaded', message: 'Overloaded' });
    ({ fetch } = mockFetch(() => new Response('data: {not json\n\n')));
    expect((await caught(collect(createClient(env, { fetch }).stream(req())))).kind).toBe('malformed');
    ({ fetch } = mockFetch(() => sseResponse(streamEvents('cut short').slice(0, 3))));
    expect((await caught(collect(createClient(env, { fetch }).stream(req())))).kind).toBe('network');
  });
});
