import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocSync, PUSH_DELAY_MS, SyncError, type Transport } from './cloudSync';
import { createDocStore, type DocStore } from './docStore';
import { addDoc, removeDoc, updateCurrent, type DocumentState } from './documents';
import type { RemoteDoc, StoredSync } from './sync';

/** The account's documents in memory, with the server's rules (backend/src/documents.ts). */
class FakeServer implements Transport {
  docs = new Map<string, RemoteDoc>();
  online = true;
  calls: string[] = [];
  private clock = 1_000;

  private check(what: string) {
    this.calls.push(what);
    if (!this.online) throw new SyncError(0, 'Failed to fetch');
  }

  async list(since: number | null) {
    this.check(`list ${since}`);
    return { documents: [...this.docs.values()].filter((d) => since === null || d.updatedAt >= since).map((d) => ({ ...d })), cursor: this.clock };
  }

  async put(id: string, body: { name: string; source: string; imports: Record<string, string> | null; baseVersion: number }) {
    this.check(`put ${id}@${body.baseVersion}`);
    const existing = this.docs.get(id);
    if (existing && existing.version !== body.baseVersion) throw new SyncError(409, 'changed', undefined, { ...existing });
    if (body.source.length > 100) throw new SyncError(413, 'too large');
    return this.write({ id, name: body.name, source: body.source, imports: body.imports, version: (existing?.version ?? 0) + 1, updatedAt: 0, deletedAt: null });
  }

  async remove(id: string, baseVersion: number) {
    this.check(`delete ${id}@${baseVersion}`);
    const existing = this.docs.get(id);
    if (!existing) return null;
    if (existing.version !== baseVersion) throw new SyncError(409, 'changed', undefined, { ...existing });
    return this.write({ ...existing, name: '', source: '', imports: null, version: existing.version + 1, deletedAt: this.clock });
  }

  async removeAll() {
    this.check('remove all');
    this.docs.clear();
  }

  /** A change made by another device. */
  write(doc: RemoteDoc): RemoteDoc {
    const saved = { ...doc, updatedAt: ++this.clock };
    this.docs.set(doc.id, saved);
    return { ...saved };
  }
}

const initial = (): DocumentState => ({ docs: [{ id: 'a', source: 'title "A"\n', fileName: 'a.proschi', updatedAt: '2026-10-01T00:00:00.000Z' }], currentId: 'a' });

let server: FakeServer;
let store: DocStore;
let saved: StoredSync | null;
let conflicts: string[][];
let signedOut: number;
let sync: DocSync;

function makeSync(userId = 'u1') {
  sync = new DocSync({
    store,
    transport: server,
    userId,
    storage: { load: () => saved, save: (v) => (saved = JSON.parse(JSON.stringify(v)) as StoredSync) },
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    onConflict: (titles) => conflicts.push(titles),
    onSignedOut: () => signedOut++,
  });
  return sync;
}

