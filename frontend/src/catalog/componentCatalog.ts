import type { ComponentType } from '../types/canvas';
import type { Kind } from '../dsl/types';

/**
 * Every tech stack the language knows: what `[Tech]` may name. One table
 * feeds the parser (names and aliases), the simulation (kind and profile),
 * the editor's and the language server's completion, the JSON Schema and the
 * icons, so they cannot disagree.
 *
 * - `kind`: the simulation kind when the component type alone would give
 *   another one (dsl/kinds.ts): edge sub-kinds, search, analytics, Redis as a
 *   cache, the Note shape.
 * - `profile`: a profile row other than the kind's default (sim/profiles.ts),
 *   e.g. partitioned NoSQL stores among databases.
 * - `aliases`: other names people write for it. Matching ignores case,
 *   spaces and punctuation (`route 53`, `Pub/Sub`, `node.js`) and a trailing
 *   version (`PostgreSQL 16`); see `findTech`.
 */
export interface ComponentOption {
  type: ComponentType;
  techStack: string;
  category: string;
  searchTerms: string;
  kind?: Kind;
  profile?: TechProfileKey;
  aliases?: readonly string[];
}

/** Profile rows a tech can pick instead of its kind's default (sim/profiles.ts). */
export type TechProfileKey = 'nosql' | 'nosqlStrong';

