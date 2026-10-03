import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { checkOpenApi } from '../src/openapi/check';
import { findConfigFile, openApiDiagnostics, parseSpecFlag, readConfig } from '../src/openapi/config';
import { closestTemplate, matchTemplates, normalizePath, stripPrefix } from '../src/openapi/paths';
import { loadSpec } from '../src/openapi/spec';
import { parse } from '../src/proschi';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ordersSpec = join(fixtures, 'openapi/specs/orders-api.yaml');
const paymentsSpec = join(fixtures, 'openapi/specs/payments-api.json');
const specs = { orders: ordersSpec, payments: paymentsSpec };

/** OpenAPI findings for use case steps, as `line: message`. */
function findings(steps: string, specMap: Record<string, string> = specs): string[] {
  const { diagram } = parse(`usecase "U" {\n${steps}\n}\n`);
  return checkOpenApi(diagram, specMap).map((d) => `${d.line}: ${d.severity}: ${d.message}`);
}

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('path matching', () => {
  const templates = ['/orders', '/orders/{orderId}', '/orders/latest', '/orders/{orderId}/invoice.{format}', '/'];

  it('normalizes step paths', () => {
    expect(normalizePath('/orders/42?expand=items#top')).toBe('/orders/42');
    expect(normalizePath('/orders/')).toBe('/orders');
    expect(normalizePath('https://api.shop.example/v1/orders')).toBe('/v1/orders');
    expect(normalizePath('https://api.shop.example')).toBe('/');
    expect(normalizePath('orders')).toBe('/orders');
    expect(normalizePath('/')).toBe('/');
  });

  it('matches concrete values and placeholders against parameters, one segment each', () => {
    expect(matchTemplates(templates, '/orders/42')).toEqual(['/orders/{orderId}']);
    expect(matchTemplates(templates, '/orders/{id}')).toEqual(['/orders/{orderId}']);
    expect(matchTemplates(templates, '/orders/42/items')).toEqual([]);
    expect(matchTemplates(templates, '/orders')).toEqual(['/orders']);
    expect(matchTemplates(templates, '/')).toEqual(['/']);
  });

  it('prefers literal segments over parameters', () => {
    expect(matchTemplates(templates, '/orders/latest')).toEqual(['/orders/latest', '/orders/{orderId}']);
    // A placeholder stands for any value, so it does not match a literal segment.
    expect(matchTemplates(['/orders/latest'], '/orders/{id}')).toEqual([]);
  });

  it('matches parameters inside a segment', () => {
    expect(matchTemplates(templates, '/orders/42/invoice.pdf')).toEqual(['/orders/{orderId}/invoice.{format}']);
    expect(matchTemplates(templates, '/orders/42/invoice')).toEqual([]);
  });

  it('strips a server prefix only at a segment boundary', () => {
    expect(stripPrefix('/v1/orders', '/v1')).toBe('/orders');
    expect(stripPrefix('/v1', '/v1')).toBe('/');
    expect(stripPrefix('/v10/orders', '/v1')).toBeUndefined();
    expect(stripPrefix('/orders', '')).toBeUndefined();
  });

  it('suggests a close template for typos only', () => {
    expect(closestTemplate(templates, '/ordres/42')).toBe('/orders/{orderId}');
    expect(closestTemplate(templates, '/order')).toBe('/orders');
    expect(closestTemplate(templates, '/customers/7/addresses')).toBeUndefined();
  });
});

