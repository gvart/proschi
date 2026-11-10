/**
 * Proschi language server (LSP over stdio). Any editor with an LSP client
 * gets the same diagnostics as the web editor, plus completion, hover,
 * go-to-definition, references, rename, an outline, formatting and links on import
 * paths, failing requirements and tests as warnings (source `proschi-test`),
 * and simulation results as inlay hints (after nodes) and code lenses (above
 * use cases, what-ifs and requirements). Imports resolve from disk relative to the document, preferring the
 * text of open (possibly unsaved) documents, confined to the project root;
 * git and https imports come from the cache of `proschi imports sync`.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CodeActionKind,
  CodeLensRefreshRequest,
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  ResponseError,
  ErrorCodes,
  MarkupKind,
  MessageType,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  ProposedFeatures,
  ShowMessageNotification,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type CodeAction,
  type DocumentSymbol,
  type Location,
  type TextEdit as LspTextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { openApiDiagnostics, watchedFiles } from './openapi/config';
import {
  analyze,
  codeLenses,
  complete,
  cursorFixes,
  declaration,
  hover,
  inlayHints,
  outline,
  quickFix,
  references,
  rename,
  renameEdits,
  renameTarget,
  semanticTokens,
  symbolTarget,
  testQuickFix,
  toRange,
  type Analysis,
  type OutlineSymbol,
  type RenameSymbol,
  type TokenKind,
} from './analysis';
import { fileResolver, importLinks, ownDiagnostics } from './imports';
import { format } from './proschi';
import { testDiagnostics } from './simulation';
import { MAX_INDEXED_FILES, WorkspaceIndex } from './workspaceIndex';

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

function analysisOf(doc: TextDocument): Analysis {
  const cached = cache.get(doc.uri);
  if (cached?.version === doc.version) return cached.analysis;
  const path = pathOf(doc.uri);
  // Per document: its project root confines its imports; remote ones come from the sync cache only.
  const resolve = fileResolver({ entry: path, read: openText });
  const analysis = analyze(doc.getText(), { path, resolve });
  resolve.explain(analysis.result);
  const files = new Set((analysis.result.imports ?? []).flatMap((i) => (i.resolved ? [i.resolved] : [])));
  cache.set(doc.uri, { version: doc.version, analysis, files });
  return analysis;
}

/** Re-validates the open documents that import `uri`, directly or through other files. */
function publishDependents(uri: string) {
  const path = pathOf(uri);
  if (!path) return;
  let changed = false;
  for (const doc of documents.all()) {
    if (doc.uri === uri || !cache.get(doc.uri)?.files.has(path)) continue;
    cache.delete(doc.uri);
    validate(doc);
    changed = true;
  }
  // Their hints and lenses show numbers that depend on the imported file.
  if (changed) refreshResults();
}

/** `proschi.inlayHints.enabled` and `proschi.codeLens.enabled`; both on until the client says otherwise. */
let show = { inlayHints: true, codeLens: true };
let canRefresh = { inlayHints: false, codeLens: false };

function refreshResults() {
  if (canRefresh.inlayHints) void connection.languages.inlayHint.refresh().catch(() => undefined);
  if (canRefresh.codeLens) void connection.sendRequest(CodeLensRefreshRequest.type).catch(() => undefined);
}

connection.onDidChangeConfiguration(({ settings }) => {
  const own = (settings as { proschi?: { inlayHints?: { enabled?: unknown }; codeLens?: { enabled?: unknown } } } | null)?.proschi;
  show = { inlayHints: own?.inlayHints?.enabled !== false, codeLens: own?.codeLens?.enabled !== false };
  refreshResults();
});

// Standard token types, so every theme colours them: node ids, tech stacks, teams, legend tags.
const TOKEN_TYPE: Record<TokenKind, string> = { node: 'variable', tech: 'type', team: 'decorator', tag: 'enumMember', constant: 'parameter' };
const TOKEN_TYPES = Object.values(TOKEN_TYPE);

/** The `.proschi` files of the workspace folders, scanned on the first rename or references request. */
let workspace = new WorkspaceIndex([]);
let watchFiles = false;

connection.onInitialize(({ capabilities: client, workspaceFolders, rootUri, rootPath }) => {
  const roots = workspaceFolders?.length ? workspaceFolders.map((f) => pathOf(f.uri)) : [rootUri ? pathOf(rootUri) : (rootPath ?? undefined)];
  workspace = new WorkspaceIndex(roots.filter((r): r is string => !!r));
  watchFiles = !!client.workspace?.didChangeWatchedFiles?.dynamicRegistration;
  canRefresh = { inlayHints: !!client.workspace?.inlayHint?.refreshSupport, codeLens: !!client.workspace?.codeLens?.refreshSupport };
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ['[', ' ', '"', '$'] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      documentLinkProvider: { resolveProvider: false },
      documentFormattingProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      semanticTokensProvider: { legend: { tokenTypes: TOKEN_TYPES, tokenModifiers: [] }, full: true },
      inlayHintProvider: true,
      codeLensProvider: { resolveProvider: false },
    },
    serverInfo: { name: 'proschi-language-server', version: typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev' },
  };
});

