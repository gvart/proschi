import { describe, expect, it } from 'vitest';
import { examples, parse } from '../dsl';
import { MAX_ALT_DEPTH } from '../dsl/parser';
import { format } from '../dsl/format';
import { toMermaidArchitecture, toMermaidSequence } from '../dsl/mermaid';
import { buildHld, toHtml, toMarkdown } from '../hld';
import { analyze, runTests } from '../sim';

/**
 * Untrusted documents arrive through share links, opened files and imports.
 * Whatever they contain, parsing and the whole pipeline behind it (simulation,
 * tests, HLD, Mermaid, formatting) must finish quickly instead of freezing the tab.
 */

const BUDGET_MS = 200;
const SIZE = 10_000;

/** A small seeded PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const fill = (unit: string, size = SIZE) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

function pipeline(source: string) {
  const { diagram } = parse(source);
  const analysis = analyze(diagram);
  runTests(diagram, analysis);
  const doc = buildHld(diagram);
  toHtml(doc);
  toMarkdown(doc);
  toMermaidArchitecture(diagram);
  for (const u of diagram.useCases.slice(0, 5)) toMermaidSequence(diagram, u.id);
  format(source);
}

function timed(source: string): number {
  const start = performance.now();
  pipeline(source);
  return performance.now() - start;
}

/** Best of three runs, so a GC pause or a cold JIT does not fail the test. */
function bestOf(source: string): number {
  pipeline(source); // warm up
  return Math.min(timed(source), timed(source), timed(source));
}

const ADVERSARIAL: Record<string, string> = {
  'one long line of label': `a -> b : ${fill('json ')}`,
  'spaces before json': `usecase "U" {\n a -> b : x${' '.repeat(SIZE)}json {\n}`,
  'keyed payload backtracking': `usecase "U" {\n a -> b : ${fill(' json  xml ')}\n}`,
  'unclosed payload bracket': `usecase "U" {\n a -> b : POST /x json {\n${fill('"k": [\n')}`,
  'unterminated strings': fill('a "unterminated\n'),
  'unclosed tech brackets': fill('n [tech\n'),
  'deeply nested braces': fill('group g {\n'),
  'deeply nested alts': `a [Actor]\nb [REST API]\nusecase "U" {\n${fill('alt "x" {\n a -> b : GET /\n')}`,
  'many sibling alt sets': `a [Actor]\nb [REST API]\nusecase "U" {\n${fill('alt "x" { a -> b : 1 } alt "y" { a -> b : 2 }\n')}\n}`,
  'huge multipliers': `a [Actor]\nb [REST API] x999999999\nusecase "U" {\n${fill(' a -> b : x999999999 ~999999999GB GET /\n')}\n}`,
  'enormous numbers': `traffic {\n${fill('  "U" 9'.padEnd(300, '9') + 'b rps\n')}\n}\na pos ${'9'.repeat(400)},-${'9'.repeat(400)}\n`,
  'many nodes and edges': Array.from({ length: 400 }, (_, i) => `n${i} [REST API]\nn${i} -> n${(i * 7) % 400}`).join('\n'),
  'arrows everywhere': fill('a -> b -> c ->> d --> e -x f\n'),
  'comment and hash soup': fill('a -> b : {"#": "#"} # # #\n'),
  'markup in names': `x "<script>alert(1)</script>" [<img src=x onerror=alert(1)>] @t\nusecase "<b>" {\n x -> x : <svg onload=alert(1)>\n}\n`,
};

describe('parsing untrusted documents stays fast', () => {
  for (const [name, source] of Object.entries(ADVERSARIAL)) {
    it(`${name} (${source.length} chars)`, () => {
      expect(bestOf(source)).toBeLessThan(BUDGET_MS);
    });
  }

  it('random documents built from language tokens', () => {
    const next = rng(42);
    const tokens = ['a', 'b', 'c', '->', '->>', '-->', '-x', ':', '{', '}', '"', '[', ']', '@t', 'usecase', 'alt', 'par', 'group', 'json', 'x9', '100k rps', '\n', ' ', '#', 'traffic', 'requirements', 'test', 'p99', '<', '50ms', 'pos 1,2'];
    for (let round = 0; round < 20; round++) {
      let source = '';
      while (source.length < SIZE) source += tokens[Math.floor(next() * tokens.length)] + (next() < 0.5 ? ' ' : '');
      expect(bestOf(source), `round ${round}`).toBeLessThan(BUDGET_MS);
    }
  });

  it('random bytes', () => {
    const next = rng(7);
    for (let round = 0; round < 10; round++) {
      const source = Array.from({ length: SIZE }, () => String.fromCharCode(Math.floor(next() * 128))).join('');
      expect(bestOf(source), `round ${round}`).toBeLessThan(BUDGET_MS);
    }
  });

  // Regressions: each of these was quadratic (or overflowed the stack) before; at 100 KB they took seconds or crashed.
  const LARGE = 100_000;
  const QUADRATIC: Record<string, string> = {
    'unclosed payload over many lines': `usecase "U" {\n a -> b : POST /x json {\n${fill('"k": [\n', LARGE)}`,
    'alts nested thousands deep': `a [Actor]\nb [REST API]\nusecase "U" {\n${fill('alt "x" {\n a -> b : GET /\n', LARGE)}`,
    'repeated connections': fill('a -> zz\n', LARGE),
    'braces nested thousands deep (format)': fill('group g {\n', LARGE),
  };
  for (const [name, source] of Object.entries(QUADRATIC)) {
    it(`${name} at 100 KB stays linear`, () => {
      expect(bestOf(source)).toBeLessThan(1000);
    });
  }

  it('reports alt blocks nested past the limit and skips them', () => {
    const deep = `a [Actor]\nb [REST API]\nusecase "U" {\n${'alt "x" {\n'.repeat(MAX_ALT_DEPTH + 2)}a -> b : GET /\n${'}\n'.repeat(MAX_ALT_DEPTH + 3)}`;
    const { diagram, diagnostics } = parse(deep);
    expect(diagnostics.some((d) => d.message.includes(`at most ${MAX_ALT_DEPTH} deep`))).toBe(true);
    expect(diagnostics.some((d) => d.message.startsWith('Unmatched') || d.message.startsWith('Missing }'))).toBe(false);
    expect(diagram.useCases).toHaveLength(1);
  });

  it('every bundled example, repeated to 10 KB', () => {
    for (const example of examples) {
      const source = fill(`${example.source}\n`);
      expect(bestOf(source), example.name).toBeLessThan(BUDGET_MS);
    }
  });
});
