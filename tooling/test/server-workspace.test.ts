import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamMessageReader, StreamMessageWriter, createProtocolConnection, type ProtocolConnection } from 'vscode-languageserver-protocol/node';
import { WorkspaceIndex } from '../src/workspaceIndex';

type Edit = { range: { start: { line: number; character: number } }; newText: string };
type Changes = Record<string, Edit[]>;

/** A language server over stdio with `dir` as its workspace folder; `registrations` collects its dynamic registrations. */
async function startServer(dir: string) {
  const server: ChildProcess = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.cjs', import.meta.url)), '--stdio']);
  const connection: ProtocolConnection = createProtocolConnection(new StreamMessageReader(server.stdout!), new StreamMessageWriter(server.stdin!));
  const registrations: unknown[] = [];
  const warnings: string[] = [];
  connection.onRequest('client/registerCapability', (p: { registrations: unknown[] }) => {
    registrations.push(...p.registrations);
    return null;
  });
  connection.onNotification('window/showMessage', (p: { message: string }) => {
    warnings.push(p.message);
  });
  connection.listen();
  const folder = pathToFileURL(dir).href;
  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: folder,
    workspaceFolders: [{ uri: folder, name: 'workspace' }],
    capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
  });
  await connection.sendNotification('initialized', {});
  const stop = async () => {
    await connection.sendRequest('shutdown');
    await connection.sendNotification('exit');
    connection.dispose();
    server.kill();
  };
  return { connection, registrations, warnings, stop };
}

const spots = (edits: Edit[] | undefined) => (edits ?? []).map((e) => [e.range.start.line, e.range.start.character, e.newText]);

describe('rename and references across the workspace', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proschi-ws-')));
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return pathToFileURL(path).href;
  };
  writeFileSync(join(dir, 'proschi.json'), '{}\n');
  const infraText = 'title "Infra"\ngateway [AWS API Gateway]\norders [REST API] @Orders\ngateway -> orders\n';
  const infra = file('infra.proschi', infraText);
  const shopText = 'import "infra.proschi"\nusecase "Order" {\n  gateway -> orders : POST /orders\n}\n';
  const shop = file('shop.proschi', shopText);
  const other = file('sub/other.proschi', 'import "../infra.proschi"\nusecase "Pay" {\n  gateway -> orders : POST /pay\n}\n');
  // Through shop.proschi, which imports infra.proschi.
  const deep = file('deep.proschi', 'import "shop.proschi"\nusecase "Ship" {\n  gateway -> orders : POST /ship\n}\n');
  const team = file('team.proschi', 'system shop "Shop" {\n  from "shop.proschi"\n  expose gateway -> "Order"\n}\n');
  // Its own `orders`, and an importer the index skips.
  const unrelated = file('unrelated.proschi', 'orders [REST API]\nclient -> orders\n');
  const skipped = file('node_modules/pkg/x.proschi', 'import "../../infra.proschi"\nusecase "X" {\n  gateway -> orders : GET /x\n}\n');

  let lsp: Awaited<ReturnType<typeof startServer>>;
  const open = (uri: string, text: string) => lsp.connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'proschi', version: 1, text } });
  const rename = async (uri: string, line: number, character: number, newName: string) =>
    ((await lsp.connection.sendRequest('textDocument/rename', { textDocument: { uri }, position: { line, character }, newName })) as { changes: Changes }).changes;

  beforeAll(async () => {
    lsp = await startServer(dir);
  });
  afterAll(() => lsp.stop());

  it('watches .proschi files when the client supports dynamic registration', async () => {
    await expect.poll(() => lsp.registrations).toEqual([
      expect.objectContaining({ method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [{ globPattern: '**/*.proschi' }] } }),
    ]);
  });

  it('renames from the declaring file in unopened importers, read from disk', async () => {
    await open(infra, infraText);
    const changes = await rename(infra, 2, 2, 'ordering');
    expect(Object.keys(changes).sort()).toEqual([deep, infra, other, shop].sort());
    expect(spots(changes[infra])).toEqual([
      [2, 0, 'ordering'],
      [3, 11, 'ordering'],
    ]);
    expect(spots(changes[shop])).toEqual([[2, 13, 'ordering']]);
    expect(spots(changes[other])).toEqual([[2, 13, 'ordering']]);
    expect(spots(changes[deep])).toEqual([[2, 13, 'ordering']]);
    expect(changes[unrelated]).toBeUndefined();
    expect(changes[skipped]).toBeUndefined();
  });

  it('renames from an importer in the declaring file and the other unopened importers', async () => {
    await open(shop, shopText);
    const changes = await rename(shop, 2, 15, 'ordering');
    expect(Object.keys(changes).sort()).toEqual([deep, infra, other, shop].sort());
    expect(spots(changes[shop])).toEqual([[2, 13, 'ordering']]);
    expect(spots(changes[other])).toEqual([[2, 13, 'ordering']]);

    // A use case of shop.proschi follows into the unopened file that has shop.proschi as a system's team file.
    const renamed = await rename(shop, 1, 10, 'Checkout');
    expect(Object.keys(renamed).sort()).toEqual([shop, team].sort());
    expect(spots(renamed[team])).toEqual([[2, 21, 'Checkout']]);
  });

  it('finds references in unopened files', async () => {
    const refs = (await lsp.connection.sendRequest('textDocument/references', {
      textDocument: { uri: infra },
      position: { line: 2, character: 2 },
      context: { includeDeclaration: true },
    })) as { uri: string }[];
    expect(refs.map((r) => r.uri).sort()).toEqual([deep, infra, infra, other, shop].sort());
  });

  it('keeps the index fresh from watched-file events', async () => {
    const late = file('late.proschi', 'import "infra.proschi"\nusecase "Late" {\n  gateway -> orders : GET /late\n}\n');
    // The index was built before the file existed.
    expect(await rename(infra, 2, 2, 'ordering')).not.toHaveProperty([late]);
    await lsp.connection.sendNotification('workspace/didChangeWatchedFiles', { changes: [{ uri: late, type: 1 }] });
    expect(spots((await rename(infra, 2, 2, 'ordering'))[late])).toEqual([[2, 13, 'ordering']]);
  });
});

