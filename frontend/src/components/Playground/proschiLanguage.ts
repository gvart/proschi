import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { componentCatalog } from '../../catalog/componentCatalog';
import type { Diagnostic } from '../../dsl';

interface LexState {
  inLabel: boolean;
  /** Open { / [ in a payload, so multi-line JSON stays highlighted as a label. */
  depth: number;
}

const KEYWORDS = /^(title|import|group|usecase|par|alt|pos)\b/;
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
/** `when` is a keyword only right after an alt name: `alt "Name" when "condition" {`. */
const AFTER_ALT_NAME = /^\s*(\}\s*)?alt\s+("(?:[^"\\]|\\.)*"|\w+)\s+$/;

/** Tokenizer behind the highlighting; exported for tests. */
export const proschiStreamParser: StreamParser<LexState> = {
  name: 'proschi',
  startState: () => ({ inLabel: false, depth: 0 }),
  token(stream, state) {
    if (stream.sol() && state.depth <= 0) {
      state.inLabel = false;
      state.depth = 0;
    }
    if (stream.eatSpace()) return null;

    const afterSpace = stream.pos === 0 || /\s/.test(stream.string[stream.pos - 1]);
    if (stream.peek() === '#' && afterSpace && state.depth <= 0) {
      stream.skipToEnd();
      return 'comment';
    }

    if (state.inLabel) {
      if (state.depth <= 0) {
        if (stream.match(HTTP_METHOD)) return 'keyword';
        if (stream.match(/^\/\S*/)) return 'link';
        if (stream.match(/^\d{3}\b/)) return 'number';
        if (stream.match(/^(json|xml|text)\b/)) return 'typeName';
      }
      const ch = stream.next();
      if (ch === '{' || ch === '[') state.depth++;
      else if (ch === '}' || ch === ']') state.depth--;
      return 'string';
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\[[^\]]*\]?/)) return 'typeName';
    if (stream.match(/^@[\w-]*/)) return 'attributeName';
    if (stream.match(/^(->>|-->|->|-x(?!\w))/)) return 'operator';
    if (stream.match(/^-?\d+/)) return 'number';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (AFTER_ALT_NAME.test(stream.string.slice(0, stream.pos)) && stream.match(/^when\b/)) return 'keyword';
    if (stream.match(/^[A-Za-z_]\w*/)) return 'variableName';
    if (stream.eat(':')) {
      state.inLabel = true;
      return 'punctuation';
    }
    if (stream.match(/^[{}]/)) return 'brace';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

/** Syntax highlighting for Proschi documents. */
export const proschiLanguage = StreamLanguage.define(proschiStreamParser);

const techOptions: Completion[] = componentCatalog.map((c) => ({
  label: c.techStack,
  type: 'type',
  detail: c.category,
  apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
    const closed = view.state.sliceDoc(to, to + 1) === ']';
    const insert = closed ? c.techStack : `${c.techStack}]`;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 1 : 0) } });
  },
}));

const keywordOptions: Completion[] = [
  { label: 'title', type: 'keyword', apply: 'title "', detail: 'document title' },
  { label: 'import', type: 'keyword', apply: 'import "', detail: 'import "file.proschi"' },
  { label: 'group', type: 'keyword', detail: 'group id "Name" { … }' },
  { label: 'usecase', type: 'keyword', apply: 'usecase "', detail: 'usecase "Name" { … }' },
  { label: 'par', type: 'keyword', apply: 'par {', detail: 'parallel steps' },
  { label: 'alt', type: 'keyword', apply: 'alt "', detail: 'alt "Scenario" { … }' },
];

/** Completes tech stacks inside [ ] and node ids / keywords elsewhere. */
export function proschiCompletions(getNodeIds: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);

    const tech = before.match(/\[([^\]]*)$/);
    if (tech) return { from: ctx.pos - tech[1].length, options: techOptions, validFor: /^[\w ./-]*$/ };

    // Labels after ':' are free text.
    if (/^[^"#]*:/.test(before)) return null;

    const word = ctx.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !ctx.explicit) return null;
    const from = word?.from ?? ctx.pos;
    const atLineStart = before.slice(0, from - line.from).trim() === '';

    const ids: Completion[] = getNodeIds().map((id) => ({ label: id, type: 'variable' }));
    return { from, options: atLineStart ? [...keywordOptions, ...ids] : ids, validFor: /^\w*$/ };
  };
}

/** Maps parser diagnostics (1-based line/col) onto document offsets. */
export function toCmDiagnostics(diagnostics: Diagnostic[], doc: Text): CmDiagnostic[] {
  return diagnostics
    .filter((d) => d.line <= doc.lines)
    .map((d) => {
      const line = doc.line(d.line);
      const from = Math.min(line.from + d.col - 1, line.to);
      const to = Math.min(from + Math.max(d.length, 1), line.to);
      return { from, to: Math.max(to, from), severity: d.severity, message: d.message };
    });
}
