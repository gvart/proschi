import * as path from 'node:path';
import { workspace, type ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { registerPreview } from './preview';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  registerPreview(context);
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
    // Sends proschi.inlayHints.enabled and proschi.codeLens.enabled to the server, now and on change.
    // Also sends changes to .proschi files, which keep the server's index for rename and find references fresh.
    synchronize: { configurationSection: 'proschi', fileEvents: workspace.createFileSystemWatcher('**/*.proschi') },
  };
  client = new LanguageClient('proschi', 'Proschi', serverOptions, clientOptions);
  await client.start();
}

export function deactivate() {
  return client?.stop();
}
