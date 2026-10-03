import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import oniguruma from 'vscode-oniguruma';
import vsctm from 'vscode-textmate';
import { examples } from '../src/proschi';

// The same engine VS Code (and IntelliJ's TextMate support, via its own port) runs.
const require = createRequire(import.meta.url);
await oniguruma.loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer);
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({ createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p), createOnigString: (s: string) => new oniguruma.OnigString(s) }),
  loadGrammar: async () => vsctm.parseRawGrammar(readFileSync(new URL('../grammar/proschi.tmLanguage.json', import.meta.url), 'utf8'), 'proschi.tmLanguage.json'),
});
const grammar = (await registry.loadGrammar('source.proschi'))!;

/** [text, innermost scope] for every token, across lines, keeping rule state like an editor does. */
function tokenize(source: string): [string, string][][] {
  let state = vsctm.INITIAL;
  return source.split('\n').map((line) => {
    const r = grammar.tokenizeLine(line, state);
    state = r.ruleStack;
    return r.tokens
      .map((t) => [line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]] as [string, string])
      .filter(([text]) => text.trim() !== '');
  });
}

const scopeOf = (lines: [string, string][][], text: string) =>
  lines.flat().find(([t]) => t.trim() === text)?.[1];

describe('TextMate grammar', () => {
  it('scopes declarations', () => {
    const [line] = tokenize('  api "Order API" [REST API] @orders pos 10,-20 # note');
    expect(line).toEqual([
      ['api', 'variable.other.node.proschi'],
      ['"', 'punctuation.definition.string.begin.proschi'],
      ['Order API', 'string.quoted.double.proschi'],
      ['"', 'punctuation.definition.string.end.proschi'],
      ['[REST API]', 'entity.name.type.tech.proschi'],
      ['@orders', 'entity.other.attribute-name.team.proschi'],
      ['pos', 'keyword.other.pos.proschi'],
      ['10', 'constant.numeric.proschi'],
      [',', 'punctuation.separator.comma.proschi'],
      ['-20', 'constant.numeric.proschi'],
      ['# note', 'comment.line.number-sign.proschi'],
    ]);
  });

  it('scopes keywords, including `} alt` on one line', () => {
    const lines = tokenize('usecase "U" {\n  par {\n  }\n  alt "A" {\n  } alt "B" {\n  }\n}');
    expect(lines[0][0]).toEqual(['usecase', 'keyword.control.proschi']);
    expect(lines[1][0]).toEqual(['par', 'keyword.control.proschi']);
    expect(lines[4].slice(0, 2)).toEqual([
      ['}', 'punctuation.section.block.end.proschi'],
      ['alt', 'keyword.control.proschi'],
    ]);
  });

  it('scopes when only between an alt name and its condition', () => {
    const [line] = tokenize('  } alt "Missing" when "no such order" {');
    expect(line).toEqual([
      ['}', 'punctuation.section.block.end.proschi'],
      ['alt', 'keyword.control.proschi'],
      ['"', 'punctuation.definition.string.begin.proschi'],
      ['Missing', 'string.quoted.double.proschi'],
      ['"', 'punctuation.definition.string.end.proschi'],
      ['when', 'keyword.control.proschi'],
      ['"', 'punctuation.definition.string.begin.proschi'],
      ['no such order', 'string.quoted.double.proschi'],
      ['"', 'punctuation.definition.string.end.proschi'],
      ['{', 'punctuation.section.block.proschi'],
    ]);
    expect(scopeOf(tokenize('alt Missing when "x" {'), 'when')).toBe('keyword.control.proschi');
    expect(scopeOf(tokenize('when -> api'), 'when')).toBe('variable.other.node.proschi');
    expect(scopeOf(tokenize('alt when {'), 'when')).toBe('variable.other.node.proschi');
  });

  it('scopes arrows, without reading -x out of an id', () => {
    for (const arrow of ['->', '->>', '-->', '-x']) {
      expect(scopeOf(tokenize(`a ${arrow} b`), arrow), arrow).toBe('keyword.operator.arrow.proschi');
    }
    expect(scopeOf(tokenize('a -> xray'), 'xray')).toBe('variable.other.node.proschi');
  });

  it('scopes step labels: method, endpoint, status, format', () => {
    const lines = tokenize('gw -> api : POST /orders json {"sku": "A1"}\napi --> gw : 201 {"id": 1}');
    expect(scopeOf(lines, 'POST')).toBe('keyword.other.http-method.proschi');
    expect(scopeOf(lines, '/orders')).toBe('string.unquoted.endpoint.proschi');
    expect(scopeOf(lines, 'json')).toBe('storage.type.format.proschi');
    expect(scopeOf(lines, '201')).toBe('constant.numeric.status.proschi');
    expect(scopeOf(lines, 'sku')).toBe('string.quoted.double.json.proschi');
    expect(scopeOf(lines, '1')).toBe('constant.numeric.json.proschi');
  });

  it('keeps a multi-line JSON payload inside the label', () => {
    const lines = tokenize('a -> b : POST /x json {\n  "items": [{ "id": 1 }],\n  "ok": true\n}\nc -> d');
    expect(scopeOf(lines, 'items')).toBe('string.quoted.double.json.proschi');
    expect(scopeOf(lines, 'true')).toBe('constant.language.json.proschi');
    // Back to statements once the brackets balance.
    expect(lines[4]).toEqual([
      ['c', 'variable.other.node.proschi'],
      ['->', 'keyword.operator.arrow.proschi'],
      ['d', 'variable.other.node.proschi'],
    ]);
  });

  it('keeps # in strings and payloads, and ends a label at a comment', () => {
    const lines = tokenize('a "#1" : x {"tag": "#2"} # done');
    expect(lines[0].filter(([, s]) => s.startsWith('comment'))).toEqual([['# done', 'comment.line.number-sign.proschi']]);
    expect(scopeOf(lines, '#1')).toBe('string.quoted.double.proschi');
    expect(scopeOf(lines, '#2')).toBe('string.quoted.double.json.proschi');
  });

  it.each(examples.map((e) => [e.id, e.source]))('tokenizes the %s example without leaving a block open', (_id, source) => {
    let state = vsctm.INITIAL;
    for (const line of source.split('\n')) state = grammar.tokenizeLine(line, state).ruleStack;
    // Depth 1 is the root rule: no string, label or payload left open.
    expect(state.depth).toBe(1);
  });
});
