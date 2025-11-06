import type { ReactElement } from 'react';
import type { TechStack, ComponentType } from '../types/canvas';
import {
  // Lucide icons
  Server,
  Database,
  MessageSquare,
  ExternalLink,
  Cloud,
  Box,
  Square,
  Circle,
  Diamond,
  FileText,
  User,
  Zap,
  Container,
  HardDrive,
  Cpu,
  Network,
  Globe,
  Layers,
} from 'lucide-react';
import {
  // AWS Icons
  SiAmazonwebservices,
  SiAwslambda,
  SiAmazonapigateway,
  SiAmazonec2,
  SiAmazonecs,
  SiAmazoneks,
  SiAwsfargate,
  SiAmazons3,
  SiAmazonrds,
  SiAmazondynamodb,
  SiAmazonelasticache,
  SiAmazonsqs,
  SiAmazonroute53,
  SiAwselasticloadbalancing,
  // Database icons
  SiPostgresql,
  SiMysql,
  SiMongodb,
  SiRedis,
  SiApachecassandra,
  SiCouchbase,
  SiElasticsearch,
  SiNeo4J,
  SiInfluxdb,
  SiMariadb,
  SiSqlite,
  SiOracle,
  // Queue icons
  SiApachekafka,
  SiRabbitmq,
  // GCP icons
  SiGooglecloud,
  // Service icons
  SiGraphql,
} from 'react-icons/si';

// Icon mapping for each TechStack
export const techStackIcons: Record<TechStack, ReactElement> = {
  // Generic Shapes
  Rectangle: <Square className="w-5 h-5" />,
  Circle: <Circle className="w-5 h-5" />,
  Diamond: <Diamond className="w-5 h-5" />,
  Cylinder: <Database className="w-5 h-5" />,
  Cloud: <Cloud className="w-5 h-5" />,
  Actor: <User className="w-5 h-5" />,
  Note: <FileText className="w-5 h-5" />,

  // Services
  'REST API': <Server className="w-5 h-5" />,
  GraphQL: <SiGraphql className="w-5 h-5" />,
  gRPC: <Server className="w-5 h-5" />,
  WebSocket: <MessageSquare className="w-5 h-5" />,
  'SOAP API': <Server className="w-5 h-5" />,

  // AWS Serverless
  'AWS Lambda': <SiAwslambda className="w-5 h-5" />,
  'AWS API Gateway': <SiAmazonapigateway className="w-5 h-5" />,

  // AWS Compute
  'AWS EC2': <SiAmazonec2 className="w-5 h-5" />,
  'AWS ECS': <SiAmazonecs className="w-5 h-5" />,
  'AWS EKS': <SiAmazoneks className="w-5 h-5" />,
  'AWS Fargate': <SiAwsfargate className="w-5 h-5" />,

  // AWS Storage
  'AWS S3': <SiAmazons3 className="w-5 h-5" />,
  'AWS EBS': <HardDrive className="w-5 h-5" />,
  'AWS EFS': <HardDrive className="w-5 h-5" />,

  // AWS Database
  'AWS RDS': <SiAmazonrds className="w-5 h-5" />,
  'AWS DynamoDB': <SiAmazondynamodb className="w-5 h-5" />,
  'AWS ElastiCache': <SiAmazonelasticache className="w-5 h-5" />,
  'AWS Aurora': <SiAmazonrds className="w-5 h-5" />,

  // AWS Messaging
  'AWS SQS': <SiAmazonsqs className="w-5 h-5" />,
  'AWS SNS': <MessageSquare className="w-5 h-5" />,
  'AWS EventBridge': <MessageSquare className="w-5 h-5" />,
  'AWS Kinesis': <MessageSquare className="w-5 h-5" />,

  // AWS CDN/Network
  'AWS CloudFront': <Globe className="w-5 h-5" />,
  'AWS Route53': <SiAmazonroute53 className="w-5 h-5" />,
  'AWS Load Balancer': <SiAwselasticloadbalancing className="w-5 h-5" />,

  // GCP Serverless
  'GCP Cloud Functions': <Zap className="w-5 h-5" />,
  'GCP Cloud Run': <Container className="w-5 h-5" />,
  'GCP App Engine': <SiGooglecloud className="w-5 h-5" />,

  // GCP Compute
  'GCP Compute Engine': <Cpu className="w-5 h-5" />,
  'GCP GKE': <Container className="w-5 h-5" />,

  // GCP Storage
  'GCP Cloud Storage': <HardDrive className="w-5 h-5" />,
  'GCP Persistent Disk': <HardDrive className="w-5 h-5" />,

  // GCP Database
  'GCP Cloud SQL': <Database className="w-5 h-5" />,
  'GCP Firestore': <Database className="w-5 h-5" />,
  'GCP Bigtable': <Database className="w-5 h-5" />,
  'GCP Spanner': <Database className="w-5 h-5" />,
  'GCP BigQuery': <Database className="w-5 h-5" />,

  // GCP Messaging
  'GCP Pub/Sub': <MessageSquare className="w-5 h-5" />,

  // GCP CDN/Network
  'GCP Cloud CDN': <Globe className="w-5 h-5" />,
  'GCP Cloud DNS': <Network className="w-5 h-5" />,
  'GCP Load Balancing': <Network className="w-5 h-5" />,

  // Azure Serverless
  'Azure Functions': <Cloud className="w-5 h-5" />,
  'Azure Logic Apps': <Cloud className="w-5 h-5" />,
  'Azure API Management': <Cloud className="w-5 h-5" />,

  // Azure Compute
  'Azure VM': <Cpu className="w-5 h-5" />,
  'Azure AKS': <Container className="w-5 h-5" />,
  'Azure Container Instances': <Container className="w-5 h-5" />,

  // Azure Storage
  'Azure Blob Storage': <HardDrive className="w-5 h-5" />,
  'Azure Files': <HardDrive className="w-5 h-5" />,
  'Azure Disk Storage': <HardDrive className="w-5 h-5" />,

  // Azure Database
  'Azure SQL': <Database className="w-5 h-5" />,
  'Azure Cosmos DB': <Database className="w-5 h-5" />,
  'Azure Database for PostgreSQL': <SiPostgresql className="w-5 h-5" />,
  'Azure Database for MySQL': <SiMysql className="w-5 h-5" />,
  'Azure Cache for Redis': <SiRedis className="w-5 h-5" />,

  // Azure Messaging
  'Azure Service Bus': <MessageSquare className="w-5 h-5" />,
  'Azure Event Hubs': <MessageSquare className="w-5 h-5" />,
  'Azure Event Grid': <MessageSquare className="w-5 h-5" />,
  'Azure Queue Storage': <MessageSquare className="w-5 h-5" />,

  // Azure CDN/Network
  'Azure CDN': <Globe className="w-5 h-5" />,
  'Azure DNS': <Network className="w-5 h-5" />,
  'Azure Front Door': <Globe className="w-5 h-5" />,

  // Traditional Databases
  PostgreSQL: <SiPostgresql className="w-5 h-5" />,
  MySQL: <SiMysql className="w-5 h-5" />,
  MongoDB: <SiMongodb className="w-5 h-5" />,
  Redis: <SiRedis className="w-5 h-5" />,
  DynamoDB: <Database className="w-5 h-5" />,
  Cassandra: <SiApachecassandra className="w-5 h-5" />,
  CouchDB: <SiCouchbase className="w-5 h-5" />,
  Elasticsearch: <SiElasticsearch className="w-5 h-5" />,
  Neo4j: <SiNeo4J className="w-5 h-5" />,
  InfluxDB: <SiInfluxdb className="w-5 h-5" />,
  TimescaleDB: <Database className="w-5 h-5" />,
  MariaDB: <SiMariadb className="w-5 h-5" />,
  SQLite: <SiSqlite className="w-5 h-5" />,
  Oracle: <SiOracle className="w-5 h-5" />,
  'SQL Server': <Database className="w-5 h-5" />,

  // Cache & In-Memory
  Memcached: <Database className="w-5 h-5" />,
  Hazelcast: <Database className="w-5 h-5" />,
  Aerospike: <Database className="w-5 h-5" />,

  // Message Queues
  Kafka: <SiApachekafka className="w-5 h-5" />,
  RabbitMQ: <SiRabbitmq className="w-5 h-5" />,
  SQS: <MessageSquare className="w-5 h-5" />,
  'Redis Queue': <SiRedis className="w-5 h-5" />,
  NATS: <MessageSquare className="w-5 h-5" />,
  'Apache Pulsar': <MessageSquare className="w-5 h-5" />,
  ActiveMQ: <MessageSquare className="w-5 h-5" />,
  ZeroMQ: <MessageSquare className="w-5 h-5" />,

  // External Systems
  'Third Party API': <ExternalLink className="w-5 h-5" />,
  'Payment Gateway': <ExternalLink className="w-5 h-5" />,
  'Auth Service': <ExternalLink className="w-5 h-5" />,
  'Email Service': <ExternalLink className="w-5 h-5" />,
  'SMS Service': <ExternalLink className="w-5 h-5" />,
  'Analytics Service': <ExternalLink className="w-5 h-5" />,
};

