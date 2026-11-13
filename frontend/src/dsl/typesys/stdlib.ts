import { STDLIB_SOURCES } from '../stdlib/sources.gen';
import type { Diagnostic } from '../types';
import { resolveTypes, type TypeResolution } from './resolve';
import type { TypeDecl } from './types';

/** Reads the type blocks of one file; the parser's `parseTypeDecls`. */
export type TypeDeclReader = (source: string, path: string) => { decls: TypeDecl[]; diagnostics: Diagnostic[] };

let cached: TypeResolution | undefined;

/**
 * The built-in types: every stdlib file read with `read`, resolved together,
 * once per process. Their diagnostics should be empty (stdlib.test.ts); they
 * are kept here rather than shown to users, whose files they are not.
 */
export function loadStdlib(read: TypeDeclReader): TypeResolution {
  if (!cached) {
    const files = STDLIB_SOURCES.map(({ source, path }) => read(source, path));
    const resolution = resolveTypes(files.flatMap((f) => f.decls.map((d) => ({ ...d, builtin: true }))));
    cached = { ...resolution, diagnostics: [...files.flatMap((f) => f.diagnostics), ...resolution.diagnostics] };
  }
  return cached;
}
