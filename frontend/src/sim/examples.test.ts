import { describe, expect, it } from 'vitest';
import { examples } from '../dsl/examples';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { runTests } from './tests';

/**
 * The bundled url-shortener example, parsed for real. As written it does not
 * hold up under its own traffic: 100k rps of redirects saturate the single
 * load balancer and the three API replicas (2k rps each), and with 9% cache
 * misses through PostgreSQL its p99 < 50 ms target is out of reach even at
 * idle (3 × ~18 ms). These tests pin that state so a change to the example or
 * the model shows up here; flip them to "everything passes" once the example
 * is fixed.
 */
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
    expect(results.map((r) => r.id).slice(0, 2)).toEqual(['req:1', 'req:2']);
  });

  it('applies traffic, replicas and capacity overrides', () => {
    expect(node('lb').loadRps).toBe(101_000);
    expect(node('api')).toMatchObject({ replicas: 3, capacityRps: 6000, loadRps: 101_000, saturated: true });
    // Every redirect reads the cache, misses write it back: 100k + 9k, on 2 × 150k.
    expect(node('cache')).toMatchObject({ replicas: 2, capacityRps: 300_000 });
    expect(node('cache').loadRps).toBeCloseTo(109_000);
    // Misses and unknown codes read the database, shortening writes it: 9k + 1k + 1k, on 2 × 8k.
    expect(node('db')).toMatchObject({ capacityRps: 16_000, latencyMs: expect.any(Number), costUsd: 900, durable: true });
    expect(node('db').loadRps).toBeCloseTo(11_000);
    expect(analysis.totalCostUsd).toBe(50 + 3 * 100 + 2 * 150 + 2 * 450);
  });

  it('passes its flow tests, durability, availability and cost, and fails on capacity', () => {
    expect(results.filter((r) => !r.passed).map((r) => r.name)).toEqual(['p99 of Redirect < 50 ms', 'p95 of every use case < 300 ms', 'survive any node failure']);
    expect(results.find((r) => r.name === 'p99 of Redirect < 50 ms')!.message).toBe(
      'p99 of Redirect: lb is saturated (101k rps of 100k rps, 101%) (limit 50 ms)',
    );
    expect(results.filter((r) => r.category === 'flow').every((r) => r.passed)).toBe(true);
  });
});
