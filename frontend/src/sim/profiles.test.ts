import { describe, expect, it } from 'vitest';
import { componentCatalog } from '../catalog/componentCatalog';
import type { DiagramNode, Kind } from '../dsl/types';
import { KINDS, kindOf } from '../dsl/kinds';
import { capacityOf, combinedUtilization, profileOf } from './profiles';

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
    ['cdn', 'AWS CloudFront', 'cdn'],
    ['cdn', 'AWS Load Balancer', 'loadbalancer'],
    ['cdn', 'AWS Route53', 'dns'],
    ['cdn', 'Rectangle', 'edge'],
    ['serverless', 'AWS API Gateway', 'gateway'],
    ['serverless', 'Azure API Management', 'gateway'],
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
  const loc = { line: 1, col: 1, length: 1 };
  /** Fields every profile of a non-store has unless the table says otherwise; nodes you run pay internet egress. */
  const plain = { writeScaling: 'replicas', shards: 1, egressUsdPerGb: 0.09 } as const;

  it('uses the kind defaults from the design table', () => {
    expect(profileOf(node('service', 'REST API'))).toEqual({
      kind: 'service',
      rps: 2000,
      readRps: 2000,
      writeRps: 2000,
      latencyMs: 10,
      availability: 0.995,
      costUsd: 100,
      durable: false,
      bandwidthMBps: 200,
      ...plain,
    });
    expect(profileOf(node('cache', 'Memcached'))).toMatchObject({ rps: 100_000, readRps: 100_000, writeRps: 100_000, writeScaling: 'replicas', latencyMs: 1, availability: 0.999, costUsd: 150, durable: false });
    expect(profileOf(node('shape', 'Actor'))).toMatchObject({ kind: 'client', rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, bandwidthMBps: 10 });
    expect(profileOf(node('shape', 'Actor')).rps).toBe(Infinity);
  });

  it('gives relational databases 20k reads per replica and 5k writes per shard (§7.2)', () => {
    for (const tech of ['PostgreSQL', 'MySQL', 'AWS Aurora', 'AWS RDS', 'SQL Server', 'Oracle', 'MariaDB', 'GCP Cloud SQL', 'Azure SQL'] as const) {
      expect(profileOf(node('database', tech)), tech).toEqual({
        kind: 'database',
        rps: 20_000,
        readRps: 20_000,
        writeRps: 5000,
        writeScaling: 'shards',
        shards: 1,
        latencyMs: 5,
        availability: 0.9995,
        costUsd: 400,
        durable: true,
        consistency: 'strong',
        bandwidthMBps: 100,
        egressUsdPerGb: 0.09,
      });
    }
  });

  it('gives NoSQL databases their own row: 20k reads and writes, scaling with replicas', () => {
    for (const tech of ['DynamoDB', 'Cassandra', 'MongoDB', 'Azure Cosmos DB', 'GCP Bigtable', 'GCP Firestore', 'GCP Spanner'] as const) {
      expect(profileOf(node('database', tech)), tech).toMatchObject({
        kind: 'database',
        rps: 20_000,
        readRps: 20_000,
        writeRps: 20_000,
        writeScaling: 'replicas',
        latencyMs: 5,
        availability: 0.9999,
        costUsd: 500,
        durable: true,
      });
    }
  });

  it('has the §7.5 edge sub-kind numbers; dns is off the request path', () => {
    expect(profileOf(node('cdn', 'AWS CloudFront'))).toMatchObject({ kind: 'cdn', rps: 200_000, latencyMs: 5, availability: 0.9999, costUsd: 100, bandwidthMBps: 1000, egressUsdPerGb: 0.02 });
    expect(profileOf(node('cdn', 'AWS Load Balancer'))).toMatchObject({ kind: 'loadbalancer', rps: 100_000, latencyMs: 2, availability: 0.9999, costUsd: 50, bandwidthMBps: 1000 });
    expect(profileOf(node('serverless', 'AWS API Gateway'))).toMatchObject({ kind: 'gateway', rps: 10_000, latencyMs: 10, availability: 0.9995, costUsd: 100 });
    expect(profileOf(node('cdn', 'AWS Route53'))).toMatchObject({ kind: 'dns', rps: Infinity, latencyMs: 0, availability: 1 });
    expect(profileOf(node('cdn', 'Rectangle'))).toMatchObject({ kind: 'edge', rps: 100_000, latencyMs: 2, costUsd: 50 });
    // The generic edge profile is reachable from the catalog: a WAF sits in front of everything.
    expect(profileOf(node('cdn', 'WAF'))).toMatchObject({ kind: 'edge', rps: 100_000, latencyMs: 2, costUsd: 50 });
    expect(profileOf(node('cdn', 'AWS WAF')).kind).toBe('edge');
  });

  it('has bandwidth and egress prices per §7.3: internet egress for what you run, a CDN rate, nothing for clients and third parties', () => {
    expect(profileOf(node('storage', 'AWS S3'))).toMatchObject({ bandwidthMBps: 100, egressUsdPerGb: 0.09 });
    expect(profileOf(node('serverless', 'AWS Lambda'))).toMatchObject({ bandwidthMBps: 100, egressUsdPerGb: 0.09 });
    expect(profileOf(node('service', 'REST API'))).toMatchObject({ bandwidthMBps: 200, egressUsdPerGb: 0.09 });
    expect(profileOf(node('cdn', 'AWS CloudFront'))).toMatchObject({ bandwidthMBps: 1000, egressUsdPerGb: 0.02 });
    expect(profileOf(node('shape', 'Actor')).egressUsdPerGb).toBe(0);
    expect(profileOf(node('external', 'Stripe')).egressUsdPerGb).toBe(0);
    expect(profileOf(node('cdn', 'AWS Route53')).egressUsdPerGb).toBe(0);
  });

  it('takes a timeout override for failed calls to the node, and none by default', () => {
    expect(profileOf(node('service', 'REST API')).timeoutMs).toBeUndefined();
    expect(profileOf(node('service', 'REST API'), { node: 'n', timeoutMs: 250, loc }).timeoutMs).toBe(250);
  });

  it('gives data stores a consistency (§7.4), and nothing else one', () => {
    const consistency = (type: DiagramNode['type'], tech: DiagramNode['techStack']) => profileOf(node(type, tech)).consistency;
    expect(consistency('database', 'PostgreSQL')).toBe('strong');
    expect(consistency('database', 'GCP Spanner')).toBe('strong');
    expect(consistency('queue', 'Kafka')).toBe('strong');
    expect(consistency('database', 'DynamoDB')).toBe('eventual');
    expect(consistency('database', 'Cassandra')).toBe('eventual');
    expect(consistency('cache', 'Redis')).toBe('eventual');
    expect(consistency('database', 'Elasticsearch')).toBe('eventual');
    expect(consistency('storage', 'AWS S3')).toBe('eventual');
    expect(consistency('cdn', 'AWS CloudFront')).toBeUndefined();
    expect(consistency('service', 'REST API')).toBeUndefined();
    expect(consistency('cdn', 'AWS Load Balancer')).toBeUndefined();
    expect(profileOf(node('service', 'REST API'), { node: 'n', consistency: 'strong', loc }).consistency).toBeUndefined();
  });

  it('applies capacity overrides, with availability given in percent', () => {
    expect(profileOf(node('database', 'PostgreSQL'), { node: 'n', rps: 20_000, latencyMs: 4, availability: 99.99, costUsd: 900, durable: false, loc })).toMatchObject({
      kind: 'database',
      rps: 20_000,
      readRps: 20_000,
      writeRps: 20_000,
      latencyMs: 4,
      availability: expect.closeTo(0.9999, 12),
      costUsd: 900,
      durable: false,
    });
    expect(profileOf(node('cache', 'Redis'), { node: 'n', durable: true, loc })).toMatchObject({ rps: 100_000, durable: true });
  });

  it('lets readRps and writeRps win over rps, and takes shards, consistency, bandwidth and egress', () => {
    const p = profileOf(node('database', 'PostgreSQL'), {
      node: 'n',
      rps: 1000,
      readRps: 30_000,
      writeRps: 8000,
      shards: 4,
      consistency: 'eventual',
      bandwidthMBps: 500,
      egressUsdPerGb: 0.05,
      loc,
    });
    expect(p).toMatchObject({ rps: 30_000, readRps: 30_000, writeRps: 8000, shards: 4, consistency: 'eventual', bandwidthMBps: 500, egressUsdPerGb: 0.05 });
    expect(profileOf(node('database', 'PostgreSQL'), { node: 'n', writeRps: 8000, loc })).toMatchObject({ readRps: 20_000, writeRps: 8000 });
  });
});

describe('capacityOf and combinedUtilization', () => {
  it('scales relational reads with replicas × shards and writes with shards only', () => {
    const pg = profileOf(node('database', 'PostgreSQL'), { node: 'n', shards: 2, loc: { line: 1, col: 1, length: 1 } });
    // 20k × 3 replicas × 2 shards = 120k reads; 5k × 2 shards = 10k writes
    expect(capacityOf(pg, 3)).toEqual({ readRps: 120_000, writeRps: 10_000 });
    expect(combinedUtilization(pg, 0.5, 0.8)).toBe(0.8);
  });

  it('scales partitioned stores and services with replicas for both; their shares add up', () => {
    const dynamo = profileOf(node('database', 'DynamoDB'));
    expect(capacityOf(dynamo, 3)).toEqual({ readRps: 60_000, writeRps: 60_000 });
    expect(combinedUtilization(dynamo, 0.5, 0.25)).toBe(0.75);
    expect(capacityOf(profileOf(node('service', 'REST API')), 4)).toEqual({ readRps: 8000, writeRps: 8000 });
  });
});
