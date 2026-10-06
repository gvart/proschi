import { describe, expect, it } from 'vitest';
import type { DocumentState, SavedDiagram } from './documents';
import { afterDelete, afterPut, applyRemote, conflictCopy, emptyMeta, fingerprint, pendingOps, readStoredSync, remoteFingerprint, retitle, type RemoteDoc, type SyncMeta } from './sync';

const NOW = '2026-10-06T14:05:00.000Z';
const clock = () => NOW;
let n = 0;
const ids = () => `new-${++n}`;

const local = (id: string, source: string, fileName = `${id}.proschi`): SavedDiagram => ({ id, source, fileName, updatedAt: '2026-10-01T00:00:00.000Z' });
const remote = (id: string, source: string, version: number, name = `${id}.proschi`): RemoteDoc => ({ id, name, source, imports: null, version, updatedAt: 1_000, deletedAt: null });
const tombstone = (id: string, version: number): RemoteDoc => ({ id, name: '', source: '', imports: null, version, updatedAt: 2_000, deletedAt: 2_000 });
const state = (...docs: SavedDiagram[]): DocumentState => ({ docs, currentId: docs[0].id });

/** Meta that says `docs` were synced at `version` with their current content. */
function synced(docs: SavedDiagram[], version = 1, cursor: number | null = 500): SyncMeta {
  return { ...emptyMeta('u1'), cursor, docs: Object.fromEntries(docs.map((d) => [d.id, { version, fp: fingerprint(d) }])) };
}

