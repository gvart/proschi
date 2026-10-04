import type { ElkNode } from 'elkjs/lib/elk-api';
// elkjs ships its engine as a ready-made classic worker script; Vite copies it as is.
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { ElkInstance } from './autoLayout';

/**
 * ELK in a Web Worker, so its 1.5 MB script is parsed and every layout runs off
 * the main thread. The worker is started on the first layout, not on page load.
 */

/** The worker could not start (e.g. blocked); layout.ts then falls back to ELK on the main thread. */
export class ElkWorkerUnavailable extends Error {
  constructor(cause: unknown) {
    super('The ELK layout worker could not start', { cause });
    this.name = 'ElkWorkerUnavailable';
  }
}

let instance: Promise<ElkInstance> | undefined;

export function workerElk(): Promise<ElkInstance> {
  instance ??= import('elkjs/lib/elk-api.js').then(({ default: ELK }) => {
    let fail: (reason: unknown) => void = () => {};
    // Rejects once the worker fails; raced against every layout so none hangs forever.
    const failed = new Promise<never>((_, reject) => {
      fail = (reason) => reject(new ElkWorkerUnavailable(reason));
    });
    failed.catch(() => {});
    const elk = new ELK({
      workerUrl: elkWorkerUrl,
      workerFactory: (url) => {
        const worker = new Worker(url ?? elkWorkerUrl);
        worker.addEventListener('error', (event) => fail(event.message || event));
        return worker;
      },
    });
    return { layout: (graph: ElkNode) => Promise.race([elk.layout(graph), failed]) };
  });
  return instance;
}
