import { describe, expect, it } from 'vitest';
import { mergeProgress, type Progress } from '../practice/progress';
import { BACKUP_JSON, applyMerge, backupFileName, buildBackup, mergeSummary, planMerge, readBackup, safeZipPath } from './backup';
import type { DocumentState, SavedDiagram } from './documents';
import { readZip, writeZip } from './zip';

const doc = (id: string, source: string, fileName?: string, extra: Partial<SavedDiagram> = {}): SavedDiagram => ({
  id,
  source,
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...(fileName ? { fileName } : {}),
  ...extra,
});

const state: DocumentState = {
  docs: [
    doc('a', 'title "Checkout"\na -> b', 'checkout.proschi', { imports: { 'infra.proschi': 'db [PostgreSQL]' } }),
    doc('b', 'title "Login"', 'auth/login.proschi'),
    doc('c', 'title "Same name"', 'checkout'), // file name without extension: must not collide in the zip
  ],
  currentId: 'b',
};
const progress: Progress = { 'url-shortener': { status: 'solved', source: 'x' }, chat: { status: 'attempted' } };

describe('backup zip', () => {
  it('holds one .proschi file per diagram plus proschi-backup.json', () => {
    const names = readZip(buildBackup(state, progress)).map((e) => e.name);
    expect(names).toEqual(['checkout.proschi', 'auth/login.proschi', 'checkout-2.proschi', BACKUP_JSON]);
  });

  it('round-trips diagrams (ids, dates, file names, imports) and practice progress', () => {
    const backup = readBackup(buildBackup(state, progress));
    expect(backup.docs).toEqual(state.docs);
    expect(backup.progress).toEqual(progress);
  });

  it('reads a zip of plain .proschi files made by hand', () => {
    let n = 0;
    const zip = writeZip([
      { name: 'one.proschi', data: 'title "One"' },
      { name: 'notes.txt', data: 'ignored' },
    ]);
    const backup = readBackup(zip, () => `new-${++n}`);
    expect(backup.docs).toMatchObject([{ id: 'new-1', source: 'title "One"', fileName: 'one.proschi' }]);
    expect(backup.progress).toEqual({});
  });

  it('rejects a zip that is not a backup, and drops malformed entries of one that is', () => {
    expect(() => readBackup(writeZip([{ name: 'x.txt', data: 'x' }]))).toThrow(/no .proschi files/);
    expect(() => readBackup(writeZip([{ name: BACKUP_JSON, data: '{nope' }]))).toThrow(/not valid JSON/);
    expect(() => readBackup(writeZip([{ name: BACKUP_JSON, data: '{"format":"other"}' }]))).toThrow(/not a Proschi backup/);

    const manifest = {
      format: 'proschi-backup',
      documents: [
        { id: 'ok', file: 'ok.proschi', fileName: 'ok.proschi', updatedAt: 't', imports: { 'a.proschi': 'a' } },
        { id: 'missing-file', file: 'gone.proschi' },
        { id: 7, file: 'ok.proschi' },
        'junk',
      ],
      practice: { p: { status: 'solved' }, q: { status: 'bogus' } },
    };
    // Own `__proto__` keys, as JSON.parse creates them from a crafted file.
    const json = JSON.stringify(manifest).replace('"imports":{', '"imports":{"__proto__":"x",').replace('"practice":{', '"practice":{"__proto__":{"status":"solved"},');
    const backup = readBackup(writeZip([{ name: 'ok.proschi', data: 'title "Ok"' }, { name: BACKUP_JSON, data: json }]));
    expect(backup.docs).toEqual([{ id: 'ok', source: 'title "Ok"', updatedAt: 't', fileName: 'ok.proschi', imports: { 'a.proschi': 'a' } }]);
    expect(backup.progress).toEqual({ p: { status: 'solved' } });
    expect(Object.getPrototypeOf(backup.progress)).toBe(Object.prototype);
  });

  it('keeps zip paths inside the archive', () => {
    expect(safeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeZipPath('/abs/x.proschi')).toBe('abs/x.proschi');
    expect(safeZipPath('a\\..\\b.proschi')).toBe('a/b.proschi');
    expect(safeZipPath('..')).toBe('diagram.proschi');
  });
});

describe('merging a backup', () => {
  it('adds new diagrams, skips identical ones and reports conflicts by id or file name', () => {
    const incoming = [
      doc('a', state.docs[0].source, 'checkout.proschi'), // identical
      doc('b', 'title "Login v2"', 'auth/login.proschi'), // same id, other content
      doc('z', 'title "Other"', 'checkout'), // same file name as c, other content
      doc('n', 'title "New"', 'new.proschi'),
    ];
    const plan = planMerge(state, incoming);
    expect(plan.unchanged).toBe(1);
    expect(plan.added.map((d) => d.id)).toEqual(['n']);
    expect(plan.conflicts.map((c) => [c.incoming.id, c.existing.id])).toEqual([
      ['b', 'b'],
      ['z', 'c'],
    ]);
  });

  it('overwrites only the conflicts the person agrees to, keeping the existing id', () => {
    const plan = planMerge(state, [doc('b', 'title "Login v2"', 'auth/login.proschi'), doc('z', 'title "Other"', 'checkout'), doc('n', 'title "New"', 'new.proschi')]);
    const merged = applyMerge(state, plan, (c) => c.existing.id === 'b');
    expect(merged.currentId).toBe('b');
    expect(merged.docs.map((d) => [d.id, d.source])).toEqual([
      ['a', state.docs[0].source],
      ['b', 'title "Login v2"'],
      ['c', 'title "Same name"'],
      ['n', 'title "New"'],
    ]);
  });

  it('summarises what an import did', () => {
    const plan = planMerge(state, [doc('n', 'x', 'n.proschi'), doc('b', 'changed', 'auth/login.proschi'), doc('a', state.docs[0].source)]);
    expect(mergeSummary(plan, 0, 2)).toBe('Backup imported: added 1 diagram, replaced 0 of 1 changed diagram, 1 already here, restored progress on 2 practice problems.');
    expect(mergeSummary(planMerge(state, []), 0, 0)).toBe('Backup imported: added 0 diagrams.');
    expect(backupFileName(new Date('2026-10-04T12:00:00Z'))).toBe('proschi-backup-2026-10-04.zip');
  });

  it('restores practice progress keeping the better status per problem', () => {
    const current: Progress = { a: { status: 'attempted', source: 'mine' }, b: { status: 'solved', source: 'mine' }, c: { status: 'todo' } };
    const restored: Progress = { a: { status: 'solved', source: 'old' }, b: { status: 'attempted', source: 'old' }, c: { status: 'todo', source: 'old' }, d: { status: 'attempted' } };
    expect(mergeProgress(current, restored)).toEqual({
      a: { status: 'solved', source: 'old' },
      b: { status: 'solved', source: 'mine' },
      c: { status: 'todo' },
      d: { status: 'attempted' },
    });
  });
});
