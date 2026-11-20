import { describe, expect, it } from 'vitest';
import { builtinTypes, parse } from '../index';
import { opLabel, stepVocabulary } from './vocabulary';

/** What the builder offers for a step is what the language accepts: no offered label draws a type warning. */

const TYPE_PROBLEM = /has no (operation|status|header)/;

const docFor = (type: string, steps: string[], extra = '') => `${extra}
client [Service]
t [${type}]
client -> t
usecase "U" {
${steps.map((s) => `  ${s}`).join('\n')}
}`;

describe('stepVocabulary', () => {
  const concrete = [...builtinTypes().values()].filter((t) => !t.abstract);

  it('offers only operations, statuses and headers that every stdlib type accepts', () => {
    for (const type of concrete) {
      const { diagram } = parse(docFor(type.name, []));
      const request = stepVocabulary(diagram, 'client', 't', 'request');
      const response = stepVocabulary(diagram, 't', 'client', 'response');
      const steps = [
        ...request.ops.map((op) => `client -> t : ${opLabel(op.name, request)}x`),
        ...request.methods.map((m) => `client -> t : ${opLabel(m, request)}x`),
        ...request.headers.map((h) => `client -> t : ${opLabel(request.ops.find((o) => /^[A-Z]+$/.test(o.name))?.name ?? 'GET', request)}x header ${h}`),
        ...response.statuses.flatMap((s) => [`client -> t : ${opLabel(request.ops[0]?.name ?? 'GET', request)}x`, `t --> client : ${s}`]),
      ];
      const problems = parse(docFor(type.name, steps)).diagnostics.filter((d) => TYPE_PROBLEM.test(d.message));
      expect(problems.map((p) => p.message), type.name).toEqual([]);
    }
  });

  it('reads PostgreSQL from its type chain: its own operations first, never a made-up one', () => {
    const { diagram } = parse(docFor('PostgreSQL', []));
    const v = stepVocabulary(diagram, 'client', 't', 'request');
    const names = v.ops.map((o) => o.name);
    expect(names).toContain('SELECT');
    expect(names).not.toContain('query');
    expect(names.slice(0, 4)).toEqual(['LISTEN', 'NOTIFY', 'COPY', 'VACUUM']);
    expect(v.ops.find((o) => o.name === 'LISTEN')?.from).toBe('PostgreSQL');
    expect(v.protocol).toBe('SQL');
  });

  it("offers a declared type's own operation first", () => {
    const { diagram } = parse(docFor('OrdersDb', [], 'type OrdersDb extends PostgreSQL {\n  op write APPEND\n}'));
    const v = stepVocabulary(diagram, 'client', 't', 'request');
    expect(v.ops[0]).toEqual({ name: 'APPEND', access: 'write', from: 'OrdersDb' });
    const problems = parse(docFor('OrdersDb', ['client -> t : APPEND entry'], 'type OrdersDb extends PostgreSQL {\n  op write APPEND\n}')).diagnostics;
    expect(problems.filter((d) => TYPE_PROBLEM.test(d.message))).toEqual([]);
  });

  it("answers with the responder's statuses, and none when it lists none", () => {
    const api = parse(docFor('REST API', [])).diagram;
    expect(stepVocabulary(api, 't', 'client', 'response').statuses).toContain(201);
    const db = parse(docFor('PostgreSQL', [])).diagram;
    expect(stepVocabulary(db, 't', 'client', 'response').statuses).toEqual([]);
  });

  it('offers HTTP methods for an HTTP type without operations, and labels already used for one', () => {
    const { diagram } = parse(docFor('Service', ['client -> t : charge card', 'client -> t : charge card', 'client -> t : refund']));
    const v = stepVocabulary(diagram, 'client', 't', 'request', [
      { from: 'client', to: 't', kind: 'request', label: 'refund' },
      { from: 'client', to: 't', kind: 'request', label: 'charge card' },
      { from: 'client', to: 't', kind: 'request', label: 'charge card' },
      { from: 't', to: 'client', kind: 'response', label: 'ok' },
    ]);
    expect(v.ops).toEqual([]);
    expect(v.methods).toContain('GET');
    expect(v.used).toEqual(['charge card', 'refund']);
  });
});

describe('opLabel', () => {
  it('starts a label with the operation, a path after an HTTP method, quotes around a name with spaces', () => {
    const http = { http: true, ops: [] };
    const sql = { http: false, ops: [] };
    expect(opLabel('GET', http)).toBe('GET /');
    expect(opLabel('SELECT', sql)).toBe('SELECT ');
    expect(opLabel('full scan', sql)).toBe('"full scan" ');
    expect(opLabel('query', http)).toBe('query ');
  });
});
