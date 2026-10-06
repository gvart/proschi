import { examples } from '../dsl/examples';
import { encodeShareHash, type PlaybackTarget } from '../playground/share';
import { exampleHref } from '../playground/exampleLink';

/** The editor, relative to the landing page (works under any sub-path). */
export const APP_PATH = './app/';

/** A link that opens `source` in the editor, optionally straight into playback. */
export function editorLink(source: string, playback?: PlaybackTarget): string {
  return APP_PATH + encodeShareHash(source, playback);
}

/** Editor link for one of the bundled examples (`./app/?example=<id>`), or null for an unknown id. */
export function exampleLink(id: string): string | null {
  return examples.some((e) => e.id === id) ? exampleHref(id, APP_PATH) : null;
}
