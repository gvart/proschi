import { describe, expect, it } from 'vitest';
import { componentCatalog, findTech } from '../../catalog/componentCatalog';
import { problems } from '../../practice/catalog';
import { parseSolution } from '../../practice/workspace';
import { WRITE_VERBS, accessOf } from '../access';
import { builtinTypes, parse } from '../index';
import { kindOf } from '../kinds';
import { lookupType, techNamed } from './resolve';
import type { ResolvedType, TypeOp } from './types';

/**
 * The full stdlib (src/dsl/stdlib): one type per catalog tech, in a tree of
 * abstract parents that carry the shared ops. typesys.test.ts covers the
 * mechanism; this file covers the content.
 */

const types = [...builtinTypes().values()];
const byName = new Map(types.map((t) => [t.name, t]));
const children = (t: ResolvedType) => types.filter((c) => c.parents[0] === t.name);
const findOp = (t: ResolvedType, name: string): TypeOp | undefined => t.ops.find((o) => o.name.toLowerCase() === name.toLowerCase());

describe('the stdlib tree', () => {
  it('has a type for every catalog tech, of the same name, kind and icon', () => {
    for (const tech of componentCatalog) {
      const type = byName.get(tech.techStack);
      expect(type, tech.techStack).toBeDefined();
      expect(type!.abstract, tech.techStack).toBe(false);
      expect(type!.icon, tech.techStack).toBe(tech.techStack);
      expect(type!.kind, tech.techStack).toBe(kindOf({ kind: 'component', type: tech.type, techStack: tech.techStack }));
      expect(lookupType(builtinTypes(), tech.techStack), tech.techStack).toBe(type);
    }
  });

  it('gives the types the catalog does not know names that are no catalog name or alias', () => {
    const own = types.filter((t) => !techNamed(t.name));
    expect(own.every((t) => t.abstract)).toBe(true);
    for (const t of own) expect(findTech(t.name)?.techStack, t.name).toBeUndefined();
  });

  it('roots every type at Component, and every abstract type has a child', () => {
    for (const t of types) {
      if (t.name === 'Component') continue;
      expect(t.parents.at(-1), t.name).toBe('Component');
      for (const p of t.parents) expect(byName.has(p), `${t.name} → ${p}`).toBe(true);
    }
    for (const t of types.filter((t) => t.abstract)) expect(children(t).length, t.name).toBeGreaterThan(0);
  });

  it('has the top levels under Component', () => {
    expect(children(byName.get('Component')!).map((t) => t.name).sort()).toEqual(
      ['Annotation', 'Caller', 'Compute', 'DataComponent', 'Edge', 'External', 'Group', 'Messaging', 'Shape'].sort(),
    );
  });

  it('gives every concrete type a kind and every type a one-sentence doc', () => {
    for (const t of types) {
      if (!t.abstract) expect(t.kind, t.name).toBeDefined();
      expect(t.doc, t.name).toMatch(/^[A-Z.a-z].*\.$/);
    }
    // A doc is the type's own, not one inherited from its parent.
    for (const t of types) if (t.parents.length) expect(t.doc, t.name).not.toBe(byName.get(t.parents[0])!.doc);
  });

  it('draws a user type of any built-in parent with a catalog icon', () => {
    for (const t of types) {
      if (!t.kind) continue;
      const { diagram, diagnostics } = parse(`type Mine extends [${t.name}] {}\nm [Mine]`);
      expect(diagnostics, t.name).toEqual([]);
      const node = diagram.nodes[0];
      expect(findTech(node.techStack)?.techStack, t.name).toBe(node.techStack);
      expect(kindOf(node), t.name).toBe(t.kind);
      if (!t.abstract) expect(node.techStack, t.name).toBe(t.name);
    }
  });

  it('sets no simulation numbers', () => {
    for (const t of types) expect(t.props, t.name).toEqual({});
  });
});

