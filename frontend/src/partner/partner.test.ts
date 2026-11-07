import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateFor, formatCredits, formatRange, parseEstimates, parseSession, parseTurnAnswer } from './contract';
import { applyEdits, countLines, diffLines, editHunks } from './edits';
import { loadStored, saveStored } from './store';
import { createSession, decide, getSession, NoCreditsError, sendTurn, SignedOutError, TurnInProgressError } from './api';
import { readProgress, withAssisted, withRun, withSource } from '../practice/progress';
import type { Problem } from '../practice/types';

const METRICS = { tests: { passed: 3, total: 6 }, p99Ms: 180, availability: 0.995, costPerMonth: 420 };

describe('contract', () => {
  it('reads a session with questions and changes, dropping what it cannot read', () => {
    const session = parseSession({
      id: 's1',
      context: { kind: 'practice', problemId: 'url-shortener' },
      deep: true,
      turns: [
        { id: 't1', role: 'user', message: 'Review my design.', at: 1 },
        {
          id: 't2',
          role: 'partner',
          message: '**Two** things.',
          questions: [{ id: 'q1', text: 'How many reads?', options: ['10k rps', 42, ''] }, { id: 'q2' }],
          changes: [
            { id: 'c1', title: 'Add a cache', why: 'Reads', edits: [{ find: 'a', replace: 'b' }, { find: 1 }], result: { ok: true, source: 'b', summary: ['adds cache'], before: METRICS, after: { ...METRICS, p99Ms: null } } },
            { id: 'c2', title: 'Shard', why: '', edits: [], result: { ok: false, reason: 'does not parse' } },
            { title: 'no id' },
          ],
          assisted: true,
          at: 2,
        },
        { id: 't3', role: 'bot', message: 'x' },
      ],
    })!;
    expect(session.context).toEqual({ kind: 'practice', problemId: 'url-shortener' });
    expect(session.deep).toBe(true);
    expect(session.turns.map((t) => t.id)).toEqual(['t1', 't2']);
    const turn = session.turns[1];
    expect(turn.questions).toEqual([{ id: 'q1', text: 'How many reads?', options: ['10k rps'] }]);
    expect(turn.changes?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(turn.changes?.[0].edits).toEqual([{ find: 'a', replace: 'b' }]);
    expect(turn.changes?.[0].result).toMatchObject({ ok: true, after: { p99Ms: null, tests: { passed: 3, total: 6 } } });
    expect(turn.changes?.[1].result).toEqual({ ok: false, reason: 'does not parse' });
    expect(turn.assisted).toBe(true);
  });

  it('reads a turn answer and the estimates', () => {
    expect(parseTurnAnswer({ turn: { id: 't', role: 'partner', message: 'ok', at: 1 }, credits: { charged: 3.25, balance: 96.75 } })).toMatchObject({ credits: { charged: 3.25, balance: 96.75 } });
    expect(parseTurnAnswer({ credits: {} })).toBeUndefined();
    const e = parseEstimates({ mock_interview: { min: 20, max: 60 }, partner_review: { min: 5, max: 15 }, partner_build: { min: 10, max: 40 }, partner_turn: { min: 1, max: 4 }, deepMultiplier: 5 })!;
    expect(estimateFor(e, 'review', false)).toEqual({ min: 5, max: 15 });
    expect(estimateFor(e, 'chat', true)).toEqual({ min: 5, max: 20 });
    expect(estimateFor(e, 'build', false)).toEqual({ min: 10, max: 40 });
    expect(parseEstimates({ partner_review: { min: 1 } })).toBeUndefined();
  });

  it('formats credits for people', () => {
    expect(formatCredits(812.4)).toBe('812');
    expect(formatCredits(3.42)).toBe('3.4');
    expect(formatCredits(0.125)).toBe('0.13');
    expect(formatCredits(1200)).toBe('1,200');
    expect(formatRange({ min: 5, max: 15 })).toBe('about 5–15 credits');
    expect(formatRange({ min: 0.4, max: 2.2 })).toBe('about 0.4–3 credits');
    expect(formatRange({ min: 4, max: 4 })).toBe('about 4 credits');
  });
});

describe('edits', () => {
  const source = 'api -> db\ndb [Postgres]\n';

  it('apply in order, each to its first match, or not at all', () => {
    expect(applyEdits(source, [{ find: 'api -> db', replace: 'api -> cache\ncache -> db' }])).toBe('api -> cache\ncache -> db\ndb [Postgres]\n');
    expect(applyEdits(source, [{ find: 'db [Postgres]', replace: 'db [Postgres] x2' }, { find: 'x2', replace: 'x4' }])).toBe('api -> db\ndb [Postgres] x4\n');
    expect(applyEdits(source, [{ find: 'api -> db', replace: 'a' }, { find: 'missing', replace: 'b' }])).toBeNull();
    expect(applyEdits(source, [{ find: '', replace: 'b' }])).toBeNull();
  });

  it('diff by line, numbered where the edit applies', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: 'B' },
      { kind: 'remove', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    const hunks = editHunks(source, [{ find: 'db [Postgres]', replace: 'db [Postgres] x2' }]);
    expect(hunks[0].line).toBe(2);
    expect(countLines(hunks)).toEqual({ added: 1, removed: 1 });
    expect(editHunks(undefined, [{ find: 'x', replace: 'y' }])[0].line).toBeUndefined();
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe('store', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps one conversation per document or problem, with its decisions', () => {
    saveStored('editor:d1', { id: 's1', decisions: { c1: 'accepted' } });
    saveStored('practice:p1', { id: 's2' });
    expect(loadStored('editor:d1')).toEqual({ id: 's1', decisions: { c1: 'accepted' } });
    expect(loadStored('practice:p1')).toEqual({ id: 's2', decisions: {} });
    saveStored('editor:d1', undefined);
    expect(loadStored('editor:d1')).toBeUndefined();
    localStorage.setItem('proschi.partner', '{"x":{"id":3}}');
    expect(loadStored('x')).toBeUndefined();
  });
});

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown) => vi.fn(async () => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));

  it('follows the contract’s paths and bodies', async () => {
    const created = answer(200, { id: 's1' });
    vi.stubGlobal('fetch', created);
    await expect(createSession({ kind: 'practice', problemId: 'p' }, true)).resolves.toBe('s1');
    expect(created).toHaveBeenCalledWith('/api/partner/sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ context: { kind: 'practice', problemId: 'p' }, deep: true }) }));

    const turn = answer(200, { turn: { id: 't', role: 'partner', message: 'hi', at: 1 }, credits: { charged: 1, balance: 9 } });
    vi.stubGlobal('fetch', turn);
    await sendTurn('s1', { intent: 'improve', message: 'cheaper', source: 'a', changeId: 'c1' });
    expect(turn).toHaveBeenCalledWith('/api/partner/sessions/s1/turns', expect.objectContaining({ body: JSON.stringify({ intent: 'improve', message: 'cheaper', source: 'a', changeId: 'c1' }) }));

    const decided = answer(204, null);
    vi.stubGlobal('fetch', decided);
    await decide('s1', 'c1', 'accepted');
    expect(decided).toHaveBeenCalledWith('/api/partner/sessions/s1/changes/c1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'accepted' }) }));
  });

  it('reads 402, 409, 401 and a gone session', async () => {
    vi.stubGlobal('fetch', answer(402, { error: 'no_credits', needed: 6, balance: 2.5 }));
    const e = await sendTurn('s', { intent: 'chat', message: 'x', source: '' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NoCreditsError);
    expect(e).toMatchObject({ needed: 6, balance: 2.5 });
    vi.stubGlobal('fetch', answer(409, { error: 'turn_in_progress' }));
    await expect(sendTurn('s', { intent: 'chat', message: 'x', source: '' })).rejects.toBeInstanceOf(TurnInProgressError);
    vi.stubGlobal('fetch', answer(401, { error: 'signed_out' }));
    await expect(sendTurn('s', { intent: 'chat', message: 'x', source: '' })).rejects.toBeInstanceOf(SignedOutError);
    vi.stubGlobal('fetch', answer(404, { error: 'not_found' }));
    await expect(getSession('s')).resolves.toBeUndefined();
  });
});

describe('assisted progress', () => {
  const problem = { id: 'p', starter: 'start' } as Problem;

  it('marks a problem assisted and keeps the mark through edits, runs and storage', () => {
    let p = withAssisted({}, 'p');
    expect(p.p).toEqual({ status: 'attempted', assisted: true });
    p = withSource(p, problem, 'changed');
    p = withRun(p, problem, true);
    expect(p.p).toEqual({ status: 'solved', source: 'changed', assisted: true });
    expect(readProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readProgress({ q: { status: 'solved', assisted: 'yes' } })).toEqual({ q: { status: 'solved' } });
    expect(withAssisted(p, 'p')).toBe(p);
  });
});