describe('loading specs', () => {
  it('reads the server prefix, resolving server variables', () => {
    expect(loadSpec(ordersSpec).prefix).toBe('/v1');
    expect(loadSpec(paymentsSpec).prefix).toBe('/payments-api');
  });

  it('rejects files that are not OpenAPI 3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-spec-'));
    writeFileSync(join(dir, 'swagger.yaml'), 'swagger: "2.0"\npaths: {}\n');
    writeFileSync(join(dir, 'broken.yaml'), 'openapi: 3.0.0\npaths: [\n');
    writeFileSync(join(dir, 'list.json'), '[1, 2]');
    expect(() => loadSpec(join(dir, 'swagger.yaml'))).toThrow('Swagger 2.0 is not supported');
    expect(() => loadSpec(join(dir, 'broken.yaml'))).toThrow();
    expect(() => loadSpec(join(dir, 'list.json'))).toThrow('not an OpenAPI document');
    expect(() => loadSpec(join(dir, 'missing.yaml'))).toThrow('ENOENT');
  });

  it('re-reads a spec when it changes on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-spec-'));
    const file = join(dir, 'api.yaml');
    writeFileSync(file, 'openapi: 3.0.0\npaths:\n  /a: {}\n');
    expect(loadSpec(file).templates).toEqual(['/a']);
    writeFileSync(file, 'openapi: 3.0.0\npaths:\n  /b: {}\n');
    const later = new Date(Date.now() + 5000);
    // Make sure the modification time differs even on coarse file systems.
    utimesSync(file, later, later);
    expect(loadSpec(file).templates).toEqual(['/b']);
  });
});

