import type { Page } from '@playwright/test';
import { planAnswer } from './accounts';

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

/** The test results in the mock's report: the server's run of the last design sent. */
const REPORT_TESTS = [
  { id: 't1', name: 'Redirects stay fast', category: 'latency', passed: true, message: 'p99 of Redirect is 38 ms (limit 50 ms)' },
  { id: 't2', name: 'Survives a lost node', category: 'availability', passed: true, message: 'Availability is 99.95% (target 99.9%)' },
  { id: 't3', name: 'Fits the budget', category: 'cost', passed: false, message: 'Costs $2,140 a month (budget $1,500)' },
];

export interface InterviewMock {
  turns: { message: string; design?: string; advance?: boolean }[];
  starts: { replace: boolean; deep: boolean }[];
}

/**
 * `open`: a session already in progress on the server (started in another tab or browser), with its first message.
 * `credits`: the balance (100 by default, the sign-up credits); a start needs 30 and each turn costs 4.
 * `runsOutAfter`: the balance drops to 0 after that many turns, and the interview moves to the wrap-up (P28).
 * `plan`: the account's (free by default); on Max a start may ask for a Deep verdict, and the finished session's report answers.
 */
export async function mockInterviews(
  page: Page,
  opts: { replies: MockReply[]; verdict?: typeof PASS_VERDICT; credits?: number; startedAt?: number; open?: string; runsOutAfter?: number; needed?: number; plan?: 'free' | 'pro' | 'max' },
): Promise<InterviewMock> {
  const mock: InterviewMock = { turns: [], starts: [] };
  let left = opts.credits ?? 100;
  const plan = opts.plan ?? 'free';
  await page.route(/\/api\/me\/plan$/, (route) => route.fulfill({ json: planAnswer(plan, { balance: left, monthly: null, signup: left, topup: 0 }) }));
  let design: string | undefined;
  let session: Record<string, unknown> | undefined = opts.open
    ? { id: 'iv-0', problem: 'url-shortener', minutes: 45, status: 'active', startedAt: Date.now() - 5 * 60_000, deadline: Date.now() + 55 * 60_000 }
    : undefined;
  const messages: Record<string, unknown>[] = opts.open ? [{ role: 'interviewer', text: opts.open, at: Date.now() - 5 * 60_000 }] : [];
  let phase = 'clarify';
  await page.route(
    (url) => url.pathname.startsWith('/api/interviews'),
    async (route) => {
      const req = route.request();
      const parts = new URL(req.url()).pathname.split('/').filter(Boolean);
      if (req.method() === 'GET' && parts.length === 2) return route.fulfill({ json: { interviews: session ? [session] : [] } });
      if (req.method() === 'POST' && parts.length === 2) {
        const body = req.postDataJSON() as { replace?: boolean; deep?: boolean };
        const replace = body.replace === true;
        const deep = body.deep === true;
        mock.starts.push({ replace, deep });
        if (deep && plan !== 'max') return route.fulfill({ status: 402, json: { error: 'plan_required', feature: 'deep_mode' } });
        if (session?.status === 'active' && !replace) return route.fulfill({ status: 409, json: { error: 'active_session', id: session.id, problem: session.problem } });
        if (left < (opts.needed ?? 30)) return route.fulfill({ status: 402, json: { error: 'no_credits', needed: opts.needed ?? 30, balance: left } });
        const startedAt = opts.startedAt ?? Date.now();
        messages.length = 0;
        messages.push({
          role: 'interviewer',
          text: "Hi, I'll be your interviewer. Today we'll design URL Shortener. We have 45 minutes. Start by asking me what you need to know.",
          at: startedAt,
        });
        session = { id: 'iv-1', problem: 'url-shortener', minutes: 45, status: 'active', startedAt, deadline: startedAt + 60 * 60_000, deep };
        return route.fulfill({ status: 201, json: { interview: { ...session, phase, turns: 0, messages } } });
      }
      if (!session) return route.fulfill({ status: 404, json: { error: 'Not found' } });
      if (req.method() === 'GET' && parts[3] === 'report') {
        if (plan !== 'max') return route.fulfill({ status: 402, json: { error: 'plan_required', feature: 'interview_report' } });
        const grade = { passed: 2, total: 3, solved: false, errors: [], results: REPORT_TESTS };
        return route.fulfill({ json: { report: { ...session, ...(design !== undefined ? { design: { source: design, grade } } : {}) } } });
      }
      if (req.method() === 'GET') return route.fulfill({ json: { interview: { ...session, phase, turns: mock.turns.length, messages } } });
      if (parts[3] === 'turn') {
        const body = req.postDataJSON() as InterviewMock['turns'][number];
        mock.turns.push(body);
        if (body.design !== undefined) design = body.design;
        const reply = opts.replies[mock.turns.length - 1] ?? { text: 'Go on.' };
        if (reply.phase) phase = reply.phase;
        left = Math.max(0, left - 4);
        if (opts.runsOutAfter !== undefined && mock.turns.length >= opts.runsOutAfter) {
          left = 0;
          phase = 'wrapup';
        }
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
