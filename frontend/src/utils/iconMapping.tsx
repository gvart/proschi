import type { ReactElement } from 'react';
import type { ComponentType, TechName, TechStack } from '../types/canvas';
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
  StickyNote,
  FolderOpen,
  Smartphone,
  Monitor,
  Search,
  BarChart3,
  Shield,
  Shuffle,
  DoorOpen,
  Bell,
  KeyRound,
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
  // Languages, platforms, proxies
  SiSpringboot,
  SiKotlin,
  SiOpenjdk,
  SiGo,
  SiNodedotjs,
  SiPython,
  SiDjango,
  SiFastapi,
  SiFlask,
  SiRubyonrails,
  SiDotnet,
  SiPhp,
  SiRust,
  SiElixir,
  SiKubernetes,
  SiDocker,
  SiCloudflareworkers,
  SiNginx,
  SiEnvoyproxy,
  SiTraefikproxy,
  SiKong,
  SiCloudflare,
  SiFastly,
  SiAkamai,
  // Stores, queues, analytics
  SiCockroachlabs,
  SiScylladb,
  SiApachehbase,
  SiEtcd,
  SiAmazondocumentdb,
  SiOpensearch,
  SiApachesolr,
  SiMeilisearch,
  SiAlgolia,
  SiSnowflake,
  SiClickhouse,
  SiApachedruid,
  SiDatabricks,
  SiPrometheus,
  SiTimescale,
  SiAmazonredshift,
  SiGooglebigquery,
  SiGooglecloudspanner,
  SiGooglecloudstorage,
  SiGooglepubsub,
  SiMinio,
  SiNatsdotio,
  SiApachepulsar,
  // External services
  SiStripe,
  SiPaypal,
  SiAdyen,
  SiBraintree,
  SiTwilio,
  SiSendgrid,
  SiMailgun,
  SiAuth0,
  SiOkta,
  SiGooglemaps,
  SiOpenai,
  SiFirebase,
  SiAmazonsimpleemailservice,
} from 'react-icons/si';