// Color mapping for component types
export const componentTypeColors: Record<ComponentType, string> = {
  shape: 'bg-gray-500',
  service: 'bg-blue-500',
  database: 'bg-green-500',
  queue: 'bg-purple-500',
  external: 'bg-orange-500',
  serverless: 'bg-yellow-500',
  compute: 'bg-indigo-500',
  container: 'bg-cyan-500',
  storage: 'bg-pink-500',
  cache: 'bg-teal-500',
  cdn: 'bg-red-500',
};

// Category icon mapping
export const categoryIcons: Record<string, ReactElement> = {
  'Generic Shapes': <Box className="w-5 h-5" />,
  Services: <Server className="w-5 h-5" />,
  'AWS Services': <SiAmazonwebservices className="w-5 h-5" />,
  'GCP Services': <SiGooglecloud className="w-5 h-5" />,
  'Azure Services': <Cloud className="w-5 h-5" />,
  Databases: <Database className="w-5 h-5" />,
  'Cache & In-Memory': <Layers className="w-5 h-5" />,
  'Message Queues': <MessageSquare className="w-5 h-5" />,
  'External Systems': <ExternalLink className="w-5 h-5" />,
};

// Helper function to get icon for a tech stack
export function getTechStackIcon(techStack: TechStack): ReactElement {
  return techStackIcons[techStack] || <Server className="w-5 h-5" />;
}

// Helper function to get color for a component type
export function getComponentTypeColor(type: ComponentType): string {
  return componentTypeColors[type] || 'bg-gray-500';
}
