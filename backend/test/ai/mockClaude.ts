import type { MessageRequest, Usage } from '../../src/ai/client';

/** A fake Claude Messages API for the AI tests: records each request and answers from a queue or a handler. */

export interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: MessageRequest & { stream?: boolean; fallbacks?: unknown };
}

export const usage = (u: Partial<Usage> = {}): Usage => ({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...u });

export function messageResponse(text: string, opts: { stop?: string; usage?: Partial<Usage>; model?: string } = {}): Response {
  return Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
    stop_reason: opts.stop ?? 'end_turn',
    usage: usage(opts.usage),
  });
}

/** An SSE body, cut into chunks of `chunk` characters so events straddle reads. */
export function sseResponse(events: unknown[], chunk = 7): Response {
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

export function streamEvents(text: string, opts: { stop?: string; usage?: Partial<Usage> } = {}): unknown[] {
  const u = usage(opts.usage);
  const pieces = text.match(/.{1,5}/gs) ?? [];
  return [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-5-5', usage: { ...u, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...pieces.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: opts.stop ?? 'end_turn' }, usage: { output_tokens: u.output_tokens } },
    { type: 'message_stop' },
  ];
}

export type Handler = (req: Recorded, n: number) => Response | Promise<Response>;

export function mockFetch(handler: Handler): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rec: Recorded = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) };
    calls.push(rec);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return handler(rec, calls.length - 1);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
