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

describe('TestPanel before the first run', () => {
  const warning = { severity: 'warning' as const, message: "Unknown use case 'Say hello'", line: 3, col: 1, length: 9 };

  it('stays quiet: no diagnostics until the tests have run', () => {
    const html = renderToStaticMarkup(<TestPanel stale={false} diagnostics={[warning]} onRun={() => {}} onSelect={() => {}} />);
    expect(html).toContain('Run tests');
    expect(html).not.toContain('Unknown use case');
  });

  it('lists the diagnostics after a run', () => {
    const html = renderToStaticMarkup(<TestPanel run={{ results: [], passed: 0, solved: false }} stale={false} diagnostics={[warning]} onRun={() => {}} onSelect={() => {}} />);
    expect(html).toContain('Unknown use case');
  });

  it('folded, shows its bar with a toggle and hides the results', () => {
    const html = renderToStaticMarkup(<TestPanel stale={false} diagnostics={[]} onRun={() => {}} onSelect={() => {}} collapsed onToggle={() => {}} />);
    expect(html).toMatch(/aria-expanded="false" aria-label="Show the test results"/);
    expect(html).toMatch(/<div class="[^"]*\bhidden\b[^"]*"><div[^>]*><p[^>]*>Run the tests/);
  });
});

describe('TestPanel while running', () => {
  it('spins and disables the button, says so, and dims the last results', () => {
    const html = renderToStaticMarkup(<TestPanel run={{ results: [result('Passing one', true)], passed: 1, solved: false }} running stale={false} diagnostics={[]} onRun={() => {}} onSelect={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>.*?Run tests<\/button>/);
    expect(html).toContain('Running the tests against the simulation');
    expect(html).toMatch(/class="pointer-events-none opacity-40[^"]*"/);
    expect(html).toContain('Passing one');
  });
});
