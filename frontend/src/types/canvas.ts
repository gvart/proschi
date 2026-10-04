export type ComponentType =
  | 'shape'
  | 'service'
  | 'database'
  | 'queue'
  | 'external'
  | 'serverless'
  | 'compute'
  | 'container'
  | 'storage'
  | 'cache'
  | 'cdn'
  | 'text'
  | 'group';

export type TechStack =
  // Generic Shapes
  | 'Rectangle'
  | 'Circle'
  | 'Diamond'
  | 'Cylinder'
  | 'Cloud'
  | 'Actor'
  | 'Note'
  // Services
  | 'REST API'
  | 'GraphQL'
  | 'gRPC'
  | 'WebSocket'
  | 'SOAP API'
  // AWS Serverless
  | 'AWS Lambda'
  | 'AWS API Gateway'
  // AWS Compute
  | 'AWS EC2'
  | 'AWS ECS'
  | 'AWS EKS'
  | 'AWS Fargate'
  // AWS Storage
  | 'AWS S3'
  | 'AWS EBS'
  | 'AWS EFS'
  // AWS Database
  | 'AWS RDS'
  | 'AWS DynamoDB'
  | 'AWS ElastiCache'
  | 'AWS Aurora'
  // AWS Messaging
  | 'AWS SQS'
  | 'AWS SNS'
  | 'AWS EventBridge'
  | 'AWS Kinesis'
  // AWS CDN/Network
  | 'AWS CloudFront'
  | 'AWS Route53'
  | 'AWS Load Balancer'
  // GCP Serverless
  | 'GCP Cloud Functions'
  | 'GCP Cloud Run'
  | 'GCP App Engine'
  // GCP Compute
  | 'GCP Compute Engine'
  | 'GCP GKE'
  // GCP Storage
  | 'GCP Cloud Storage'
  | 'GCP Persistent Disk'
  // GCP Database
  | 'GCP Cloud SQL'
  | 'GCP Firestore'
  | 'GCP Bigtable'
  | 'GCP Spanner'
  | 'GCP BigQuery'
  // GCP Messaging
  | 'GCP Pub/Sub'
  // GCP CDN/Network
  | 'GCP Cloud CDN'
  | 'GCP Cloud DNS'
  | 'GCP Load Balancing'
  // Azure Serverless
  | 'Azure Functions'
  | 'Azure Logic Apps'
  | 'Azure API Management'
  // Azure Compute
  | 'Azure VM'
  | 'Azure AKS'
  | 'Azure Container Instances'
  // Azure Storage
  | 'Azure Blob Storage'
  | 'Azure Files'
  | 'Azure Disk Storage'
  // Azure Database
  | 'Azure SQL'
  | 'Azure Cosmos DB'
  | 'Azure Database for PostgreSQL'
  | 'Azure Database for MySQL'
  | 'Azure Cache for Redis'
  // Azure Messaging
  | 'Azure Service Bus'
  | 'Azure Event Hubs'
  | 'Azure Event Grid'
  | 'Azure Queue Storage'
  // Azure CDN/Network
  | 'Azure CDN'
  | 'Azure DNS'
  | 'Azure Front Door'
  // Traditional Databases
  | 'PostgreSQL'
  | 'MySQL'
  | 'MongoDB'
  | 'Redis'
  | 'DynamoDB'
  | 'Cassandra'
  | 'CouchDB'
  | 'Elasticsearch'
  | 'Neo4j'
  | 'InfluxDB'
  | 'TimescaleDB'
  | 'MariaDB'
  | 'SQLite'
  | 'Oracle'
  | 'SQL Server'
  // Cache & In-Memory
  | 'Memcached'
  | 'Hazelcast'
  | 'Aerospike'
  // Message Queues
  | 'Kafka'
  | 'RabbitMQ'
  | 'SQS'
  | 'Redis Queue'
  | 'NATS'
  | 'Apache Pulsar'
  | 'ActiveMQ'
  | 'ZeroMQ'
  // External Systems
  | 'Third Party API'
  | 'Payment Gateway'
  | 'Auth Service'
  | 'Email Service'
  | 'SMS Service'
  | 'Analytics Service'
  // Text & Annotations
  | 'Text Note'
  | 'Sticky Note'
  | 'Comment'
  // Grouping
  | 'Logical Group'
  | 'Network Boundary'
  | 'Security Zone'
  | 'Service Group';

export interface ComponentMetadata {
  id: string;
  name: string;
  type: ComponentType;
  techStack: TechStack;
  ownerTeam?: string;
  description?: string;
  // For text nodes
  textContent?: string;
  fontSize?: number;
  // For group nodes
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: ComponentMetadata;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
}
