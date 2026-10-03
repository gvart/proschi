import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
  type ProtocolConnection,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol/node';

// Drives the bundled server (dist/server.cjs, built by `pretest`) over stdio, like an editor would.
const server = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.cjs', import.meta.url)), '--stdio']);
let connection: ProtocolConnection;
const diagnostics = new Map<string, PublishDiagnosticsParams[]>();
const uri = 'file:///tmp/shop.proschi';

function nextDiagnostics(forUri: string): Promise<PublishDiagnosticsParams> {
  const seen = diagnostics.get(forUri)?.length ?? 0;
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const list = diagnostics.get(forUri) ?? [];
      if (list.length > seen) {
        clearInterval(timer);
        resolve(list[list.length - 1]);
      }
    }, 10);
  });
}

beforeAll(async () => {
  connection = createProtocolConnection(new StreamMessageReader(server.stdout), new StreamMessageWriter(server.stdin));
  connection.onNotification('textDocument/publishDiagnostics', (p: PublishDiagnosticsParams) => {
    diagnostics.set(p.uri, [...(diagnostics.get(p.uri) ?? []), p]);
  });
  connection.listen();
  const init = await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  expect(init).toMatchObject({ capabilities: { hoverProvider: true, definitionProvider: true }, serverInfo: { name: 'proschi-language-server' } });
  await connection.sendNotification('initialized', {});
});

afterAll(async () => {
  await connection.sendRequest('shutdown');
  await connection.sendNotification('exit');
  connection.dispose();
  server.kill();
});

describe('language server', () => {
  it('publishes the parser diagnostics when a file opens, and clears them when fixed', async () => {
    const opened = nextDiagnostics(uri);
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'proschi', version: 1, text: 'api [REST API]\napi [Redis]\ndb [Nope]\napi -> db\n' },
    });
    const { diagnostics: found } = await opened;
    expect(found.map((d) => [d.range.start.line, d.severity, d.message])).toEqual([
      [1, 1, "Duplicate id 'api' (first declared on line 1)"],
      [2, 2, "Unknown tech stack 'Nope'; drawing a Rectangle"],
    ]);
    expect(found[0]).toMatchObject({ source: 'proschi', range: { start: { character: 0 }, end: { character: 3 } } });

    const fixed = nextDiagnostics(uri);
    await connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: 'api [REST API]\ndb [Redis]\napi -> db\n' }],
    });
    expect((await fixed).diagnostics).toEqual([]);
  });

  it('answers completion, hover, definition, references and symbols', async () => {
    const textDocument = { uri };
    const completion = (await connection.sendRequest('textDocument/completion', { textDocument, position: { line: 2, character: 7 } })) as { label: string }[];
    expect(completion.map((c) => c.label)).toEqual(['api', 'db']);

    const hover = (await connection.sendRequest('textDocument/hover', { textDocument, position: { line: 2, character: 8 } })) as { contents: { value: string } };
    expect(hover.contents.value).toContain('`Redis`');

    expect(await connection.sendRequest('textDocument/definition', { textDocument, position: { line: 2, character: 8 } })).toEqual({
      uri,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
    });

    const refs = (await connection.sendRequest('textDocument/references', { textDocument, position: { line: 0, character: 1 }, context: { includeDeclaration: true } })) as unknown[];
    expect(refs).toHaveLength(2);

    const symbols = (await connection.sendRequest('textDocument/documentSymbol', { textDocument })) as { name: string }[];
    expect(symbols.map((s) => s.name)).toEqual(['api', 'db']);
  });

  it('reports OpenAPI findings for documents below a proschi.json', async () => {
    // The file need not exist: proschi.json is found from its directory.
    const specUri = pathToFileURL(fileURLToPath(new URL('./fixtures/openapi/unsaved.proschi', import.meta.url))).href;
    const opened = nextDiagnostics(specUri);
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: specUri, languageId: 'proschi', version: 1, text: 'usecase "U" {\n  gateway -> orders : GET /orders/42\n  orders --> gateway : 503\n}\n' },
    });
    const { diagnostics: found } = await opened;
    expect(found).toEqual([
      {
        range: { start: { line: 2, character: 2 }, end: { line: 2, character: 26 } },
        severity: 2,
        source: 'proschi-openapi',
        message: 'Status 503 is not documented for GET /orders/{orderId} (documented: 200, 4XX)',
      },
    ]);
  });
});
