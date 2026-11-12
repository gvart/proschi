import { layoutGraph, type Layout } from '../../../frontend/src/dsl/autoLayout';
import { viewSource, type Source } from './document';

/** The browser's ELK layout of a document, as the view shows it: what layout.cjs writes, and the raster worker's `layout` answer. */
export function layoutOf(input: Source): Promise<Layout> {
  return layoutGraph(viewSource(input).diagram);
}
