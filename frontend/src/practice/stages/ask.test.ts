import { describe, expect, it } from 'vitest';
import { MAX_QUOTE, quoteForPartner } from './ask';

describe('a selection quoted for Design partner', () => {
  it('quotes each line, drops blank ones, and leaves room for the question', () => {
    expect(quoteForPartner('  Redirects: 10k rps\n\n  95% hit the cache  ')).toBe('> Redirects: 10k rps\n> 95% hit the cache\n\n');
  });

  it('cuts a long selection', () => {
    const quote = quoteForPartner('x'.repeat(MAX_QUOTE + 50))!;
    expect(quote).toBe(`> ${'x'.repeat(MAX_QUOTE)}…\n\n`);
  });

  it('ignores a selection of spaces', () => {
    expect(quoteForPartner(' \n\t ')).toBeUndefined();
  });
});
