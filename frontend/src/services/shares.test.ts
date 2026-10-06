import { describe, expect, it } from 'vitest';
import { embedSnippet, embedUrl, shareIdFromSearch } from './shares';
import { embedTarget, NO_DIAGRAM_MESSAGE } from '../embed/target';
import { encodeShareHash } from '../playground/share';
import { openShared, initialState } from '../playground/documents';
import { dataUrlBytes, previewTransform } from '../components/Playground/exportDiagram';

describe('short links', () => {
  it('reads only well-formed ids from ?s=', () => {
    expect(shareIdFromSearch('?s=Ab3dEf9hIj')).toBe('Ab3dEf9hIj');
    expect(shareIdFromSearch('?theme=dark&s=Ab3dEf9hIj')).toBe('Ab3dEf9hIj');
    expect(shareIdFromSearch('?s=short')).toBeUndefined();
    expect(shareIdFromSearch('?s=../../api/me')).toBeUndefined();
    expect(shareIdFromSearch('')).toBeUndefined();
  });

  it('puts the embed page next to the editor, under any sub-path', () => {
    expect(embedUrl('https://proschi.app/app/#code=abc', { id: 'Ab3dEf9hIj' })).toBe('https://proschi.app/embed/?s=Ab3dEf9hIj');
    expect(embedUrl('https://u.github.io/proschi/app/?x=1#code=abc', { hash: '#code=xyz' })).toBe('https://u.github.io/proschi/embed/#code=xyz');
  });

  it('escapes the title and address in the iframe snippet', () => {
    const snippet = embedSnippet('https://proschi.app/embed/?s=Ab3dEf9hIj&theme=dark', 'A "quoted" <title>');
    expect(snippet).toBe(
      '<iframe src="https://proschi.app/embed/?s=Ab3dEf9hIj&amp;theme=dark" title="A &quot;quoted&quot; &lt;title&gt; · Proschi" width="100%" height="480" style="border:0" loading="lazy" allowfullscreen></iframe>',
    );
  });
});

describe('embed page address', () => {
  it('prefers a short link, then a #code= link', () => {
    const hash = encodeShareHash('title Embedded\n', undefined, { 'a.proschi': 'x "X" [Go]\n' });
    expect(embedTarget('?s=Ab3dEf9hIj', hash)).toEqual({ kind: 'short', id: 'Ab3dEf9hIj' });
    expect(embedTarget('?theme=dark', hash)).toEqual({ kind: 'hash', source: 'title Embedded\n', imports: { 'a.proschi': 'x "X" [Go]\n' } });
    expect(embedTarget('', '')).toEqual({ kind: 'error', message: NO_DIAGRAM_MESSAGE });
  });
});

describe('opening a shared diagram', () => {
  const ids = (() => {
    let n = 0;
    return () => `doc-${++n}`;
  })();
  const clock = () => '2026-01-01T00:00:00.000Z';

  it('adds it on top, or selects the saved copy with the same text', () => {
    const state = initialState({ stored: null, legacySource: null, sharedSource: null, fallbackSource: 'title First\n' }, clock, ids);
    const opened = openShared(state, 'title Shared\n', { 'lib.proschi': 'a "A" [Go]\n' }, clock, ids);
    expect(opened.docs.map((d) => d.source)).toEqual(['title Shared\n', 'title First\n']);
    expect(opened.docs[0].imports).toEqual({ 'lib.proschi': 'a "A" [Go]\n' });
    expect(opened.currentId).toBe(opened.docs[0].id);

    const again = openShared({ ...opened, currentId: opened.docs[1].id }, 'title Shared\n', undefined, clock, ids);
    expect(again.docs).toHaveLength(2);
    expect(again.currentId).toBe(opened.docs[0].id);
  });
});

describe('link preview image', () => {
  it('centres the diagram on the card without blowing up small ones', () => {
    const big = previewTransform({ x: 100, y: 50, width: 2272, height: 566 }, 1200, 630, 32);
    expect(big.zoom).toBeCloseTo(0.5);
    // Centred: equal margins left and right.
    expect(big.x + 100 * big.zoom).toBeCloseTo((1200 - 2272 * big.zoom) / 2);
    const small = previewTransform({ x: 0, y: 0, width: 100, height: 50 }, 1200, 630, 32);
    expect(small.zoom).toBe(1.5);
  });

  it('measures a data URL in bytes', () => {
    expect(dataUrlBytes(`data:image/png;base64,${btoa('x'.repeat(300))}`)).toBe(300);
  });
});
