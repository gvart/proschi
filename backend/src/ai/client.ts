/**
 * A small Claude Messages API client over plain fetch (it runs in the
 * Worker; the SDK adds nothing we need here). One request shape, two ways to
 * send it: `create` waits for the whole message, `stream` yields its text as
 * it arrives (Server-Sent Events). Both return the token usage, for the
 * session's budget (./budget.ts) and the credit ledger.
 *
 * The base URL is configurable so requests can go through Cloudflare AI
 * Gateway (docs/design/paid-plans.md, P4): set AI_GATEWAY_URL to
 * `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`. An
 * authenticated gateway also needs AI_GATEWAY_TOKEN, sent as
 * `cf-aig-authorization: Bearer <token>`.
 */

export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';
/** Deep mode (docs/design/paid-plans.md P31): Design partner on Opus. */
export const OPUS = 'claude-opus-5-5';
export type Model = typeof SONNET | typeof HAIKU | typeof OPUS;

export const API_VERSION = '2026-10-21';
export const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/** A whole request, retries excluded. Interview turns are short; the verdict thinks. */
export const DEFAULT_TIMEOUT_MS = 90_000;
/** Server-side refusal fallback (Claude API only; Sonnet and Opus, Haiku has none). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The secrets the client needs (P10: without the key the AI routes answer 501). */
export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  /** Cloudflare AI Gateway's Anthropic endpoint; the Claude API when unset. */
  AI_GATEWAY_URL?: string;
  /** The token of an authenticated AI Gateway (`cf-aig-authorization`); only sent with AI_GATEWAY_URL. */
  AI_GATEWAY_TOKEN?: string;
}

export function aiEnabled(env: AiEnv): env is AiEnv & { ANTHROPIC_API_KEY: string } {
  return !!env.ANTHROPIC_API_KEY;
}

