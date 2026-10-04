import { describe, expect, it } from 'vitest';
import { kindFromName, kindOf } from '../dsl/kinds';
import { parse } from '../dsl/parser';
import { profileOf } from '../sim/profiles';
import { catalogCollisions, componentCatalog, editDistance, findTech, suggestTech, techKey } from './componentCatalog';

const kindOfTech = (written: string) => {
  const node = parse(`n [${written}]`).diagram.nodes[0];
  return kindOf(node);
};

describe('component catalog', () => {
  it('has no two names or aliases that normalise to the same key', () => {
    expect(catalogCollisions()).toEqual([]);
  });

  it('has unique tech stack names', () => {
    const names = componentCatalog.map((c) => c.techStack);
    expect(new Set(names).size).toBe(names.length);
  });

  it('normalises case, spaces and punctuation', () => {
    expect(techKey('Route 53')).toBe('route53');
    expect(techKey('Pub/Sub')).toBe('pubsub');
    expect(techKey('Node.js')).toBe('nodejs');
    expect(findTech('ROUTE-53')?.techStack).toBe('AWS Route53');
    expect(findTech('postgresql 16.2')?.techStack).toBe('PostgreSQL');
    expect(findTech('Redis v7')?.techStack).toBe('Redis');
    expect(findTech('Nonexistent')).toBeUndefined();
    expect(findTech('')).toBeUndefined();
  });

  // What people write, and the kind the simulation gives it.
  it.each([
    ['S3', 'storage'],
    ['GCS', 'storage'],
    ['Azure Blob', 'storage'],
    ['MinIO', 'storage'],
    ['DynamoDB', 'database'],
    ['Cassandra', 'database'],
    ['ScyllaDB', 'database'],
    ['MongoDB', 'database'],
    ['CockroachDB', 'database'],
    ['Spanner', 'database'],
    ['Aurora', 'database'],
    ['Postgres', 'database'],
    ['MySQL', 'database'],
    ['MariaDB', 'database'],
    ['SQL Server', 'database'],
    ['Oracle', 'database'],
    ['Redis', 'cache'],
    ['Memcached', 'cache'],
    ['Valkey', 'cache'],
    ['Kafka', 'queue'],
    ['Kinesis', 'queue'],
    ['SQS', 'queue'],
    ['SNS', 'queue'],
    ['RabbitMQ', 'queue'],
    ['Pub/Sub', 'queue'],
    ['NATS', 'queue'],
    ['EventBridge', 'queue'],
    ['Elasticsearch', 'search'],
    ['OpenSearch', 'search'],
    ['Solr', 'search'],
    ['CloudFront', 'cdn'],
    ['Fastly', 'cdn'],
    ['Akamai', 'cdn'],
    ['Cloudflare', 'cdn'],
    ['ALB', 'loadbalancer'],
    ['NLB', 'loadbalancer'],
    ['ELB', 'loadbalancer'],
    ['nginx', 'loadbalancer'],
    ['Envoy', 'loadbalancer'],
    ['HAProxy', 'loadbalancer'],
    ['API Gateway', 'gateway'],
    ['Kong', 'gateway'],
    ['Route53', 'dns'],
    ['Lambda', 'function'],
    ['Cloud Functions', 'function'],
    ['ECS', 'service'],
    ['EKS', 'service'],
    ['Kubernetes', 'service'],
    ['Spring', 'service'],
    ['Kotlin', 'service'],
    ['Java', 'service'],
    ['Go', 'service'],
    ['Node', 'service'],
    ['Python', 'service'],
    ['Snowflake', 'analytics'],
    ['BigQuery', 'analytics'],
    ['Redshift', 'analytics'],
    ['ClickHouse', 'analytics'],
    ['Neo4j', 'database'],
    ['InfluxDB', 'analytics'],
    ['TimescaleDB', 'analytics'],
    ['Stripe', 'external'],
    ['Twilio', 'external'],
    ['WAF', 'edge'],
  ])('knows [%s] as a %s', (written, kind) => {
    expect(findTech(written), written).toBeDefined();
    expect(parse(`n [${written}]`).diagnostics).toEqual([]);
    expect(kindOfTech(written)).toBe(kind);
  });

  it('gives every component in the catalog a finite, priced profile (except clients, DNS and third parties)', () => {
    for (const c of componentCatalog) {
      if (c.type === 'shape' || c.type === 'text' || c.type === 'group') continue;
      const node = parse(`n [${c.techStack}]`).diagram.nodes[0];
      const p = profileOf(node);
      if (p.kind === 'dns') continue;
      expect(Number.isFinite(p.rps), c.techStack).toBe(true);
      expect(p.latencyMs, c.techStack).toBeGreaterThan(0);
      if (p.kind !== 'external') expect(p.costUsd, c.techStack).toBeGreaterThan(0);
    }
  });
});

describe('unknown tech stacks', () => {
  it.each([
    ['TigerBeetle DB', 'database'],
    ['Acme Cache', 'cache'],
    ['In-house Message Broker', 'queue'],
    ['Our Search Index', 'search'],
    ['Ceph-like Object Storage', 'storage'],
    ['Edge CDN v2', 'cdn'],
    ['Custom Load Balancer', 'loadbalancer'],
    ['SMS Gateway Inc', 'external'],
    ['Partner Webhook', 'external'],
    ['Corporate Firewall', 'edge'],
    ['Billing Ledger', 'database'],
    ['Clickstream Warehouse', 'analytics'],
  ])('reads the kind of [%s] from its name: %s', (tech, kind) => {
    expect(kindFromName(tech)).toBe(kind);
  });

  it('falls back to the closest tech, then to a service, never a client', () => {
    expect(kindOfTech('Postgress')).toBe('database');
    expect(kindOfTech('Cobol Mainframe')).toBe('service');
    const p = profileOf(parse('n [Cobol Mainframe]').diagram.nodes[0]);
    expect(p).toMatchObject({ kind: 'service', rps: 2000, latencyMs: 10, costUsd: 100 });
  });

  it('suggests close names and known names inside longer ones', () => {
    expect(suggestTech('Postgress')).toBe('PostgreSQL');
    expect(suggestTech('Kafak')).toBe('Kafka');
    expect(suggestTech('Elasticsaerch')).toBe('Elasticsearch');
    expect(suggestTech('Postgres on Kubernetes')).toBe('PostgreSQL');
    expect(suggestTech('Zzyzx')).toBeUndefined();
    // Annotations are never suggested for a node.
    expect(suggestTech('Note')).not.toBe('Note');
  });

  it('counts a transposition as one edit', () => {
    expect(editDistance('kafak', 'kafka')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
