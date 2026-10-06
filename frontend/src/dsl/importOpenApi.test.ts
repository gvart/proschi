import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parse } from './index';
import { MAX_USE_CASES, fromOpenApi, openApiFromText, serverPrefix } from './importOpenApi';
import { genericTechsKnown, idAllocator, quote, stepLabel, techFromLabel } from './importDesign';
import ordersYaml from './importFixtures/orders-api.yaml?raw';
import ordersExpected from './importFixtures/orders-api.proschi?raw';

describe('fromOpenApi', () => {
  it('converts the fixture: a client, the API and a use case per operation with its main status', () => {
    const { source, warnings } = openApiFromText(ordersYaml, parseYaml);
    expect(source).toBe(ordersExpected);
    expect(parse(source).diagnostics).toEqual([]);
    expect(warnings.map((w) => w.message)).toEqual(['Webhooks are not imported', '1 TRACE operation(s) left out']);
  });

  it('reads JSON without a YAML parser', () => {
    const spec = { openapi: '3.1.0', info: { title: 'Pets' }, paths: { '/pets': { get: { responses: { '200': {} } } } } };
    const { source } = openApiFromText(JSON.stringify(spec));
    expect(source).toContain('usecase "GET /pets"');
    expect(parse(source).diagnostics).toEqual([]);
  });

  it('groups many operations per tag, one scenario per operation', () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) paths[`/r${i}`] = { get: { tags: [i % 2 ? 'odd' : 'even'], summary: `Get ${i}`, responses: { '200': {} } } };
    const { source, warnings } = fromOpenApi({ openapi: '3.0.0', info: { title: 'Big' }, tags: [{ name: 'odd', description: 'Odd ones' }], paths });
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(diagram.useCases.map((u) => [u.name, u.scenarios.length])).toEqual([
      ['even', 15],
      ['odd', 15],
    ]);
    expect(diagram.useCases[1].description).toBe('Odd ones');
    expect(warnings.at(-1)?.message).toContain('grouped into one use case per tag');
  });

  it('caps the number of tag use cases', () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) paths[`/r${i}`] = { post: { tags: [`t${i}`], responses: { '204': {} } } };
    const { source, warnings } = fromOpenApi({ openapi: '3.0.0', paths });
    expect(parse(source).diagram.useCases).toHaveLength(MAX_USE_CASES);
    expect(warnings[0].message).toBe('25 operations in 25 tags: only the first 20 tags are imported');
  });

  it('warns instead of throwing on anything else', () => {
    for (const doc of [null, 42, [], { swagger: '2.0', basePath: '/api/', paths: { '/x': { get: { responses: { default: {} } } } } }, { paths: { '/a': { $ref: '#/x' } } }]) {
      const result = fromOpenApi(doc);
      expect(parse(result.source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
    expect(fromOpenApi({ swagger: '2.0', basePath: '/api/', paths: { '/x': { get: { responses: {} } } } }).source).toContain('GET /api/x');
    expect(openApiFromText('openapi: [', parseYaml).warnings[0].message).toMatch(/^Could not read the spec/);
  });

  it('reads the path prefix from the first server', () => {
    expect(serverPrefix([{ url: 'https://x.example/v2/' }])).toBe('/v2');
    expect(serverPrefix([{ url: 'https://x/{v}', variables: { v: { default: 'beta' } } }])).toBe('/beta');
    expect(serverPrefix([{ url: '/rel?x=1' }])).toBe('/rel');
    expect(serverPrefix(undefined)).toBe('');
  });
});

describe('import helpers', () => {
  it('quotes strings for the parser', () => {
    expect(quote('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c d"');
  });

  it('allocates valid, unique ids', () => {
    const id = idAllocator();
    expect(['Order Service', 'order-service', '9lives', 'usecase', '', 'Order Service'].map(id)).toEqual(['Order_Service', 'order_service2', 'n9lives', 'usecase_', 'node', 'Order_Service']);
  });

  it('guesses techs from labels', () => {
    expect(techFromLabel('Users DB (Postgres)')).toBe('PostgreSQL');
    expect(techFromLabel('Billing Store')).toBe('Database');
    expect(techFromLabel('Mobile Client')).toBe('Actor');
    expect(techFromLabel('Thing', 'Message Queue')).toBe('Message Queue');
    expect(genericTechsKnown()).toBe(true);
  });

  it('cuts payloads that would run into the next lines', () => {
    expect(stepLabel('POST /a/{id} {"x": 1}')).toEqual({ label: 'POST /a/{id} {"x": 1}', cut: false });
    expect(stepLabel('POST /a/{id} {"x": "tr…')).toEqual({ label: 'POST /a/{id}', cut: true });
    expect(stepLabel('Ping # 3 ~soon')).toEqual({ label: 'Ping 3 ~soon', cut: false });
    expect(stepLabel('~fast ping').label).toBe('ping');
    expect(stepLabel('~2MB PUT /f').label).toBe('~2MB PUT /f');
  });
});
