import { describe, expect, it } from 'vitest';
import { componentCatalog } from '../catalog/componentCatalog';
import { KINDS, isDataStore, isKind, kindOf } from './kinds';
import { parse } from './parser';

const kindOfTech = (tech: string) => kindOf(parse(`n [${tech}]`).diagram.nodes[0]);

describe('kindOf', () => {
  it.each([
    ['Actor', 'client'],
    ['Rectangle', 'client'],
    ['AWS CloudFront', 'edge'],
    ['AWS Load Balancer', 'edge'],
    ['AWS API Gateway', 'edge'],
    ['Azure Front Door', 'edge'],
    ['REST API', 'service'],
    ['gRPC', 'service'],
    ['AWS ECS', 'service'],
    ['AWS EC2', 'service'],
    ['AWS Lambda', 'function'],
    ['GCP Cloud Run', 'function'],
    ['Redis', 'cache'],
    ['AWS ElastiCache', 'cache'],
    ['Memcached', 'cache'],
    ['PostgreSQL', 'database'],
    ['DynamoDB', 'database'],
    ['Azure Cosmos DB', 'database'],
    ['Elasticsearch', 'search'],
    ['GCP BigQuery', 'analytics'],
    ['InfluxDB', 'analytics'],
    ['Kafka', 'queue'],
    ['AWS SQS', 'queue'],
    ['AWS S3', 'storage'],
    ['Azure Blob Storage', 'storage'],
    ['Payment Gateway', 'external'],
    ['Sticky Note', 'other'],
    ['Network Boundary', 'other'],
  ])('%s is a %s', (tech, kind) => {
    expect(kindOfTech(tech)).toBe(kind);
  });

  it('treats a node without a tech, and an implicit node, as a client', () => {
    const { diagram } = parse('a\na -> b');
    expect(diagram.nodes.map(kindOf)).toEqual(['client', 'client']);
  });

  it('treats groups as other', () => {
    expect(kindOf(parse('group g {\n}').diagram.nodes[0])).toBe('other');
  });

  it('gives every catalog component a kind from the table', () => {
    for (const c of componentCatalog) {
      const kind = kindOf({ kind: c.type === 'group' ? 'group' : c.type === 'text' ? 'text' : 'component', type: c.type, techStack: c.techStack });
      expect(KINDS, c.techStack).toContain(kind);
      if (c.type !== 'group' && c.type !== 'text') expect(kind, c.techStack).not.toBe('other');
    }
  });

  it('knows which kinds store data', () => {
    expect(KINDS.filter(isDataStore)).toEqual(['cache', 'database', 'search', 'analytics', 'queue', 'storage']);
    expect(isKind('cache')).toBe(true);
    expect(isKind('node')).toBe(false);
  });
});
