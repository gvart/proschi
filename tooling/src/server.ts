/**
 * Proschi language server (LSP over stdio). Any editor with an LSP client
 * gets the same diagnostics as the web editor, plus completion, hover,
 * go-to-definition, references, an outline and formatting.
 */
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  ProposedFeatures,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type CodeAction,
  type DocumentSymbol,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiDiagnostics, watchedFiles } from './openapi/config';
import { analyze, complete, definition, hover, outline, quickFix, references, toRange, type Analysis, type OutlineSymbol } from './analysis';
import { format } from './proschi';

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
    documentFormattingProvider: true,
    codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
  },
  serverInfo: { name: 'proschi-language-server', version: typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev' },
}));

function validate(document: TextDocument) {
  const { diagram, diagnostics } = analysisOf(document);
  const toLsp = (source: string) => (d: (typeof diagnostics)[number]) => ({
    range: toRange(d),
    severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    source,
    message: d.message,
  });
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [...diagnostics.map(toLsp('proschi')), ...openApiFindings(document, diagram).map(toLsp('proschi-openapi'))],
  });
}

/** Findings against the specs named in the nearest proschi.json, for documents saved on disk. */
function openApiFindings(document: TextDocument, diagram: Analysis['diagram']) {
  if (!document.uri.startsWith('file:')) return [];
  try {
    return openApiDiagnostics(fileURLToPath(document.uri), diagram);
  } catch {
    return [];
  }
}

documents.onDidChangeContent(({ document }) => validate(document));

// Specs and proschi.json change outside the editor; re-check open documents when they do.
// Spec and config reads are cached by modification time, so this costs a stat per file.
function watchedStamp(): string {
  return watchedFiles()
    .map((file) => {
      try {
        return `${file}:${statSync(file).mtimeMs}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join('\n');
}

let stamp = '';
setInterval(() => {
  const next = watchedStamp();
  if (stamp && next !== stamp) documents.all().forEach(validate);
  stamp = next;
}, 2000).unref();

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

// One edit that replaces the whole document, or none when it is already formatted.
connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const formatted = format(text);
  return formatted === text ? [] : [{ range: { start: { line: 0, character: 0 }, end: doc.positionAt(text.length) }, newText: formatted }];
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const analysis = analysisOf(doc);
  const actions: CodeAction[] = [];
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== 'proschi') continue;
    const fix = typeof diagnostic.message === 'string' && quickFix(analysis, diagnostic.message);
    if (!fix) continue;
    actions.push({
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      edit: { changes: { [params.textDocument.uri]: [fix.edit] } },
    });
  }
  return actions;
});

documents.listen(connection);
connection.listen();