/** Lets pending promises and timers up to `ms` run. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

const type = (source: string) => store.set((s) => updateCurrent(s, source));

describe('DocSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeServer();
    store = createDocStore(initial());
    saved = null;
    conflicts = [];
    signedOut = 0;
  });
  afterEach(() => {
    sync?.stop();
    vi.useRealTimers();
  });

  it('first sign-in uploads the diagrams in this browser and pulls the account', async () => {
    server.write({ id: 'b', name: 'b.proschi', source: 'title "B"\n', imports: null, version: 1, updatedAt: 0, deletedAt: null });
    makeSync().start();
    await settle();
    expect(server.calls).toEqual(['list null', 'put a@0']);
    expect(store.get().docs.map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(server.docs.get('a')?.source).toBe('title "A"\n');
    expect(sync.getStatus()).toEqual({ kind: 'saved' });
    expect(saved?.meta?.docs.a.version).toBe(1);
  });

  it('pushes edits about 2 s after the last change, not on every keystroke', async () => {
    makeSync().start();
    await settle();
    server.calls = [];
    type('title "A1"\n');
    expect(sync.getStatus()).toEqual({ kind: 'saving' });
    await settle(PUSH_DELAY_MS - 500);
    type('title "A2"\n');
    await settle(PUSH_DELAY_MS - 500);
    expect(server.calls).toEqual([]);
    await settle(500);
    expect(server.calls).toEqual(['put a@1']);
    expect(server.docs.get('a')).toMatchObject({ source: 'title "A2"\n', version: 2 });
    expect(sync.getStatus()).toEqual({ kind: 'saved' });
  });

  it('flush sends what is pending at once, e.g. as the page is hidden', async () => {
    makeSync().start();
    await settle();
    type('title "Bye"\n');
    await sync.flush(true);
    expect(server.docs.get('a')?.source).toBe('title "Bye"\n');
  });

  it('deletes with the base version, and learns deletions made elsewhere', async () => {
    makeSync().start();
    await settle();
    store.set((s) => addDoc(s, 'title "B"\n', () => '2026-10-02T00:00:00.000Z', () => 'b'));
    await settle(PUSH_DELAY_MS);
    store.set((s) => removeDoc(s, 'a'));
    await settle(PUSH_DELAY_MS);
    expect(server.docs.get('a')).toMatchObject({ deletedAt: expect.any(Number), version: 2 });
    // Another device deletes b.
    const b = server.docs.get('b')!;
    server.write({ ...b, source: '', name: '', version: b.version + 1, deletedAt: 5 });
    await sync.sync();
    expect(store.get().docs.map((d) => d.id)).not.toContain('b');
    expect(store.get().docs).toHaveLength(1);
  });

  it('on a 409 keeps both: the server copy, and this browser\'s renamed', async () => {
    makeSync().start();
    await settle();
    // Another device saves version 2 meanwhile.
    server.write({ ...server.docs.get('a')!, source: 'title "A"\nservice theirs\n', version: 2 });
    type('title "A"\nservice mine\n');
    await settle(PUSH_DELAY_MS);
    const docs = store.get().docs;
    expect(docs.find((d) => d.id === 'a')?.source).toBe('title "A"\nservice theirs\n');
    const copy = docs.find((d) => d.id !== 'a')!;
    expect(copy.source).toMatch(/^title "A \(conflict .+\)"\nservice mine\n$/);
    expect(store.get().currentId).toBe(copy.id);
    expect(conflicts).toEqual([[expect.stringMatching(/^A \(conflict /)]]);
    // Both are in the account now.
    expect(server.docs.get(copy.id)?.source).toBe(copy.source);
    expect(server.docs.get('a')?.source).toBe('title "A"\nservice theirs\n');
    expect(sync.getStatus()).toEqual({ kind: 'saved' });
  });

  it('offline: keeps editing, says so, queues and retries with backoff', async () => {
    makeSync().start();
    await settle();
    server.online = false;
    type('title "Offline 1"\n');
    await settle(PUSH_DELAY_MS);
    expect(sync.getStatus()).toEqual({ kind: 'offline' });
    type('title "Offline 2"\n');
    expect(store.get().docs[0].source).toBe('title "Offline 2"\n');
    await settle(2000);
    expect(sync.getStatus()).toEqual({ kind: 'offline' });
    server.online = true;
    // The second retry waits twice as long.
    await settle(4000);
    expect(server.docs.get('a')).toMatchObject({ source: 'title "Offline 2"\n', version: 2 });
    expect(sync.getStatus()).toEqual({ kind: 'saved' });
  });

  it('remembers what is pending across reloads', async () => {
    makeSync().start();
    await settle();
    server.online = false;
    type('title "Unsent"\n');
    await settle(PUSH_DELAY_MS);
    sync.stop();
    server.online = true;
    server.calls = [];
    makeSync().start();
    await settle();
    expect(server.calls).toEqual(['list 0', 'put a@1']);
    expect(server.docs.get('a')?.source).toBe('title "Unsent"\n');
  });

  it('does not resend a diagram the server refused until it changes', async () => {
    makeSync().start();
    await settle();
    type('x'.repeat(101));
    await settle(PUSH_DELAY_MS);
    expect(sync.getStatus()).toEqual({ kind: 'saved', note: 'too large' });
    server.calls = [];
    await sync.sync();
    expect(server.calls).toEqual(['list 0']);
    type('small');
    await settle(PUSH_DELAY_MS);
    expect(server.docs.get('a')?.source).toBe('small');
    expect(sync.getStatus()).toEqual({ kind: 'saved' });
  });

  it('turned off: sends nothing; deleting the cloud copies keeps the local ones', async () => {
    makeSync().start();
    await settle();
    sync.setEnabled(false);
    expect(saved?.off).toBe(true);
    server.calls = [];
    type('title "Local only"\n');
    await settle(PUSH_DELAY_MS * 2);
    expect(server.calls).toEqual([]);
    expect(sync.getStatus()).toEqual({ kind: 'off' });
    await sync.deleteCloudCopies();
    expect(server.docs.size).toBe(0);
    expect(store.get().docs[0].source).toBe('title "Local only"\n');
    // Still off after a reload.
    sync.stop();
    makeSync().start();
    await settle();
    expect(sync.getStatus()).toEqual({ kind: 'off' });
    expect(server.calls).toEqual(['remove all']);
    // Turned on again: uploaded as new.
    sync.setEnabled(true);
    await settle();
    expect(server.docs.get('a')).toMatchObject({ source: 'title "Local only"\n', version: 1 });
  });

  it('a 401 stops syncing and reports the sign-out', async () => {
    server.list = async () => {
      throw new SyncError(401, 'Sign in first');
    };
    makeSync().start();
    await settle();
    expect(signedOut).toBe(1);
    expect(sync.getStatus()).toEqual({ kind: 'signed-out' });
  });

  it('another account starts over, like a first sign-in', async () => {
    makeSync('u1').start();
    await settle();
    sync.stop();
    server = new FakeServer();
    makeSync('u2').start();
    await settle();
    expect(server.calls).toEqual(['list null', 'put a@0']);
  });
});