connection.onInitialized(() => {
  if (watchFiles) void connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: [{ globPattern: '**/*.proschi' }] }).catch(() => undefined);
});

connection.onDidChangeWatchedFiles(({ changes }) => {
  for (const change of changes) {
    const path = pathOf(change.uri);
    if (path) workspace.changed(path, change.type === FileChangeType.Deleted);
  }
});

function validate(document: TextDocument) {
  const analysis = analysisOf(document);
  const toLsp = (source: string) => (d: Analysis['diagnostics'][number]) => ({
    range: toRange(d),
    severity: d.severity === 'error' ? DiagnosticSeverity.Error : d.severity === 'info' ? DiagnosticSeverity.Information : DiagnosticSeverity.Warning,
    source,
    message: d.message,
  });
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [
      ...ownDiagnostics(analysis.result).map(toLsp('proschi')),
      // Findings on steps in imported files belong to those files.
      ...openApiFindings(document, analysis.diagram)
        .filter((d) => d.file === undefined)
        .map(toLsp('proschi-openapi')),
      ...simulationFindings(analysis.diagram).map(toLsp('proschi-test')),
    ],
  });
}

/** Failing requirements and tests; the simulation must never take the other diagnostics down with it. */
function simulationFindings(diagram: Analysis['diagram']) {
  try {
    return testDiagnostics(diagram);
  } catch (e) {
    connection.console.error(`Simulation failed: ${String(e)}`);
    return [];
  }
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

documents.onDidChangeContent(({ document }) => {
  validate(document);
  publishDependents(document.uri);
});

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
  // Dependents now read the file from disk again.
  publishDependents(document.uri);
});

const withDoc =
  <T>(fallback: T, fn: (analysis: Analysis, params: { position: { line: number; character: number } }) => T) =>
  (params: { textDocument: { uri: string }; position: { line: number; character: number } }): T => {
    const doc = documents.get(params.textDocument.uri);
    return doc ? fn(analysisOf(doc), params) : fallback;
  };

const COMPLETION_KIND = {
  keyword: CompletionItemKind.Keyword,
  node: CompletionItemKind.Variable,
  tech: CompletionItemKind.Class,
  type: CompletionItemKind.Interface,
  op: CompletionItemKind.Method,
  status: CompletionItemKind.Value,
  header: CompletionItemKind.Field,
  usecase: CompletionItemKind.Function,
  scenario: CompletionItemKind.Event,
  constant: CompletionItemKind.Constant,
};

