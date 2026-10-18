import { createContext, useContext, useSyncExternalStore } from 'react';

/** How long the packet takes to travel one step's edge. */
export const TRAVEL_MS = 1500;

/**
 * The packet's progress along the current step's edge, 0–100, ticked by
 * requestAnimationFrame. It lives outside React state so that a tick re-renders
 * only what reads it (the travelling packet, the progress bar), never the graph.
 */
export class PlaybackClock {
  private value = 0;
  private frame = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.value;

  private set(value: number) {
    if (value === this.value) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  /** Runs from `from` to 100. */
  start(from = 0) {
    this.stop();
    this.set(from);
    if (typeof requestAnimationFrame !== 'function') return this.set(100);
    const began = performance.now() - (from / 100) * TRAVEL_MS;
    const tick = (now: number) => {
      const value = Math.min(100, Math.max(0, ((now - began) / TRAVEL_MS) * 100));
      this.set(value);
      if (value < 100) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Carries on from where it was stopped, if the packet had not arrived. */
  resume() {
    if (this.value < 100) this.start(this.value);
  }

  stop() {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  reset() {
    this.stop();
    this.set(0);
  }
}

const idle = new PlaybackClock();
export const PlaybackClockContext = createContext<PlaybackClock>(idle);

/** The current progress, or what `select` makes of it; re-renders only when that changes. */
export function usePlaybackProgress<T = number>(select?: (progress: number) => T): T {
  const clock = useContext(PlaybackClockContext);
  const read = () => (select ? select(clock.get()) : (clock.get() as T));
  return useSyncExternalStore(clock.subscribe, read, read);
}
