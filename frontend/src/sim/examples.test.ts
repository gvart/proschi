import { describe, expect, it } from 'vitest';
import { examples } from '../dsl/examples';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { runTests } from './tests';

/** The bundled url-shortener example, parsed for real, holds up under its own traffic. */
describe('bundled url-shortener example', () => {
  const source = examples.find((e) => e.id === 'url-shortener')!.source;
  const { diagram, diagnostics } = parse(source);
  const analysis = analyze(diagram);
  const results = runTests(diagram, analysis);
  const node = (id: string) => analysis.nodes.find((n) => n.id === id)!;

  it('parses cleanly and yields one result per requirement and test', () => {
    expect(diagnostics).toEqual([]);
    expect(diagram.traffic).toHaveLength(2);
    expect(results).toHaveLength(diagram.requirements!.length + diagram.tests!.length);
  });

  it('applies traffic, replicas and capacity overrides', () => {
    // 100k redirects + 1k shortens enter through the load balancer and the API.
    expect(node('lb')).toMatchObject({ replicas: 3, capacityRps: 300_000, loadRps: 101_000 });
    expect(node('api')).toMatchObject({ replicas: 12, capacityRps: 240_000, loadRps: 101_000 });
    expect(node('api').latencyMs).toBeCloseTo(4 / (1 - 101_000 / 240_000));
    // Every redirect reads the cache, misses write it back: 100k + 9k, on 2 × 150k.
    expect(node('cache').capacityRps).toBe(300_000);
    expect(node('cache').loadRps).toBeCloseTo(109_000);
    // Misses and unknown codes read the database, shortening writes it: 9k + 1k + 1k, on 3 × 8k.
    // `capacity { db 8k rps }` sets reads and writes; PostgreSQL writes go to one primary (§7.2):
    // reads 10k on 3 × 8k, writes 1k on 8k; the busier side (reads, 41.7%) sets the utilisation.
    expect(node('db')).toMatchObject({ replicas: 3, readCapacityRps: 24_000, writeCapacityRps: 8000, readLoadRps: 10_000, writeLoadRps: 1000, costUsd: 1350, durable: true });
    expect(node('db').utilization).toBeCloseTo(10_000 / 24_000);
    expect(node('db').capacityRps).toBeCloseTo(11_000 / (10_000 / 24_000));
    expect(node('db').loadRps).toBeCloseTo(11_000);
    expect(analysis.totalCostUsd).toBe(3 * 50 + 12 * 100 + 2 * 150 + 3 * 450);
  });

  it('sets p99 by the cache-miss path', () => {
    const redirect = analysis.useCases.find((u) => u.name === 'Redirect')!;
    const miss = redirect.scenarios.find((s) => s.name === 'Cache miss')!;
    expect(miss.share).toBeCloseTo(0.09);
    expect(redirect.percentiles.p99).toBeCloseTo(miss.percentiles.p99);
    expect(redirect.percentiles.p99).toBeLessThan(100);
  });

  it('passes every one of its own requirements and tests, with no saturation or single point of failure', () => {
    expect(results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.message}`)).toEqual([]);
    expect(analysis.nodes.filter((n) => n.saturated)).toEqual([]);
    expect(analysis.singlePointsOfFailure).toEqual([]);
    expect(analysis.warnings).toEqual([]);
  });
});
