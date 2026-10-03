/**
 * Proschi language server (LSP over stdio). Any editor with an LSP client
 * gets the same diagnostics as the web editor, plus completion, hover,
 * go-to-definition, references and an outline.
 */
import {
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  ProposedFeatures,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type DocumentSymbol,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, complete, definition, hover, outline, references, toRange, type Analysis, type OutlineSymbol } from './analysis';

declare const PROSCHI_VERSION: string;

if (process.argv.includes('--version')) {
  console.log(typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev');
  process.exit(0);
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const cache = new Map<string, { version: number; analysis: Analysis }>();

function analysisOf(doc: TextDocument): Analysis {
  const cached = cache.get(doc.uri);
  if (cached?.version === doc.version) return cached.analysis;
  const analysis = analyze(doc.getText());
  cache.set(doc.uri, { version: doc.version, analysis });
  return analysis;
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ['[', ' '] },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
  },
  serverInfo: { name: 'proschi-language-server', version: typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev' },
}));

documents.onDidChangeContent(({ document }) => {
  const { diagnostics } = analysisOf(document);
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: diagnostics.map((d) => ({
      range: toRange(d),
      severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      source: 'proschi',
      message: d.message,
    })),
  });
});

documents.onDidClose(({ document }) => {
  cache.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

const withDoc =
  <T>(fallback: T, fn: (analysis: Analysis, params: { position: { line: number; character: number } }) => T) =>
  (params: { textDocument: { uri: string }; position: { line: number; character: number } }): T => {
    const doc = documents.get(params.textDocument.uri);
    return doc ? fn(analysisOf(doc), params) : fallback;
  };

const COMPLETION_KIND = { keyword: CompletionItemKind.Keyword, node: CompletionItemKind.Variable, tech: CompletionItemKind.Class };

connection.onCompletion(
  withDoc([], (analysis, { position }) =>
    complete(analysis, position).map((item) => ({
      label: item.label,
      kind: COMPLETION_KIND[item.kind],
      detail: item.detail,
      textEdit: { range: item.range, newText: item.snippet ?? item.insertText ?? item.label },
      insertTextFormat: item.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    })),
  ),
);

connection.onHover(
  withDoc(null, (analysis, { position }) => {
    const result = hover(analysis, position);
    return result && { contents: { kind: MarkupKind.Markdown, value: result.markdown }, range: result.range };
  }),
);

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  const range = doc && definition(analysisOf(doc), params.position);
  return range ? { uri: params.textDocument.uri, range } : null;
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return references(analysisOf(doc), params.position).map((range) => ({ uri: params.textDocument.uri, range }));
});

const SYMBOL_KIND = { node: SymbolKind.Object, group: SymbolKind.Namespace, usecase: SymbolKind.Function, scenario: SymbolKind.Event };

function toSymbol(s: OutlineSymbol): DocumentSymbol {
  return { name: s.name, detail: s.detail, kind: SYMBOL_KIND[s.kind], range: s.range, selectionRange: s.range, children: s.children.map(toSymbol) };
}

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? outline(analysisOf(doc)).map(toSymbol) : [];
});

documents.listen(connection);
connection.listen();
