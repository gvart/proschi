import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMistakes, MAX_MISTAKES, mergeMistakes, onMistakesChange, readMistakes, recordMistake, syncMistakes } from './recentMistakes';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  return store;
}

describe('recent mistakes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the latest per problem, newest first, at most MAX_MISTAKES', () => {
    stubStorage();
    recordMistake('chat', 'A', undefined, 1);
    recordMistake('kv', 'B', 'b-design', 2);
    recordMistake('chat', 'C', undefined, 3);
    expect(loadMistakes()).toEqual([
      { problem: 'chat', title: 'C', at: 3 },
      { problem: 'kv', title: 'B', at: 2, id: 'b-design' },
    ]);
    for (let i = 0; i < MAX_MISTAKES + 5; i++) recordMistake(`p${i}`, 'X', undefined, 10 + i);
    expect(loadMistakes()).toHaveLength(MAX_MISTAKES);
    expect(loadMistakes()[0].problem).toBe(`p${MAX_MISTAKES + 4}`);
  });

  it('drops anything malformed', () => {
    expect(readMistakes({})).toEqual([]);
    expect(
      readMistakes([null, { problem: '__proto__', title: 'A', at: 1 }, { problem: 'a', title: 2, at: 1 }, { problem: 'a', title: 'A', at: 1.5 }, { problem: 'c', title: 'C', at: 1, id: 3 }, { problem: 'b', title: 'B', at: 4 }]),
    ).toEqual([{ problem: 'b', title: 'B', at: 4 }]);
  });

  it('merges this browser’s with the account’s: the newest per problem, and sends what the account lacks', () => {
    const local = [
      { problem: 'chat', title: 'Local chat', at: 30, id: 'c1' },
      { problem: 'kv', title: 'Old kv', at: 5, id: 'k1' },
      { problem: 'pastebin', title: 'No id', at: 4 },
      { problem: 'feed', title: 'Same', at: 3, id: 'f1' },
    ];
    const remote = [
      { problem: 'kv', title: 'New kv', at: 20, id: 'k2' },
      { problem: 'chat', title: 'Old chat', at: 10, id: 'c0' },
      { problem: 'url', title: 'From another device', at: 15, id: 'u1' },
      { problem: 'feed', title: 'Same', at: 3, id: 'f1' },
    ];
    const { merged, toSend } = mergeMistakes(local, remote);
    expect(merged.map((m) => `${m.problem}:${m.title}`)).toEqual(['chat:Local chat', 'kv:New kv', 'url:From another device', 'pastebin:No id', 'feed:Same']);
    // Those with an id the account lacks or has older; one without an id stays here.
    expect(toSend.map((m) => m.id)).toEqual(['c1', 'k1']);
    expect(mergeMistakes([], Array.from({ length: MAX_MISTAKES + 3 }, (_, i) => ({ problem: `p${i}`, title: 'X', at: i, id: 'x' }))).merged).toHaveLength(MAX_MISTAKES);
  });

  it('syncs with the account on sign-in, and changes nothing offline', async () => {
    stubStorage();
    recordMistake('chat', 'Local', 'c1', 30);
    const heard: string[] = [];
    const off = onMistakesChange((added, source) => heard.push(`${source}:${added.length}`));
    const calls: { method: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init: RequestInit) => {
        calls.push({ method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify(init.method === 'POST' ? { stored: 1 } : { mistakes: [{ problem: 'url', id: 'u1', title: 'Remote', at: 40 }] }), { status: 200 });
      }),
    );
    await syncMistakes();
    expect(loadMistakes().map((m) => m.problem)).toEqual(['url', 'chat']);
    expect(calls).toEqual([{ method: 'GET', body: undefined }, { method: 'POST', body: { mistakes: [{ problem: 'chat', id: 'c1', title: 'Local', at: 30 }] } }]);
    expect(heard).toEqual(['account:2']);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await syncMistakes();
    expect(loadMistakes().map((m) => m.problem)).toEqual(['url', 'chat']);
    off();
  });
});
