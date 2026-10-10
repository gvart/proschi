import { useSyncExternalStore } from 'react';
import { lessonsRead, onLessonsRead } from './progress';

// One list per change, so the snapshot is stable between reads.
let cached: { key: string; ids: string[] } | undefined;

function snapshot(): string[] {
  const ids = lessonsRead();
  const key = ids.join(',');
  if (cached?.key !== key) cached = { key, ids };
  return cached.ids;
}

/** The lessons and guides read in this browser (progress.ts), updated as more are read. */
export function useLessonsRead(): string[] {
  return useSyncExternalStore(onLessonsRead, snapshot, snapshot);
}
