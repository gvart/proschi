import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
  type ProtocolConnection,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol/node';

// Requirement and test findings over the real LSP connection.

const server = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.cjs', import.meta.url)), '--stdio']);
let connection: ProtocolConnection;
const published = new Map<string, PublishDiagnosticsParams[]>();

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

async function open(uri: string, text: string) {
  const diagnostics = nextDiagnostics(uri);
  await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'proschi', version: 1, text } });
  return (await diagnostics).diagnostics;
}

const hoverText = async (uri: string, line: number, character: number) =>
  ((await connection.sendRequest('textDocument/hover', { textDocument: { uri }, position: { line, character } })) as { contents: { value: string } }).contents.value;

beforeAll(async () => {
  connection = createProtocolConnection(new StreamMessageReader(server.stdout), new StreamMessageWriter(server.stdin));
  connection.onNotification('textDocument/publishDiagnostics', (p: PublishDiagnosticsParams) => {
    published.set(p.uri, [...(published.get(p.uri) ?? []), p]);
  });
  connection.listen();
  await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  await connection.sendNotification('initialized', {});
});

afterAll(async () => {
  await connection.sendRequest('shutdown');
  await connection.sendNotification('exit');
  connection.dispose();
  server.kill();
});

const ITEMS = `client [Actor]
api [REST API]
db [PostgreSQL]
client -> api
api -> db
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  db --> api : row
  api --> client : 200
}
`;

describe('language server: simulation', () => {
  it('adds nothing to documents without traffic, requirements or tests', async () => {
    const uri = 'file:///tmp/sim-plain.proschi';
    expect(await open(uri, ITEMS)).toEqual([]);
    expect(await hoverText(uri, 1, 1)).not.toContain('Load');
  });

  it('reports failing requirements and tests as warnings, and load in hovers', async () => {
    const uri = 'file:///tmp/sim-items.proschi';
    const text = `${ITEMS}traffic {
  "Read" 1k rps
}
requirements {
  p99 "Read" < 100ms
  survive any node failure
}
test "Reads answer 404" {
  "Read" responds 404
}
`;
    const found = (await open(uri, text)).filter((d) => d.source === 'proschi-test');
    expect(found.map((d) => [d.range.start.line, d.severity])).toEqual([
      [16, 2],
      [18, 2],
      [19, 2],
    ]);
    expect(found[0].message).toContain('survive any node failure: Losing api (REST API) breaks "Read"');
    expect(await hoverText(uri, 1, 1)).toContain('Load 1k rps of 2k rps (50% utilised)');
  });
});
