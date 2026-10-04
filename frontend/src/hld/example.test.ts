import { describe, expect, it } from 'vitest';
import { parse } from '../dsl';
import { urlShortenerExample } from '../dsl/examples';
import { buildHld, defaultEngine, section, toMarkdown } from './index';

describe('HLD of the bundled url-shortener example', () => {
  const doc = buildHld(parse(urlShortenerExample).diagram, defaultEngine);

  it('has every section, checked by the simulation', () => {
    expect(doc.checked).toBe(true);
    expect(doc.sections.map((s) => s.kind)).toEqual(['overview', 'requirements', 'capacity', 'components', 'dataModel', 'apis', 'scenarios', 'decisions']);
    expect(section(doc, 'overview')!.summary).toBe('Turns long URLs into short codes and redirects visitors to them');
  });

  it('every requirement and test passes, with the measured value', () => {
    const r = section(doc, 'requirements')!;
    expect(r.nonFunctional).toHaveLength(8);
    expect(r.flowTests).toHaveLength(3);
    for (const row of [...r.nonFunctional, ...r.flowTests]) {
      expect(row.status, row.measured).toBe('pass');
      expect(row.measured).toBeTruthy();
    }
    expect(r.nonFunctional[0].measured).toMatch(/^p99 of Redirect is [\d.]+ ms \(limit 100 ms\)$/);
  });

  it('has a capacity table, components with entities, a data model and decisions', () => {
    const c = section(doc, 'capacity')!;
    expect(c.traffic.map((t) => t.useCase)).toEqual(['Redirect', 'Shorten']);
    expect(c.load.map((n) => n.id)).toEqual(['lb', 'api', 'cache', 'db']);
    expect(c.load.every((n) => !n.saturated && n.loadRps > 0)).toBe(true);
    expect(c.totalCostUsd).toBeGreaterThan(0);
    expect(section(doc, 'components')!.components.find((x) => x.id === 'db')).toMatchObject({ kind: 'database', replicas: 3, entities: ['Url'] });
    expect(section(doc, 'dataModel')!.entities[0]).toMatchObject({ name: 'Url', storeName: 'URL store' });
    expect(section(doc, 'decisions')!.decisions.map((d) => d.title)).toEqual(['Cache redirects in Redis', 'Base62 codes from a counter']);
    const redirect = section(doc, 'scenarios')!.useCases[0];
    expect(redirect.scenarios.map((s) => s.share)).toEqual([0.9, 0.09, 0.01, 0]);
    expect(redirect.scenarios[0].latency?.p99).toBeGreaterThan(0);
  });

  it('writes Markdown with every check passing', () => {
    const md = toMarkdown(doc);
    expect(md.match(/\| ✅ \|/g)).toHaveLength(11);
    expect(md).not.toContain('❌');
    expect(md).not.toContain('not checked');
  });
});
