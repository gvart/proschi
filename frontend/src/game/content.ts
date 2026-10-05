import { readContent, type ContentRead } from './engine/content';

/**
 * The game's content as the Arcade page bundles it: every file of
 * src/game/content except the scripted runs, which only the checks read.
 */
const files = import.meta.glob(['./content/**/*.md', './content/**/*.json', '!./content/scenarios/*/reference.json', '!./content/scenarios/*/wrong/*.json'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let cached: ContentRead | undefined;

/** The parsed content; `proschi game check` and the tests report errors, the page uses what parsed. */
export function gameContent(): ContentRead {
  cached ??= readContent(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace(/^\.\/content\//, ''), text])));
  return cached;
}