describe('endpoint check', () => {
  it('passes documented endpoints, with or without the server prefix and query strings', () => {
    expect(
      findings(
        [
          'gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 1}]}',
          'gateway -> orders : POST /v1/orders {"items": [{"sku": "A", "quantity": 1}]}',
          'gateway -> orders : GET https://api.shop.example/v1/orders?status=paid',
          'gateway -> orders : GET /orders/latest',
          'gateway -> orders : PUT /orders/{id}',
          'gateway -> payments : POST /payments-api/payments/pay_1/refunds',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reports unknown paths, with a suggestion when one is close', () => {
    expect(findings('gateway -> orders : GET /ordres/42\ngateway -> orders : GET /v2/orders')).toEqual([
      "2: warning: GET /ordres/42: 'orders-api.yaml' has no path /ordres/42; did you mean GET /orders/{orderId}?",
      "3: warning: GET /v2/orders: 'orders-api.yaml' has no path /v2/orders",
    ]);
  });

  it('reports undocumented methods', () => {
    expect(findings('gateway -> orders : POST /orders/42\ngateway -> payments : GET /payments')).toEqual([
      "2: warning: POST /orders/42: 'orders-api.yaml' has no POST /orders/{orderId} (documented: GET /orders/{orderId}, PUT /orders/{orderId})",
      "3: warning: GET /payments: 'payments-api.json' has no GET /payments; did you mean POST /payments?",
    ]);
  });

  it('only checks HTTP steps to nodes that have a spec', () => {
    expect(findings('gateway -> db : GET /nothing\norders -> db : SELECT order\ngateway -> orders : INSERT order')).toEqual([]);
  });

  it('checks a failed call for its endpoint only', () => {
    expect(findings('orders -x payments : POST /payments {"wrong": true}\norders -x payments : POST /refunds')).toEqual([
      "3: warning: POST /refunds: 'payments-api.json' has no path /refunds",
    ]);
  });
});

describe('status check', () => {
  it('accepts exact codes, NXX ranges and default', () => {
    const steps = [
      'gateway -> orders : GET /orders/1',
      'orders --> gateway : 200 {"id": 1, "status": "paid"}',
      'gateway -> orders : GET /orders/2',
      'orders --> gateway : 404 {"error": "not_found"}',
      'gateway -> orders : PUT /orders/3 {"items": [{"sku": "A", "quantity": 1}]}',
      'orders --> gateway : 409',
      'orders -> payments : POST /payments {"orderId": 1, "amount": 5}',
      'payments --> orders : 202 {"paymentId": "pay_9"}',
    ];
    expect(findings(steps.join('\n'))).toEqual([]);
  });

  it('reports undocumented codes on the response line', () => {
    const steps = ['gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 1}]}', '  orders -> db : INSERT order', 'orders --> gateway : 422'];
    expect(findings(steps.join('\n'))).toEqual(['4: warning: Status 422 is not documented for POST /orders (documented: 201, 400)']);
  });
});

describe('payload check', () => {
  it('validates request bodies through $refs, with 3.0 nullable and boolean exclusiveMinimum', () => {
    expect(findings('gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 1}], "note": null}')).toEqual([]);
    expect(findings('gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 1.5}]}')).toEqual([
      '2: warning: Request body does not match the schema of POST /orders: /items/0/quantity must be integer',
    ]);
    expect(findings('gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 0}], "gift": true}')).toEqual([
      "2: warning: Request body does not match the schema of POST /orders: (root) must NOT have additional properties ('gift'); /items/0/quantity must be > 0",
    ]);
  });

  it('validates response bodies, including +json media types and $ref responses', () => {
    const steps = [
      'gateway -> orders : GET /orders/1',
      'orders --> gateway : 200 {"id": 1, "status": "lost", "total": null}',
      'gateway -> orders : POST /orders {"items": [{"sku": "A", "quantity": 1}]}',
      'orders --> gateway : 400 {"detail": "no"}',
    ];
    expect(findings(steps.join('\n'))).toEqual([
      '3: warning: 200 response body does not match the schema of GET /orders/{orderId}: /status must be equal to one of the allowed values: "pending", "paid", "shipped"',
      "5: warning: 400 response body does not match the schema of POST /orders: (root) must have required property 'error'",
    ]);
  });

  it('validates OpenAPI 3.1 schemas as JSON Schema 2020-12', () => {
    expect(findings('orders -> payments : POST /payments {"orderId": 1, "amount": 5, "coupon": null, "currency": "EUR"}')).toEqual([]);
    expect(findings('orders -> payments : POST /payments {"orderId": 1, "amount": 0, "coupon": 5, "tip": 1}')).toEqual([
      "2: warning: Request body does not match the schema of POST /payments: /amount must be > 0; /coupon must be string,null; (root) must NOT have unevaluated properties ('tip')",
    ]);
    expect(findings('orders -> payments : POST /payments {"orderId": 1, "amount": 5}\npayments --> orders : 402 {"reason": "declined"}')).toEqual([
      "3: warning: 402 response body does not match the schema of POST /payments: (root) must have required property 'code'",
    ]);
  });

  it('summarizes long error lists', () => {
    const [message] = findings('orders -> payments : POST /payments {"orderId": "a", "amount": "b", "currency": "GBP", "coupon": 1}');
    expect(message).toMatch(/\(and 1 more\)$/);
  });

  it('skips payloads that are not JSON, or not valid JSON', () => {
    const steps = [
      'gateway -> orders : POST /orders {"items": [ ... ]}',
      'gateway -> orders : POST /orders xml <order/>',
      'gateway -> orders : POST /orders text hello',
      'gateway -> orders : GET /orders/1',
      'orders --> gateway : 200 the order',
    ];
    expect(findings(steps.join('\n'))).toEqual([]);
  });

  it('reports a step shared by several scenarios once', () => {
    const steps = ['gateway -> orders : POST /orders {"items": []}', 'alt "A" {', '  orders --> gateway : 201 {"id": 1, "status": "paid"}', '} alt "B" {', '  orders --> gateway : 400 {"error": "x"}', '}'];
    expect(findings(steps.join('\n'))).toEqual(['2: warning: Request body does not match the schema of POST /orders: /items must NOT have fewer than 1 items']);
  });
});

describe('unreadable specs', () => {
  it('is an error on the node, naming the file', () => {
    const { diagram } = parse('orders [REST API]\nusecase "U" {\n  gateway -> orders : GET /orders\n  gateway -> orders : GET /orders/1\n}\n');
    const [d, ...rest] = checkOpenApi(diagram, { orders: join(fixtures, 'nope.yaml') });
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ severity: 'error', line: 1, col: 1 });
    expect(d.message).toMatch(/^Cannot read OpenAPI spec '.*nope\.yaml' for 'orders': ENOENT/);
  });
});

describe('configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'proschi-config-'));
  mkdirSync(join(root, 'specs'));
  mkdirSync(join(root, 'docs', 'flows'), { recursive: true });
  writeFileSync(join(root, 'specs', 'orders.yaml'), 'openapi: 3.0.0\npaths:\n  /orders:\n    get:\n      responses:\n        "200": {description: ok}\n');
  writeFileSync(join(root, 'proschi.json'), JSON.stringify({ openapi: { orders: 'specs/orders.yaml' } }));
  const flow = join(root, 'docs', 'flows', 'flow.proschi');
  writeFileSync(flow, 'usecase "U" {\n  gateway -> orders : POST /orders\n}\n');

  it('finds proschi.json by walking up, with paths relative to it', () => {
    expect(findConfigFile(join(root, 'docs', 'flows'))).toBe(join(root, 'proschi.json'));
    expect(readConfig(join(root, 'proschi.json')).openapi).toEqual({ orders: join(root, 'specs', 'orders.yaml') });
    expect(findConfigFile(tmpdir())).toBeUndefined();
  });

  it('uses the config, and lets flags override it', () => {
    const { diagram } = parse('usecase "U" {\n  gateway -> orders : POST /orders\n}\n');
    expect(openApiDiagnostics(flow, diagram).map((d) => d.message)).toEqual(["POST /orders: 'orders.yaml' has no POST /orders; did you mean GET /orders?"]);
    expect(openApiDiagnostics(flow, diagram, { orders: ordersSpec })).toEqual([]);
  });

  it('reports an invalid config as an error', () => {
    const bad = mkdtempSync(join(tmpdir(), 'proschi-config-'));
    writeFileSync(join(bad, 'proschi.json'), '{"openapi": {"orders": 1}}');
    const [d] = openApiDiagnostics(join(bad, 'x.proschi'), parse('').diagram);
    expect(d).toMatchObject({ severity: 'error', line: 1 });
    expect(d.message).toContain('"openapi" must map node ids to spec paths');
    writeFileSync(join(bad, 'proschi.json'), '{nope');
    expect(openApiDiagnostics(join(bad, 'y.proschi'), parse('').diagram)[0].message).toMatch(/^Invalid .*proschi\.json/);
  });

  it('parses --openapi values', () => {
    expect(parseSpecFlag('orders=specs/o.yaml')).toEqual(['orders', join(process.cwd(), 'specs/o.yaml')]);
    expect(parseSpecFlag('orders')).toBeUndefined();
    expect(parseSpecFlag('=x.yaml')).toBeUndefined();
    expect(parseSpecFlag('orders=')).toBeUndefined();
  });
});

