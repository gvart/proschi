import { describe, expect, it } from 'vitest';
import { tokenizeLine } from './lexer';
import { parseQuantity } from './quantity';

const tokens = (line: string) => tokenizeLine(line, 1).tokens.map((t) => [t.kind, t.value, t.length]);

describe('quantity tokens', () => {
  it('reads a number with an attached or separated unit as one token', () => {
    expect(tokens('50ms 99.9% 100krps')).toEqual([
      ['quantity', '50ms', 4],
      ['quantity', '99.9%', 5],
      ['quantity', '100krps', 7],
    ]);
    expect(tokens('100k rps 50 ms 99.9 % 3000 usd/month 3000usd/month')).toEqual([
      ['quantity', '100krps', 8],
      ['quantity', '50ms', 5],
      ['quantity', '99.9%', 6],
      ['quantity', '3000usd/month', 14],
      ['quantity', '3000usd/month', 13],
    ]);
  });

  it('keeps plain integers as numbers, so positions read as before', () => {
    expect(tokens('pos 10,-20')).toEqual([
      ['ident', 'pos', 3],
      ['number', '10', 2],
      ['comma', ',', 1],
      ['number', '-20', 3],
    ]);
    expect(tokens('pos 10 , 20')).toEqual([
      ['ident', 'pos', 3],
      ['number', '10', 2],
      ['comma', ',', 1],
      ['number', '20', 2],
    ]);
  });

  it('reads decimals and magnitudes as quantities', () => {
    expect(tokens('2.5 100k 4xx')).toEqual([
      ['quantity', '2.5', 3],
      ['quantity', '100k', 4],
      ['quantity', '4xx', 3],
    ]);
  });

  it('only joins a separated word that is a unit', () => {
    expect(tokens('100 apples')).toEqual([
      ['number', '100', 3],
      ['ident', 'apples', 6],
    ]);
    expect(tokens('10 msx')).toEqual([
      ['number', '10', 2],
      ['ident', 'msx', 3],
    ]);
    // A unit already attached takes no second one.
    expect(tokens('50ms s')).toEqual([
      ['quantity', '50ms', 4],
      ['ident', 's', 1],
    ]);
  });

  it('reads comparison operators', () => {
    expect(tokens('< <= > >=')).toEqual([
      ['op', '<', 1],
      ['op', '<=', 2],
      ['op', '>', 1],
      ['op', '>=', 2],
    ]);
  });

  it('still rejects a stray dot', () => {
    expect(tokenizeLine('a 1.', 1).diagnostics).toEqual([expect.objectContaining({ message: "Unexpected character '.'" })]);
  });
});

describe('parseQuantity', () => {
  it('normalises rates to requests per second', () => {
    expect(parseQuantity('100krps')).toEqual({ value: 100_000, unit: 'rps' });
    expect(parseQuantity('6krpm')).toEqual({ value: 100, unit: 'rps' });
    expect(parseQuantity('864krpd')).toEqual({ value: 10, unit: 'rps' });
    expect(parseQuantity('2mrps')).toEqual({ value: 2_000_000, unit: 'rps' });
    expect(parseQuantity('1brpd')).toEqual({ value: Number((1e9 / 86_400).toPrecision(12)), unit: 'rps' });
  });

  it('normalises durations to milliseconds; ms is never mega-seconds', () => {
    expect(parseQuantity('50ms')).toEqual({ value: 50, unit: 'ms' });
    expect(parseQuantity('1.5s')).toEqual({ value: 1500, unit: 'ms' });
  });

  it('reads percentages, costs and plain numbers', () => {
    expect(parseQuantity('99.95%')).toEqual({ value: 99.95, unit: '%' });
    expect(parseQuantity('3000usd/month')).toEqual({ value: 3000, unit: 'usd/month' });
    expect(parseQuantity('1.2kusd/month')).toEqual({ value: 1200, unit: 'usd/month' });
    expect(parseQuantity('42')).toEqual({ value: 42 });
    expect(parseQuantity('1.15k')).toEqual({ value: 1150 });
  });

  it('names an unknown unit', () => {
    expect(parseQuantity('5xyz')).toEqual({ error: expect.stringContaining("Unknown unit 'xyz'") });
    expect(parseQuantity('5Ms')).toEqual({ error: expect.stringContaining("Unknown unit 'Ms'") });
    expect(parseQuantity('5toString')).toEqual({ error: expect.stringContaining('Unknown unit') });
  });
});
