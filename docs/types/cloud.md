---
updated: 2026-11-10
---

# Built-in types: cloud providers

The managed products of AWS, Google Cloud, Azure and Cloudflare. Each extends the generic type of its kind, or the product it is compatible with. Generated from [cloud-aws.proschi](../../frontend/src/dsl/stdlib/cloud-aws.proschi), [cloud-gcp.proschi](../../frontend/src/dsl/stdlib/cloud-gcp.proschi), [cloud-azure.proschi](../../frontend/src/dsl/stdlib/cloud-azure.proschi), [cloud-cloudflare.proschi](../../frontend/src/dsl/stdlib/cloud-cloudflare.proschi); [component types](../TYPES.md) explains how to read and extend them.

## AWS products

### AWS CloudFront

Amazon CloudFront, the CDN of AWS.

- **Extends:** [CDN](edge.md#cdn) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** `CreateInvalidation`, plus 1 from [CDN](edge.md#cdn), 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### AWS Route53

Amazon Route 53, the DNS service of AWS, with health checks and latency routing.

- **Extends:** [DNS](edge.md#dns) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `dns`
- **Protocol:** `DNS`
- **Read:** 2 from [DNS](edge.md#dns)
- **Write:** `ChangeResourceRecordSets`, plus 1 from [DNS](edge.md#dns)

### AWS Load Balancer

Elastic Load Balancing: an application (L7) or network (L4) load balancer on AWS.

- **Extends:** [Load Balancer](edge.md#load-balancer) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### AWS API Gateway

Amazon API Gateway, the managed API front door of AWS.

- **Extends:** [API Gateway](edge.md#api-gateway) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### AWS WAF

AWS WAF, the web application firewall in front of CloudFront, load balancers and API Gateway.

- **Extends:** [WAF](edge.md#waf) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `edge`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### AWS Global Accelerator

AWS Global Accelerator: anycast addresses that carry traffic over the AWS network to the nearest healthy region.

- **Extends:** [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `edge`

### AWS EC2

Amazon EC2, virtual machines on AWS.

- **Extends:** [VM](compute.md#vm) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### AWS ECS

Amazon ECS, which runs containers on AWS.

- **Extends:** [Docker](compute.md#docker) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### AWS Fargate

AWS Fargate, containers on AWS without servers to manage.

- **Extends:** [Docker](compute.md#docker) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### AWS EKS

Amazon EKS, managed Kubernetes on AWS.

- **Extends:** [Kubernetes](compute.md#kubernetes) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### AWS Lambda

AWS Lambda, functions that run per request or event on AWS.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### AWS RDS

Amazon RDS, managed relational databases on AWS (PostgreSQL, MySQL and others).

- **Extends:** [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### AWS Aurora

Amazon Aurora, the AWS relational database compatible with PostgreSQL and MySQL, on shared distributed storage.

- **Extends:** [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### AWS DynamoDB

Amazon DynamoDB, the managed key-value and document database of AWS.

- **Extends:** [DynamoDB](data.md#dynamodb) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** 6 from [DynamoDB](data.md#dynamodb), 1 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** 9 from [DynamoDB](data.md#dynamodb), 3 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### AWS DocumentDB

Amazon DocumentDB, the AWS document database compatible with MongoDB.

- **Extends:** [MongoDB](data.md#mongodb) › [Document NoSQL Database](data.md#document-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** 7 from [MongoDB](data.md#mongodb), 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** 12 from [MongoDB](data.md#mongodb), 3 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### AWS Keyspaces

Amazon Keyspaces, the AWS wide-column database compatible with Cassandra.

- **Extends:** [Cassandra](data.md#cassandra) › [Wide-Column NoSQL Database](data.md#wide-column-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `CQL`
- **Read:** 1 from [Cassandra](data.md#cassandra), 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** 5 from [Cassandra](data.md#cassandra), 2 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### AWS Neptune

Amazon Neptune, the graph database of AWS.

- **Extends:** [Graph NoSQL Database](data.md#graph-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `Cypher`
- **Read:** 4 from [Graph NoSQL Database](data.md#graph-nosql-database), 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** 6 from [Graph NoSQL Database](data.md#graph-nosql-database), 1 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### AWS ElastiCache

Amazon ElastiCache, managed Redis, Valkey or Memcached on AWS.

- **Extends:** [Redis](data.md#redis) › [Cache](data.md#cache) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](data.md#redis), 2 from [Cache](data.md#cache), 3 from [Data](data.md#data)
- **Write:** 81 from [Redis](data.md#redis), 3 from [Cache](data.md#cache), 8 from [Data](data.md#data)

### AWS OpenSearch

Amazon OpenSearch Service, managed OpenSearch on AWS.

- **Extends:** [OpenSearch](data.md#opensearch) › [Elasticsearch](data.md#elasticsearch) › [Search Engine](data.md#search-engine) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 8 from [Elasticsearch](data.md#elasticsearch), 3 from [Search Engine](data.md#search-engine), 3 from [Data](data.md#data)
- **Write:** 10 from [Elasticsearch](data.md#elasticsearch), 3 from [Search Engine](data.md#search-engine), 8 from [Data](data.md#data)

### AWS Redshift

Amazon Redshift, the data warehouse of AWS.

- **Extends:** [Data Warehouse](data.md#data-warehouse) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](data.md#data-warehouse), 3 from [Data](data.md#data)
- **Write:** 9 from [Data Warehouse](data.md#data-warehouse), 8 from [Data](data.md#data)

### AWS Athena

Amazon Athena, SQL queries over files in S3.

- **Extends:** [Data Warehouse](data.md#data-warehouse) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** `StartQueryExecution`, `GetQueryExecution`, `GetQueryResults`, plus 4 from [Data Warehouse](data.md#data-warehouse), 3 from [Data](data.md#data)
- **Write:** 9 from [Data Warehouse](data.md#data-warehouse), 8 from [Data](data.md#data)

### AWS S3

Amazon S3, the object storage of AWS.

- **Extends:** [Object Storage](data.md#object-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Extended by:** [MinIO](data.md#minio), [Cloudflare R2](#cloudflare-r2)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** `GetObject`, `HeadObject`, `ListObjectsV2`, `ListObjects`, `GetObjectTagging`, `GetObjectAcl`, `ListMultipartUploads`, `ListParts`, `SelectObjectContent`, `HeadBucket`, `ListBuckets`, plus 3 from [Object Storage](data.md#object-storage), 3 from [Data](data.md#data)
- **Write:** `PutObject`, `CopyObject`, `DeleteObject`, `DeleteObjects`, `RestoreObject`, `PutObjectTagging`, `PutObjectAcl`, `CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `CreateBucket`, `DeleteBucket`, plus 3 from [Object Storage](data.md#object-storage), 8 from [Data](data.md#data)

### AWS EBS

Amazon EBS, block volumes for EC2 instances.

- **Extends:** [Block Storage](data.md#block-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 3 from [Data](data.md#data)
- **Write:** 8 from [Data](data.md#data)

### AWS EFS

Amazon EFS, a shared NFS file system on AWS.

- **Extends:** [Shared File System](data.md#shared-file-system) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 2 from [Shared File System](data.md#shared-file-system), 3 from [Data](data.md#data)
- **Write:** 1 from [Shared File System](data.md#shared-file-system), 8 from [Data](data.md#data)

### AWS SQS

Amazon SQS, the managed message queue of AWS.

- **Extends:** [SQS](messaging.md#sqs) › [Message Queue](messaging.md#message-queue) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `queue`
- **Read:** 4 from [SQS](messaging.md#sqs), 3 from [Message Queue](messaging.md#message-queue), 4 from [Messaging](messaging.md#messaging)
- **Write:** 10 from [SQS](messaging.md#sqs), 7 from [Messaging](messaging.md#messaging)

### AWS SNS

Amazon SNS, the pub/sub topics of AWS that fan out to queues, functions and phones.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `PublishBatch`, `CreateTopic`, `DeleteTopic`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### AWS EventBridge

Amazon EventBridge, the AWS event bus that routes events by rules.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `PutEvents`, `PutRule`, `PutTargets`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### AWS Kinesis

Amazon Kinesis Data Streams, the partitioned stream of AWS.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** `GetRecords`, `GetShardIterator`, `SubscribeToShard`, `DescribeStream`, `ListShards`, plus 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `PutRecord`, `PutRecords`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### AWS MSK

Amazon MSK, managed Kafka on AWS.

- **Extends:** [Kafka](messaging.md#kafka) › [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 4 from [Kafka](messaging.md#kafka), 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** 8 from [Kafka](messaging.md#kafka), 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### AWS SES

Amazon SES, the email sending service of AWS.

- **Extends:** [Email Service](external.md#email-service) › [Notifier](external.md#notifier) › [External](external.md#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](external.md#external)
- **Write:** `SendEmail`, `SendRawEmail`, `SendBulkEmail`, plus 2 from [Notifier](external.md#notifier), 4 from [External](external.md#external)
- **Statuses:** 61 from [External](external.md#external)
- **Headers:** 69 from [External](external.md#external)

### AWS Cognito

Amazon Cognito, user sign-up and sign-in on AWS.

- **Extends:** [Auth Service](external.md#auth-service) › [External](external.md#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `GetUser`, plus 5 from [Auth Service](external.md#auth-service), 5 from [External](external.md#external)
- **Write:** `InitiateAuth`, `RespondToAuthChallenge`, `SignUp`, `ConfirmSignUp`, `GlobalSignOut`, plus 6 from [Auth Service](external.md#auth-service), 4 from [External](external.md#external)
- **Statuses:** 61 from [External](external.md#external)
- **Headers:** 69 from [External](external.md#external)

## Google Cloud products

### GCP Cloud CDN

Cloud CDN, the CDN of Google Cloud.

- **Extends:** [CDN](edge.md#cdn) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 1 from [CDN](edge.md#cdn), 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### GCP Cloud DNS

Cloud DNS, the DNS service of Google Cloud.

- **Extends:** [DNS](edge.md#dns) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `dns`
- **Protocol:** `DNS`
- **Read:** 2 from [DNS](edge.md#dns)
- **Write:** 1 from [DNS](edge.md#dns)

### GCP Load Balancing

Cloud Load Balancing, Google Cloud's global and regional load balancers.

- **Extends:** [Load Balancer](edge.md#load-balancer) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### GCP Apigee

Apigee, Google Cloud's API management platform.

- **Extends:** [API Gateway](edge.md#api-gateway) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### GCP Compute Engine

Compute Engine, virtual machines on Google Cloud.

- **Extends:** [VM](compute.md#vm) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### GCP GKE

Google Kubernetes Engine, managed Kubernetes on Google Cloud.

- **Extends:** [Kubernetes](compute.md#kubernetes) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### GCP Cloud Functions

Cloud Functions, functions that run per request or event on Google Cloud.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### GCP Cloud Run

Cloud Run, containers that run per request and scale to zero on Google Cloud.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### GCP App Engine

App Engine, Google Cloud's managed platform for web apps.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### GCP Cloud SQL

Cloud SQL, managed PostgreSQL, MySQL and SQL Server on Google Cloud.

- **Extends:** [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### GCP Spanner

Spanner, Google Cloud's globally distributed relational database with external consistency.

- **Extends:** [Distributed SQL Database](data.md#distributed-sql-database) › [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** `ExecuteSql`, `ExecuteStreamingSql`, `StreamingRead`, `BeginTransaction`, plus 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** `ExecuteBatchDml`, plus 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### GCP Firestore

Firestore, Google Cloud's serverless document database.

- **Extends:** [Document NoSQL Database](data.md#document-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `GetDocument`, `ListDocuments`, `BatchGetDocuments`, `RunQuery`, `RunAggregationQuery`, `Listen`, plus 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** `CreateDocument`, `UpdateDocument`, `DeleteDocument`, `BatchWrite`, `Commit`, `BeginTransaction`, plus 3 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### GCP Bigtable

Bigtable, Google Cloud's wide-column database for large, low-latency workloads.

- **Extends:** [Wide-Column NoSQL Database](data.md#wide-column-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `ReadRows`, `SampleRowKeys`, plus 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** `MutateRow`, `MutateRows`, `CheckAndMutateRow`, `ReadModifyWriteRow`, plus 3 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### GCP Memorystore

Memorystore, managed Redis and Memcached on Google Cloud.

- **Extends:** [Redis](data.md#redis) › [Cache](data.md#cache) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](data.md#redis), 2 from [Cache](data.md#cache), 3 from [Data](data.md#data)
- **Write:** 81 from [Redis](data.md#redis), 3 from [Cache](data.md#cache), 8 from [Data](data.md#data)

### GCP BigQuery

BigQuery, Google Cloud's serverless data warehouse.

- **Extends:** [Data Warehouse](data.md#data-warehouse) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `analytics`
- **Protocol:** `SQL`
- **Read:** 4 from [Data Warehouse](data.md#data-warehouse), 3 from [Data](data.md#data)
- **Write:** 9 from [Data Warehouse](data.md#data-warehouse), 8 from [Data](data.md#data)

### GCP Cloud Storage

Cloud Storage, the object storage of Google Cloud.

- **Extends:** [Object Storage](data.md#object-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** 3 from [Object Storage](data.md#object-storage), 3 from [Data](data.md#data)
- **Write:** `Insert`, `Patch`, `Update`, `Copy`, `Compose`, `Rewrite`, plus 3 from [Object Storage](data.md#object-storage), 8 from [Data](data.md#data)

### GCP Persistent Disk

Persistent Disk, block volumes for Compute Engine.

- **Extends:** [Block Storage](data.md#block-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 3 from [Data](data.md#data)
- **Write:** 8 from [Data](data.md#data)

### GCP Pub/Sub

Pub/Sub, Google Cloud's global messaging service of topics and subscriptions.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** `Pull`, `StreamingPull`, plus 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `Acknowledge`, `ModifyAckDeadline`, `CreateTopic`, `CreateSubscription`, `Seek`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

## Azure products

### Azure CDN

Azure CDN, the content delivery network of Azure.

- **Extends:** [CDN](edge.md#cdn) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 1 from [CDN](edge.md#cdn), 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Azure Front Door

Azure Front Door, Azure's global entry point: CDN, load balancing and WAF at the edge.

- **Extends:** [CDN](edge.md#cdn) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 1 from [CDN](edge.md#cdn), 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Azure DNS

Azure DNS, the DNS service of Azure.

- **Extends:** [DNS](edge.md#dns) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `dns`
- **Protocol:** `DNS`
- **Read:** 2 from [DNS](edge.md#dns)
- **Write:** 1 from [DNS](edge.md#dns)

### Azure Load Balancer

Azure Load Balancer, the L4 load balancer of Azure.

- **Extends:** [Load Balancer](edge.md#load-balancer) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Azure Application Gateway

Azure Application Gateway, the L7 load balancer of Azure, with an optional WAF.

- **Extends:** [Load Balancer](edge.md#load-balancer) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Azure API Management

Azure API Management, the API gateway and developer portal of Azure.

- **Extends:** [API Gateway](edge.md#api-gateway) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Azure VM

Azure Virtual Machines, virtual machines on Azure.

- **Extends:** [VM](compute.md#vm) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure AKS

Azure Kubernetes Service, managed Kubernetes on Azure.

- **Extends:** [Kubernetes](compute.md#kubernetes) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure Container Instances

Azure Container Instances, containers on Azure without servers to manage.

- **Extends:** [Docker](compute.md#docker) › [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure App Service

Azure App Service, Azure's managed platform for web apps and APIs.

- **Extends:** [Platform](compute.md#platform) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure Functions

Azure Functions, functions that run per request or event on Azure.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure Logic Apps

Azure Logic Apps, workflows of connectors that run on triggers.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Azure SQL

Azure SQL Database, managed SQL Server on Azure.

- **Extends:** [SQL Server](data.md#sql-server) › [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### Azure Database for PostgreSQL

Azure Database for PostgreSQL, managed PostgreSQL on Azure.

- **Extends:** [PostgreSQL](data.md#postgresql) › [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 1 from [PostgreSQL](data.md#postgresql), 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 3 from [PostgreSQL](data.md#postgresql), 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### Azure Database for MySQL

Azure Database for MySQL, managed MySQL on Azure.

- **Extends:** [MySQL](data.md#mysql) › [Database](data.md#database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Protocol:** `SQL`
- **Read:** 6 from [Database](data.md#database), 3 from [Data](data.md#data)
- **Write:** 1 from [MySQL](data.md#mysql), 11 from [Database](data.md#database), 8 from [Data](data.md#data)

### Azure Cosmos DB

Azure Cosmos DB, Azure's globally distributed multi-model database.

- **Extends:** [Document NoSQL Database](data.md#document-nosql-database) › [NoSQL Database](data.md#nosql-database) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `database`
- **Read:** `ReadItem`, `ReadMany`, `QueryItems`, `ReadChangeFeed`, plus 2 from [NoSQL Database](data.md#nosql-database), 3 from [Data](data.md#data)
- **Write:** `CreateItem`, `UpsertItem`, `ReplaceItem`, `PatchItem`, `DeleteItem`, `TransactionalBatch`, plus 3 from [NoSQL Database](data.md#nosql-database), 8 from [Data](data.md#data)

### Azure Cache for Redis

Azure Cache for Redis, managed Redis on Azure.

- **Extends:** [Redis](data.md#redis) › [Cache](data.md#cache) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `cache`
- **Protocol:** `RESP`
- **Read:** 67 from [Redis](data.md#redis), 2 from [Cache](data.md#cache), 3 from [Data](data.md#data)
- **Write:** 81 from [Redis](data.md#redis), 3 from [Cache](data.md#cache), 8 from [Data](data.md#data)

### Azure AI Search

Azure AI Search, the managed search service of Azure, with vector search.

- **Extends:** [Search Engine](data.md#search-engine) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `search`
- **Read:** 3 from [Search Engine](data.md#search-engine), 3 from [Data](data.md#data)
- **Write:** 3 from [Search Engine](data.md#search-engine), 8 from [Data](data.md#data)

### Azure Blob Storage

Azure Blob Storage, the object storage of Azure.

- **Extends:** [Object Storage](data.md#object-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** `GetBlob`, `GetBlobProperties`, `GetBlobMetadata`, `GetBlockList`, `ListBlobs`, `ListContainers`, plus 3 from [Object Storage](data.md#object-storage), 3 from [Data](data.md#data)
- **Write:** `PutBlob`, `PutBlock`, `PutBlockList`, `PutPage`, `AppendBlock`, `CopyBlob`, `DeleteBlob`, `SetBlobMetadata`, `SetBlobProperties`, `SnapshotBlob`, `LeaseBlob`, `CreateContainer`, `DeleteContainer`, plus 3 from [Object Storage](data.md#object-storage), 8 from [Data](data.md#data)

### Azure Files

Azure Files, managed SMB and NFS file shares on Azure.

- **Extends:** [Shared File System](data.md#shared-file-system) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 2 from [Shared File System](data.md#shared-file-system), 3 from [Data](data.md#data)
- **Write:** 1 from [Shared File System](data.md#shared-file-system), 8 from [Data](data.md#data)

### Azure Disk Storage

Azure Managed Disks, block volumes for Azure virtual machines.

- **Extends:** [Block Storage](data.md#block-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Read:** 3 from [Data](data.md#data)
- **Write:** 8 from [Data](data.md#data)

### Azure Queue Storage

Azure Queue Storage, simple message queues in an Azure storage account.

- **Extends:** [Message Queue](messaging.md#message-queue) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `queue`
- **Read:** `GetMessages`, `PeekMessages`, plus 3 from [Message Queue](messaging.md#message-queue), 4 from [Messaging](messaging.md#messaging)
- **Write:** `PutMessage`, `UpdateMessage`, `DeleteMessage`, `ClearMessages`, plus 7 from [Messaging](messaging.md#messaging)

### Azure Service Bus

Azure Service Bus, Azure's enterprise broker of queues and topics.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** `ReceiveMessages`, `PeekMessages`, plus 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `SendMessages`, `CompleteMessage`, `AbandonMessage`, `DeadLetterMessage`, `DeferMessage`, `ScheduleMessages`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### Azure Event Hubs

Azure Event Hubs, Azure's partitioned event stream, with a Kafka endpoint.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** `ReceiveEvents`, plus 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `SendEvents`, `UpdateCheckpoint`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

### Azure Event Grid

Azure Event Grid, Azure's event routing service.

- **Extends:** [Message Broker](messaging.md#message-broker) › [Messaging](messaging.md#messaging) › [Component](core.md#component)
- **Kind:** `broker`
- **Read:** 2 from [Message Broker](messaging.md#message-broker), 4 from [Messaging](messaging.md#messaging)
- **Write:** `PublishEvents`, plus 1 from [Message Broker](messaging.md#message-broker), 7 from [Messaging](messaging.md#messaging)

## Cloudflare products

### Cloudflare

Cloudflare, the CDN and edge network in front of the origin.

- **Extends:** [CDN](edge.md#cdn) › [HTTP Edge](edge.md#http-edge) › [Edge](edge.md#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](edge.md#http-edge)
- **Write:** 1 from [CDN](edge.md#cdn), 4 from [HTTP Edge](edge.md#http-edge)
- **Statuses:** 61 from [HTTP Edge](edge.md#http-edge)
- **Headers:** 69 from [HTTP Edge](edge.md#http-edge)

### Cloudflare Workers

Cloudflare Workers, functions that run at Cloudflare's edge locations.

- **Extends:** [Function](compute.md#function) › [Compute](compute.md#compute) › [Component](core.md#component)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](compute.md#compute)
- **Headers:** 69 from [Compute](compute.md#compute)

### Cloudflare R2

Cloudflare R2, object storage with the S3 API and no egress fees.

- **Extends:** [AWS S3](#aws-s3) › [Object Storage](data.md#object-storage) › [Data](data.md#data) › [Component](core.md#component)
- **Kind:** `storage`
- **Protocol:** `HTTP`
- **Read:** 11 from [AWS S3](#aws-s3), 3 from [Object Storage](data.md#object-storage), 3 from [Data](data.md#data)
- **Write:** 14 from [AWS S3](#aws-s3), 3 from [Object Storage](data.md#object-storage), 8 from [Data](data.md#data)
