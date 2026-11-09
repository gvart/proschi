import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
  type ProtocolConnection,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol/node';

// Multi-file documents over the real LSP connection, with the files on disk.
const server = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.cjs', import.meta.url)), '--stdio']);
let connection: ProtocolConnection;
const published = new Map<string, PublishDiagnosticsParams[]>();

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proschi-lsp-')));
const infraPath = join(dir, 'infra.proschi');
const infraText = 'title "Infra"\ngateway [AWS API Gateway]\norders [REST API] @Orders\ngateway -> orders\n';
writeFileSync(infraPath, infraText);
const infraUri = pathToFileURL(infraPath).href;
const shopUri = pathToFileURL(join(dir, 'shop.proschi')).href;
const shopText = 'import "infra.proschi"\nimport "nope.proschi"\nusecase "Order" {\n  gateway -> orders : POST /orders\n}\n';

function nextDiagnostics(uri: string): Promise<PublishDiagnosticsParams> {
  const seen = published.get(uri)?.length ?? 0;
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const list = published.get(uri) ?? [];
      if (list.length > seen) {
        clearInterval(timer);
        resolve(list[list.length - 1]);
      }
    }, 10);
  });
}

const messages = (p: PublishDiagnosticsParams) => p.diagnostics.map((d) => [d.range.start.line, d.message]);

beforeAll(async () => {
  connection = createProtocolConnection(new StreamMessageReader(server.stdout), new StreamMessageWriter(server.stdin));
  connection.onNotification('textDocument/publishDiagnostics', (p: PublishDiagnosticsParams) => {
    published.set(p.uri, [...(published.get(p.uri) ?? []), p]);
  });
  connection.listen();
  const init = await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  expect(init).toMatchObject({ capabilities: { documentLinkProvider: {} } });
  await connection.sendNotification('initialized', {});
});

afterAll(async () => {
  await connection.sendRequest('shutdown');
  await connection.sendNotification('exit');
  connection.dispose();
  server.kill();
});

