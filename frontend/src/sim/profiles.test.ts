import { describe, expect, it } from 'vitest';
import { componentCatalog } from '../catalog/componentCatalog';
import type { DiagramNode, Kind } from '../dsl/types';
import { KINDS, kindOf } from '../dsl/kinds';
import { KIND_PROFILES, profileOf } from './profiles';

const node = (type: DiagramNode['type'], techStack: DiagramNode['techStack'], kind: DiagramNode['kind'] = 'component'): DiagramNode => ({
  id: 'n',
  kind,
  name: 'n',
  type,
  techStack,
  loc: { line: 1, col: 1, length: 1 },
});

describe('kindOf', () => {
  it('maps every catalog tech to a kind', () => {
    for (const option of componentCatalog) {
      const kind = kindOf(node(option.type, option.techStack, option.type === 'group' ? 'group' : option.type === 'text' ? 'text' : 'component'));
      expect(KINDS, option.techStack).toContain(kind);
      if (option.type === 'text' || option.type === 'group' || option.techStack === 'Note') expect(kind, option.techStack).toBe('other');
      else if (option.type === 'shape') expect(kind, option.techStack).toBe('client');
      else expect(['client', 'other'], option.techStack).not.toContain(kind);
    }
  });

  it.each<[DiagramNode['type'], DiagramNode['techStack'], Kind]>([
    ['shape', 'Actor', 'client'],
    ['shape', 'Rectangle', 'client'],
    ['cdn', 'AWS CloudFront', 'edge'],
    ['cdn', 'AWS Load Balancer', 'edge'],
    ['serverless', 'AWS API Gateway', 'edge'],
    ['serverless', 'Azure API Management', 'edge'],
    ['service', 'REST API', 'service'],
    ['container', 'AWS EKS', 'service'],
    ['compute', 'AWS EC2', 'service'],
    ['serverless', 'AWS Lambda', 'function'],
    ['serverless', 'GCP Cloud Run', 'function'],
    ['cache', 'AWS ElastiCache', 'cache'],
    ['database', 'Redis', 'cache'],
    ['database', 'PostgreSQL', 'database'],
    ['database', 'AWS DynamoDB', 'database'],
    ['database', 'Elasticsearch', 'search'],
    ['database', 'GCP BigQuery', 'analytics'],
    ['database', 'InfluxDB', 'analytics'],
    ['queue', 'Kafka', 'queue'],
    ['storage', 'AWS S3', 'storage'],
    ['external', 'Payment Gateway', 'external'],
  ])('%s %s is %s', (type, tech, kind) => {
    expect(kindOf(node(type, tech))).toBe(kind);
  });

  it('treats groups and text nodes as other', () => {
    expect(kindOf(node('group', 'Logical Group', 'group'))).toBe('other');
    expect(kindOf(node('text', 'Sticky Note', 'text'))).toBe('other');
  });
});

describe('profileOf', () => {
  it('uses the kind defaults from the design table', () => {
    expect(profileOf(node('service', 'REST API'))).toEqual({ kind: 'service', rps: 2000, latencyMs: 10, availability: 0.995, costUsd: 100, durable: false });
    expect(profileOf(node('database', 'PostgreSQL'))).toEqual({ kind: 'database', rps: 5000, latencyMs: 5, availability: 0.9995, costUsd: 400, durable: true });
    expect(profileOf(node('cache', 'Memcached'))).toMatchObject({ rps: 100_000, latencyMs: 1, availability: 0.999, costUsd: 150, durable: false });
    expect(profileOf(node('shape', 'Actor'))).toEqual({ kind: 'client', ...KIND_PROFILES.client });
    expect(profileOf(node('shape', 'Actor')).rps).toBe(Infinity);
  });

  it('gives NoSQL databases their own row', () => {
    for (const tech of ['DynamoDB', 'Cassandra', 'MongoDB', 'Azure Cosmos DB', 'GCP Bigtable', 'GCP Firestore', 'GCP Spanner'] as const) {
      expect(profileOf(node('database', tech)), tech).toEqual({ kind: 'database', rps: 20_000, latencyMs: 5, availability: 0.9999, costUsd: 500, durable: true });
    }
  });

  it('applies capacity overrides, with availability given in percent', () => {
    const loc = { line: 1, col: 1, length: 1 };
    expect(profileOf(node('database', 'PostgreSQL'), { node: 'n', rps: 20_000, latencyMs: 4, availability: 99.99, costUsd: 900, durable: false, loc })).toEqual({
      kind: 'database',
      rps: 20_000,
      latencyMs: 4,
      availability: expect.closeTo(0.9999, 12),
      costUsd: 900,
      durable: false,
    });
    expect(profileOf(node('cache', 'Redis'), { node: 'n', durable: true, loc })).toMatchObject({ rps: 100_000, durable: true });
  });
});
