import { joinImportPath, mapResolver } from '../../../frontend/src/dsl/imports';
import { parse } from '../../../frontend/src/dsl/parser';
import type { Diagram, Diagnostic } from '../../../frontend/src/dsl/types';
import { encodeShareHash, type PlaybackTarget } from '../../../frontend/src/playground/share';
import { analyze, runTests, type TestResult } from '../../../frontend/src/sim';
import { analysisOverlay, type NodeOverlay } from '../../../frontend/src/sim/overlay';

/**
 * A Proschi document as the terminal view needs it: the diagram, its errors,
 * the simulation's per-node overlay and requirement results (when the
 * document has `traffic`), and the link that opens it in the web editor.
 */

export interface Source {
  source: string;
  /** The document's name, for resolving its imports. */
  path?: string;
  /** Imported files by the path the document's imports resolve to. */
  imports?: Record<string, string>;
}

export interface Document {
  diagram: Diagram;
  errors: Diagnostic[];
  overlay?: Record<string, NodeOverlay>;
  tests: TestResult[];
  /** The web editor's link to the document, opened at a playback step when given one. */
  link: (playback?: PlaybackTarget) => string;
}

export const EDITOR = 'https://proschi.app/app/';

export function parseSource({ source, path = 'diagram.proschi', imports = {} }: Source): { diagram: Diagram; errors: Diagnostic[] } {
  const result = parse(source, { path, resolve: mapResolver(imports) });
  return { diagram: result.diagram, errors: result.diagnostics.filter((d) => d.severity === 'error') };
}

export function loadDocument(input: Source): Document {
  const { diagram, errors } = parseSource(input);
  const simulated = errors.length === 0 && (diagram.traffic?.length ?? 0) > 0;
  const analysis = simulated ? analyze(diagram) : undefined;
  const imports = input.imports && Object.keys(input.imports).length ? input.imports : undefined;
  return {
    diagram,
    errors,
    ...(analysis ? { overlay: analysisOverlay(diagram, analysis).nodes } : {}),
    tests: analysis ? runTests(diagram, analysis) : [],
    link: (playback) => EDITOR + encodeShareHash(input.source, playback, imports),
  };
}

/** Import paths a document names that `imports` does not hold yet, resolved against `path`. */
export function missingImports(input: Source): string[] {
  const missing = new Set<string>();
  const imports = input.imports ?? {};
  const known = mapResolver(imports);
  parse(input.source, {
    path: input.path ?? 'diagram.proschi',
    resolve: (importPath, fromPath) => {
      const found = known(importPath, fromPath);
      if (!found) missing.add(joinImportPath(fromPath, importPath));
      return found;
    },
  });
  return [...missing];
}

/** A short stable key for a document's text and imports (FNV-1a). */
export function keyOf(input: Source): string {
  const text = input.source + '\u0000' + JSON.stringify(input.imports ?? {});
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}
