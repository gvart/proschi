import { describe, expect, it } from 'vitest';
import { formatAvailability, formatMs, formatPercent, formatRps, formatUsd } from './format';

describe('formatting', () => {
  it('formats rates with magnitudes', () => {
    expect([0.5, 950, 1000, 12_500, 100_000, 2_500_000, Infinity].map(formatRps)).toEqual(['0.5 rps', '950 rps', '1k rps', '12.5k rps', '100k rps', '2.5m rps', '∞ rps']);
  });

  it('formats durations with one decimal below 100 ms', () => {
    expect([4.25, 41, 78.75, 1200.4].map(formatMs)).toEqual(['4.3 ms', '41 ms', '78.8 ms', '1200 ms']);
  });

  it('shows enough nines to tell availability apart from the next limit, rounding down', () => {
    expect([1, 0.995, 0.9995, 0.99945, 0.999993, 0.9945025].map(formatAvailability)).toEqual(['100%', '99.5%', '99.95%', '99.945%', '99.9993%', '99.45%']);
  });

  it('formats utilisation and cost', () => {
    expect(formatPercent(0.734)).toBe('73%');
    expect(formatUsd(3250)).toBe('$3,250/month');
  });
});