export const componentCatalog = [
  // Generic Shapes
  { type: 'shape', techStack: 'Rectangle', category: 'Generic Shapes', searchTerms: 'rectangle box square shape' },
  { type: 'shape', techStack: 'Circle', category: 'Generic Shapes', searchTerms: 'circle round shape' },
  { type: 'shape', techStack: 'Diamond', category: 'Generic Shapes', searchTerms: 'diamond rhombus shape decision' },
  { type: 'shape', techStack: 'Cylinder', category: 'Generic Shapes', searchTerms: 'cylinder shape storage' },
  { type: 'shape', techStack: 'Cloud', category: 'Generic Shapes', searchTerms: 'cloud shape' },
  { type: 'shape', techStack: 'Actor', category: 'Generic Shapes', searchTerms: 'actor user person human shape', aliases: ['User', 'Client', 'Customer', 'Person'] },
  { type: 'shape', techStack: 'Browser', category: 'Generic Shapes', searchTerms: 'browser web client user', aliases: ['Web Browser', 'Web Client'] },
  { type: 'shape', techStack: 'Mobile App', category: 'Generic Shapes', searchTerms: 'mobile app ios android client user', aliases: ['Mobile', 'Mobile Client', 'iOS', 'iOS App', 'Android', 'Android App'] },
  { type: 'shape', techStack: 'Note', category: 'Generic Shapes', searchTerms: 'note document comment annotation', kind: 'other' },

  // Generic components: one per kind, for a node whose product does not matter or is not listed.
  { type: 'service', techStack: 'Service', category: 'Generic Components', searchTerms: 'service microservice backend server application', aliases: ['Microservice', 'Backend', 'Backend Service', 'App Server', 'Application Server', 'Server', 'API Server'] },
  { type: 'service', techStack: 'Worker', category: 'Generic Components', searchTerms: 'worker background job consumer processor', aliases: ['Background Worker', 'Job Worker', 'Consumer', 'Job Runner'] },
  { type: 'database', techStack: 'Database', category: 'Generic Components', searchTerms: 'database relational sql db', aliases: ['DB', 'RDBMS', 'SQL Database', 'Relational Database', 'SQL'] },
  { type: 'database', techStack: 'NoSQL Database', category: 'Generic Components', searchTerms: 'nosql key value document wide column database', profile: 'nosql', aliases: ['NoSQL', 'NoSQL DB', 'Key-Value Store', 'KV Store', 'Document Store', 'Document Database', 'Wide-Column Store'] },
  { type: 'cache', techStack: 'Cache', category: 'Generic Components', searchTerms: 'cache in-memory key value', aliases: ['In-Memory Cache', 'Distributed Cache'] },
  { type: 'queue', techStack: 'Message Queue', category: 'Generic Components', searchTerms: 'queue message broker topic stream event bus', aliases: ['Queue', 'Message Broker', 'Broker', 'Event Bus', 'Topic', 'Event Stream', 'Stream'] },
  { type: 'storage', techStack: 'Object Storage', category: 'Generic Components', searchTerms: 'object storage blob bucket files', aliases: ['Object Store', 'Blob Store', 'Blob Storage', 'Bucket', 'Storage', 'File Storage'] },
  { type: 'cdn', techStack: 'CDN', category: 'Generic Components', searchTerms: 'cdn content delivery network edge cache', kind: 'cdn', aliases: ['Content Delivery Network', 'Edge Cache'] },
  { type: 'cdn', techStack: 'Load Balancer', category: 'Generic Components', searchTerms: 'load balancer lb reverse proxy', kind: 'loadbalancer', aliases: ['LB', 'Reverse Proxy', 'L7 Load Balancer', 'L4 Load Balancer'] },
  { type: 'cdn', techStack: 'API Gateway', category: 'Generic Components', searchTerms: 'api gateway', kind: 'gateway', aliases: ['Gateway', 'Edge Gateway'] },
  { type: 'cdn', techStack: 'DNS', category: 'Generic Components', searchTerms: 'dns domain name system', kind: 'dns', aliases: ['Domain Name System', 'DNS Server'] },
  { type: 'cdn', techStack: 'WAF', category: 'Generic Components', searchTerms: 'waf web application firewall edge', kind: 'edge', aliases: ['Web Application Firewall', 'Firewall'] },
  { type: 'serverless', techStack: 'Function', category: 'Generic Components', searchTerms: 'function serverless faas', aliases: ['Serverless Function', 'Serverless', 'FaaS', 'Cloud Function'] },
  { type: 'database', techStack: 'Search Engine', category: 'Generic Components', searchTerms: 'search engine index full text', kind: 'search', aliases: ['Search', 'Search Index', 'Full-Text Search', 'Search Service'] },
  { type: 'database', techStack: 'Data Warehouse', category: 'Generic Components', searchTerms: 'data warehouse lake olap analytics', kind: 'analytics', aliases: ['Warehouse', 'Data Lake', 'OLAP', 'Analytics DB', 'Analytics Database', 'Time Series DB', 'Time Series Database', 'TSDB'] },

  // Services
  { type: 'service', techStack: 'REST API', category: 'Services', searchTerms: 'rest api http service endpoint', aliases: ['REST', 'API', 'HTTP API', 'Web API', 'REST Service'] },
  { type: 'service', techStack: 'GraphQL', category: 'Services', searchTerms: 'graphql api service query', aliases: ['GraphQL API', 'Apollo'] },
  { type: 'service', techStack: 'gRPC', category: 'Services', searchTerms: 'grpc rpc service', aliases: ['gRPC Service', 'RPC'] },
  { type: 'service', techStack: 'WebSocket', category: 'Services', searchTerms: 'websocket ws realtime service', aliases: ['WebSockets', 'WS', 'Socket.IO', 'WebSocket Server'] },
  { type: 'service', techStack: 'SOAP API', category: 'Services', searchTerms: 'soap api xml service', aliases: ['SOAP'] },

  // Languages and frameworks: a service written in it.
  { type: 'service', techStack: 'Spring Boot', category: 'Languages & Frameworks', searchTerms: 'spring boot java kotlin service', aliases: ['Spring', 'Spring Framework', 'Spring WebFlux'] },
  { type: 'service', techStack: 'Kotlin', category: 'Languages & Frameworks', searchTerms: 'kotlin ktor jvm service', aliases: ['Ktor'] },
  { type: 'service', techStack: 'Java', category: 'Languages & Frameworks', searchTerms: 'java jvm service', aliases: ['JVM', 'Quarkus', 'Micronaut'] },
  { type: 'service', techStack: 'Go', category: 'Languages & Frameworks', searchTerms: 'go golang service', aliases: ['Golang'] },
  { type: 'service', techStack: 'Node.js', category: 'Languages & Frameworks', searchTerms: 'node nodejs javascript typescript express nestjs service', aliases: ['Node', 'Express', 'Express.js', 'NestJS', 'TypeScript', 'JavaScript'] },
  { type: 'service', techStack: 'Python', category: 'Languages & Frameworks', searchTerms: 'python service' },
  { type: 'service', techStack: 'Django', category: 'Languages & Frameworks', searchTerms: 'django python service' },
  { type: 'service', techStack: 'FastAPI', category: 'Languages & Frameworks', searchTerms: 'fastapi python service' },
  { type: 'service', techStack: 'Flask', category: 'Languages & Frameworks', searchTerms: 'flask python service' },
  { type: 'service', techStack: 'Ruby on Rails', category: 'Languages & Frameworks', searchTerms: 'ruby on rails service', aliases: ['Rails', 'Ruby'] },
  { type: 'service', techStack: '.NET', category: 'Languages & Frameworks', searchTerms: 'dotnet .net asp.net c# service', aliases: ['ASP.NET', 'ASP.NET Core', 'dotnet', 'C#'] },
  { type: 'service', techStack: 'PHP', category: 'Languages & Frameworks', searchTerms: 'php laravel symfony service', aliases: ['Laravel', 'Symfony'] },
  { type: 'service', techStack: 'Rust', category: 'Languages & Frameworks', searchTerms: 'rust axum actix service', aliases: ['Axum', 'Actix'] },
  { type: 'service', techStack: 'Elixir', category: 'Languages & Frameworks', searchTerms: 'elixir phoenix erlang service', aliases: ['Phoenix', 'Erlang'] },

  // Containers and platforms
  { type: 'container', techStack: 'Kubernetes', category: 'Containers & Platforms', searchTerms: 'kubernetes k8s container pod', aliases: ['K8s', 'Kubernetes Pod', 'Pod'] },
  { type: 'container', techStack: 'Docker', category: 'Containers & Platforms', searchTerms: 'docker container', aliases: ['Container', 'Docker Container'] },
  { type: 'compute', techStack: 'VM', category: 'Containers & Platforms', searchTerms: 'vm virtual machine server instance', aliases: ['Virtual Machine', 'Instance', 'Bare Metal'] },
  { type: 'serverless', techStack: 'Cloudflare Workers', category: 'Containers & Platforms', searchTerms: 'cloudflare workers edge functions serverless', aliases: ['Workers'] },

  // AWS Serverless
  { type: 'serverless', techStack: 'AWS Lambda', category: 'AWS Services', searchTerms: 'aws lambda serverless function', aliases: ['Lambda', 'Amazon Lambda'] },
  { type: 'serverless', techStack: 'AWS API Gateway', category: 'AWS Services', searchTerms: 'aws api gateway rest', kind: 'gateway', aliases: ['Amazon API Gateway'] },

  // AWS Compute
  { type: 'compute', techStack: 'AWS EC2', category: 'AWS Services', searchTerms: 'aws ec2 compute instance vm', aliases: ['EC2', 'Amazon EC2'] },
  { type: 'container', techStack: 'AWS ECS', category: 'AWS Services', searchTerms: 'aws ecs container docker', aliases: ['ECS', 'Amazon ECS'] },
  { type: 'container', techStack: 'AWS EKS', category: 'AWS Services', searchTerms: 'aws eks kubernetes k8s', aliases: ['EKS', 'Amazon EKS'] },
  { type: 'container', techStack: 'AWS Fargate', category: 'AWS Services', searchTerms: 'aws fargate serverless container', aliases: ['Fargate'] },

  // AWS Storage
  { type: 'storage', techStack: 'AWS S3', category: 'AWS Services', searchTerms: 'aws s3 storage bucket object', aliases: ['S3', 'Amazon S3', 'S3 Bucket'] },
  { type: 'storage', techStack: 'AWS EBS', category: 'AWS Services', searchTerms: 'aws ebs storage volume disk', aliases: ['EBS', 'Amazon EBS'] },
  { type: 'storage', techStack: 'AWS EFS', category: 'AWS Services', searchTerms: 'aws efs storage file system', aliases: ['EFS', 'Amazon EFS'] },

  // AWS Database
  { type: 'database', techStack: 'AWS RDS', category: 'AWS Services', searchTerms: 'aws rds database relational sql', aliases: ['RDS', 'Amazon RDS'] },
  { type: 'database', techStack: 'AWS DynamoDB', category: 'AWS Services', searchTerms: 'aws dynamodb database nosql', profile: 'nosql', aliases: ['Amazon DynamoDB', 'Dynamo'] },
  { type: 'cache', techStack: 'AWS ElastiCache', category: 'AWS Services', searchTerms: 'aws elasticache redis memcached cache', aliases: ['ElastiCache', 'Amazon ElastiCache'] },
  { type: 'database', techStack: 'AWS Aurora', category: 'AWS Services', searchTerms: 'aws aurora database mysql postgresql', aliases: ['Aurora', 'Amazon Aurora', 'Aurora PostgreSQL', 'Aurora MySQL', 'Aurora Serverless'] },
  { type: 'database', techStack: 'AWS DocumentDB', category: 'AWS Services', searchTerms: 'aws documentdb mongodb document database', aliases: ['DocumentDB', 'Amazon DocumentDB'] },
  { type: 'database', techStack: 'AWS Keyspaces', category: 'AWS Services', searchTerms: 'aws keyspaces cassandra nosql', profile: 'nosql', aliases: ['Keyspaces', 'Amazon Keyspaces'] },
  { type: 'database', techStack: 'AWS Neptune', category: 'AWS Services', searchTerms: 'aws neptune graph database', aliases: ['Neptune', 'Amazon Neptune'] },
  { type: 'database', techStack: 'AWS Redshift', category: 'AWS Services', searchTerms: 'aws redshift data warehouse analytics', kind: 'analytics', aliases: ['Redshift', 'Amazon Redshift'] },
  { type: 'database', techStack: 'AWS Athena', category: 'AWS Services', searchTerms: 'aws athena query s3 analytics', kind: 'analytics', aliases: ['Athena', 'Amazon Athena'] },
  { type: 'database', techStack: 'AWS OpenSearch', category: 'AWS Services', searchTerms: 'aws opensearch elasticsearch search', kind: 'search', aliases: ['Amazon OpenSearch', 'OpenSearch Service', 'AWS Elasticsearch'] },

  // AWS Messaging
  { type: 'queue', techStack: 'AWS SQS', category: 'AWS Services', searchTerms: 'aws sqs queue message', aliases: ['Amazon SQS', 'Simple Queue Service'] },
  { type: 'queue', techStack: 'AWS SNS', category: 'AWS Services', searchTerms: 'aws sns notification topic pubsub', aliases: ['SNS', 'Amazon SNS', 'Simple Notification Service'] },
  { type: 'queue', techStack: 'AWS EventBridge', category: 'AWS Services', searchTerms: 'aws eventbridge event bus', aliases: ['EventBridge', 'Amazon EventBridge'] },
  { type: 'queue', techStack: 'AWS Kinesis', category: 'AWS Services', searchTerms: 'aws kinesis stream data', aliases: ['Kinesis', 'Amazon Kinesis', 'Kinesis Data Streams'] },
  { type: 'queue', techStack: 'AWS MSK', category: 'AWS Services', searchTerms: 'aws msk managed kafka stream', aliases: ['MSK', 'Amazon MSK', 'Managed Streaming for Kafka'] },

  // AWS CDN/Network
  { type: 'cdn', techStack: 'AWS CloudFront', category: 'AWS Services', searchTerms: 'aws cloudfront cdn edge', kind: 'cdn', aliases: ['CloudFront', 'Amazon CloudFront'] },
  { type: 'cdn', techStack: 'AWS Route53', category: 'AWS Services', searchTerms: 'aws route53 dns domain', kind: 'dns', aliases: ['Route53', 'Amazon Route 53'] },
  { type: 'cdn', techStack: 'AWS Load Balancer', category: 'AWS Services', searchTerms: 'aws alb elb nlb load balancer', kind: 'loadbalancer', aliases: ['ALB', 'NLB', 'ELB', 'AWS ALB', 'AWS NLB', 'AWS ELB', 'Application Load Balancer', 'Network Load Balancer', 'Elastic Load Balancer', 'Elastic Load Balancing'] },
  { type: 'cdn', techStack: 'AWS WAF', category: 'AWS Services', searchTerms: 'aws waf web application firewall', kind: 'edge', aliases: ['Amazon WAF'] },
  { type: 'cdn', techStack: 'AWS Global Accelerator', category: 'AWS Services', searchTerms: 'aws global accelerator anycast edge', kind: 'edge', aliases: ['Global Accelerator'] },

  // AWS third-party style services
  { type: 'external', techStack: 'AWS SES', category: 'AWS Services', searchTerms: 'aws ses email simple email service', aliases: ['SES', 'Amazon SES', 'Simple Email Service'] },
  { type: 'external', techStack: 'AWS Cognito', category: 'AWS Services', searchTerms: 'aws cognito auth identity users', aliases: ['Cognito', 'Amazon Cognito'] },

  // GCP Serverless
  { type: 'serverless', techStack: 'GCP Cloud Functions', category: 'GCP Services', searchTerms: 'gcp google cloud functions serverless', aliases: ['Cloud Functions', 'Google Cloud Functions'] },
  { type: 'serverless', techStack: 'GCP Cloud Run', category: 'GCP Services', searchTerms: 'gcp google cloud run serverless container', aliases: ['Cloud Run', 'Google Cloud Run'] },
  { type: 'serverless', techStack: 'GCP App Engine', category: 'GCP Services', searchTerms: 'gcp google app engine paas', aliases: ['App Engine', 'Google App Engine'] },

  // GCP Compute
  { type: 'compute', techStack: 'GCP Compute Engine', category: 'GCP Services', searchTerms: 'gcp google compute engine vm instance', aliases: ['Compute Engine', 'GCE', 'Google Compute Engine'] },
  { type: 'container', techStack: 'GCP GKE', category: 'GCP Services', searchTerms: 'gcp google gke kubernetes k8s', aliases: ['GKE', 'Google Kubernetes Engine'] },

  // GCP Storage
  { type: 'storage', techStack: 'GCP Cloud Storage', category: 'GCP Services', searchTerms: 'gcp google cloud storage bucket object', aliases: ['GCS', 'Cloud Storage', 'Google Cloud Storage'] },
  { type: 'storage', techStack: 'GCP Persistent Disk', category: 'GCP Services', searchTerms: 'gcp google persistent disk storage', aliases: ['Persistent Disk'] },

  // GCP Database
  { type: 'database', techStack: 'GCP Cloud SQL', category: 'GCP Services', searchTerms: 'gcp google cloud sql database', aliases: ['Cloud SQL', 'Google Cloud SQL'] },
  { type: 'database', techStack: 'GCP Firestore', category: 'GCP Services', searchTerms: 'gcp google firestore database nosql', profile: 'nosqlStrong', aliases: ['Firestore', 'Cloud Firestore', 'Datastore'] },
  { type: 'database', techStack: 'GCP Bigtable', category: 'GCP Services', searchTerms: 'gcp google bigtable database nosql', profile: 'nosqlStrong', aliases: ['Bigtable', 'Cloud Bigtable'] },
  { type: 'database', techStack: 'GCP Spanner', category: 'GCP Services', searchTerms: 'gcp google spanner database sql', profile: 'nosqlStrong', aliases: ['Spanner', 'Cloud Spanner', 'Google Spanner'] },
  { type: 'database', techStack: 'GCP BigQuery', category: 'GCP Services', searchTerms: 'gcp google bigquery data warehouse analytics', kind: 'analytics', aliases: ['BigQuery', 'Google BigQuery'] },
  { type: 'cache', techStack: 'GCP Memorystore', category: 'GCP Services', searchTerms: 'gcp google memorystore redis memcached cache', aliases: ['Memorystore'] },

  // GCP Messaging
  { type: 'queue', techStack: 'GCP Pub/Sub', category: 'GCP Services', searchTerms: 'gcp google pubsub pub/sub message queue', aliases: ['Pub/Sub', 'Google Pub/Sub', 'Cloud Pub/Sub'] },

  // GCP CDN/Network
  { type: 'cdn', techStack: 'GCP Cloud CDN', category: 'GCP Services', searchTerms: 'gcp google cloud cdn edge', kind: 'cdn', aliases: ['Cloud CDN', 'Google Cloud CDN'] },
  { type: 'cdn', techStack: 'GCP Cloud DNS', category: 'GCP Services', searchTerms: 'gcp google cloud dns domain', kind: 'dns', aliases: ['Cloud DNS', 'Google Cloud DNS'] },
  { type: 'cdn', techStack: 'GCP Load Balancing', category: 'GCP Services', searchTerms: 'gcp google load balancing', kind: 'loadbalancer', aliases: ['Cloud Load Balancing', 'GCP Load Balancer', 'Google Cloud Load Balancing'] },
  { type: 'cdn', techStack: 'GCP Apigee', category: 'GCP Services', searchTerms: 'gcp google apigee api gateway management', kind: 'gateway', aliases: ['Apigee'] },

  // Azure Serverless
  { type: 'serverless', techStack: 'Azure Functions', category: 'Azure Services', searchTerms: 'azure functions serverless', aliases: ['Azure Function'] },
  { type: 'serverless', techStack: 'Azure Logic Apps', category: 'Azure Services', searchTerms: 'azure logic apps workflow', aliases: ['Logic Apps'] },
  { type: 'serverless', techStack: 'Azure API Management', category: 'Azure Services', searchTerms: 'azure api management gateway', kind: 'gateway', aliases: ['APIM', 'Azure APIM'] },

  // Azure Compute
  { type: 'compute', techStack: 'Azure VM', category: 'Azure Services', searchTerms: 'azure vm virtual machine compute', aliases: ['Azure Virtual Machine', 'Azure Virtual Machines'] },
  { type: 'container', techStack: 'Azure AKS', category: 'Azure Services', searchTerms: 'azure aks kubernetes k8s', aliases: ['AKS', 'Azure Kubernetes Service'] },
  { type: 'container', techStack: 'Azure Container Instances', category: 'Azure Services', searchTerms: 'azure container instances aci', aliases: ['ACI'] },
  { type: 'service', techStack: 'Azure App Service', category: 'Azure Services', searchTerms: 'azure app service web apps paas', aliases: ['App Service', 'Azure Web Apps'] },

  // Azure Storage
  { type: 'storage', techStack: 'Azure Blob Storage', category: 'Azure Services', searchTerms: 'azure blob storage object', aliases: ['Azure Blob', 'Azure Storage'] },
  { type: 'storage', techStack: 'Azure Files', category: 'Azure Services', searchTerms: 'azure files storage file system' },
  { type: 'storage', techStack: 'Azure Disk Storage', category: 'Azure Services', searchTerms: 'azure disk storage volume', aliases: ['Azure Managed Disks'] },

  // Azure Database
  { type: 'database', techStack: 'Azure SQL', category: 'Azure Services', searchTerms: 'azure sql database', aliases: ['Azure SQL Database'] },
  { type: 'database', techStack: 'Azure Cosmos DB', category: 'Azure Services', searchTerms: 'azure cosmos db database nosql', profile: 'nosql', aliases: ['Cosmos DB', 'Cosmos'] },
  { type: 'database', techStack: 'Azure Database for PostgreSQL', category: 'Azure Services', searchTerms: 'azure postgresql database', aliases: ['Azure PostgreSQL', 'Azure Postgres'] },
  { type: 'database', techStack: 'Azure Database for MySQL', category: 'Azure Services', searchTerms: 'azure mysql database', aliases: ['Azure MySQL'] },
  { type: 'cache', techStack: 'Azure Cache for Redis', category: 'Azure Services', searchTerms: 'azure redis cache', aliases: ['Azure Redis'] },
  { type: 'database', techStack: 'Azure AI Search', category: 'Azure Services', searchTerms: 'azure ai cognitive search', kind: 'search', aliases: ['Azure Cognitive Search', 'Azure Search'] },

  // Azure Messaging
  { type: 'queue', techStack: 'Azure Service Bus', category: 'Azure Services', searchTerms: 'azure service bus queue message', aliases: ['Service Bus'] },
  { type: 'queue', techStack: 'Azure Event Hubs', category: 'Azure Services', searchTerms: 'azure event hubs stream', aliases: ['Event Hubs', 'Event Hub'] },
  { type: 'queue', techStack: 'Azure Event Grid', category: 'Azure Services', searchTerms: 'azure event grid', aliases: ['Event Grid'] },
  { type: 'queue', techStack: 'Azure Queue Storage', category: 'Azure Services', searchTerms: 'azure queue storage message', aliases: ['Azure Queue', 'Azure Queues'] },

  // Azure CDN/Network
  { type: 'cdn', techStack: 'Azure CDN', category: 'Azure Services', searchTerms: 'azure cdn edge', kind: 'cdn' },
  { type: 'cdn', techStack: 'Azure DNS', category: 'Azure Services', searchTerms: 'azure dns domain', kind: 'dns' },
  { type: 'cdn', techStack: 'Azure Front Door', category: 'Azure Services', searchTerms: 'azure front door cdn', kind: 'cdn', aliases: ['Front Door'] },
  { type: 'cdn', techStack: 'Azure Load Balancer', category: 'Azure Services', searchTerms: 'azure load balancer', kind: 'loadbalancer' },
  { type: 'cdn', techStack: 'Azure Application Gateway', category: 'Azure Services', searchTerms: 'azure application gateway l7 load balancer', kind: 'loadbalancer', aliases: ['Application Gateway', 'Azure App Gateway'] },

  // Traditional Databases
  { type: 'database', techStack: 'PostgreSQL', category: 'Databases', searchTerms: 'postgresql postgres sql database', aliases: ['Postgres', 'PG', 'PostGIS', 'pgvector'] },
  { type: 'database', techStack: 'MySQL', category: 'Databases', searchTerms: 'mysql sql database', aliases: ['Percona'] },
  { type: 'database', techStack: 'MongoDB', category: 'Databases', searchTerms: 'mongodb mongo nosql database', profile: 'nosqlStrong', aliases: ['Mongo', 'MongoDB Atlas'] },
  { type: 'database', techStack: 'Redis', category: 'Databases', searchTerms: 'redis cache database key-value', kind: 'cache', aliases: ['Redis Cluster', 'Redis Cache'] },
  { type: 'database', techStack: 'DynamoDB', category: 'Databases', searchTerms: 'dynamodb nosql database aws', profile: 'nosql' },
  { type: 'database', techStack: 'Cassandra', category: 'Databases', searchTerms: 'cassandra nosql database', profile: 'nosql', aliases: ['Apache Cassandra', 'DataStax'] },
  { type: 'database', techStack: 'CouchDB', category: 'Databases', searchTerms: 'couchdb nosql database', profile: 'nosql', aliases: ['Apache CouchDB'] },
  { type: 'database', techStack: 'Elasticsearch', category: 'Databases', searchTerms: 'elasticsearch search database', kind: 'search', aliases: ['Elastic', 'Elastic Search', 'ES'] },
  { type: 'database', techStack: 'Neo4j', category: 'Databases', searchTerms: 'neo4j graph database', aliases: ['Graph Database', 'Graph DB'] },
  { type: 'database', techStack: 'InfluxDB', category: 'Databases', searchTerms: 'influxdb timeseries database', kind: 'analytics', aliases: ['Influx'] },
  { type: 'database', techStack: 'TimescaleDB', category: 'Databases', searchTerms: 'timescaledb timeseries postgresql database', kind: 'analytics', aliases: ['Timescale'] },
  { type: 'database', techStack: 'MariaDB', category: 'Databases', searchTerms: 'mariadb mysql sql database', aliases: ['Maria'] },
  { type: 'database', techStack: 'SQLite', category: 'Databases', searchTerms: 'sqlite sql database' },
  { type: 'database', techStack: 'Oracle', category: 'Databases', searchTerms: 'oracle sql database', aliases: ['Oracle DB', 'Oracle Database'] },
  { type: 'database', techStack: 'SQL Server', category: 'Databases', searchTerms: 'sql server mssql database microsoft', aliases: ['MSSQL', 'MS SQL', 'Microsoft SQL Server'] },
  { type: 'database', techStack: 'CockroachDB', category: 'Databases', searchTerms: 'cockroachdb distributed sql database', profile: 'nosqlStrong', aliases: ['Cockroach'] },
  { type: 'database', techStack: 'YugabyteDB', category: 'Databases', searchTerms: 'yugabytedb distributed sql database', profile: 'nosqlStrong', aliases: ['Yugabyte'] },
  { type: 'database', techStack: 'TiDB', category: 'Databases', searchTerms: 'tidb distributed sql mysql database', profile: 'nosqlStrong' },
  { type: 'database', techStack: 'Vitess', category: 'Databases', searchTerms: 'vitess sharded mysql planetscale database', profile: 'nosqlStrong', aliases: ['PlanetScale'] },
  { type: 'database', techStack: 'ScyllaDB', category: 'Databases', searchTerms: 'scylladb cassandra nosql database', profile: 'nosql', aliases: ['Scylla'] },
  { type: 'database', techStack: 'Couchbase', category: 'Databases', searchTerms: 'couchbase nosql document database', profile: 'nosql' },
  { type: 'database', techStack: 'HBase', category: 'Databases', searchTerms: 'hbase hadoop wide column nosql database', profile: 'nosqlStrong', aliases: ['Apache HBase'] },
  { type: 'database', techStack: 'etcd', category: 'Databases', searchTerms: 'etcd key value consensus configuration' },
  { type: 'database', techStack: 'ZooKeeper', category: 'Databases', searchTerms: 'zookeeper coordination consensus configuration', aliases: ['Apache ZooKeeper'] },

  // Cache & In-Memory
  { type: 'cache', techStack: 'Memcached', category: 'Cache & In-Memory', searchTerms: 'memcached cache memory', aliases: ['Memcache'] },
  { type: 'cache', techStack: 'Hazelcast', category: 'Cache & In-Memory', searchTerms: 'hazelcast cache memory' },
  { type: 'cache', techStack: 'Aerospike', category: 'Cache & In-Memory', searchTerms: 'aerospike cache database' },
  { type: 'cache', techStack: 'Valkey', category: 'Cache & In-Memory', searchTerms: 'valkey redis cache memory' },
  { type: 'cache', techStack: 'KeyDB', category: 'Cache & In-Memory', searchTerms: 'keydb redis cache memory' },
  { type: 'cache', techStack: 'Dragonfly', category: 'Cache & In-Memory', searchTerms: 'dragonfly dragonflydb redis cache memory', aliases: ['DragonflyDB'] },

  // Message Queues
  { type: 'queue', techStack: 'Kafka', category: 'Message Queues', searchTerms: 'kafka message queue stream', aliases: ['Apache Kafka', 'Confluent', 'Confluent Kafka', 'Kafka Topic'] },
  { type: 'queue', techStack: 'RabbitMQ', category: 'Message Queues', searchTerms: 'rabbitmq message queue amqp', aliases: ['Rabbit', 'AMQP'] },
  { type: 'queue', techStack: 'SQS', category: 'Message Queues', searchTerms: 'sqs queue aws message' },
  { type: 'queue', techStack: 'Redis Queue', category: 'Message Queues', searchTerms: 'redis queue message', aliases: ['Redis Streams', 'Redis Pub/Sub'] },
  { type: 'queue', techStack: 'NATS', category: 'Message Queues', searchTerms: 'nats message queue', aliases: ['NATS JetStream', 'JetStream'] },
  { type: 'queue', techStack: 'Apache Pulsar', category: 'Message Queues', searchTerms: 'pulsar message queue stream', aliases: ['Pulsar'] },
  { type: 'queue', techStack: 'ActiveMQ', category: 'Message Queues', searchTerms: 'activemq message queue', aliases: ['Apache ActiveMQ', 'Amazon MQ'] },
  { type: 'queue', techStack: 'ZeroMQ', category: 'Message Queues', searchTerms: 'zeromq zmq message queue', aliases: ['ZMQ', '0MQ'] },
  { type: 'queue', techStack: 'Redpanda', category: 'Message Queues', searchTerms: 'redpanda kafka stream queue' },

  // Search
  { type: 'database', techStack: 'OpenSearch', category: 'Search', searchTerms: 'opensearch elasticsearch search', kind: 'search' },
  { type: 'database', techStack: 'Solr', category: 'Search', searchTerms: 'solr lucene search', kind: 'search', aliases: ['Apache Solr'] },
  { type: 'database', techStack: 'Meilisearch', category: 'Search', searchTerms: 'meilisearch search', kind: 'search' },
  { type: 'database', techStack: 'Typesense', category: 'Search', searchTerms: 'typesense search', kind: 'search' },
  { type: 'database', techStack: 'Algolia', category: 'Search', searchTerms: 'algolia hosted search', kind: 'search' },

  // Analytics
  { type: 'database', techStack: 'Snowflake', category: 'Analytics', searchTerms: 'snowflake data warehouse analytics', kind: 'analytics' },
  { type: 'database', techStack: 'ClickHouse', category: 'Analytics', searchTerms: 'clickhouse olap analytics columnar', kind: 'analytics' },
  { type: 'database', techStack: 'Apache Druid', category: 'Analytics', searchTerms: 'druid olap analytics', kind: 'analytics', aliases: ['Druid'] },
  { type: 'database', techStack: 'Apache Pinot', category: 'Analytics', searchTerms: 'pinot olap analytics', kind: 'analytics', aliases: ['Pinot'] },
  { type: 'database', techStack: 'Databricks', category: 'Analytics', searchTerms: 'databricks lakehouse spark analytics', kind: 'analytics' },
  { type: 'database', techStack: 'Prometheus', category: 'Analytics', searchTerms: 'prometheus metrics time series monitoring', kind: 'analytics' },

  // Storage
  { type: 'storage', techStack: 'MinIO', category: 'Storage', searchTerms: 'minio s3 object storage' },
  { type: 'storage', techStack: 'Cloudflare R2', category: 'Storage', searchTerms: 'cloudflare r2 object storage', aliases: ['R2'] },
  { type: 'storage', techStack: 'Ceph', category: 'Storage', searchTerms: 'ceph object block storage' },
  { type: 'storage', techStack: 'HDFS', category: 'Storage', searchTerms: 'hdfs hadoop file system storage', aliases: ['Hadoop', 'Hadoop HDFS'] },

  // CDN, proxies and gateways
  { type: 'cdn', techStack: 'Cloudflare', category: 'CDN & Edge', searchTerms: 'cloudflare cdn edge', kind: 'cdn', aliases: ['Cloudflare CDN'] },
  { type: 'cdn', techStack: 'Fastly', category: 'CDN & Edge', searchTerms: 'fastly cdn edge', kind: 'cdn' },
  { type: 'cdn', techStack: 'Akamai', category: 'CDN & Edge', searchTerms: 'akamai cdn edge', kind: 'cdn' },
  { type: 'cdn', techStack: 'nginx', category: 'CDN & Edge', searchTerms: 'nginx reverse proxy load balancer web server', kind: 'loadbalancer', aliases: ['NGINX Plus', 'OpenResty'] },
  { type: 'cdn', techStack: 'Envoy', category: 'CDN & Edge', searchTerms: 'envoy proxy load balancer service mesh', kind: 'loadbalancer', aliases: ['Envoy Proxy'] },
  { type: 'cdn', techStack: 'HAProxy', category: 'CDN & Edge', searchTerms: 'haproxy load balancer proxy', kind: 'loadbalancer' },
  { type: 'cdn', techStack: 'Traefik', category: 'CDN & Edge', searchTerms: 'traefik reverse proxy load balancer', kind: 'loadbalancer' },
  { type: 'cdn', techStack: 'Kubernetes Ingress', category: 'CDN & Edge', searchTerms: 'kubernetes ingress controller load balancer', kind: 'loadbalancer', aliases: ['Ingress', 'Ingress Controller', 'K8s Ingress'] },
  { type: 'cdn', techStack: 'Kong', category: 'CDN & Edge', searchTerms: 'kong api gateway', kind: 'gateway', aliases: ['Kong Gateway'] },
  { type: 'cdn', techStack: 'Spring Cloud Gateway', category: 'CDN & Edge', searchTerms: 'spring cloud gateway api gateway', kind: 'gateway' },

  // External Systems
  { type: 'external', techStack: 'Third Party API', category: 'External Systems', searchTerms: 'third party api external', aliases: ['External API', 'External Service', 'Third-Party API', '3rd Party API', 'Partner API', 'SaaS', 'Webhook'] },
  { type: 'external', techStack: 'Payment Gateway', category: 'External Systems', searchTerms: 'payment gateway stripe paypal', aliases: ['Payment Provider', 'Payments API', 'Payment Processor', 'PSP'] },
  { type: 'external', techStack: 'Auth Service', category: 'External Systems', searchTerms: 'auth authentication authorization', aliases: ['Identity Provider', 'IdP', 'OAuth Provider', 'SSO'] },
  { type: 'external', techStack: 'Email Service', category: 'External Systems', searchTerms: 'email service sendgrid mailgun', aliases: ['Email', 'Email Provider', 'SMTP'] },
  { type: 'external', techStack: 'SMS Service', category: 'External Systems', searchTerms: 'sms service twilio', aliases: ['SMS', 'SMS Gateway', 'SMS Provider'] },
  { type: 'external', techStack: 'Push Service', category: 'External Systems', searchTerms: 'push notification service mobile', aliases: ['Push Notifications', 'Push Notification Service', 'Push Provider'] },
  { type: 'external', techStack: 'Analytics Service', category: 'External Systems', searchTerms: 'analytics service google analytics', aliases: ['Google Analytics', 'Segment', 'Mixpanel', 'Amplitude'] },
  { type: 'external', techStack: 'Stripe', category: 'External Systems', searchTerms: 'stripe payments' },
  { type: 'external', techStack: 'PayPal', category: 'External Systems', searchTerms: 'paypal payments' },
  { type: 'external', techStack: 'Adyen', category: 'External Systems', searchTerms: 'adyen payments' },
  { type: 'external', techStack: 'Braintree', category: 'External Systems', searchTerms: 'braintree payments' },
  { type: 'external', techStack: 'Twilio', category: 'External Systems', searchTerms: 'twilio sms voice' },
  { type: 'external', techStack: 'SendGrid', category: 'External Systems', searchTerms: 'sendgrid email' },
  { type: 'external', techStack: 'Mailgun', category: 'External Systems', searchTerms: 'mailgun email' },
  { type: 'external', techStack: 'Auth0', category: 'External Systems', searchTerms: 'auth0 identity login' },
  { type: 'external', techStack: 'Okta', category: 'External Systems', searchTerms: 'okta identity sso' },
  { type: 'external', techStack: 'Google Maps', category: 'External Systems', searchTerms: 'google maps geocoding routing', aliases: ['Google Maps API', 'Maps API'] },
  { type: 'external', techStack: 'APNs', category: 'External Systems', searchTerms: 'apns apple push notification', aliases: ['Apple Push Notification Service', 'Apple Push'] },
  { type: 'external', techStack: 'FCM', category: 'External Systems', searchTerms: 'fcm firebase cloud messaging push', aliases: ['Firebase Cloud Messaging', 'Firebase Messaging'] },
  { type: 'external', techStack: 'OpenAI', category: 'External Systems', searchTerms: 'openai llm ai api', aliases: ['OpenAI API', 'LLM API', 'LLM'] },

  // Text & Annotations
  { type: 'text', techStack: 'Text Note', category: 'Annotations', searchTerms: 'text note annotation comment label' },
  { type: 'text', techStack: 'Sticky Note', category: 'Annotations', searchTerms: 'sticky note annotation comment' },
  { type: 'text', techStack: 'Comment', category: 'Annotations', searchTerms: 'comment annotation note text' },

  // Grouping
  { type: 'group', techStack: 'Logical Group', category: 'Grouping', searchTerms: 'group container boundary logical' },
  { type: 'group', techStack: 'Network Boundary', category: 'Grouping', searchTerms: 'group network boundary vpc subnet' },
  { type: 'group', techStack: 'Security Zone', category: 'Grouping', searchTerms: 'group security zone boundary' },
  { type: 'group', techStack: 'Service Group', category: 'Grouping', searchTerms: 'group service container boundary' },
] as const satisfies readonly ComponentOption[];

