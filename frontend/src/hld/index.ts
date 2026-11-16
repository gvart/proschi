import type { Diagram } from '../dsl/types';
import { defaultEngine, type Engine } from './engine';
import { hld, type HldDocument } from './hld';

export * from './engine';
export * from './hld';
export { toMarkdown } from './markdown';
export { DEFAULT_HLD_PAGE, EXPORT_CSP, toHtml, type HldFigures, type HldPageTheme } from './html';

/** Runs the simulation (when there is one) and builds the HLD from its results. */
export function buildHld(diagram: Diagram, engine: Engine = defaultEngine): HldDocument {
  const analysis = engine.analyze(diagram);
  return hld(diagram, analysis, engine.runTests(diagram, analysis));
}
