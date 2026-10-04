import { describe, expect, it } from 'vitest';
import { componentCatalog } from '../catalog/componentCatalog';
import { EDGE_KINDS, KINDS, isDataStore, isEdge, isKind, kindMatches, kindOf } from './kinds';
import { parse } from './parser';

const kindOfTech = (tech: string) => kindOf(parse(`n [${tech}]`).diagram.nodes[0]);

describe('kindOf', () => {
  it.each([
    ['Actor', 'client'],
    ['Rectangle', 'client'],
    ['AWS CloudFront', 'cdn'],
    ['Azure CDN', 'cdn'],
    ['GCP Cloud CDN', 'cdn'],
    ['Azure Front Door', 'cdn'],
    ['AWS Load Balancer', 'loadbalancer'],
    ['GCP Load Balancing', 'loadbalancer'],
    ['AWS API Gateway', 'gateway'],
    ['Azure API Management', 'gateway'],
    ['AWS Route53', 'dns'],
    ['Azure DNS', 'dns'],
    ['GCP Cloud DNS', 'dns'],
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
    ['Note', 'other'],
    ['Cylinder', 'client'],
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
      if (c.type !== 'group' && c.type !== 'text' && c.techStack !== 'Note') expect(kind, c.techStack).not.toBe('other');
    }
  });

  it('keeps a cdn-type component with another tech a plain edge', () => {
    expect(kindOf({ kind: 'component', type: 'cdn', techStack: 'Rectangle' })).toBe('edge');
  });

  it('lets any edge match every edge sub-kind (§7.5), and nothing else', () => {
    expect(EDGE_KINDS).toEqual(['edge', 'cdn', 'loadbalancer', 'gateway', 'dns']);
    for (const k of EDGE_KINDS) {
      expect(isEdge(k)).toBe(true);
      expect(kindMatches(k, 'edge'), k).toBe(true);
      expect(isKind(k)).toBe(true);
    }
    expect(kindMatches('cdn', 'cdn')).toBe(true);
    expect(kindMatches('edge', 'cdn')).toBe(false);
    expect(kindMatches('gateway', 'loadbalancer')).toBe(false);
    expect(kindMatches('service', 'edge')).toBe(false);
    expect(isEdge('service')).toBe(false);
  });

  it('knows which kinds store data', () => {
    expect(KINDS.filter(isDataStore)).toEqual(['cache', 'database', 'search', 'analytics', 'queue', 'storage']);
    expect(isKind('cache')).toBe(true);
    expect(isKind('node')).toBe(false);
  });
});