describe('the stdlib vocabularies', () => {
  it('lists each op once along a chain, ignoring case', () => {
    for (const t of types) {
      const names = t.ops.map((o) => o.name.toLowerCase());
      expect(names.filter((n, i) => names.indexOf(n) !== i), t.name).toEqual([]);
    }
  });

  it('declares every verb that writes today as a write op somewhere', () => {
    const missing = WRITE_VERBS.filter((verb) => !types.some((t) => findOp(t, verb)?.access === 'write'));
    expect(missing).toEqual([]);
  });

  it('gives HTTP types every method and the common statuses and headers', () => {
    for (const name of ['REST API', 'GraphQL', 'Load Balancer', 'API Gateway', 'CDN', 'Third Party API']) {
      const t = byName.get(name)!;
      for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(findOp(t, m)?.access, `${name} ${m}`).toBe('read');
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(findOp(t, m)?.access, `${name} ${m}`).toBe('write');
      expect(t.statuses, name).toEqual(expect.arrayContaining([200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]));
      expect(t.headers, name).toEqual(expect.arrayContaining(['Authorization', 'Content-Type', 'Accept', 'Cache-Control', 'ETag', 'If-None-Match', 'Idempotency-Key', 'Retry-After', 'Location', 'X-Request-Id']));
    }
    // Services whose requests the design names itself have no fixed ops.
    for (const name of ['Service', 'Worker', 'gRPC', 'WebSocket', 'Go', 'Kubernetes', 'AWS Lambda']) expect(byName.get(name)!.ops, name).toEqual([]);
  });

  it('knows the key techs by their own commands', () => {
    const expectOps = (name: string, read: string[], write: string[]) => {
      const t = byName.get(name)!;
      for (const op of read) expect(findOp(t, op)?.access, `${name} ${op}`).toBe('read');
      for (const op of write) expect(findOp(t, op)?.access, `${name} ${op}`).toBe('write');
    };
    expectOps('PostgreSQL', ['SELECT'], ['INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'COMMIT']);
    expectOps('Redis', ['GET', 'MGET', 'HGETALL', 'ZRANGE', 'ZREVRANGE', 'SISMEMBER', 'PFCOUNT', 'GEOSEARCH', 'XREAD', 'TTL'], ['SET', 'DEL', 'INCR', 'INCRBY', 'DECR', 'EXPIRE', 'HSET', 'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'SADD', 'ZADD', 'ZINCRBY', 'PFADD', 'GEOADD', 'PUBLISH', 'XADD']);
    expectOps('AWS ElastiCache', ['GET'], ['SET']);
    expectOps('DynamoDB', ['GetItem', 'BatchGetItem', 'Query', 'Scan'], ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems']);
    expectOps('AWS S3', ['GetObject', 'HeadObject', 'ListObjectsV2'], ['PutObject', 'DeleteObject', 'CreateMultipartUpload', 'CompleteMultipartUpload']);
    expectOps('GCP Cloud Storage', ['GET', 'LIST'], ['Insert', 'Compose', 'Rewrite']);
    expectOps('Azure Blob Storage', ['GetBlob', 'ListBlobs'], ['PutBlob', 'PutBlockList', 'DeleteBlob']);
    expectOps('Kafka', ['Fetch', 'Consume', 'Poll'], ['Produce', 'Commit']);
    expectOps('AWS SQS', ['ReceiveMessage'], ['SendMessage', 'DeleteMessage', 'ChangeMessageVisibility']);
    expectOps('Elasticsearch', ['Search', 'Get', '_search'], ['Index', 'Bulk', 'Delete']);
    expectOps('MongoDB', ['find', 'aggregate'], ['insertOne', 'updateOne', 'deleteOne']);
    expectOps('Cassandra', ['SELECT'], ['INSERT', 'UPDATE', 'DELETE', 'BATCH']);
    expectOps('GraphQL', ['query', 'subscription'], ['mutation']);
    expectOps('Memcached', ['GET', 'GETS'], ['SET', 'ADD', 'CAS', 'DELETE']);
    expectOps('Payment Gateway', [], ['CHARGE', 'REFUND']);
    // Edges that carry WebSockets forward a MESSAGE; plain HTTP edges do not.
    for (const name of ['AWS Load Balancer', 'API Gateway', 'AWS API Gateway', 'Cloudflare', 'nginx', 'Envoy', 'HAProxy']) expect(findOp(byName.get(name)!, 'MESSAGE')?.access, name).toBe('forward');
    for (const name of ['CDN', 'Load Balancer', 'WAF', 'DNS']) expect(findOp(byName.get(name)!, 'MESSAGE'), name).toBeUndefined();
  });
});

/**
 * Steps of the practice problems whose label (or HTTP method) is an op of
 * the target's type with an access other than today's (dsl/access.ts).
 * These are real writes that the verb list reads; when step access comes
 * from the type's ops, they become writes.
 */
const ACCESS_CHANGES = [
  // A WebSocket frame the load balancer forwards: it writes when its handler does (chat's SEND, a document's OP).
  'AWS Load Balancer MESSAGE read→write',
  // User types of the problems: a consumed record spends budget, a ref update and its replication, a TAO write and invalidation.
  'BudgetService AdAggregate read→write',
  'BudgetService AdEvent read→write',
  'GitFileServer PREPARE read→write',
  'GitFileServer REPLICATE read→write',
  'Redis LPOP read→write',
  'Redis PFADD read→write',
  'Redis ZINCRBY read→write',
  // collaborative-docs: an edit is stored; a cursor (SessionServer CURSOR) is a read.
  'SessionServer OP read→write',
  'TAO INVALIDATE read→write',
  'TAO assoc_add read→write',
];

describe('the stdlib and the practice problems', () => {
  it('agrees with the access steps have today, except for the listed real writes', () => {
    const changes = new Set<string>();
    for (const p of problems) {
      for (const source of [p.solution, p.starter, ...(p.wrong ?? []).map((w) => w.source)]) {
        const { diagram } = parseSolution(p, source);
        const solution = source === p.solution;
        const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
        for (const step of diagram.useCases.flatMap((u) => u.scenarios.flatMap((s) => s.steps))) {
          const type = nodes.get(step.toServiceId)?.resolvedType;
          const word = step.httpMethod || /^\s*"?([A-Za-z_]+)/.exec(step.stepName.replace(/^((x\d+|~\S+)\s+)*/, ''))?.[1];
          const op = type && word ? findOp(type, word) : undefined;
          const before = accessOf(step.httpMethod || undefined, step.stepName);
          // The access the step gets: the op's, or for a forwarded frame its handler's.
          if (op && step.access !== before) changes.add(`${type!.name} ${op.name} ${before}→${step.access}`);
          // An op's multipliers would change the simulation of a reference solution.
          if (op && solution) expect(op.latency ?? op.cost, `${p.id}: ${type!.name} ${op.name}`).toBeUndefined();
        }
      }
    }
    expect([...changes].sort()).toEqual(ACCESS_CHANGES);
  });
});
