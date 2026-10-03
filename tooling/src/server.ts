/**
 * Proschi language server (LSP over stdio). Any editor with an LSP client
 * gets the same diagnostics as the web editor, plus completion, hover,
 * go-to-definition, references, an outline and links on import paths.
 * Imports resolve from disk relative to the document, preferring the text of
 * open (possibly unsaved) documents.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { analyze, complete, declaration, hover, outline, references, toRange, type Analysis, type OutlineSymbol } from './analysis';
import { fileResolver, importLinks, ownDiagnostics } from './imports';

declare const PROSCHI_VERSION: string;

if (process.argv.includes('--version')) {
  console.log(typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev');
  process.exit(0);
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** Analyses by URI, with the files their imports read, so a change to one of those re-validates them. */
const cache = new Map<string, { version: number; analysis: Analysis; files: Set<string> }>();

const pathOf = (uri: string): string | undefined => (uri.startsWith('file:') ? fileURLToPath(uri) : undefined);
const uriOf = (path: string): string => pathToFileURL(path).href;

/** Open documents by file path; their text wins over what is on disk. */
function openText(path: string): string | undefined {
  return documents.all().find((d) => pathOf(d.uri) === path)?.getText();
}

const resolve = fileResolver(openText);

function analysisOf(doc: TextDocument): Analysis {
  const cached = cache.get(doc.uri);
  if (cached?.version === doc.version) return cached.analysis;
  const analysis = analyze(doc.getText(), { path: pathOf(doc.uri), resolve });
  const files = new Set((analysis.result.imports ?? []).flatMap((i) => (i.resolved ? [i.resolved] : [])));
  cache.set(doc.uri, { version: doc.version, analysis, files });
  return analysis;
}

function publish(doc: TextDocument) {
  connection.sendDiagnostics({
    uri: doc.uri,
    version: doc.version,
    diagnostics: ownDiagnostics(analysisOf(doc).result).map((d) => ({
      range: toRange(d),
      severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      source: 'proschi',
      message: d.message,
    })),
  });
}

/** Re-validates the open documents that import `uri`, directly or through other files. */
function publishDependents(uri: string) {
  const path = pathOf(uri);
  if (!path) return;
  for (const doc of documents.all()) {
    if (doc.uri === uri || !cache.get(doc.uri)?.files.has(path)) continue;
    cache.delete(doc.uri);
    publish(doc);
  }
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ['[', ' '] },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
    documentLinkProvider: { resolveProvider: false },
  },
  serverInfo: { name: 'proschi-language-server', version: typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev' },
}));

documents.onDidChangeContent(({ document }) => {
  publish(document);
  publishDependents(document.uri);
});

documents.onDidClose(({ document }) => {
  cache.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  // Dependents now read the file from disk again.
  publishDependents(document.uri);
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
  const found = doc && declaration(analysisOf(doc), params.position);
  if (!found) return null;
  return { uri: found.file ? uriOf(found.file) : params.textDocument.uri, range: found.range };
});

connection.onDocumentLinks((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? importLinks(analysisOf(doc).result).map(({ range, target }) => ({ range, target: uriOf(target) })) : [];
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