connection.onCompletion(
  withDoc([], (analysis, { position }) =>
    complete(analysis, position).map((item) => ({
      label: item.label,
      kind: COMPLETION_KIND[item.kind],
      detail: item.detail,
      ...(item.documentation ? { documentation: { kind: MarkupKind.Markdown, value: item.documentation } } : {}),
      textEdit: { range: item.range, newText: item.snippet ?? item.insertText ?? item.label },
      ...(item.filterText ? { filterText: item.filterText } : {}),
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

/** The analysis of the file at `path`: its open document, else its text on disk (undefined when unreadable). */
function analysisAt(path: string): { uri: string; analysis: Analysis } | undefined {
  const open = documents.all().find((d) => pathOf(d.uri) === path);
  if (open) return { uri: open.uri, analysis: analysisOf(open) };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  return { uri: uriOf(path), analysis: analyze(text, { path, resolve: fileResolver({ entry: path, read: openText }) }) };
}

let warnedOverCap = false;

/**
 * The edits renaming `symbol` declared in `declared` (undefined: in `uri`)
 * everywhere outside `uri`: the declaring file, and every workspace file or
 * open document that imports it or has it as a system's team file, directly
 * or through other files. Unopened files are edited from their text on disk.
 * Remote declaring files (git, https, cloud) are not edited.
 */
function editsElsewhere(uri: string, symbol: RenameSymbol, newName: string, declared: string | undefined): Record<string, LspTextEdit[]> {
  const changes: Record<string, LspTextEdit[]> = {};
  if (declared !== undefined && !isAbsolute(declared)) return changes;
  const self = pathOf(uri);
  const home = declared ?? self;
  if (declared) {
    const there = analysisAt(declared);
    const edits = there ? renameEdits(there.analysis, symbol, newName) : [];
    if (there && edits.length) changes[there.uri] = edits;
  }
  if (!home) return changes;
  if (workspace.overCap && !warnedOverCap) {
    warnedOverCap = true;
    // A notification: not every client answers the showMessage request.
    void connection.sendNotification(ShowMessageNotification.type, {
      type: MessageType.Warning,
      message: `Proschi: the workspace has more than ${MAX_INDEXED_FILES} .proschi files, so rename and find references only search the open documents.`,
    });
  }
  const candidates = new Set([...workspace.dependents(home), ...documents.all().flatMap((d) => pathOf(d.uri) ?? [])]);
  for (const path of candidates) {
    if (path === home || path === self) continue;
    const found = analysisAt(path);
    if (!found || found.uri in changes) continue;
    const { analysis } = found;
    const uses = (analysis.result.imports ?? []).some((i) => i.resolved === home) || (analysis.diagram.systems ?? []).some((s) => s.resolved === home);
    if (!uses) continue;
    const edits = renameEdits(analysis, symbol, newName, home);
    if (edits.length) changes[found.uri] = edits;
  }
  return changes;
}

const toLocations = (changes: Record<string, LspTextEdit[]>): Location[] => Object.entries(changes).flatMap(([uri, edits]) => edits.map(({ range }) => ({ uri, range })));

/** Uses in the document, in the file that declares the symbol, and in every workspace file that uses that file. */
connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const analysis = analysisOf(doc);
  const target = symbolTarget(analysis, params.position);
  if (!target) return [];
  const own =
    target.symbol.kind === 'node' || target.symbol.kind === 'constant'
      ? references(analysis, params.position)
      : renameEdits(analysis, target.symbol, '', target.file).map((e) => e.range);
  return [...own.map((range) => ({ uri: doc.uri, range })), ...toLocations(editsElsewhere(doc.uri, target.symbol, '', target.file))];
});

connection.onPrepareRename(withDoc(null, (analysis, { position }) => renameTarget(analysis, position)));

/** Renames in the document and, through editsElsewhere, in every other workspace file that uses the symbol. */
connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const result = rename(analysisOf(doc), params.position, params.newName);
  if (!result) return null;
  if ('error' in result) throw new ResponseError(ErrorCodes.InvalidParams, result.error);
  // A constant is written with `$` but its name has none, as in the document's own edits.
  const newName = result.symbol.kind === 'constant' ? params.newName.replace(/^\$/, '') : params.newName;
  return { changes: { [params.textDocument.uri]: result.edits, ...editsElsewhere(params.textDocument.uri, result.symbol, newName, result.declaredIn) } };
});

const SYMBOL_KIND: Record<OutlineSymbol['kind'], SymbolKind> = {
  node: SymbolKind.Object,
  group: SymbolKind.Namespace,
  type: SymbolKind.Class,
  usecase: SymbolKind.Function,
  scenario: SymbolKind.Event,
  section: SymbolKind.Module,
  traffic: SymbolKind.Property,
  requirement: SymbolKind.Constant,
  entity: SymbolKind.Struct,
  decision: SymbolKind.Key,
  test: SymbolKind.Method,
};

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
  if (params.context.only && !params.context.only.some((k) => CodeActionKind.QuickFix.startsWith(k))) return [];
  for (const diagnostic of params.context.diagnostics) {
    const fix =
      diagnostic.source === 'proschi'
        ? typeof diagnostic.message === 'string' && quickFix(analysis, diagnostic.message, diagnostic.range)
        : diagnostic.source === 'proschi-test' && testQuickFix(analysis, diagnostic.range);
    if (!fix) continue;
    actions.push({
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      edit: { changes: { [params.textDocument.uri]: [fix.edit] } },
    });
  }
  for (const fix of cursorFixes(analysis, params.range)) {
    actions.push({ title: fix.title, kind: CodeActionKind.QuickFix, edit: { changes: { [params.textDocument.uri]: [fix.edit] } } });
  }
  return actions;
});

/** The simulation must never take the editor down with it: no hints or lenses when it fails. */
function simulated<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch (e) {
    connection.console.error(`Simulation failed: ${String(e)}`);
    return [];
  }
}

// `62% · $400/mo` after each node; a saturated node says so in its label.
connection.languages.inlayHint.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !show.inlayHints) return [];
  return simulated(() =>
    inlayHints(analysisOf(doc), params.range).map((h) => ({
      position: h.position,
      label: h.label,
      paddingLeft: true,
      ...(h.tooltip ? { tooltip: { kind: MarkupKind.Markdown, value: h.tooltip } } : {}),
    })),
  );
});

// Results only: the lenses carry no command to run.
connection.onCodeLens((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !show.codeLens) return [];
  return simulated(() => codeLenses(analysisOf(doc)).map((l) => ({ range: l.range, command: { title: l.title, command: '' } })));
});

// Each token as [deltaLine, deltaStart, length, type, modifiers], relative to the previous one.
connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  const data: number[] = [];
  let line = 0;
  let character = 0;
  for (const t of doc ? semanticTokens(analysisOf(doc)) : []) {
    data.push(t.line - line, t.line === line ? t.character - character : t.character, t.length, TOKEN_TYPES.indexOf(TOKEN_TYPE[t.kind]), 0);
    line = t.line;
    character = t.character;
  }
  return { data };
});

documents.listen(connection);
connection.listen();
