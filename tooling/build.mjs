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
  jsx: 'automatic',
  define: { PROSCHI_VERSION: JSON.stringify(version) },
};

// The renderer pulls in frontend files that import these packages; take them from
// tooling/node_modules (one copy of React, and no need for frontend/node_modules).
const RENDER_PACKAGES = ['elkjs', 'react', 'react-dom', 'react-icons', 'lucide-react'];
const renderAlias = Object.fromEntries(RENDER_PACKAGES.map((p) => [p, `./node_modules/${p}`]));

// `proschi render` lives in dist/render.cjs, which cli.cjs loads only for that
// command, so check, parse, fmt and the language server stay small.
const externalRenderer = {
  name: 'external-renderer',
  setup(b) {
    b.onResolve({ filter: /^\.\/render\/command$/ }, () => ({ path: './render.cjs', external: true }));
  },
};
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs', banner: { js: '#!/usr/bin/env node' }, plugins: [externalRenderer] });
await build({ ...common, entryPoints: ['src/render/command.ts'], outfile: 'dist/render.cjs', alias: renderAlias, minify: true });
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

// VS Code extension: its own client bundle (minified, as the preview carries the renderer),
// plus copies of the server and grammar.
await build({ ...common, entryPoints: ['vscode/src/extension.ts'], outfile: 'vscode/dist/extension.cjs', external: ['vscode'], alias: renderAlias, minify: true });
copyFileSync('dist/server.cjs', 'vscode/dist/server.cjs');
// Both packages ship the repository's license.
copyFileSync('../LICENSE', 'LICENSE');
copyFileSync('../LICENSE', 'vscode/LICENSE');
mkdirSync('vscode/syntaxes', { recursive: true });
copyFileSync('grammar/proschi.tmLanguage.json', 'vscode/syntaxes/proschi.tmLanguage.json');