describe('proschi check with OpenAPI specs', () => {
  const drift = join(fixtures, 'drift.proschi');
  const shown = relative(process.cwd(), drift);
  const flags = ['--openapi', `orders=${ordersSpec}`, '--openapi', `payments=${paymentsSpec}`];

  it('passes the documented fixture, found through proschi.json', () => {
    expect(capture(['check', '--strict', join(fixtures, 'openapi')])).toMatchObject({ code: 0, out: '1 file: no problems' });
  });

  it('reports drift as warnings, failing only with --strict', () => {
    const r = capture(['check', ...flags, drift]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${shown}:5:3: warning: Status 422 is not documented for POST /orders (documented: 201, 400)`);
    expect(r.out).toContain('1 file: 0 error(s), 8 warning(s)');
    expect(capture(['check', '--strict', ...flags, drift]).code).toBe(1);
    expect(capture(['check', '--strict', drift]).code).toBe(0);
  });

  it('fails when a spec cannot be read', () => {
    const r = capture(['check', '--openapi', `orders=${join(fixtures, 'missing.yaml')}`, drift]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/:2:14: error: Cannot read OpenAPI spec '.*missing\.yaml' for 'orders'/);
  });

  it('writes GitHub annotations for findings', () => {
    const r = capture(['check', '--format', 'github', ...flags, drift]);
    expect(r.out.split('\n')[0]).toBe(
      `::warning file=${shown},line=2,col=3,title=proschi::POST /orders/42: 'orders-api.yaml' has no POST /orders/{orderId} (documented: GET /orders/{orderId}, PUT /orders/{orderId})`,
    );
  });

  it('rejects malformed --openapi flags', () => {
    expect(capture(['check', '--openapi', 'orders', drift]).code).toBe(2);
    expect(capture(['check', drift, '--openapi']).code).toBe(2);
  });
});
