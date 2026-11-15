import { useMemo } from 'react';
import type { Diagram } from '../../dsl';
import { analyze, runTests, type Analysis, type AnalyzeOptions, type TestResult } from '../../sim';

/** Analysis and test results of the parsed diagram; both take milliseconds, so they run on every parse. */
export function useSimulation(diagram: Diagram) {
  const analysis = useMemo(() => analyze(diagram), [diagram]);
  const results = useMemo(() => runTests(diagram, analysis), [diagram, analysis]);
  return useMemo(() => ({ analysis, results }), [analysis, results]);
}

/** The diagram analysed under a what-if's options (components/WhatIf); `base` itself without any. */
export function useWhatIfSimulation(diagram: Diagram, base: { analysis: Analysis; results: TestResult[] }, options: AnalyzeOptions | undefined) {
  return useMemo(() => {
    if (!options) return base;
    const analysis = analyze(diagram, options);
    return { analysis, results: runTests(diagram, analysis, options) };
  }, [diagram, base, options]);
}
