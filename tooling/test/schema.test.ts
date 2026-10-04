import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { diagramSchema } from '../src/schema';
import { examples, parse } from '../src/proschi';

const committed = JSON.parse(readFileSync(new URL('../schema/proschi-diagram.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(committed);

const landingHero = (() => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const code = html.match(/id="hero-source"[^>]*><code>([\s\S]*?)<\/code>/)![1];
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

  it('describes every requirement, assertion and selector', () => {
    const source = [
      'title "T" "Summary"',
      'api [REST API] x2',
      'db [PostgreSQL]',
      'usecase "U" {',
      '  api -> db : x',
      '}',
      'traffic {',
      '  "U" 10 rps mix "U" 50%',
      '}',
      'requirements {',
      '  p999 "U" < 1s',
      '  availability >= 99%',
      '  durable "U"',
      '  survive any node failure',
      '  survive failure of [Redis]',
      '  cost <= 10 usd/month',
      '}',
      'capacity {',
      '  db 1k rps latency 2ms availability 99.9% cost 5 usd/month volatile',
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
      '}',
    ].join('\n');
    const result = JSON.parse(JSON.stringify(parse(source)));
    expect(result.diagram.tests[0].assertions).toHaveLength(9);
    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('rejects fields it does not know', () => {
    const result = JSON.parse(JSON.stringify(parse('a -> b')));
    result.diagram.nodes[0].colour = 'red';
    expect(validate(result)).toBe(false);
  });
});
