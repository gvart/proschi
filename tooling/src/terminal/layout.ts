import { layoutGraph, type Layout } from '../../../frontend/src/dsl/autoLayout';
import { viewSource, type Source } from './document';

/** The documents laid out last, by what they are laid out from: ELK takes most of a call (≈2 s for a large design), so a worker lays each one out once. */
const laid = new Map<string, Promise<Layout>>();
const KEEP = 8;

/**
 * The browser's ELK layout of a document, as the view shows it: the raster
 * worker's `layout` answer, and what its pictures and the HLD's architecture
 * figure are drawn from. Kept for the last few documents; a failed layout is
 * not kept.
 */
export function layoutOf(input: Source): Promise<Layout> {
  const key = JSON.stringify([input.source, input.path, input.imports, input.view]);
  let done = laid.get(key);
  if (done) {
    laid.delete(key);
    laid.set(key, done);
    return done;
  }
  done = layoutGraph(viewSource(input).diagram);
  laid.set(key, done);
  done.catch(() => laid.delete(key));
  if (laid.size > KEEP) laid.delete(laid.keys().next().value!);
  return done;
}
