import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser';
import { problems } from '../../practice/catalog';
import { composeLabel, splitLabel, type LabelParts } from './stepLabel';

const doc = (label: string) => `api [REST API]\ndb [PostgreSQL]\napi -> db\nusecase "U" {\n  api -> db : ${label}\n}\n`;
const stepOf = (label: string) => parse(doc(label)).diagram.useCases[0].steps[0];

describe('step label parts', () => {
  it('splits and composes every part', () => {
    const label = 'x200 ~2MB POST /photos/{id} header Authorization, If-None-Match upload json {"caption": "Sunset"}';
    const parts = splitLabel(label);
    expect(parts).toEqual({ fanOut: 200, size: '2MB', head: 'POST /photos/{id}', headers: ['Authorization', 'If-None-Match'], tail: 'upload json {"caption": "Sunset"}' });
    expect(composeLabel(parts)).toBe(label);
    expect(splitLabel('INSERT order {"id": 1}')).toEqual({ head: 'INSERT order', headers: [], tail: '{"id": 1}' });
    expect(splitLabel('LPUSH feed:{follower}')).toEqual({ head: 'LPUSH feed:{follower}', headers: [], tail: '' });
  });

  it('reads back as the language reads it, for any combination of parts', () => {
    const heads = ['GET /orders/{id}', 'SELECT orders'];
    for (const head of heads)
      for (const fanOut of [undefined, 3])
        for (const size of [undefined, '2MB'])
          for (const headers of [[], ['Authorization']])
            for (const tail of ['', '{"id": 1}', 'json {"id": 1}']) {
              const parts: LabelParts = { fanOut, size, head, headers, tail };
              const step = stepOf(composeLabel(parts));
              expect(step.multiplier).toBe(fanOut);
              expect(step.sizeBytes).toBe(size ? 2_000_000 : undefined);
              if (head.startsWith('GET')) {
                expect(step.endpoint).toBe('/orders/{id}');
                expect(step.headers).toEqual(headers.length ? headers : undefined);
              }
              expect(step.requestBody).toBe(tail ? '{"id": 1}' : undefined);
            }
  });

  it('composes back every step label of the practice solutions, up to spacing', () => {
    for (const p of problems) {
      for (const line of p.solution.split('\n')) {
        const m = /^\s*[\w.]+\s*(?:->>|-->|->|-x)\s*[\w.]+\s*:\s*(.+)$/.exec(line);
        if (!m || /[{[]\s*$/.test(m[1])) continue;
        expect(composeLabel(splitLabel(m[1])), `${p.id}: ${m[1]}`).toBe(m[1].trim().replace(/\s+/g, ' '));
      }
    }
  });
});
