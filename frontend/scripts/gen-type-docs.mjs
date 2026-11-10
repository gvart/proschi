// Writes docs/types/*.md, the built-in type reference, from the stdlib
// (plugins/typeReference.ts). The docs build renders the same pages itself;
// these copies are for GitHub, and plugins/typeReference.test.ts fails when
// they are out of date. Run after `npm run gen:stdlib`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
// The stdlib's TypeScript imports have no extensions; Vite's module runner resolves them.
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
const { runnerImport } = await import('vite');
const { module } = await runnerImport(fileURLToPath(new URL('../plugins/typeReference.ts', import.meta.url)));
for (const [source, markdown] of module.typeReferencePages()) {
  mkdirSync(dirname(docs + source), { recursive: true });
  writeFileSync(docs + source, markdown);
}
