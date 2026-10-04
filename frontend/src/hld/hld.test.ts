import { describe, expect, it } from 'vitest';
import { ecommerceExample, parse } from '../dsl';
import { shortenerAnalysis, shortenerDiagram, shortenerTests } from './fixtures';
import { assertionLabel, buildHld, hld, nullEngine, requirementLabel, section, toHtml, toMarkdown, type Engine } from './index';

/** Every opened tag is closed, in order (void elements aside). */
function expectBalancedHtml(html: string) {
  const voids = new Set(['meta', 'br', 'img', 'hr', 'input', 'link']);
  const stack: string[] = [];
  // SVG elements may self-close; the HLD's own markup never does.
  for (const [, close, name, selfClose] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = name.toLowerCase();
    if (voids.has(tag) || selfClose) continue;
    if (!close) stack.push(tag);
    else expect(stack.pop(), `</${tag}>`).toBe(tag);
  }
  expect(stack).toEqual([]);
}

describe('hld', () => {
  const doc = hld(shortenerDiagram(), shortenerAnalysis, shortenerTests);

  it('has all nine sections, in order', () => {
    expect(doc.sections.map((s) => s.kind)).toEqual(['overview', 'requirements', 'capacity', 'components', 'dataModel', 'apis', 'scenarios', 'decisions', 'risks']);
    expect(doc.title).toBe('URL Shortener');
    expect(doc.checked).toBe(true);
  });

  it('overview: summary and counts', () => {
    expect(section(doc, 'overview')).toMatchObject({ summary: 'Turns long URLs into short codes', components: 5, useCases: 3, teams: ['links'] });
  });

  it('requirements: use cases with scenarios and conditions, requirements and tests with results', () => {
    const s = section(doc, 'requirements')!;
    expect(s.functional.map((f) => f.name)).toEqual(['Shorten', 'Redirect', 'Redirect again']);
    expect(s.functional[1].scenarios).toEqual([
      { id: 'cache-hit', name: 'Cache hit', outcome: 'success', condition: undefined },
      { id: 'cache-miss', name: 'Cache miss', outcome: 'success', condition: 'the code is not cached' },
    ]);
    expect(s.nonFunctional.map((r) => [r.label, r.status])).toEqual([
      ['p99 of Redirect < 50 ms', 'fail'],
      ['availability of every use case ≥ 99.9%', 'pass'],
      ['Shorten is durable', 'unchecked'],
      ['survive any node failure', 'unchecked'],
      ['cost ≤ $3,000/month', 'pass'],
    ]);
    expect(s.nonFunctional[0]).toMatchObject({ measured: 'p99 of Redirect is 75 ms (limit 50 ms)', hint: 'Add replicas to Load Balancer', category: 'latency' });
    expect(s.flowTests[0]).toMatchObject({
      status: 'pass',
      assertions: ['"Redirect" calls any cache before any database', '"Redirect" scenario "Cache hit" never calls any database'],
    });
    expect(s.flowTests[1]).toMatchObject({ status: 'fail', assertions: ['no path from visitor to [DynamoDB]'] });
  });

  it('capacity: traffic and load per component, without clients', () => {
    const s = section(doc, 'capacity')!;
    expect(s.traffic[0]).toEqual({ useCase: 'Redirect', rps: 100_000, mix: [{ scenario: 'Cache hit', share: 0.9 }, { scenario: 'Cache miss', share: 0.1 }] });
    expect(s.load.map((n) => n.id)).toEqual(['lb', 'api', 'cache', 'db']);
    expect(s.load[0]).toMatchObject({ name: 'Load Balancer', saturated: true, replicas: 1 });
    expect(s.totalCostUsd).toBe(1000);
  });

  it('components: tech, kind, team, replicas, responsibility, group and entities stored', () => {
    const s = section(doc, 'components')!;
    expect(s.components.find((c) => c.id === 'api')).toEqual({
      id: 'api', name: 'Shortener API', tech: 'REST API', kind: 'service', team: 'links', replicas: 3, responsibility: 'Creates codes and serves redirects', group: undefined, entities: [],
    });
    expect(s.components.find((c) => c.id === 'db')).toMatchObject({ kind: 'database', entities: ['Url'] });
    expect(s.components.find((c) => c.id === 'lb')).toMatchObject({ kind: 'edge', group: 'Edge' });
  });

  it('data model: entities with fields and their store', () => {
    const [url] = section(doc, 'dataModel')!.entities;
    expect(url).toMatchObject({ name: 'Url', store: 'db', storeName: 'Links DB' });
    expect(url.fields.map((f) => f.name)).toEqual(['code', 'target', 'createdAt']);
  });

  it('APIs: grouped by endpoint template, responses by scenario', () => {
    const s = section(doc, 'apis')!;
    expect(s.endpoints.map((e) => e.endpoint)).toEqual(['POST /links', 'GET /r/{id}']);
    const get = s.endpoints[1];
    expect(get).toMatchObject({ method: 'GET', path: '/r/{id}', service: 'Load Balancer' });
    expect(get.operations.map((o) => [o.useCase, o.endpoint])).toEqual([['Redirect', 'GET /r/1001'], ['Redirect again', 'GET /r/1002']]);
    expect(get.operations[0].responses).toEqual([
      { scenario: 'Cache hit', outcome: 'success', status: '302', body: undefined },
      { scenario: 'Cache miss', outcome: 'success', status: '302', body: undefined },
    ]);
    expect(s.endpoints[0].operations[0]).toMatchObject({ request: '{"target": "https://example.com"}', responses: [{ status: '201', body: '{"code": "aZ3"}' }] });
  });

  it('scenarios: conditions, shares and latency', () => {
    const redirect = section(doc, 'scenarios')!.useCases.find((u) => u.name === 'Redirect')!;
    expect(redirect.rps).toBe(100_000);
    expect(redirect.scenarios[1]).toMatchObject({ name: 'Cache miss', condition: 'the code is not cached', share: 0.1, meanMs: 25, steps: 4 });
    expect(redirect.scenarios[1].latency?.p99).toBe(75);
  });

  it('decisions are kept as written', () => {
    expect(section(doc, 'decisions')!.decisions[0].rejected).toEqual([{ option: 'Memcached', reason: 'no replication' }]);
  });

  it('risks: failing checks, saturated and hot nodes, single points of failure, missing error handling, warnings', () => {
    const risks = section(doc, 'risks')!.risks;
    expect(risks.map((r) => [r.kind, r.title])).toEqual([
      ['requirement', 'Requirement not met: p99 of Redirect < 50 ms'],
      ['test', 'Test failing: No direct path'],
      ['saturated', 'Load Balancer is saturated'],
      ['hot', 'Shortener API runs hot'],
      ['spof', 'Single point of failure: Code Cache (Redis)'],
      ['no-error-handling', 'Shorten has no error scenario'],
      ['no-error-handling', 'Redirect has no error scenario'],
      ['no-error-handling', 'Redirect again has no error scenario'],
      ['warning', 'Shares of Redirect sum to 100%'],
    ]);
    expect(risks[2].detail).toBe('101k rps against a capacity of 100k rps (101%)');
  });
});