export interface CacheControl {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

export interface TextBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface MessageParam {
  role: 'user' | 'assistant';
  content: string | TextBlock[];
}

export interface MessageRequest {
  model: Model;
  max_tokens: number;
  system: TextBlock[];
  messages: MessageParam[];
  thinking?: { type: 'adaptive' } | { type: 'between_tools' } | { type: 'disabled' };
  output_config?: {
    effort?: 'low' | 'medium' | 'high';
    format?: { type: 'json_schema'; schema: Record<string, unknown> };
  };
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** One call's usage with the model that answered it: what the credit ledger prices. */
export type ModelUsage = Usage & { model: string };

export const NO_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

export interface MessageResult {
  /** The model that answered (a fallback model when Sonnet declined). */
  model: string;
  /** The text blocks joined; thinking and fallback blocks are left out. */
  text: string;
  stopReason: string;
  usage: Usage;
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'done'; result: MessageResult };

export type AiErrorKind = 'disabled' | 'auth' | 'bad_request' | 'too_large' | 'rate_limit' | 'overloaded' | 'server' | 'timeout' | 'network' | 'refusal' | 'truncated' | 'malformed';

/** Every failure of a model call, mapped to what the route does with it. */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  /** Worth trying again later (the route can refund the credit if it is early, P3). */
  readonly retryable: boolean;
  /** Tokens already spent on the failed call (a refusal or a truncated answer is billed). */
  readonly usage?: Usage;
  /**
   * The calls the user pays for although this one failed
   * (docs/design/paid-plans.md P34): every answer the model gave (a refusal,
   * one cut off at max_tokens, one that did not validate, and an earlier
   * attempt's). Empty when the call failed on our side or the
   * infrastructure's (network, timeout, rate limit, overloaded, 5xx).
   */
  readonly charge: ModelUsage[];
  constructor(kind: AiErrorKind, message: string, opts: { status?: number; usage?: Usage; charge?: ModelUsage[] } = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = opts.status;
    this.usage = opts.usage;
    this.charge = opts.charge ?? [];
    this.retryable = ['rate_limit', 'overloaded', 'server', 'timeout', 'network'].includes(kind);
  }
}

export interface ClaudeClient {
  create(req: MessageRequest): Promise<MessageResult>;
  stream(req: MessageRequest): AsyncIterable<StreamEvent>;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Retries of a rate-limited, overloaded or failed request before any of its body is read. */
  maxRetries?: number;
  /** Milliseconds before a retry, doubled each time; a `retry-after` header wins. */
  retryDelayMs?: number;
}

function errorKind(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 504 || status === 524 || status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function usageOf(raw: unknown): Usage {
  const u = (raw ?? {}) as Partial<Record<keyof Usage, unknown>>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { input_tokens: n(u.input_tokens), output_tokens: n(u.output_tokens), cache_creation_input_tokens: n(u.cache_creation_input_tokens), cache_read_input_tokens: n(u.cache_read_input_tokens) };
}

/** A refusal or a cut-off answer is an error: callers only see complete answers. The model answered, so it is charged (P34). */
function finish(result: MessageResult): MessageResult {
  const charge = [{ model: result.model, ...result.usage }];
  if (result.stopReason === 'refusal') throw new AiError('refusal', 'The model declined to answer', { usage: result.usage, charge });
  if (result.stopReason === 'max_tokens') throw new AiError('truncated', 'The answer was cut off at max_tokens', { usage: result.usage, charge });
  return result;
}

/** An answer that did not validate: an AiError ('malformed') that charges it, after the calls in `before` (P34). */
export function malformed(message: string, result: MessageResult, before: ModelUsage[] = []): AiError {
  return new AiError('malformed', message, { usage: result.usage, charge: [...before, { model: result.model, ...result.usage }] });
}

export function createClient(env: AiEnv, opts: ClientOptions = {}): ClaudeClient {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? 2;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const url = `${(env.AI_GATEWAY_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/messages`;

  function body(req: MessageRequest, stream: boolean): string {
    // Sonnet and Opus: on a policy decline the API re-runs the request on a fallback model in the same call.
    return JSON.stringify({ ...req, ...(req.model !== HAIKU ? { fallbacks: 'default' } : {}), ...(stream ? { stream: true } : {}) });
  }

  /** Sends until a 2xx or a final error; the returned response's body is unread. The timer covers the body too: call `done` after reading it. */
  async function send(req: MessageRequest, stream: boolean): Promise<{ res: Response; done: () => void }> {
    if (!env.ANTHROPIC_API_KEY) throw new AiError('disabled', 'ANTHROPIC_API_KEY is not set');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
      ...(req.model !== HAIKU ? { 'anthropic-beta': FALLBACK_BETA } : {}),
      ...(env.AI_GATEWAY_URL && env.AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}),
    };
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const done = () => clearTimeout(timer);
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers, body: body(req, stream), signal: controller.signal });
      } catch (e) {
        done();
        const err = controller.signal.aborted ? new AiError('timeout', `No answer within ${timeoutMs} ms`) : new AiError('network', `Could not reach the model: ${(e as Error).message}`);
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw err;
      }
      if (res.ok) return { res, done };
      const text = await res.text().catch(() => '');
      done();
      let message = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Not JSON (a gateway's HTML page): the status is all we report.
      }
      const err = new AiError(errorKind(res.status), message, { status: res.status });
      if (!err.retryable || attempt >= maxRetries) throw err;
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : retryDelayMs * 2 ** attempt);
    }
  }

  async function create(req: MessageRequest): Promise<MessageResult> {
    const { res, done } = await send(req, false);
    let raw: { model?: string; content?: { type: string; text?: string }[]; stop_reason?: string; usage?: unknown };
    try {
      raw = (await res.json()) as typeof raw;
    } catch (e) {
      throw (e as Error).name === 'AbortError' ? new AiError('timeout', `No answer within ${timeoutMs} ms`) : new AiError('malformed', 'The response is not JSON');
    } finally {
      done();
    }
    const text = (raw.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return finish({ model: raw.model ?? req.model, text, stopReason: raw.stop_reason ?? '', usage: usageOf(raw.usage) });
  }

  async function* stream(req: MessageRequest): AsyncIterable<StreamEvent> {
    const { res, done } = await send(req, true);
    if (!res.body) {
      done();
      throw new AiError('malformed', 'The stream has no body');
    }
    let model: string = req.model;
    let stopReason = '';
    let usage = { ...NO_USAGE };
    let text = '';
    try {
      for await (const event of sseEvents(res.body)) {
        let data: { type?: string; message?: { model?: string; usage?: unknown }; delta?: { type?: string; text?: string; stop_reason?: string }; usage?: unknown; error?: { type?: string; message?: string } };
        try {
          data = JSON.parse(event) as typeof data;
        } catch {
          throw new AiError('malformed', 'A stream event is not JSON');
        }
        switch (data.type) {
          case 'message_start':
            model = data.message?.model ?? model;
            usage = usageOf(data.message?.usage);
            break;
          case 'content_block_delta':
            if (data.delta?.type === 'text_delta' && data.delta.text) {
              text += data.delta.text;
              yield { type: 'text', text: data.delta.text };
            }
            break;
          case 'message_delta': {
            stopReason = data.delta?.stop_reason ?? stopReason;
            // message_delta's usage is cumulative: the final output count, and the input counts when it repeats them.
            const u = usageOf(data.usage);
            for (const key of Object.keys(u) as (keyof Usage)[]) if (u[key]) usage[key] = u[key];
            break;
          }
          case 'error': {
            const t = data.error?.type ?? '';
            const kind: AiErrorKind = t === 'overloaded_error' ? 'overloaded' : t === 'rate_limit_error' ? 'rate_limit' : t === 'api_error' ? 'server' : 'bad_request';
            throw new AiError(kind, data.error?.message ?? 'The stream failed', { usage });
          }
        }
      }
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw (e as Error).name === 'AbortError' ? new AiError('timeout', `No answer within ${timeoutMs} ms`, { usage }) : new AiError('network', `The stream broke: ${(e as Error).message}`, { usage });
    } finally {
      done();
    }
    if (!stopReason) throw new AiError('network', 'The stream ended before the message did', { usage });
    yield { type: 'done', result: finish({ model, text, stopReason, usage }) };
  }

  return { create, stream };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The `data:` payloads of a Server-Sent Events body, one string per event. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const take = function* (final: boolean): Generator<string> {
    buffer = buffer.replace(/\r\n?/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0 || (final && buffer.trim())) {
      const chunk = end >= 0 ? buffer.slice(0, end) : buffer;
      buffer = end >= 0 ? buffer.slice(end + 2) : '';
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      yield* take(false);
    }
    yield* take(true);
  } finally {
    reader.releaseLock();
  }
}

/** Collects a stream into its result, passing each piece of text to `onText`. */
export async function collect(events: AsyncIterable<StreamEvent>, onText?: (text: string) => void): Promise<MessageResult> {
  for await (const e of events) {
    if (e.type === 'text') onText?.(e.text);
    else return e.result;
  }
  throw new AiError('network', 'The stream ended without a result');
}
