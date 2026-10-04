import { problemFromFiles, ProblemFolderError } from './problemFiles';
import type { Problem } from './types';

/**
 * One practice problem, fetched when it is opened: the practice page loads
 * only that folder's files, where catalog.ts bundles every problem.
 */

const files = import.meta.glob<string>(['./problems/*/*', './problems/*/wrong/*.proschi'], { query: '?raw', import: 'default' });

const cache = new Map<string, Promise<Problem | undefined>>();

/** The problem in folder `id`, or undefined when there is none or it cannot be read. Cached, so React's `use` gets the same promise. */
export function loadProblem(id: string): Promise<Problem | undefined> {
  let problem = cache.get(id);
  if (!problem) {
    problem = readFolder(id).catch((error) => {
      // A failed download (offline, or a newer deploy replaced the files); reloading the page tries again.
      console.error(`Could not load problem ${id}:`, error);
      return undefined;
    });
    cache.set(id, problem);
  }
  return problem;
}

async function readFolder(id: string): Promise<Problem | undefined> {
  const prefix = `./problems/${id}/`;
  const entries = Object.entries(files).filter(([path]) => path.startsWith(prefix));
  if (entries.length === 0) return undefined;
  const loaded = await Promise.all(entries.map(async ([path, load]) => [path.slice(prefix.length), await load()] as const));
  try {
    return problemFromFiles(id, Object.fromEntries(loaded));
  } catch (e) {
    if (e instanceof ProblemFolderError) return undefined;
    throw e;
  }
}
