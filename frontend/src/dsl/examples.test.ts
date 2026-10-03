import { describe, expect, it } from 'vitest';
import { examples, parse } from './index';

describe('examples', () => {
  it.each(examples.map((e) => [e.name, e.source]))('%s parses cleanly and has a playable use case', (_name, source) => {
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(diagram.title).toBeTruthy();
    expect(diagram.useCases[0]?.steps.length).toBeGreaterThan(0);
    expect(diagram.nodes.every((n) => !n.implicit)).toBe(true);
  });

  it('have unique ids', () => {
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length);
  });
});
