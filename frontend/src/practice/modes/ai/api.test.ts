import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSse, sendTurn, shownPhase, TurnError } from './api';

const MIN = 60_000;
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function streamOf(text: string, chunk = 5): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
}

describe('AI interview client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('splits Server-Sent Events and keeps the unfinished rest', () => {
    const { events, rest } = parseSse(`${sse('text', { text: 'Hi' })}event: hint\r\ndata: {"kind":"focus","text":"x"}\r\n\r\nevent: done\ndata: {"re`);
    expect(events).toEqual([
      { event: 'text', data: { text: 'Hi' } },
      { event: 'hint', data: { kind: 'focus', text: 'x' } },
    ]);
    expect(rest).toBe('event: done\ndata: {"re');
  });

  it('streams a turn into onText and returns done with the hint and grade', async () => {
    const body = sse('text', { text: 'Ab' }) + sse('text', { text: 'out' }) + sse('hint', { kind: 'improve', text: 'Say why.' }) + sse('grade', { passed: 2, total: 3, solved: false }) + sse('done', { reply: 'About', phase: 'clarify', elapsedMs: 1, turns: 1 });
    const fetch = vi.fn(async () => new Response(streamOf(body), { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const pieces: string[] = [];
    const done = await sendTurn('abc', { message: 'Hi' }, (t) => pieces.push(t));
    expect(pieces.join('')).toBe('About');
    expect(done).toMatchObject({ reply: 'About', turns: 1, hint: { kind: 'improve' }, grade: { passed: 2 } });
    expect(fetch).toHaveBeenCalledWith('/api/interviews/abc/turn', expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Hi' }) }));
  });

  it('turns an error event or a JSON refusal into a TurnError', async () => {
    vi.stubGlobal('fetch', async () => new Response(streamOf(sse('text', { text: 'x' }) + sse('error', { error: 'ai_failed', refunded: true }))));
    await expect(sendTurn('a', { message: 'Hi' }, () => {})).rejects.toMatchObject({ code: 'ai_failed', refunded: true });
    vi.stubGlobal('fetch', async () => Response.json({ error: 'time' }, { status: 409 }));
    const e = await sendTurn('a', { message: 'Hi' }, () => {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TurnError);
    expect(e).toMatchObject({ code: 'time', refunded: false, status: 409 });
    vi.stubGlobal('fetch', async () => new Response(streamOf(sse('text', { text: 'cut' }))));
    await expect(sendTurn('a', { message: 'Hi' }, () => {})).rejects.toMatchObject({ code: 'network' });
  });

  it('shows the clock’s phase, or a later one the session moved to', () => {
    const at = { minutes: 45 as const, startedAt: 0 };
    expect(shownPhase({ ...at, phase: 'clarify' }, 1 * MIN)).toBe('clarify');
    expect(shownPhase({ ...at, phase: 'clarify' }, 5 * MIN)).toBe('estimate');
    expect(shownPhase({ ...at, phase: 'design' }, 5 * MIN)).toBe('design');
    expect(shownPhase({ ...at, phase: 'design' }, 50 * MIN)).toBe('wrapup');
  });
});
