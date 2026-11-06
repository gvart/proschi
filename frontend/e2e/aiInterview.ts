import type { Page } from '@playwright/test';

/**
 * A stateful mock of the AI interviewer's API (backend/src/interviews.ts)
 * for the build with accounts: one session, turns answered over SSE from
 * `replies` in order, and the verdict on finish. Register it after
 * mockSignedIn: the later route wins.
 */

export interface MockReply {
  text: string;
  hint?: { kind: 'focus' | 'improve' | 'wrapup'; text: string };
  phase?: 'clarify' | 'estimate' | 'design' | 'wrapup';
}

export const PASS_VERDICT = {
  passed: true,
  scores: { requirements: 4, estimation: 3, design: 4, tradeoffs: 3, communication: 5 },
  wentWell: [
    { skill: 'requirements', text: 'You asked for the read to write ratio and the redirect latency before designing.' },
    { skill: 'design', text: 'The cache in front of the key-value store passed every redirect test.' },
  ],
  wentWrong: [{ skill: 'estimation', text: 'The storage estimate skipped the 5-year retention, so it came out 5x too low.' }],
  nextSteps: ['Practise storage estimates with retention', 'Explain one rejected alternative out loud', 'Try the Pastebin problem next'],
};

export const FAIL_VERDICT = {
  passed: false,
  scores: { requirements: 2, estimation: 1, design: 3, tradeoffs: 2, communication: 3 },
  wentWell: [{ skill: 'communication', text: 'You explained the read path clearly.' }],
  wentWrong: [
    { skill: 'requirements', text: 'You started designing before asking about scale.' },
    { skill: 'estimation', text: 'No estimate of the request rate or storage.' },
  ],
  nextSteps: ['Ask about scale and latency first', 'Do the estimate cards for this week'],
};

export interface InterviewMock {
  turns: { message: string; design?: string; advance?: boolean }[];
}

export async function mockInterviews(page: Page, opts: { replies: MockReply[]; verdict?: typeof PASS_VERDICT; credits?: number; startedAt?: number }): Promise<InterviewMock> {
  const mock: InterviewMock = { turns: [] };
  const credits = (total: number) => ({ total, monthly: 0, trial: total, pack: 0, period: '2026-11' });
  let left = opts.credits ?? 1;
  let session: Record<string, unknown> | undefined;
  const messages: Record<string, unknown>[] = [];
  let phase = 'clarify';
  await page.route(
    (url) => url.pathname.startsWith('/api/interviews'),
    async (route) => {
      const req = route.request();
      const parts = new URL(req.url()).pathname.split('/').filter(Boolean);
      if (req.method() === 'GET' && parts.length === 2) return route.fulfill({ json: { interviews: session ? [session] : [], credits: credits(left) } });
      if (req.method() === 'POST' && parts.length === 2) {
        if (left <= 0) return route.fulfill({ status: 402, json: { error: 'no_credits', credits: credits(0) } });
        left--;
        const startedAt = opts.startedAt ?? Date.now();
        messages.push({
          role: 'interviewer',
          text: "Hi, I'll be your interviewer. Today we'll design URL Shortener. We have 45 minutes. Start by asking me what you need to know.",
          at: startedAt,
        });
        session = { id: 'iv-1', problem: 'url-shortener', minutes: 45, status: 'active', startedAt, deadline: startedAt + 60 * 60_000 };
        return route.fulfill({ status: 201, json: { interview: { ...session, phase, turns: 0, messages }, credits: credits(left) } });
      }
      if (!session) return route.fulfill({ status: 404, json: { error: 'Not found' } });
      if (req.method() === 'GET') return route.fulfill({ json: { interview: { ...session, phase, turns: mock.turns.length, messages } } });
      if (parts[3] === 'turn') {
        const body = req.postDataJSON() as InterviewMock['turns'][number];
        mock.turns.push(body);
        const reply = opts.replies[mock.turns.length - 1] ?? { text: 'Go on.' };
        if (reply.phase) phase = reply.phase;
        messages.push({ role: 'candidate', text: body.message, at: Date.now(), ...(body.design !== undefined ? { design: true } : {}) });
        messages.push({ role: 'interviewer', text: reply.text, at: Date.now(), ...(reply.hint ? { hint: reply.hint } : {}) });
        const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const pieces = reply.text.match(/.{1,12}/gs) ?? [];
        const text =
          pieces.map((t) => sse('text', { text: t })).join('') +
          (reply.hint ? sse('hint', reply.hint) : '') +
          (body.design !== undefined ? sse('grade', { passed: 7, total: 10, solved: false, results: [], errors: [] }) : '') +
          sse('done', { reply: reply.text, phase, elapsedMs: 1000, turns: mock.turns.length });
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: text });
      }
      if (parts[3] === 'finish') {
        session = { ...session, status: 'finished', endedAt: Date.now(), verdict: opts.verdict ?? PASS_VERDICT };
        return route.fulfill({ json: { interview: session } });
      }
      return route.fulfill({ status: 404, json: { error: 'Not found' } });
    },
  );
  return mock;
}
