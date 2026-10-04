import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../dsl';
import { buildHld, EXPORT_CSP, toHtml } from '../hld';
import { initialState, readState } from '../playground/documents';
import { TooLargeError, decompressBounded } from '../playground/lzBounded';
import { fileMap } from '../playground/sanitize';
import { LONG_LINK_CHARS, MAX_SHARE_CHARS, TOO_LARGE_MESSAGE, decodeShareLink, encodeShareHash, isLongLink, readShareLink } from '../playground/share';
import { safeHref } from '../practice/markdown';
import { loadProgress, readProgress } from '../practice/progress';

describe('bounded lz-string decompression', () => {
  it('decodes exactly what lz-string decodes', () => {
    const samples = ['a', 'hello world', 'title "Café ☕"\na -> b : {"q": "#1 & 2"}', 'x'.repeat(5000), Array.from({ length: 3000 }, (_, i) => String.fromCharCode(32 + (i % 500))).join('')];
    for (const s of samples) {
      const encoded = compressToEncodedURIComponent(s);
      expect(decompressBounded(encoded, 1e7)).toBe(decompressFromEncodedURIComponent(encoded));
    }
    for (const junk of ['%%%', 'AAAA', '$$$$$$$$', 'a b c']) expect(decompressBounded(junk, 1e7)).toBe(decompressFromEncodedURIComponent(junk));
  });

  it('stops at the cap instead of expanding a small link into hundreds of megabytes', () => {
    // 1 MB of one character compresses to a couple of kilobytes.
    const bomb = compressToEncodedURIComponent('a'.repeat(1_000_000));
    expect(bomb.length).toBeLessThan(5000);
    expect(() => decompressBounded(bomb, 100_000)).toThrow(TooLargeError);
    expect(decompressBounded(bomb, 1_000_000)).toHaveLength(1_000_000);
  });
});

describe('share link decoding', () => {
  it('refuses a link that expands past 2 MB with a friendly error, quickly', () => {
    const hash = encodeShareHash('a'.repeat(MAX_SHARE_CHARS + 1));
    const start = performance.now();
    expect(readShareLink(hash)).toEqual({ error: TOO_LARGE_MESSAGE });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(decodeShareLink(hash)).toBeNull();
  });

  it('counts imported files toward the limit', () => {
    const hash = encodeShareHash('a -> b', undefined, { 'big.proschi': 'x'.repeat(MAX_SHARE_CHARS) });
    expect(readShareLink(hash)).toEqual({ error: TOO_LARGE_MESSAGE });
  });

  it('drops malformed imports but still opens the document', () => {
    const code = encodeShareHash('a -> b');
    for (const bad of ['%%%', compressToEncodedURIComponent('{not json'), compressToEncodedURIComponent('[1,2]'), compressToEncodedURIComponent('"str"'), compressToEncodedURIComponent('null')]) {
      expect(decodeShareLink(`${code}&imports=${bad}`)).toEqual({ source: 'a -> b' });
    }
  });

  it('keeps prototype keys out of imported file maps', () => {
    const json = '{"__proto__": "polluted", "constructor": "c", "prototype": "p", "ok.proschi": "a [Actor]", "n.proschi": 5, "": "empty"}';
    const link = decodeShareLink(`${encodeShareHash('a -> b')}&imports=${compressToEncodedURIComponent(json)}`);
    expect(link?.imports).toEqual({ 'ok.proschi': 'a [Actor]' });
    expect(Object.getPrototypeOf(link!.imports)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(fileMap({ ['x'.repeat(600)]: 'too long a path' })).toBeUndefined();
  });

  it('warns about links longer than 8 000 characters', () => {
    expect(isLongLink('x'.repeat(LONG_LINK_CHARS))).toBe(false);
    expect(isLongLink('x'.repeat(LONG_LINK_CHARS + 1))).toBe(true);
    expect(LONG_LINK_CHARS).toBe(8000);
  });
});

describe('corrupted localStorage', () => {
  const base = { legacySource: null, sharedSource: null, fallbackSource: 'title "Fallback"' };

  it('ignores saved state of the wrong shape instead of crashing', () => {
    for (const stored of [null, 'text', 42, [], {}, { docs: 'abc' }, { docs: [1, null, 'x'] }, { docs: [{ id: 1, source: 'x' }] }, { docs: [{ id: 'a' }] }]) {
      const state = initialState({ ...base, stored });
      expect(state.docs).toHaveLength(1);
      expect(state.docs[0].source).toBe('title "Fallback"');
    }
  });

  it('keeps the good diagrams, drops bad fields and duplicate ids', () => {
    const stored = {
      currentId: 'missing',
      docs: [
        { id: 'a', source: 'title "A"', updatedAt: 5, fileName: 7, imports: { __proto__: 'x', 'i.proschi': 'i', bad: 3 } },
        { id: 'a', source: 'duplicate' },
        { id: 'b', source: 'title "B"', updatedAt: '2026-01-01T00:00:00.000Z', fileName: 'b.proschi' },
      ],
    };
    const state = readState(stored)!;
    expect(state.currentId).toBe('a');
    expect(state.docs).toEqual([
      { id: 'a', source: 'title "A"', updatedAt: new Date(0).toISOString(), imports: { 'i.proschi': 'i' } },
      { id: 'b', source: 'title "B"', updatedAt: '2026-01-01T00:00:00.000Z', fileName: 'b.proschi' },
    ]);
  });

  it('ignores a legacy source that is not a string', () => {
    expect(initialState({ ...base, stored: null, legacySource: { evil: true } }).docs[0].source).toBe('title "Fallback"');
  });

  describe('practice progress', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('drops malformed entries and __proto__ keys', () => {
      const raw = JSON.parse('{"__proto__": {"status": "solved"}, "a": {"status": "solved", "source": 5}, "b": "solved", "c": null, "d": {"status": "hacked"}}');
      const progress = readProgress(raw);
      expect(progress).toEqual({ a: { status: 'solved' } });
      expect(Object.getPrototypeOf(progress)).toBe(Object.prototype);
    });

    it('survives storage holding invalid JSON or throwing', () => {
      vi.stubGlobal('localStorage', { getItem: () => '{oops' });
      expect(loadProgress()).toEqual({});
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('SecurityError');
        },
      });
      expect(loadProgress()).toEqual({});
    });
  });
});

describe('links and HTML built from content', () => {
  it('Markdown links never get a script or data URL', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', '  javascript:alert(1)', '\tjavascript:alert(1)', 'java\nscript:alert(1)', 'vbscript:x', 'data:text/html,<script>', 'DATA:image/svg+xml,x', 'file:///etc/passwd', 'blob:https://x/y']) {
      expect(safeHref(href), href).toBeUndefined();
    }
    for (const href of ['https://example.com', 'http://x.y/z', 'mailto:a@b.c', '#top', './a', '../app/', 'relative/path']) expect(safeHref(href), href).toBeDefined();
  });

  it('the HLD HTML export escapes document text and blocks scripts with its own CSP', () => {
    const { diagram } = parse(`title "</title><script>alert(1)</script>"
x "<img src=x onerror=alert(1)>" [REST API] @"><b> "<svg onload=alert(1)>"
usecase "<i>u</i>" "<script>" {
  x -> x : POST /a json {"k": "</code><script>"}
}
decision "<b>d</b>" because "<script>"
`);
    const html = toHtml(buildHld(diagram));
    expect(html).not.toMatch(/<(script|img|svg|i|b)\b/i);
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`);
  });
});
