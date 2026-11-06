import { useEffect, useState } from 'react';
import { getRoadmapNext, PICK_RETRY_MS, type RoadmapNext } from './api';

/**
 * The AI roadmap's picks for the page (GET /api/roadmap/next). The server
 * makes them after the verdict is answered, so while they are coming this
 * asks again at PICK_RETRY_MS (2, 5 and 10 s after the first ask), then
 * stops:
 *
 * - `interview`: the picks made after that verdict. `wait` (a verdict that
 *   just ended) asks again while there are none.
 * - no `interview`: the newest picks; while the server says a verdict's are
 *   still coming (`pending`), asks for those.
 *
 * `off`: no AI or no Pro on the server, so the page keeps the roadmap's order.
 * `picking`: still waiting. `ready` with `missed`: the wait ended without new
 * picks (`next` is then the older ones, or null).
 */
export type PicksState = { status: 'loading' | 'off' | 'picking' } | { status: 'ready'; next: RoadmapNext | null; missed?: boolean };

export function useRoadmapNext(enabled: boolean, opts: { interview?: string; wait?: boolean } = {}): PicksState {
  const { interview, wait = false } = opts;
  const [state, setState] = useState<PicksState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const started = Date.now();
    /** Asks for `id`'s picks at each retry; `fallback` is shown if none arrive. */
    const poll = (id: string, fallback: RoadmapNext | null, i = 0) => {
      if (i >= PICK_RETRY_MS.length) {
        setState({ status: 'ready', next: fallback, missed: true });
        return;
      }
      timers.push(
        setTimeout(
          () =>
            void getRoadmapNext(id).then((a) => {
              if (!live) return;
              if (a.status === 'ok' && a.data.next) setState({ status: 'ready', next: a.data.next });
              else poll(id, fallback, i + 1);
            }),
          Math.max(0, started + PICK_RETRY_MS[i] - Date.now()),
        ),
      );
    };
    void getRoadmapNext(interview).then((a) => {
      if (!live) return;
      if (a.status !== 'ok') return setState({ status: 'off' });
      const { next, pending } = a.data;
      const waitFor = interview ? (!next && wait ? interview : undefined) : pending;
      if (!waitFor) return setState({ status: 'ready', next });
      setState({ status: 'picking' });
      poll(waitFor, interview ? null : next);
    });
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
  }, [enabled, interview, wait]);
  return enabled ? state : { status: 'off' };
}