describe('hld without simulation', () => {
  it('omits empty sections', () => {
    const doc = hld(parse('a -> b').diagram);
    expect(doc.sections.map((s) => s.kind)).toEqual(['overview', 'components']);
    expect(doc.checked).toBe(false);
    expect(hld(parse('').diagram).sections).toEqual([]);
  });

  it('marks requirements unchecked and takes shares from the traffic mix', () => {
    const doc = buildHld(shortenerDiagram(), nullEngine);
    expect(section(doc, 'requirements')!.nonFunctional.every((r) => r.status === 'unchecked')).toBe(true);
    expect(section(doc, 'capacity')!.load).toEqual([]);
    const scenarios = section(doc, 'scenarios')!.useCases;
    expect(scenarios[0].scenarios[0].share).toBe(1);
    expect(scenarios[1].scenarios.map((s) => s.share)).toEqual([0.9, 0.1]);
    expect(scenarios[2].scenarios[0].share).toBeUndefined();
    expect(section(doc, 'risks')!.risks.every((r) => r.kind === 'no-error-handling')).toBe(true);
  });

  it('uses an injected engine', () => {
    const engine: Engine = { available: true, analyze: () => shortenerAnalysis, runTests: (_d, a) => (a === shortenerAnalysis ? shortenerTests : []) };
    expect(buildHld(shortenerDiagram(), engine).checked).toBe(true);
    expect(section(buildHld(shortenerDiagram(), engine), 'capacity')!.load).toHaveLength(4);
  });

  it('the e-commerce example has error scenarios and grouped APIs', () => {
    const doc = hld(parse(ecommerceExample).diagram);
    expect(section(doc, 'risks')).toBeUndefined();
    expect(section(doc, 'apis')!.endpoints.map((e) => e.endpoint)).toEqual(['POST /api/orders', 'GET /api/orders/order-789']);
    expect(section(doc, 'apis')!.endpoints[0].operations[0].responses.map((r) => r.status)).toEqual(['201', '422', '503']);
  });
});

describe('labels', () => {
  it('requirements read like their test names', () => {
    const loc = { line: 1, col: 1, length: 1 };
    expect(requirementLabel({ kind: 'latency', percentile: 99.9, maxMs: 300, loc })).toBe('p999 of every use case < 300 ms');
    expect(requirementLabel({ kind: 'availability', useCase: 'Redirect', minPercent: 99.95, loc })).toBe('availability of Redirect ≥ 99.95%');
    expect(requirementLabel({ kind: 'survive', target: { node: 'cache' }, loc })).toBe('survive failure of cache');
    expect(requirementLabel({ kind: 'survive', target: { kind: 'database' }, loc })).toBe('survive failure of any database');
  });

  it('assertions read as written', () => {
    const loc = { line: 1, col: 1, length: 1 };
    expect(assertionLabel({ kind: 'calls', useCase: 'U', target: { node: 'db' }, quantifier: 'every', loc })).toBe('"U" every scenario calls db');
    expect(assertionLabel({ kind: 'writesBeforeResponding', useCase: 'U', target: { tech: 'PostgreSQL' }, loc })).toBe('"U" writes [PostgreSQL] before responding');
    expect(assertionLabel({ kind: 'responds', useCase: 'U', scenario: 'Bad', status: '4xx', loc })).toBe('"U" scenario "Bad" responds 4xx');
    expect(assertionLabel({ kind: 'hasScenario', useCase: 'U', scenario: 'S', loc })).toBe('"U" has scenario "S"');
    expect(assertionLabel({ kind: 'handlesFailure', useCase: 'U', target: { kind: 'cache' }, loc })).toBe('"U" handles failure of any cache');
    expect(assertionLabel({ kind: 'replicas', target: { kind: 'service' }, min: 2, loc })).toBe('any service has replicas >= 2');
  });
});

