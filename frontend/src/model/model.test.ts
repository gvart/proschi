import { describe, expect, it } from 'vitest';
import modelHtml from '../../model/index.html?raw';
import { parse } from '../dsl/parser';
import { pinResolver } from './pins';

/**
 * The "How the simulation works" page states the model's numbers as plain
 * text. These tests recompute every one of them (see pins.ts) and parse every
 * worked example, so a change to the simulation that the page does not follow
 * fails here.
 */

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Worked examples by id; one with `data-extends` is its base's source followed by its own. */
function examplesOf(html: string): Map<string, string> {
  const raw = new Map<string, { source: string; base?: string }>();
  for (const m of html.matchAll(/(<pre\b[^>]*\bdata-example="[^"]*"[^>]*>)<code>([\s\S]*?)<\/code><\/pre>/g)) {
    raw.set(attr(m[1], 'data-example')!, { source: decodeEntities(m[2]), base: attr(m[1], 'data-extends') });
  }
  const resolved = new Map<string, string>();
  const resolve = (id: string): string => {
    const entry = raw.get(id);
    if (!entry) throw new Error(`No example ${id}`);
    return entry.base ? `${resolve(entry.base)}\n\n${entry.source}` : entry.source;
  };
  for (const id of raw.keys()) resolved.set(id, resolve(id));
  return resolved;
}

/** Every pinned element: its pin and its text, tags stripped. */
function pinsOf(html: string): { pin: string; text: string }[] {
  return [...html.matchAll(/<(\w+)\b([^>]*\bdata-pin="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    pin: decodeEntities(m[3]),
    text: decodeEntities(m[4].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
  }));
}

const examples = examplesOf(modelHtml);
const pins = pinsOf(modelHtml);

describe('simulation page', () => {
  it('has the worked examples', () => {
    expect([...examples.keys()].sort()).toEqual(['feed', 'orders', 'orders-sharded', 'photos-api', 'photos-cdn']);
  });

  it.each([...examples])('example %s parses without diagnostics', (_, source) => {
    expect(parse(source).diagnostics).toEqual([]);
  });

  it('pins its numbers', () => {
    expect(pins.length).toBeGreaterThan(200);
    // Every pin is checked by the next test; this guards against the regex silently matching nothing.
    expect(new Set(pins.map((p) => p.pin.split('|')[0]))).toEqual(new Set(['const', 'profile', ...examples.keys()]));
  });

  it('states every number as the simulation computes it', () => {
    const resolve = pinResolver(examples);
    const wrong = pins.map(({ pin, text }) => ({ pin, text, expected: resolve(pin) })).filter((p) => p.text !== p.expected);
    expect(wrong).toEqual([]);
  });

  it('keeps the landing page’s content security policy', () => {
    const csp = (html: string) => /http-equiv="%VITE_CSP_HTTP_EQUIV%"\s+content="([^"]+)"/.exec(html)?.[1];
    return import('../../index.html?raw').then(({ default: landing }) => {
      expect(csp(modelHtml)).toBeDefined();
      expect(csp(modelHtml)).toBe(csp(landing));
      expect(modelHtml).toContain('<meta name="referrer" content="strict-origin-when-cross-origin" />');
    });
  });
});
