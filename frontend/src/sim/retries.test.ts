import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { format } from '../dsl/format';
import { analyze, expectedAttempts, retryVariants, type Retry } from './analyze';
import { criticalPath } from './flow';
import { runTests } from './tests';
import { runWhatIfs } from './whatif';

const shop = (extra = '', rps = '1k rps') => `
user [Browser]
api  [REST API] x4
pay  [Go] x2
user -> api
api -> pay
usecase "Pay" {
  user -> api : POST /pay
  api -> pay : charge
  api --> user : 201
}
traffic {
  "Pay" ${rps}
}
${extra}`;

const run = (source: string) => {
  const { diagram, diagnostics } = parse(source);
  const analysis = analyze(diagram);
  return { diagram, diagnostics, analysis, node: (id: string) => analysis.nodes.find((n) => n.id === id)!, pay: analysis.useCases[0] };
};

describe('retries and partial failure', () => {
  it('parses errors and retries in capacity, and errors in a what-if', () => {
    const { diagram, diagnostics } = parse(shop('capacity {\n  pay errors 2% retries 3\n}\nwhatif "Bad deploy" {\n  pay errors 20%\n}'));
    expect(diagnostics).toEqual([]);
    expect(diagram.capacity![0]).toMatchObject({ node: 'pay', errorPercent: 2, retries: 3 });
    expect(diagram.whatifs![0].changes).toMatchObject([{ kind: 'errors', node: 'pay', percent: 20 }]);
  });

  it('rejects an error rate over 100% and retries out of range', () => {
    const messages = (capacity: string) => parse(shop(`capacity {\n  ${capacity}\n}`)).diagnostics.map((d) => [d.severity, d.message]);
    expect(messages('pay errors 120%')).toEqual([['error', 'An error rate cannot be more than 100%']]);
    expect(messages('pay errors 2% retries 9')).toEqual([['error', 'Expected a whole number of retries from 0 to 5, e.g. retries 3']]);
    expect(messages('pay retries 1.5')).toEqual([['error', 'Expected a whole number of retries from 0 to 5, e.g. retries 3']]);
    expect(messages('pay errors 2% errors 3%')).toEqual([['error', "Errors is given twice for 'pay'"]]);
  });

  it('counts Σ e^k attempts for k = 0..retries', () => {
    expect(expectedAttempts(0.1, 0)).toBe(1);
    expect(expectedAttempts(0.1, 2)).toBeCloseTo(1.11, 12);
    expect(expectedAttempts(1, 3)).toBe(4);
  });

  it('multiplies the load on the callee by the attempts, not on the caller', () => {
    const plain = run(shop());
    const retried = run(shop('capacity {\n  pay errors 10% retries 2\n}'));
    expect(retried.node('pay').loadRps).toBeCloseTo(1110, 9);
    expect(retried.node('api').loadRps).toBe(plain.node('api').loadRps);
    expect(retried.node('pay').retry).toMatchObject({ errorRate: 0.1, retries: 2, stormRisk: false });
    expect(retried.node('pay').retry!.attempts).toBeCloseTo(1.11, 12);
    expect(retried.node('pay').retry!.success).toBeCloseTo(0.999, 12);
    expect(plain.node('pay').retry).toBeUndefined();
  });

  it('fails a call only when every attempt fails', () => {
    const plain = run(shop());
    const noRetry = run(shop('capacity {\n  pay errors 10%\n}'));
    const retried = run(shop('capacity {\n  pay errors 10% retries 2\n}'));
    expect(noRetry.pay.availability).toBeCloseTo(plain.pay.availability * 0.9, 12);
    expect(retried.pay.availability).toBeCloseTo(plain.pay.availability * 0.999, 12);
    // Errors without retries add no load and no latency.
    expect(noRetry.node('pay').loadRps).toBe(1000);
    expect(noRetry.pay.percentiles).toEqual(plain.pay.percentiles);
  });

  it('mixes a retry branch into the latency, weighted by its probability', () => {
    const plain = run(shop());
    const retried = run(shop('capacity {\n  pay errors 10% retries 2\n}'));
    const hop = retried.node('pay').latencyMs;
    // The mean grows by the expected extra attempts of the pay hop: 0.09 × 1 + 0.01 × 2.
    const extra = retried.pay.scenarios[0].meanMs - (plain.pay.scenarios[0].meanMs - plain.node('pay').latencyMs + hop);
    expect(extra).toBeCloseTo(hop * 0.11, 9);
    expect(retried.pay.percentiles.p99).toBeGreaterThan(plain.pay.percentiles.p99);
    expect(retried.pay.percentiles.p999).toBeGreaterThan(retried.pay.percentiles.p99);
  });

  it('splits a path into retry variants, the last one taking every attempt', () => {
    const { diagram } = parse(shop());
    const u = diagram.useCases[0];
    const retries = new Map<string, Retry>([['pay', { errorRate: 0.1, retries: 2, attempts: 1.11, success: 0.999 }]]);
    const variants = retryVariants(criticalPath(u, u.scenarios[0]), retries);
    expect(variants.map((v) => v.share)).toEqual([0.9, expect.closeTo(0.09, 12), expect.closeTo(0.01, 12)]);
    expect(variants.map((v) => v.hops.flat().find((h) => h.target === 'pay')!.attempts)).toEqual([undefined, 2, 3]);
  });

  it('warns about a retry storm when a node with retries runs hot', () => {
    const hot = run(shop('capacity {\n  pay 600 rps errors 5% retries 3\n}'));
    expect(hot.node('pay').retry!.stormRisk).toBe(true);
    expect(hot.analysis.warnings).toContain(
      "'pay' risks a retry storm: it runs at 88% with 5% errors and 3 retries. Once it saturates, more calls fail and each comes back up to 3 more times, up to 4k rps. Add capacity, retry less, or back off.",
    );
    expect(run(shop('capacity {\n  pay 600 rps errors 5%\n}')).node('pay').retry!.stormRisk).toBe(false);
  });

  it('takes a what-if error rate with the declared retries', () => {
    const { diagram } = parse(shop('capacity {\n  pay errors 1% retries 3\n}\nrequirements {\n  availability "Pay" >= 99.9%\n}\nwhatif "Bad deploy" {\n  pay errors 50%\n}'));
    const base = analyze(diagram);
    const [w] = runWhatIfs(diagram);
    expect(w.options.errorRates).toEqual(new Map([['pay', 50]]));
    expect(w.analysis.nodes.find((n) => n.id === 'pay')!.loadRps).toBeCloseTo(1875, 9);
    expect(w.analysis.useCases[0].availability).toBeLessThan(base.useCases[0].availability);
    expect(runTests(diagram, base)[0].passed).toBe(true);
    expect(w.passed).toBe(false);
  });

  it('formats the capacity and what-if lines as written', () => {
    const source = shop('capacity {\n  pay   errors 2%   retries 3\n}');
    expect(format(source)).toContain('  pay errors 2% retries 3');
  });
});