describe('toMarkdown', () => {
  const md = toMarkdown(hld(shortenerDiagram(), shortenerAnalysis, shortenerTests));

  it('has a heading per section and Mermaid for the architecture and every scenario', () => {
    expect(md.startsWith('# URL Shortener\n')).toBe(true);
    expect(md.match(/^## .+$/gm)).toEqual(['## Overview', '## Requirements', '## Capacity estimates', '## Components', '## Data model', '## APIs', '## Scenarios', '## Decisions', '## Risks']);
    expect(md.match(/^```mermaid$/gm)).toHaveLength(1 + 4);
    expect(md.match(/^flowchart LR$/gm)).toHaveLength(1);
    expect(md.match(/^sequenceDiagram$/gm)).toHaveLength(4);
    // Every fence is closed.
    expect(md.match(/^```/gm)!.length % 2).toBe(0);
  });

  it('writes tables with the measured values and status', () => {
    expect(md).toContain('| p99 of Redirect < 50 ms | ❌ | p99 of Redirect is 75 ms (limit 50 ms) |');
    expect(md).toContain('| Shorten is durable | — | — |');
    expect(md).toContain('| Redirect | 100k rps | Cache hit 90%, Cache miss 10% |');
    expect(md).toContain('| Load Balancer | 101k rps | 100k rps | 101% ⚠️ saturated | 1 | $50 |');
    expect(md).toContain('**Total cost:** $1,000 / month');
    expect(md).toContain('| **Shortener API** (`api`) | REST API | service | links | 3 | Creates codes and serves redirects | — |');
    expect(md).toContain('### Url (in Links DB)');
    expect(md).toContain('| `code` | string | key |');
    expect(md).toContain('### `GET /r/{id}`');
    expect(md).toContain('| Cache hit | `302` |');
    expect(md).toContain('#### Cache miss\n\nWhen the code is not cached · 10% of traffic · p50 25 ms, p99 75 ms');
    expect(md).toContain('**Because** Reads outnumber writes 100:1');
    expect(md).toContain('- **Memcached** — no replication');
    expect(md).toContain('- 🔴 **Load Balancer is saturated** — 101k rps against a capacity of 100k rps (101%) _Fix:_');
    // Table rows never break.
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) expect(line.endsWith('|')).toBe(true);
  });

  it('escapes pipes in cells and says when nothing was checked', () => {
    const d = shortenerDiagram();
    d.nodes.find((n) => n.id === 'api')!.description = 'a | b';
    const unchecked = toMarkdown(hld(d));
    expect(unchecked).toContain('a \\| b');
    expect(unchecked).toContain('> Requirements and tests were not checked');
    expect(toMarkdown(hld(parse(ecommerceExample).diagram))).not.toContain('not checked');
  });
});

describe('toHtml', () => {
  const doc = hld(shortenerDiagram(), shortenerAnalysis, shortenerTests);

  it('is a well-formed, self-contained page with every section', () => {
    const html = toHtml(doc);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expectBalancedHtml(html);
    expect(html).not.toMatch(/<script|<link|https?:\/\/(?!example\.com)/);
    for (const s of doc.sections) expect(html).toContain(`<section id="${s.kind}"><h2>${s.title}</h2>`);
    expect(html).toContain('<span class="fail">✗ fail</span>');
  });

  it('embeds figures when given, and lists messages otherwise', () => {
    const plain = toHtml(doc);
    expect(plain).toContain('<ol class="messages">');
    const withFigures = toHtml(doc, { architecture: '<svg id="arch"></svg>', scenarios: { 'redirect--cache-hit': '<svg id="hit"></svg>' } });
    expect(withFigures).toContain('<figure><svg id="arch"></svg></figure>');
    expect(withFigures).toContain('<figure><svg id="hit"></svg></figure>');
    expect(withFigures.match(/<ol class="messages">/g)).toHaveLength(3);
  });

  it('escapes text from the document', () => {
    const d = parse('title "<b>Shop</b>"\na "A & B" "<script>x</script>"').diagram;
    const html = toHtml(hld(d));
    expect(html).toContain('<h1>&lt;b&gt;Shop&lt;/b&gt;</h1>');
    expect(html).not.toContain('<script>');
    expectBalancedHtml(html);
  });
});
