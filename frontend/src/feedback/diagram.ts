import { useEffect } from 'react';

/**
 * The diagram the feedback dialog can attach: the page with one (the editor,
 * a practice problem) registers its source with useFeedbackDiagram, and the
 * dialog offers "Attach my current diagram" only while one is registered.
 */
let current: string | undefined;

export const currentDiagram = (): string | undefined => current;

/** Keeps `source` as the diagram feedback may attach while the calling component is mounted. */
export function useFeedbackDiagram(source: string): void {
  useEffect(() => {
    current = source;
  }, [source]);
  useEffect(
    () => () => {
      current = undefined;
    },
    [],
  );
}