/** Icons of tech stacks that have their own; the rest get their component type's (`typeIcons`). */
export const techStackIcons: Partial<Record<TechStack, ReactElement>> = {
  // Generic Shapes
  Rectangle: <Square className="w-5 h-5" />,
  Circle: <Circle className="w-5 h-5" />,
  Diamond: <Diamond className="w-5 h-5" />,
  Cylinder: <Database className="w-5 h-5" />,
  Cloud: <Cloud className="w-5 h-5" />,
  Actor: <User className="w-5 h-5" />,
  Browser: <Monitor className="w-5 h-5" />,
  'Mobile App': <Smartphone className="w-5 h-5" />,
  Note: <FileText className="w-5 h-5" />,

  // Generic components
  'Load Balancer': <Shuffle className="w-5 h-5" />,
  'API Gateway': <DoorOpen className="w-5 h-5" />,
  WAF: <Shield className="w-5 h-5" />,
  'Search Engine': <Search className="w-5 h-5" />,
  'Data Warehouse': <BarChart3 className="w-5 h-5" />,

  // Languages and frameworks, platforms
  'Spring Boot': <SiSpringboot className="w-5 h-5" />,
  Kotlin: <SiKotlin className="w-5 h-5" />,
  Java: <SiOpenjdk className="w-5 h-5" />,
  Go: <SiGo className="w-5 h-5" />,
  'Node.js': <SiNodedotjs className="w-5 h-5" />,
  Python: <SiPython className="w-5 h-5" />,
  Django: <SiDjango className="w-5 h-5" />,
  FastAPI: <SiFastapi className="w-5 h-5" />,
  Flask: <SiFlask className="w-5 h-5" />,
  'Ruby on Rails': <SiRubyonrails className="w-5 h-5" />,
  '.NET': <SiDotnet className="w-5 h-5" />,
  PHP: <SiPhp className="w-5 h-5" />,
  Rust: <SiRust className="w-5 h-5" />,
  Elixir: <SiElixir className="w-5 h-5" />,
  Kubernetes: <SiKubernetes className="w-5 h-5" />,
  Docker: <SiDocker className="w-5 h-5" />,
  'Cloudflare Workers': <SiCloudflareworkers className="w-5 h-5" />,

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
  'GCP Cloud Storage': <SiGooglecloudstorage className="w-5 h-5" />,
  'GCP Persistent Disk': <HardDrive className="w-5 h-5" />,

  // GCP Database
  'GCP Cloud SQL': <Database className="w-5 h-5" />,
  'GCP Firestore': <Database className="w-5 h-5" />,
  'GCP Bigtable': <Database className="w-5 h-5" />,
  'GCP Spanner': <SiGooglecloudspanner className="w-5 h-5" />,
  'GCP BigQuery': <SiGooglebigquery className="w-5 h-5" />,

  // GCP Messaging
  'GCP Pub/Sub': <SiGooglepubsub className="w-5 h-5" />,

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
  TimescaleDB: <SiTimescale className="w-5 h-5" />,
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
  NATS: <SiNatsdotio className="w-5 h-5" />,
  'Apache Pulsar': <SiApachepulsar className="w-5 h-5" />,
  ActiveMQ: <MessageSquare className="w-5 h-5" />,
  ZeroMQ: <MessageSquare className="w-5 h-5" />,

  // External Systems
  'Third Party API': <ExternalLink className="w-5 h-5" />,
  'Payment Gateway': <ExternalLink className="w-5 h-5" />,
  'Auth Service': <ExternalLink className="w-5 h-5" />,
  'Email Service': <ExternalLink className="w-5 h-5" />,
  'SMS Service': <ExternalLink className="w-5 h-5" />,
  'Analytics Service': <ExternalLink className="w-5 h-5" />,
  'Push Service': <Bell className="w-5 h-5" />,
  Stripe: <SiStripe className="w-5 h-5" />,
  PayPal: <SiPaypal className="w-5 h-5" />,
  Adyen: <SiAdyen className="w-5 h-5" />,
  Braintree: <SiBraintree className="w-5 h-5" />,
  Twilio: <SiTwilio className="w-5 h-5" />,
  SendGrid: <SiSendgrid className="w-5 h-5" />,
  Mailgun: <SiMailgun className="w-5 h-5" />,
  Auth0: <SiAuth0 className="w-5 h-5" />,
  Okta: <SiOkta className="w-5 h-5" />,
  'Google Maps': <SiGooglemaps className="w-5 h-5" />,
  APNs: <Bell className="w-5 h-5" />,
  FCM: <SiFirebase className="w-5 h-5" />,
  OpenAI: <SiOpenai className="w-5 h-5" />,
  'AWS SES': <SiAmazonsimpleemailservice className="w-5 h-5" />,
  'AWS Cognito': <KeyRound className="w-5 h-5" />,

  // Stores, search and analytics
  CockroachDB: <SiCockroachlabs className="w-5 h-5" />,
  ScyllaDB: <SiScylladb className="w-5 h-5" />,
  HBase: <SiApachehbase className="w-5 h-5" />,
  etcd: <SiEtcd className="w-5 h-5" />,
  'AWS DocumentDB': <SiAmazondocumentdb className="w-5 h-5" />,
  'AWS Redshift': <SiAmazonredshift className="w-5 h-5" />,
  'AWS OpenSearch': <SiOpensearch className="w-5 h-5" />,
  OpenSearch: <SiOpensearch className="w-5 h-5" />,
  Solr: <SiApachesolr className="w-5 h-5" />,
  Meilisearch: <SiMeilisearch className="w-5 h-5" />,
  Algolia: <SiAlgolia className="w-5 h-5" />,
  Snowflake: <SiSnowflake className="w-5 h-5" />,
  ClickHouse: <SiClickhouse className="w-5 h-5" />,
  'Apache Druid': <SiApachedruid className="w-5 h-5" />,
  Databricks: <SiDatabricks className="w-5 h-5" />,
  Prometheus: <SiPrometheus className="w-5 h-5" />,
  Valkey: <SiRedis className="w-5 h-5" />,
  KeyDB: <SiRedis className="w-5 h-5" />,
  'GCP Memorystore': <SiRedis className="w-5 h-5" />,
  MinIO: <SiMinio className="w-5 h-5" />,
  'Cloudflare R2': <SiCloudflare className="w-5 h-5" />,
  Redpanda: <SiApachekafka className="w-5 h-5" />,
  'AWS MSK': <SiApachekafka className="w-5 h-5" />,

  // CDN, proxies and gateways
  Cloudflare: <SiCloudflare className="w-5 h-5" />,
  Fastly: <SiFastly className="w-5 h-5" />,
  Akamai: <SiAkamai className="w-5 h-5" />,
  nginx: <SiNginx className="w-5 h-5" />,
  Envoy: <SiEnvoyproxy className="w-5 h-5" />,
  HAProxy: <Shuffle className="w-5 h-5" />,
  Traefik: <SiTraefikproxy className="w-5 h-5" />,
  'Kubernetes Ingress': <SiKubernetes className="w-5 h-5" />,
  Kong: <SiKong className="w-5 h-5" />,
  'Spring Cloud Gateway': <SiSpringboot className="w-5 h-5" />,
  'AWS WAF': <Shield className="w-5 h-5" />,
  'AWS Global Accelerator': <Globe className="w-5 h-5" />,
  'Azure Load Balancer': <Network className="w-5 h-5" />,
  'Azure Application Gateway': <Network className="w-5 h-5" />,

  // Text & Annotations
  'Text Note': <StickyNote className="w-5 h-5" />,
  'Sticky Note': <StickyNote className="w-5 h-5" />,
  Comment: <FileText className="w-5 h-5" />,

  // Grouping
  'Logical Group': <FolderOpen className="w-5 h-5" />,
  'Network Boundary': <Box className="w-5 h-5" />,
  'Security Zone': <Box className="w-5 h-5" />,
  'Service Group': <Layers className="w-5 h-5" />,
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
  text: 'bg-yellow-400',
  group: 'bg-blue-400',
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
  Annotations: <StickyNote className="w-5 h-5" />,
  Grouping: <FolderOpen className="w-5 h-5" />,
};

/** Icons by component type, for tech stacks without their own (generic and unknown ones included). */
export const typeIcons: Record<ComponentType, ReactElement> = {
  shape: <Square className="w-5 h-5" />,
  service: <Server className="w-5 h-5" />,
  database: <Database className="w-5 h-5" />,
  queue: <MessageSquare className="w-5 h-5" />,
  external: <ExternalLink className="w-5 h-5" />,
  serverless: <Zap className="w-5 h-5" />,
  compute: <Cpu className="w-5 h-5" />,
  container: <Container className="w-5 h-5" />,
  storage: <HardDrive className="w-5 h-5" />,
  cache: <Layers className="w-5 h-5" />,
  cdn: <Globe className="w-5 h-5" />,
  text: <StickyNote className="w-5 h-5" />,
  group: <FolderOpen className="w-5 h-5" />,
};

/** The icon of a tech stack: its own, else its component type's. */
export function getTechStackIcon(techStack: TechName, type?: ComponentType): ReactElement {
  return techStackIcons[techStack as TechStack] ?? (type ? typeIcons[type] : undefined) ?? <Server className="w-5 h-5" />;
}

// Helper function to get color for a component type
export function getComponentTypeColor(type: ComponentType): string {
  return componentTypeColors[type] || 'bg-gray-500';
}
