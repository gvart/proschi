import type { Page } from '@playwright/test';

/**
 * Design partner's API (docs/impl/design-partner.md, "Design partner") kept
 * in memory for the build with accounts: sessions, turns and decisions, with
 * the answers a test queues or a default per intent. Changes are built from
 * the source the page sends, as the server builds them, so their edits apply.
 */

export const ESTIMATES = {
  mock_interview: { min: 20, max: 60 },
  partner_review: { min: 5, max: 15 },
  partner_build: { min: 10, max: 40 },
  partner_turn: { min: 1, max: 4 },
  deepMultiplier: 2,
};

export interface TurnBody {
  intent: 'review' | 'build' | 'chat' | 'improve' | 'solve';
  message: string;
  source: string;
  files?: { name: string; source: string }[];
  changeId?: string;
}

type Turn = Record<string, unknown> & { id: string; role: 'user' | 'partner' };
type Answer = { status: number; json: unknown } | Turn;
type Reply = (body: TurnBody, partner: PartnerMock) => Answer | Promise<Answer>;

const METRICS_BEFORE = { tests: { passed: 4, total: 7 }, p99Ms: 212, availability: 0.995, costPerMonth: 380 };
const METRICS_AFTER = { tests: { passed: 7, total: 7 }, p99Ms: 38, availability: 0.9995, costPerMonth: 455 };

/** The first line of `source` with an arrow: the text a change's edit finds. */
export function arrowLine(source: string): string {
  return source.split('\n').find((l) => l.includes('->')) ?? source.split('\n')[0];
}

export class PartnerMock {
  sessions = new Map<string, { context: unknown; deep: boolean; turns: Turn[] }>();
  created: { context: unknown; deep?: boolean }[] = [];
  bodies: TurnBody[] = [];
  decisions: { changeId: string; decision: string }[] = [];
  queue: Reply[] = [];
  private n = 0;
  private changes = 0;

  /** A change adding a cache line after the first arrow, checked: before and after numbers. */
  change(source: string, title = 'Put a cache in front of the database'): Record<string, unknown> {
    const find = arrowLine(source);
    const replace = `${find}\n  # cached: redis in front of the reads`;
    return {
      id: `c${++this.changes}`,
      title,
      why: 'Most requests are reads of the same links, so a cache answers them without touching the database, and the p99 falls well under the limit.',
      edits: [{ find, replace }],
      result: { ok: true, source: source.replace(find, replace), summary: ['adds cache', 'api: 2 replicas → 4'], before: METRICS_BEFORE, after: METRICS_AFTER },
    };
  }

  private async reply(body: TurnBody): Promise<Answer> {
    const queued = this.queue.shift();
    if (queued) return queued(body, this);
    const id = `t${++this.n}`;
    const at = Date.now();
    return this.answer(body, id, at);
  }

  /** The default answer of an intent. */
  answer(body: TurnBody, id = `t${++this.n}`, at = Date.now()): Turn {
    switch (body.intent) {
      case 'review':
        return {
          id,
          role: 'partner',
          at,
          message:
            '## What holds up\n\nThe API scales out behind the load balancer, and every write is **durable**.\n\n## What to look at\n\n- One database takes every read: at peak it runs at 86%.\n- `redirect` misses its p99 of 50 ms.',
          questions: [{ id: 'q1', text: 'How many redirects a second at peak?', options: ['About 1k', 'About 10k', 'More than 100k'] }],
        };
      case 'build':
      case 'improve':
      case 'chat':
        return { id, role: 'partner', at, message: 'Here is a change that takes the reads off the database.', changes: [this.change(body.source)] };
      case 'solve':
        return { id, role: 'partner', at, message: 'These changes pass every test.', changes: [this.change(body.source, 'Add a cache and a second replica')], assisted: true };
    }
  }

  async mock(page: Page): Promise<void> {
    await page.route('**/api/credits/estimates', (route) => route.fulfill({ json: ESTIMATES }));
    await page.route(
      (url) => url.pathname.startsWith('/api/partner/'),
      async (route) => {
        const request = route.request();
        const parts = new URL(request.url()).pathname.split('/').slice(3).map(decodeURIComponent);
        // sessions | sessions/:id | sessions/:id/turns | sessions/:id/changes/:changeId
        if (request.method() === 'POST' && parts.length === 1) {
          const body = request.postDataJSON() as { context: unknown; deep?: boolean };
          this.created.push(body);
          const id = `s${this.sessions.size + 1}`;
          this.sessions.set(id, { context: body.context, deep: !!body.deep, turns: [] });
          return route.fulfill({ json: { id } });
        }
        const session = this.sessions.get(parts[1]);
        if (!session) return route.fulfill({ status: 404, json: { error: 'not_found' } });
        if (request.method() === 'GET' && parts.length === 2) return route.fulfill({ json: { id: parts[1], ...session } });
        if (parts[2] === 'turns') {
          const body = request.postDataJSON() as TurnBody;
          this.bodies.push(body);
          const answer = await this.reply(body);
          if ('status' in answer && typeof answer.status === 'number') return route.fulfill(answer as { status: number; json: unknown });
          const turn = answer as Turn;
          session.turns.push({ id: `u${this.n}`, role: 'user', message: body.message, at: Date.now() }, turn);
          return route.fulfill({ json: { turn, credits: { charged: 3.42, balance: 812.4 } } });
        }
        if (parts[2] === 'changes') {
          this.decisions.push({ changeId: parts[3], decision: (request.postDataJSON() as { decision: string }).decision });
          return route.fulfill({ status: 204 });
        }
        return route.fulfill({ status: 404, json: { error: 'not mocked' } });
      },
    );
  }
}

/** The browser logs the 4xx answers a test asks for as console errors; only those are dropped. */
export function allowStatus(errors: string[], status: number): void {
  const re = new RegExp(`Failed to load resource: the server responded with a status of ${status}`);
  for (let i = errors.length - 1; i >= 0; i--) if (re.test(errors[i])) errors.splice(i, 1);
}