describe('language server with imports', () => {
  it('resolves imports from disk and reports files it cannot find', async () => {
    const opened = nextDiagnostics(shopUri);
    await connection.sendNotification('textDocument/didOpen', { textDocument: { uri: shopUri, languageId: 'proschi', version: 1, text: shopText } });
    expect(messages(await opened)).toEqual([[1, "Cannot find 'nope.proschi'"]]);
  });

  it('completes, hovers and goes to definitions in imported files', async () => {
    const textDocument = { uri: shopUri };
    const completion = (await connection.sendRequest('textDocument/completion', { textDocument, position: { line: 3, character: 13 } })) as { label: string }[];
    expect(completion.map((c) => c.label)).toEqual(['gateway', 'orders']);

    const hover = (await connection.sendRequest('textDocument/hover', { textDocument, position: { line: 3, character: 15 } })) as { contents: { value: string } };
    expect(hover.contents.value).toContain('owned by @Orders');

    expect(await connection.sendRequest('textDocument/definition', { textDocument, position: { line: 3, character: 15 } })).toEqual({
      uri: infraUri,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } },
    });

    expect(await connection.sendRequest('textDocument/documentLink', { textDocument })).toEqual([
      { range: { start: { line: 0, character: 8 }, end: { line: 0, character: 21 } }, target: infraUri },
    ]);
  });

  it('uses the unsaved text of an open imported file and re-validates its dependents', async () => {
    const shopUpdate = nextDiagnostics(shopUri);
    const infraOpened = nextDiagnostics(infraUri);
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: infraUri, languageId: 'proschi', version: 1, text: `${infraText}orders [Redis]\ngroup g {\n` },
    });
    expect(messages(await infraOpened)).toEqual([
      [4, "Duplicate id 'orders' (first declared on line 3)"],
      [5, "Missing } to close group 'g'"],
    ]);
    expect(messages(await shopUpdate)).toEqual([
      [0, "'infra.proschi' has 2 errors"],
      [1, "Cannot find 'nope.proschi'"],
    ]);

    const fixed = nextDiagnostics(shopUri);
    await connection.sendNotification('textDocument/didChange', { textDocument: { uri: infraUri, version: 2 }, contentChanges: [{ text: infraText }] });
    expect(messages(await fixed)).toEqual([[1, "Cannot find 'nope.proschi'"]]);
  });

  it('reports OpenAPI findings only for steps in the document itself', async () => {
    const api = join(dir, 'api');
    mkdirSync(api);
    const spec = fileURLToPath(new URL('./fixtures/openapi/specs/orders-api.yaml', import.meta.url));
    writeFileSync(join(api, 'proschi.json'), JSON.stringify({ openapi: { orders: spec } }));
    writeFileSync(join(api, 'flows.proschi'), 'gateway [AWS API Gateway]\norders [REST API]\ngateway -> orders\nusecase "Imported typo" {\n  gateway -> orders : GET /ordres\n}\n');
    const uri = pathToFileURL(join(api, 'root.proschi')).href;
    const opened = nextDiagnostics(uri);
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'proschi', version: 1, text: 'import "flows.proschi"\nusecase "Own typo" {\n  gateway -> orders : GET /odrers\n}\n' },
    });
    const { diagnostics: found } = await opened;
    expect(found.map((d) => [d.range.start.line, d.source, String(d.message).split(':')[0]])).toEqual([[2, 'proschi-openapi', 'GET /odrers']]);
  });

  it('reads the file from disk again when the imported document closes', async () => {
    await connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: infraUri, version: 3 },
      contentChanges: [{ text: 'gateway [REST API]\n' }],
    });
    const before = (await connection.sendRequest('textDocument/hover', { textDocument: { uri: shopUri }, position: { line: 3, character: 4 } })) as { contents: { value: string } };
    expect(before.contents.value).toContain('`REST API`');

    const reverted = nextDiagnostics(shopUri);
    await connection.sendNotification('textDocument/didClose', { textDocument: { uri: infraUri } });
    await reverted;
    const after = (await connection.sendRequest('textDocument/hover', { textDocument: { uri: shopUri }, position: { line: 3, character: 4 } })) as { contents: { value: string } };
    expect(after.contents.value).toContain('`AWS API Gateway`');
  });

  it('renames a node in the document and in the imported file that declares it', async () => {
    const textDocument = { uri: shopUri };
    expect(await connection.sendRequest('textDocument/prepareRename', { textDocument, position: { line: 3, character: 15 } })).toEqual({
      range: { start: { line: 3, character: 13 }, end: { line: 3, character: 19 } },
      placeholder: 'orders',
    });
    const edit = (await connection.sendRequest('textDocument/rename', { textDocument, position: { line: 3, character: 15 }, newName: 'ordering' })) as {
      changes: Record<string, { range: { start: { line: number; character: number } }; newText: string }[]>;
    };
    expect(Object.keys(edit.changes).sort()).toEqual([infraUri, shopUri].sort());
    expect(edit.changes[shopUri].map((e) => [e.range.start.line, e.range.start.character, e.newText])).toEqual([[3, 13, 'ordering']]);
    expect(edit.changes[infraUri].map((e) => [e.range.start.line, e.range.start.character])).toEqual([
      [2, 0],
      [3, 11],
    ]);
    await expect(connection.sendRequest('textDocument/rename', { textDocument, position: { line: 3, character: 15 }, newName: 'gateway' })).rejects.toThrow(
      "There is already a node 'gateway'",
    );
  });

  it('renames in the open documents that import the declaring file', async () => {
    const infraOpened = nextDiagnostics(infraUri);
    await connection.sendNotification('textDocument/didOpen', { textDocument: { uri: infraUri, languageId: 'proschi', version: 10, text: infraText } });
    await infraOpened;
    // From the declaring file: its own uses, and those of shop.proschi, which is open and imports it.
    const edit = (await connection.sendRequest('textDocument/rename', { textDocument: { uri: infraUri }, position: { line: 2, character: 2 }, newName: 'ordering' })) as {
      changes: Record<string, { range: { start: { line: number; character: number } } }[]>;
    };
    expect(Object.keys(edit.changes).sort()).toEqual([infraUri, shopUri].sort());
    expect(edit.changes[infraUri].map((e) => [e.range.start.line, e.range.start.character])).toEqual([
      [2, 0],
      [3, 11],
    ]);
    expect(edit.changes[shopUri].map((e) => [e.range.start.line, e.range.start.character])).toEqual([[3, 13]]);

    // A use case declared in shop.proschi, renamed from a system's expose line in another open document.
    const teamUri = pathToFileURL(join(dir, 'platform.proschi')).href;
    const teamOpened = nextDiagnostics(teamUri);
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: teamUri, languageId: 'proschi', version: 1, text: 'system shop "Shop" {\n  from "shop.proschi"\n  expose gateway -> "Order"\n}\n' },
    });
    await teamOpened;
    const renamed = (await connection.sendRequest('textDocument/rename', { textDocument: { uri: teamUri }, position: { line: 2, character: 22 }, newName: 'Checkout' })) as {
      changes: Record<string, { range: { start: { line: number; character: number } }; newText: string }[]>;
    };
    expect(Object.keys(renamed.changes).sort()).toEqual([shopUri, teamUri].sort());
    expect(renamed.changes[teamUri].map((e) => [e.range.start.line, e.range.start.character, e.newText])).toEqual([[2, 21, 'Checkout']]);
    expect(renamed.changes[shopUri].map((e) => [e.range.start.line, e.range.start.character])).toEqual([[2, 9]]);
  });
});
