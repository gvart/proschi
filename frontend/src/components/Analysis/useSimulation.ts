import { useMemo } from 'react';
import type { Diagram } from '../../dsl';
import { analyze, runTests } from '../../sim';

/** Analysis and test results of the parsed diagram; both take milliseconds, so they run on every parse. */
export function useSimulation(diagram: Diagram) {
  const analysis = useMemo(() => analyze(diagram), [diagram]);
  const results = useMemo(() => runTests(diagram, analysis), [diagram, analysis]);
  return { analysis, results };
}
