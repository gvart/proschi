// Bundles the CLI and language server (with the parser from frontend/src/dsl
// inlined), the VS Code extension, and regenerates the JSON Schema.
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
  define: { PROSCHI_VERSION: JSON.stringify(version) },
};

await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs', banner: { js: '#!/usr/bin/env node' } });
await build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/server.cjs', banner: { js: '#!/usr/bin/env node' } });
chmodSync('dist/cli.cjs', 0o755);
chmodSync('dist/server.cjs', 0o755);

// The schema module only needs the catalog; bundle it to a temp file and run it.
await build({ ...common, entryPoints: ['src/schema.ts'], outfile: 'dist/.schema.cjs' });
const { createRequire } = await import('node:module');
const { diagramSchema } = createRequire(import.meta.url)('./dist/.schema.cjs');
mkdirSync('schema', { recursive: true });
writeFileSync('schema/proschi-diagram.schema.json', JSON.stringify(diagramSchema(), null, 2) + '\n');
rmSync('dist/.schema.cjs');

// VS Code extension: its own client bundle (minified, as the preview carries ELK),
// plus copies of the server and grammar.
await build({ ...common, entryPoints: ['vscode/src/extension.ts'], outfile: 'vscode/dist/extension.cjs', external: ['vscode'], minify: true });
copyFileSync('dist/server.cjs', 'vscode/dist/server.cjs');
// Both packages ship the repository's license.
copyFileSync('../LICENSE', 'LICENSE');
copyFileSync('../LICENSE', 'vscode/LICENSE');
mkdirSync('vscode/syntaxes', { recursive: true });
copyFileSync('grammar/proschi.tmLanguage.json', 'vscode/syntaxes/proschi.tmLanguage.json');
