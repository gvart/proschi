import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TestPanel from './TestPanel';
import type { RunResult } from './workspace';

const result = (name: string, passed: boolean) => ({ id: `test:${name}`, name, category: 'latency' as const, passed, message: `${name} measured`, ...(passed ? {} : { hint: `fix ${name}` }) });

function render(run: RunResult): string {
  return renderToStaticMarkup(<TestPanel run={run} stale={false} diagnostics={[]} onRun={() => {}} onSelect={() => {}} community={<p>Solved by 1 of 2 who tried</p>} />);
}

describe('TestPanel', () => {
  it('lists failures with their fixes first, then the passing tests and how others did, both folded', () => {
    const html = render({ results: [result('Passing one', true), result('Failing one', false)], passed: 1, solved: false });
    const at = (text: string) => html.indexOf(text);
    expect(at('Fix: fix Failing one')).toBeGreaterThan(-1);
    expect(at('Failing one')).toBeLessThan(at('Passing one'));
    expect(at('Passing one')).toBeLessThan(at('Solved by 1 of 2'));
    expect(html).toMatch(/<details[^>]*><summary[^>]*>1 passing<\/summary>/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>How others did<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open[^>]*><summary[^>]*>How others did/);
  });

  it('opens how others did once solved', () => {
    const html = render({ results: [result('Passing one', true)], passed: 1, solved: true });
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>How others did/);
  });
});