describe('cloud sync merge', () => {
  it('adds diagrams from the account and takes newer copies of unchanged ones', () => {
    const a = local('a', 'title "A"\n');
    const meta = synced([a]);
    const result = applyRemote(state(a), meta, [remote('a', 'title "A2"\n', 2), remote('b', 'title "B"\n', 1)], clock, ids);
    expect(result.state.docs.map((d) => [d.id, d.source])).toEqual([
      ['a', 'title "A2"\n'],
      ['b', 'title "B"\n'],
    ]);
    expect(result.meta.docs.a.version).toBe(2);
    expect(result.conflicts).toEqual([]);
    expect(pendingOps(result.state, result.meta)).toEqual([]);
  });

  it('ignores versions it already has', () => {
    const a = local('a', 'mine');
    const before = state(a);
    const result = applyRemote(before, synced([a], 3), [remote('a', 'old', 3), remote('a', 'older', 2)], clock, ids);
    expect(result.state).toBe(before);
  });

  it('keeps both when a diagram changed here and there: the local one is renamed', () => {
    const a = local('a', 'title "Shop"\nservice api\n', 'shop.proschi');
    const meta = synced([a]);
    const edited = { ...a, source: 'title "Shop"\nservice web\n' };
    const result = applyRemote(state(edited), meta, [remote('a', 'title "Shop"\nservice db\n', 2, 'shop.proschi')], clock, ids);
    const [server, copy] = result.state.docs;
    expect(server).toMatchObject({ id: 'a', source: 'title "Shop"\nservice db\n' });
    expect(copy.id).not.toBe('a');
    expect(copy.source).toMatch(/^title "Shop \(conflict \d{4}-\d\d-\d\d \d\d:\d\d\)"\nservice web\n$/);
    expect(copy.fileName).toMatch(/^shop \(conflict .+\)\.proschi$/);
    // The open diagram stays the one being edited.
    expect(result.state.currentId).toBe(copy.id);
    expect(result.conflicts).toEqual([expect.stringMatching(/^Shop \(conflict /)]);
    // The copy is new: it is uploaded; the server's copy is in sync.
    expect(pendingOps(result.state, result.meta)).toEqual([expect.objectContaining({ kind: 'put', id: copy.id, baseVersion: 0 })]);
  });

  it('a change to the same content is no conflict', () => {
    const a = local('a', 'one');
    const same = { ...a, source: 'two' };
    const result = applyRemote(state(same), synced([a]), [remote('a', 'two', 2)], clock, ids);
    expect(result.state.docs).toHaveLength(1);
    expect(pendingOps(result.state, result.meta)).toEqual([]);
  });

  it('deletes what was deleted elsewhere, unless it was edited here', () => {
    const a = local('a', 'A');
    const b = local('b', 'B');
    const meta = synced([a, b]);
    const editedB = { ...b, source: 'B edited' };
    const result = applyRemote(state(a, editedB), meta, [tombstone('a', 2), tombstone('b', 2)], clock, ids);
    expect(result.state.docs.map((d) => d.id)).toEqual(['b']);
    expect(result.meta.docs.a).toBeUndefined();
    // b is sent on top of the tombstone, which restores it.
    expect(pendingOps(result.state, result.meta)).toEqual([expect.objectContaining({ kind: 'put', id: 'b', baseVersion: 2 })]);
  });

  it('a diagram deleted here but edited elsewhere comes back', () => {
    const a = local('a', 'A');
    const b = local('b', 'B');
    const meta = synced([a, b]);
    expect(pendingOps(state(a), meta)).toEqual([{ kind: 'delete', id: 'b', baseVersion: 1 }]);
    const result = applyRemote(state(a), meta, [remote('b', 'B edited', 2)], clock, ids);
    expect(result.state.docs.map((d) => d.source)).toEqual(['A', 'B edited']);
    expect(pendingOps(result.state, result.meta)).toEqual([]);
  });

  it('never leaves the editor without a diagram', () => {
    const a = local('a', 'A');
    const result = applyRemote(state(a), synced([a]), [tombstone('a', 2)], clock, ids);
    expect(result.state.docs).toHaveLength(1);
    expect(result.state.docs[0].id).not.toBe('a');
    expect(result.state.currentId).toBe(result.state.docs[0].id);
  });

  it('first sign-in: merges by id, uploads what the account lacks, keeps both on a clash, drops exact twins', () => {
    const same = local('same', 'title "Same"\n');
    const clash = local('clash', 'title "Mine"\n');
    const onlyHere = local('here', 'title "Here"\n');
    const starter = local('starter-local', 'title "Starter"\n', 'starter.proschi');
    const meta = emptyMeta('u1');
    const result = applyRemote(
      state(starter, same, clash, onlyHere),
      meta,
      [remote('same', 'title "Same"\n', 4), remote('clash', 'title "Theirs"\n', 2), remote('starter-remote', 'title "Starter"\n', 1, 'starter.proschi')],
      clock,
      ids,
    );
    const docs = result.state.docs;
    expect(docs.map((d) => d.id)).not.toContain('starter-local');
    expect(result.state.currentId).toBe('starter-remote');
    expect(docs.filter((d) => d.id === 'same')).toHaveLength(1);
    expect(docs.find((d) => d.id === 'clash')?.source).toBe('title "Theirs"\n');
    expect(docs.some((d) => d.source.startsWith('title "Mine (conflict'))).toBe(true);
    const ops = pendingOps(result.state, result.meta);
    expect(ops.map((o) => o.kind === 'put' && [o.baseVersion, o.body.source])).toEqual(
      expect.arrayContaining([
        [0, 'title "Here"\n'],
        [0, expect.stringMatching(/^title "Mine \(conflict/)],
      ]),
    );
    expect(ops).toHaveLength(2);
  });

  it('ops: edits and new diagrams oldest first with their base version, then deletes', () => {
    const a = local('a', 'A');
    const b = local('b', 'B');
    const meta = synced([a, b], 5);
    const editedA = { ...a, source: 'A2', updatedAt: '2026-10-03T00:00:00.000Z' };
    const added = { ...local('c', 'C'), imports: { 'lib.proschi': 'x' }, updatedAt: '2026-10-02T00:00:00.000Z' };
    const ops = pendingOps({ docs: [editedA, added], currentId: 'a' }, meta);
    expect(ops).toEqual([
      { kind: 'put', id: 'c', baseVersion: 0, fp: fingerprint(added), body: { name: 'c.proschi', source: 'C', imports: { 'lib.proschi': 'x' } } },
      { kind: 'put', id: 'a', baseVersion: 5, fp: fingerprint(editedA), body: { name: 'a.proschi', source: 'A2', imports: null } },
      { kind: 'delete', id: 'b', baseVersion: 5 },
    ]);
    let next = afterPut(meta, ops[0] as Extract<(typeof ops)[0], { kind: 'put' }>, remote('c', 'C', 1));
    next = afterDelete(next, 'b');
    expect(pendingOps({ docs: [editedA, added], currentId: 'a' }, next).map((o) => o.id)).toEqual(['a']);
  });

  it('renaming a file counts as an edit', () => {
    const a = local('a', 'A');
    expect(pendingOps(state({ ...a, fileName: 'renamed.proschi' }), synced([a]))).toHaveLength(1);
  });

  it('local and remote fingerprints agree', () => {
    const doc = { ...local('a', 'src', 'x.proschi'), imports: { 'b.proschi': '1', 'a.proschi': '2' } };
    expect(fingerprint(doc)).toBe(remoteFingerprint({ ...remote('a', 'src', 1, 'x.proschi'), imports: { 'a.proschi': '2', 'b.proschi': '1' } }));
  });

  it('retitles a copy, with or without a title line', () => {
    expect(retitle('  title Shop\nservice a\n', 'Shop "2"')).toBe('  title "Shop \\"2\\""\nservice a\n');
    expect(retitle('service a\n', 'X')).toBe('title "X"\nservice a\n');
    expect(conflictCopy(local('a', 'service a\n', 'a.proschi'), 'b', NOW)).toMatchObject({ id: 'b', fileName: expect.stringMatching(/^a \(conflict .+\)\.proschi$/) });
  });

  it('reads stored state defensively', () => {
    expect(readStoredSync(null)).toEqual({});
    expect(readStoredSync({ off: true })).toEqual({ off: true });
    const stored = readStoredSync({ meta: { userId: 'u', cursor: 'x', docs: { a: { version: 1, fp: 'f' }, b: { version: 'x' }, ['__proto__']: { version: 1, fp: 'f' } }, refused: 4 } });
    expect(stored.meta).toEqual({ userId: 'u', cursor: null, docs: { a: { version: 1, fp: 'f' } }, refused: {} });
  });
});