describe('a workspace over the cap', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proschi-ws-cap-')));
  writeFileSync(join(dir, 'proschi.json'), '{}\n');
  const infraText = 'orders [REST API]\n';
  const infraUri = pathToFileURL(join(dir, 'infra.proschi')).href;
  writeFileSync(join(dir, 'infra.proschi'), infraText);
  for (let i = 0; i < 2000; i++) writeFileSync(join(dir, `f${i}.proschi`), 'import "infra.proschi"\nclient -> orders\n');

  it('says so and searches only the open documents', async () => {
    const lsp = await startServer(dir);
    try {
      await lsp.connection.sendNotification('textDocument/didOpen', { textDocument: { uri: infraUri, languageId: 'proschi', version: 1, text: infraText } });
      const { changes } = (await lsp.connection.sendRequest('textDocument/rename', { textDocument: { uri: infraUri }, position: { line: 0, character: 1 }, newName: 'ordering' })) as {
        changes: Changes;
      };
      expect(Object.keys(changes)).toEqual([infraUri]);
      await expect.poll(() => lsp.warnings).toEqual([expect.stringContaining('more than 2000 .proschi files')]);
    } finally {
      await lsp.stop();
    }
  });
});

describe('WorkspaceIndex', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proschi-index-')));
  const write = (name: string, text: string) => {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  const a = write('a.proschi', 'x [REST API]\n');
  const b = write('b.proschi', 'import "a.proschi"\nimport "git:github.com/acme/p//a.proschi@v1"\n');
  const c = write('c/c.proschi', 'system s "S" {\n  from "../b.proschi"\n}\n');
  write('.git/d.proschi', 'import "../a.proschi"\n');
  write('dist/e.proschi', 'import "../a.proschi"\n');

  it('finds direct and indirect users, skipping node_modules, .git and dist', () => {
    expect(new WorkspaceIndex([dir]).dependents(a).sort()).toEqual([b, c].sort());
  });

  it('updates on changes and deletions after the first scan', () => {
    const index = new WorkspaceIndex([dir]);
    expect(index.dependents(b)).toEqual([c]);
    write('c/c.proschi', 'title "No longer"\n');
    index.changed(c, false);
    expect(index.dependents(a)).toEqual([b]);
    index.changed(b, true);
    expect(index.dependents(a)).toEqual([]);
    write('c/c.proschi', 'system s "S" {\n  from "../b.proschi"\n}\n');
  });

  it('is empty past the cap', () => {
    const index = new WorkspaceIndex([dir], 2);
    expect(index.overCap).toBe(true);
    expect(index.dependents(a)).toEqual([]);
  });
});