/** A tech stack from the catalog. */
export type TechStack = (typeof componentCatalog)[number]['techStack'];

/**
 * A node's tech as written: a catalog name, or (for a tech the catalog does
 * not know, which the parser warns about) the text inside the brackets.
 */
export type TechName = TechStack | (string & {});

/** `Route 53`, `route53` and `ROUTE-53` all become `route53`. */
export const techKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9#+]/g, '');

/** A catalog entry, with its name typed as a TechStack. */
export type CatalogEntry = ComponentOption & { techStack: TechStack };

const entries: readonly CatalogEntry[] = componentCatalog;
const byKey = new Map<string, CatalogEntry>();
for (const c of entries) {
  for (const name of [c.techStack, ...(c.aliases ?? [])]) {
    const key = techKey(name);
    if (!byKey.has(key)) byKey.set(key, c);
  }
}

/** Names and aliases that normalise to the same key as an earlier one (catalog.test.ts keeps this empty). */
export function catalogCollisions(): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const c of entries) {
    for (const name of [c.techStack, ...(c.aliases ?? [])]) {
      const key = techKey(name);
      const first = seen.get(key);
      if (first !== undefined && first !== c.techStack) clashes.push(`${name} (${c.techStack}) clashes with ${first}`);
      else seen.set(key, c.techStack);
    }
  }
  return clashes;
}

