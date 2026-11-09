import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { diagramSchema } from '../src/schema';
import { examples, parse } from '../src/proschi';

const committed = JSON.parse(readFileSync(new URL('../schema/proschi-diagram.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(committed);

// The document the landing page's live demo ends with: the static poster (frontend/index.html, #demo-source),
// which frontend/src/landing/landing.test.ts checks against src/components/Demo/demoScript.ts.
const landingHero = (() => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const code = html.match(/id="demo-source"[^>]*><code>([\s\S]*?)<\/code>/)![1];
  return code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
})();

describe('JSON Schema', () => {
  it('is up to date (run npm run build after changing the parser or catalog)', () => {
    expect(committed).toEqual(diagramSchema());
  });

  it.each([...examples.map((e) => [e.id, e.source]), ['landing hero', landingHero]])('describes the parse result of %s', (_id, source) => {
    const result = parse(source);
    // Round-trip through JSON, as `proschi parse` prints it.
    expect(validate(JSON.parse(JSON.stringify(result))), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes documents with problems, failed calls, conditions and positions too', () => {
    const source = 'g [Network Boundary]\ngroup vpc pos 10,20 {\n  a [Nope] pos -5,3\n}\nusecase "U" {\n  a -x b : GET /x/42\n  alt "A" when "b is down" {\n    b --> a : 200\n  }\n}\n%%%';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagram.useCases[0]).toMatchObject({ endpointGroup: 'GET /x/{id}', scenarios: [{ condition: 'b is down' }] });
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes whatif blocks', () => {
    const source = 'api [REST API]\nusecase "U" {\n  api -> api : x\n}\nwhatif "W" {\n  traffic "U" x3\n  fail api\n  api x2\n}\nwhatif "V" {\n  traffic "U" 5k rps\n}';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.whatifs).toHaveLength(2);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes constants', () => {
    const source = 'let peak = 2k rps\nlet n = 2\napi [REST API] x$n\nusecase "U" {\n  api -> api : x\n}\ntraffic {\n  "U" $peak\n}';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.constants).toHaveLength(2);
    const peak = JSON.parse(JSON.stringify(parse(source.replace('"U" $peak', '"U" $peak peak x3'))));
    expect(peak.diagram.traffic[0]).toMatchObject({ rps: 6000, avgRps: 2000 });
    expect(validate(peak), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes error rates and retries, in capacity and what-ifs', () => {
    const source = 'api [REST API]\npay [Go]\napi -> pay\ncapacity {\n  pay errors 2% retries 3\n}\nwhatif "Bad deploy" {\n  pay errors 20%\n}';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.capacity[0]).toMatchObject({ errorPercent: 2, retries: 3 });
    expect(result.diagram.whatifs[0].changes[0]).toMatchObject({ kind: 'errors', percent: 20 });
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes scoped budgets', () => {
    const source =
      'group g {\n  api [REST API] @Pay .hot\n}\nlegend {\n  hot "Hot" red\n}\nrequirements {\n  cost @Pay <= 500 usd/month\n  cost .hot <= 5 usd/month\n  cost group g <= 1k usd/month\n}';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.requirements.map((r: { scope: unknown }) => r.scope)).toEqual([{ team: 'Pay' }, { tag: 'hot' }, { group: 'g' }]);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes cache hit rates, in capacity and what-ifs, and info diagnostics', () => {
    const source =
      'api [REST API]\ncache [Redis]\napi -> cache\nusecase "U" {\n  api -> cache : GET\n}\ntraffic {\n  "U" 1k rps mix "U" 100%\n}\ncapacity {\n  cache hit 90%\n}\nwhatif "Cold" {\n  cache hit 40%\n}';
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.capacity[0].hitPercent).toBe(90);
    expect(result.diagram.whatifs[0].changes[0]).toMatchObject({ kind: 'hit', percent: 40 });
    expect(result.diagnostics.map((d: { severity: string }) => d.severity)).toEqual(['info']);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('describes every requirement, assertion and selector', () => {
    const source = [
      'title "T" "Summary"',
      'api [REST API] x2',
      'db [PostgreSQL]',
      'usecase "U" {',
      '  api -> db : x',
      '  api -> db : x20 ~2MB INSERT row',
      '}',
      'traffic {',
      '  "U" 10 rps mix "U" 50%',
      '}',
      'requirements {',
      '  p999 "U" < 1s',
      '  p99 "U" scenario "U" < 100ms',
      '  availability >= 99%',
      '  durable "U"',
      '  survive any node failure',
      '  survive failure of [Redis]',
      '  cost <= 10 usd/month',
      '}',
      'capacity {',
      '  db 1k rps latency 2ms availability 99.9% cost 5 usd/month volatile',
      '  api reads 2k rps writes 1k rps shards 2 consistency strong bandwidth 1 GB/s egress 0.09 usd/GB',
      '}',
      'entity E in db "d" {',
      '  id uuid key unique',
      '}',
      'decision "D" {',
      '  because "b"',
      '  rejected "o" "r"',
      '}',
      'test "All" {',
      '  "U" calls any database',
      '  "U" scenario "U" every scenario calls db',
      '  "U" calls api before [PostgreSQL]',
      '  "U" writes db before responding',
      '  "U" responds 2xx',
      '  "U" has scenario "X"',
      '  "U" handles failure of db',
      '  no path from api to any cache',
      '  any service has replicas >= 2',
      '  "U" never waits for any queue or any cache',
      '  "U" scenario "U" calls db after api',
      '  in "U" api calls any strong store',
      '  api never calls any eventual store',
      '  "U" starts at api',
      '}',
    ].join('\n');
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.tests[0].assertions).toHaveLength(14);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('rejects fields it does not know', () => {
    const result = JSON.parse(JSON.stringify(parse('a -> b')));
    result.diagram.nodes[0].colour = 'red';
    expect(validate(result)).toBe(false);
  });
});
