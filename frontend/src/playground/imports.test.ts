import { describe, expect, it } from 'vitest';
import { parse } from '../dsl';
import { addFile, fileNameOf, initialState, type SavedDiagram } from './documents';
import { filesResolver, importableFiles, usedImports } from './imports';

const doc = (id: string, source: string, extra: Partial<SavedDiagram> = {}): SavedDiagram => ({ id, source, updatedAt: '2026-01-01', ...extra });

describe('file names of saved diagrams', () => {
  it('uses the opened file name, or one derived from the title', () => {
    expect(fileNameOf({ source: 'title "Shared Infra"', fileName: 'infra.proschi' })).toBe('infra.proschi');
    expect(fileNameOf({ source: 'title "Shared Infra!"' })).toBe('shared-infra.proschi');
    expect(fileNameOf({ source: 'a -> b' })).toBe('untitled.proschi');
    expect(fileNameOf({ source: 'title "☕"' })).toBe('diagram.proschi');
  });

  it('remembers the name of an opened file', () => {
    const state = addFile(initialState({ stored: null, legacySource: null, sharedSource: null, fallbackSource: 'x' }), 'y', 'infra.proschi');
    expect(state.docs[0]).toMatchObject({ source: 'y', fileName: 'infra.proschi' });
  });
});

describe('imports in the browser', () => {
  const infra = doc('i', 'title "Infra"\napi [REST API]\ndb [Redis]\napi -> db', { fileName: 'infra.proschi' });
  const root = doc('root', 'title "Shop"\nimport "infra.proschi"\nusecase "U" {\n  api -> db : GET /x\n}');

  it('resolves imports against the other saved diagrams', () => {
    const files = importableFiles([root, infra], root);
    expect(Object.keys(files)).toEqual(['infra.proschi']);
    const result = parse(root.source, { path: fileNameOf(root), resolve: filesResolver(files, fileNameOf(root)) });
    expect(result.diagnostics).toEqual([]);
    expect(result.diagram.nodes.map((n) => n.id)).toEqual(['api', 'db']);
    expect(usedImports(result, files, fileNameOf(root))).toEqual({ 'infra.proschi': infra.source });
  });

  it('lets the most recently changed diagram win a name clash', () => {
    const older = doc('o', 'old', { fileName: 'infra.proschi', updatedAt: '2025-01-01' });
    expect(importableFiles([root, infra, older], root)['infra.proschi']).toBe(infra.source);
  });

  it('prefers files carried by a share link', () => {
    const shared = { ...root, imports: { 'infra.proschi': 'api [GraphQL]\ndb [Redis]' } };
    const files = importableFiles([shared, infra], shared);
    const result = parse(root.source, { path: 'shop.proschi', resolve: filesResolver(files, 'shop.proschi') });
    expect(result.diagram.nodes[0].techStack).toBe('GraphQL');
  });

  it('reports a cycle back to the document being edited', () => {
    const src = 'title "Shop"\nimport "loop.proschi"';
    const loop = doc('l', 'import "shop.proschi"', { fileName: 'loop.proschi' });
    const files = importableFiles([doc('root', src), loop], doc('root', src));
    const result = parse(src, { path: 'shop.proschi', resolve: filesResolver(files, 'shop.proschi') });
    expect(result.diagnostics.map((d) => [d.file, d.message])).toEqual([['loop.proschi', 'Import cycle: shop.proschi → loop.proschi → shop.proschi']]);
  });
});

describe('opening a share link with imports', () => {
  const base = { stored: null, legacySource: null, fallbackSource: 'x' };
  const imports = { 'infra.proschi': 'api [REST API]' };

  it('keeps the shared imports with the opened diagram', () => {
    const state = initialState({ ...base, sharedSource: 'import "infra.proschi"', sharedImports: imports });
    expect(state.docs[0]).toMatchObject({ source: 'import "infra.proschi"', imports });
  });

  it('attaches them to an identical saved diagram', () => {
    const stored = { docs: [{ id: 'a', source: 'same', updatedAt: 't' }], currentId: 'a' };
    const state = initialState({ ...base, stored, sharedSource: 'same', sharedImports: imports });
    expect(state.docs).toEqual([{ id: 'a', source: 'same', updatedAt: 't', imports }]);
  });
});
