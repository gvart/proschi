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
  expect(init).toMatchObject({ capabilities: { hoverProvider: true, definitionProvider: true, documentFormattingProvider: true }, serverInfo: { name: 'proschi-language-server' } });
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
      textDocument: { uri, languageId: 'proschi', version: 1, text: 'api [REST API]\napi [Redis]\ndb [Postgress]\napi -> db\n' },
    });
    const { diagnostics: found } = await opened;
    expect(found.map((d) => [d.range.start.line, d.severity, d.message])).toEqual([
      [1, 1, "Duplicate id 'api' (first declared on line 1)"],
      [2, 2, "Unknown tech stack 'Postgress'. Did you mean 'PostgreSQL'? Until then it is simulated as a generic database, like [Database]"],
    ]);
    expect(found[0]).toMatchObject({ source: 'proschi', range: { start: { character: 0 }, end: { character: 3 } } });

    // The unknown tech's quick fix puts the suggestion inside the brackets.
    const actions = (await connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri },
      range: found[1].range,
      context: { diagnostics: [found[1]] },
    })) as { title: string; edit: { changes: Record<string, { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]> } }[];
    expect(actions.map((a) => a.title)).toEqual(["Change to 'PostgreSQL'"]);
    expect(actions[0].edit.changes[uri]).toEqual([{ range: { start: { line: 2, character: 4 }, end: { line: 2, character: 13 } }, newText: 'PostgreSQL' }]);

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

  it('formats the whole document in one edit, or none when it is formatted', async () => {
    const formatUri = 'file:///tmp/format.proschi';
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: formatUri, languageId: 'proschi', version: 1, text: 'api [REST API]\ndatabase   [Redis]\n\n\napi->database:SQL\n' },
    });
    const params = { textDocument: { uri: formatUri }, options: { tabSize: 2, insertSpaces: true } };
    expect(await connection.sendRequest('textDocument/formatting', params)).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
        newText: 'api      [REST API]\ndatabase [Redis]\n\napi -> database : SQL\n',
      },
    ]);

    await connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: formatUri, version: 2 },
      contentChanges: [{ text: 'api [REST API]\n' }],
    });
    expect(await connection.sendRequest('textDocument/formatting', params)).toEqual([]);
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

  it('offers a quick fix that adds a missing connection', async () => {
    const flowUri = 'file:///tmp/flow.proschi';
    const text = 'web -> api\n\nusecase "Read" {\n  web -> api : GET /orders/1\n  api -> db : SELECT\n  api --> web : 200\n}\n';
    const opened = nextDiagnostics(flowUri);
    await connection.sendNotification('textDocument/didOpen', { textDocument: { uri: flowUri, languageId: 'proschi', version: 1, text } });
    const { diagnostics: found } = await opened;
    expect(found.map((d) => [d.range.start.line, d.severity, d.message])).toEqual([
      [4, 2, "No connection between 'api' and 'db' in the architecture; add 'api -> db'"],
    ]);

    const actions = (await connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri: flowUri },
      range: found[0].range,
      context: { diagnostics: found },
    })) as { title: string; kind: string; isPreferred: boolean; edit: { changes: Record<string, { range: { start: { line: number; character: number } }; newText: string }[]> } }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ title: "Add connection 'api -> db'", kind: 'quickfix', isPreferred: true });
    const [edit] = actions[0].edit.changes[flowUri];
    const lines = text.split('\n');
    const at = lines.slice(0, edit.range.start.line).reduce((n, l) => n + l.length + 1, 0) + edit.range.start.character;
    expect(text.slice(0, at) + edit.newText + text.slice(at)).toBe(text.replace('web -> api\n', 'web -> api\napi -> db\n'));

    // Other diagnostics have no quick fix.
    const none = await connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri: flowUri },
      range: found[0].range,
      context: { diagnostics: [{ ...found[0], message: 'Unmatched }' }] },
    });
    expect(none).toEqual([]);
  });

  it('answers semantic tokens for nodes, tech stacks and teams', async () => {
    const textDocument = { uri: 'file:///tmp/tokens.proschi', languageId: 'proschi', version: 1, text: 'api [REST API] @shop\ndb [Redis]\napi -> db : GET\n' };
    await connection.sendNotification('textDocument/didOpen', { textDocument });
    const { data } = (await connection.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: textDocument.uri } })) as { data: number[] };
    // [deltaLine, deltaStart, length, type, modifiers]; types: 0 variable (node), 1 type (tech), 2 decorator (team).
    expect(data).toEqual([0, 0, 3, 0, 0, 0, 4, 10, 1, 0, 0, 11, 5, 2, 0, 1, 0, 2, 0, 0, 0, 3, 7, 1, 0, 1, 0, 3, 0, 0, 0, 7, 2, 0, 0]);
  });
});