/** A trailing version: `16`, `8.0`, `v7`, `7.x`. */
const VERSION = /[\s-]*v?\d+(\.(\d+|x))*\s*$/i;

/**
 * The catalog entry `name` refers to: its name or an alias, ignoring case,
 * spaces and punctuation, then without a trailing version number
 * (`PostgreSQL 16`, `Redis 7.2`).
 */
export function findTech(name: string): CatalogEntry | undefined {
  const exact = byKey.get(techKey(name));
  if (exact) return exact;
  const unversioned = name.replace(VERSION, '');
  return unversioned !== name && unversioned.trim() ? byKey.get(techKey(unversioned)) : undefined;
}

/** Edit distance with adjacent transpositions (`kafak` is one edit from `kafka`), for "did you mean". */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * The catalog tech closest to an unknown name, for "did you mean": the
 * smallest edit distance to a name or alias (at most a quarter of the name's
 * length, and at least 1 edit allowed), else a known name the text contains
 * as a whole word (`Postgres on RDS` → PostgreSQL). Groups and annotations
 * (the Note shape included) are never suggested for a node.
 */
export function suggestTech(name: string, accept: (c: CatalogEntry) => boolean = (c) => c.type !== 'group' && c.type !== 'text' && c.techStack !== 'Note'): TechStack | undefined {
  const key = techKey(name);
  if (!key) return undefined;
  let best: { tech: TechStack; d: number } | undefined;
  for (const c of entries) {
    if (!accept(c)) continue;
    for (const candidate of [c.techStack, ...(c.aliases ?? [])]) {
      const d = editDistance(key, techKey(candidate));
      if (!best || d < best.d) best = { tech: c.techStack, d };
    }
  }
  if (best && best.d <= Math.max(1, Math.floor(key.length / 4))) return best.tech;
  const words = name.toLowerCase().split(/[^a-z0-9.#+]+/).filter(Boolean);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const found = byKey.get(techKey(words.slice(i, i + n).join(' ')));
      if (found && accept(found) && techKey(words.slice(i, i + n).join('')).length >= 3) return found.techStack;
    }
  }
  return undefined;
}
