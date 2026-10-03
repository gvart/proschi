import * as path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  const module = context.asAbsolutePath(path.join('dist', 'server.cjs'));
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'proschi' },
      { scheme: 'untitled', language: 'proschi' },
    ],
  };
  client = new LanguageClient('proschi', 'Proschi', serverOptions, clientOptions);
  await client.start();
}

export function deactivate() {
  return client?.stop();
}
