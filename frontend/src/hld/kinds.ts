import type { DiagramNode, Kind } from '../dsl/types';

/**
 * The simulation class of a node (docs/design/hld-and-practice.md §2.1), for
 * the HLD when no analysis is available. A deliberately small stand-in for the
 * simulation's profile table: the analysis, when present, wins.
 */

// First match wins, so the specific names come before the general ones.
const BY_TECH: [RegExp, Kind][] = [
  [/^Actor$/, 'client'],
  [/Redis Queue/, 'queue'],
  [/Redis|ElastiCache|Memcached|Hazelcast|Aerospike/, 'cache'],
  [/CloudFront|Load Balanc|Route53|API Gateway|Front Door|CDN|DNS|API Management/, 'edge'],
  [/Lambda|Cloud Functions|Azure Functions|Cloud Run|App Engine|Logic Apps/, 'function'],
  [/Elasticsearch/, 'search'],
  [/BigQuery|InfluxDB|TimescaleDB/, 'analytics'],
  [/Kafka|SQS|SNS|Kinesis|Pub\/Sub|RabbitMQ|Service Bus|Event Hubs|Event Grid|EventBridge|Queue Storage|NATS|Pulsar|ActiveMQ|ZeroMQ/, 'queue'],
  [/S3|Blob Storage|Cloud Storage|EFS|EBS|Azure Files|Disk Storage|Persistent Disk/, 'storage'],
  [/PostgreSQL|MySQL|Aurora|RDS|SQL Server|Oracle|Cloud SQL|MariaDB|SQLite|Azure SQL|DynamoDB|Cassandra|MongoDB|Cosmos DB|Bigtable|Firestore|Spanner|CouchDB|Neo4j/, 'database'],
  [/Third Party API|Payment Gateway|Auth Service|Email Service|SMS Service|Analytics Service/, 'external'],
];

const BY_TYPE: Partial<Record<DiagramNode['type'], Kind>> = {
  shape: 'client',
  service: 'service',
  compute: 'service',
  container: 'service',
  serverless: 'function',
  database: 'database',
  queue: 'queue',
  cache: 'cache',
  storage: 'storage',
  cdn: 'edge',
  external: 'external',
};

export function kindOf(node: DiagramNode): Kind {
  return BY_TECH.find(([pattern]) => pattern.test(node.techStack))?.[1] ?? BY_TYPE[node.type] ?? 'other';
}
