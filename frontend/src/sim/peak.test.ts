import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { runTests } from './tests';
import { runWhatIfs } from './whatif';
import { formatTraffic } from './format';

const design = (traffic: string) => `
user  [Browser]
api   [REST API] x8
user -> api
usecase "Download" {
  user -> api : ~1MB GET /file
}
traffic {
  "Download" ${traffic}
}
requirements {
  p99 "Download" < 200ms
}
whatif "Launch" {
  traffic "Download" x2
}
`;

const run = (traffic: string) => {
  const { diagram, diagnostics } = parse(design(traffic));
  expect(diagnostics).toEqual([]);
  const analysis = analyze(diagram);
  return { diagram, analysis, api: analysis.nodes.find((n) => n.id === 'api')!, tests: runTests(diagram, analysis) };
};

describe('peak traffic', () => {
  it('parses peak x3 and peak <rate>: the rate is the average, rps the peak', () => {
    expect(parse(design('20k rps peak x3')).diagram.traffic![0]).toMatchObject({ rps: 60_000, avgRps: 20_000 });
    expect(parse(design('20k rps peak 50k rps')).diagram.traffic![0]).toMatchObject({ rps: 50_000, avgRps: 20_000 });
    expect(parse(`let burst = 2.5\n${design('2k rps peak x$burst')}`).diagram.traffic![0]).toMatchObject({ rps: 5000, avgRps: 2000 });
    expect('avgRps' in parse(design('20k rps')).diagram.traffic![0]).toBe(false);
  });

  it('takes a peak with a mix after it', () => {
    const { diagram, diagnostics } = parse(design('1k rps peak x2 mix "Download" 100%'));
    expect(diagnostics).toEqual([]);
    expect(diagram.traffic![0]).toMatchObject({ rps: 2000, avgRps: 1000, mix: [{ scenario: 'Download', share: 1 }] });
  });

  it('rejects a peak below the average and a missing peak', () => {
    const errors = (traffic: string) => parse(design(traffic)).diagnostics.map((d) => d.message);
    expect(errors('20k rps peak 10k rps')).toEqual(['The peak cannot be below the average, 20,000 rps']);
    expect(errors('20k rps peak x0.5')).toEqual(['The peak cannot be below the average, 20,000 rps']);
    expect(errors('20k rps peak')).toEqual(['Expected the peak after peak, as a multiple of the average (peak x3) or a rate (peak 60k rps)']);
    expect(errors('20k rps peak 5ms')).toEqual(["Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd, not '5ms'"]);
  });

  it('loads the design with the peak, and costs egress at the average', () => {
    const peak = run('2k rps peak x3');
    const flatPeak = run('6k rps');
    const flatAverage = run('2k rps');
    // Capacity, utilisation, latency and requirements: as at a flat 6k rps.
    expect(peak.api.loadRps).toBe(6000);
    expect(peak.api.utilization).toBe(flatPeak.api.utilization);
    expect(peak.analysis.useCases[0].percentiles).toEqual(flatPeak.analysis.useCases[0].percentiles);
    expect(peak.tests).toEqual(flatPeak.tests);
    // Egress, and so the bill: as at a flat 2k rps.
    expect(peak.api.egressGbPerMonth).toBe(flatAverage.api.egressGbPerMonth);
    expect(peak.analysis.totalCostUsd).toBe(flatAverage.analysis.totalCostUsd);
    expect(peak.analysis.totalCostUsd).toBeLessThan(flatPeak.analysis.totalCostUsd);
    expect(peak.analysis.useCases[0]).toMatchObject({ rps: 6000, avgRps: 2000 });
    expect('avgRps' in flatPeak.analysis.useCases[0]).toBe(false);
  });

  it('keeps the profile in a what-if: x2 doubles both the peak and the average', () => {
    const [launch] = runWhatIfs(run('2k rps peak x3').diagram);
    const [flat] = runWhatIfs(run('6k rps').diagram);
    expect(launch.analysis.useCases[0]).toMatchObject({ rps: 12_000, avgRps: 4000 });
    expect(launch.analysis.nodes[1].utilization).toBe(flat.analysis.nodes[1].utilization);
    expect(launch.analysis.totalEgressUsd).toBeCloseTo(run('4k rps').analysis.totalEgressUsd, 9);
  });

  it('formats both rates', () => {
    expect(formatTraffic(60_000, 20_000)).toBe('avg 20k · peak 60k rps');
    expect(formatTraffic(60_000)).toBe('60k rps');
    expect(formatTraffic(500, 500)).toBe('500 rps');
  });
});
