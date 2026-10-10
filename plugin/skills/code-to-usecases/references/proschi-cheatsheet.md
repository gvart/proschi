# Proschi cheat-sheet

The whole language on one page, for writing `.proschi` files. The full
reference is <https://proschi.app/docs/language/>; the parser is the
definition, so when in doubt run `npx proschi@latest check <file>` and believe it.

## Statements

```proschi
# The second string (the summary) is optional.
title "Shop" "One-line summary of the system"

# Group styles: Logical Group (default), Network Boundary, Security Zone, Service Group.
group vpc "AWS VPC" [Network Boundary] {
  api "Order API" [Spring Boot] @orders x3
  db  "Orders DB" [PostgreSQL]  @orders "Owns orders and payments"
}
user "Customer" [Actor]

# Architecture connections; the label is optional.
user -> api : HTTPS
api  -> db  : SQL
```

- Node: `id ["Name"] [Tech] [@team] ["Description"] [x<replicas>]`, parts in
  any order after the id. Ids: letters, digits, `_`; start with a letter or `_`
  (`order-service` is invalid: write `order_service` or `orderService`).
- One statement per line. `#` starts a comment. Nodes and groups may nest in
  groups; `usecase`, `traffic`, `requirements`, `capacity`, `entity`,
  `decision`, `test` and `import "file.proschi"` are top level only.
- An id used in a connection but never declared becomes a plain node, so
  declare every node with a tech to get the right icon and numbers.
- Format with `npx proschi@latest fmt <file>` (aligns columns; never changes meaning).

## Tech stacks (`[Tech]`) and kinds

The tech decides the icon, the kind and the simulation defaults. Matching
ignores case, spaces, punctuation and a trailing version (`[postgres 16]` is
`[PostgreSQL]`). An unknown tech is only a warning; to stay clean, use the
generic tech of its kind and put the product in the name:
`ledger "TigerBeetle ledger" [Database]`.

| Kind | Use these techs |
|---|---|
| client | `Actor` (aliases User, Client, Customer), `Browser`, `Mobile App` |
| edge / cdn / loadbalancer / gateway / dns | `CDN`, `AWS CloudFront`, `Cloudflare`, `Fastly`, `Load Balancer`, `AWS Load Balancer` (ALB/NLB), `nginx`, `Envoy`, `HAProxy`, `Traefik`, `Kubernetes Ingress`, `API Gateway`, `AWS API Gateway`, `Kong`, `Azure Application Gateway`, `DNS`, `AWS Route53`, `WAF`, `AWS WAF` |
| service | `Service`, `Worker`, `REST API`, `gRPC`, `GraphQL`, `WebSocket`, `Spring Boot`, `Kotlin`, `Java`, `Go`, `Node.js` (Express, NestJS), `Python`, `Django`, `FastAPI`, `Flask`, `Ruby on Rails`, `.NET`, `PHP`, `Rust`, `Elixir`, `Kubernetes`, `Docker`, `VM`, `AWS EC2`, `AWS ECS`, `AWS EKS`, `AWS Fargate`, `GCP GKE`, `Azure AKS`, `Azure App Service` |
| function | `Function`, `AWS Lambda`, `GCP Cloud Functions`, `GCP Cloud Run`, `Azure Functions`, `Cloudflare Workers` |
| cache | `Cache`, `Redis`, `Valkey`, `Memcached`, `AWS ElastiCache`, `GCP Memorystore`, `Azure Cache for Redis`, `Hazelcast` |
| database | `Database`, `NoSQL Database`, `PostgreSQL`, `MySQL`, `MariaDB`, `SQL Server`, `Oracle`, `SQLite`, `AWS RDS`, `AWS Aurora`, `GCP Cloud SQL`, `Azure SQL`, `CockroachDB`, `GCP Spanner`, `DynamoDB`, `Cassandra`, `ScyllaDB`, `MongoDB`, `Azure Cosmos DB`, `GCP Firestore`, `GCP Bigtable`, `Neo4j`, `etcd` |
| search | `Search Engine`, `Elasticsearch`, `OpenSearch`, `Solr`, `Algolia`, `Meilisearch` |
| analytics | `Data Warehouse`, `GCP BigQuery`, `Snowflake`, `AWS Redshift`, `ClickHouse`, `InfluxDB`, `TimescaleDB`, `Prometheus` |
| queue | `Message Queue`, `Kafka`, `AWS MSK`, `RabbitMQ`, `AWS SQS`, `AWS SNS`, `AWS Kinesis`, `AWS EventBridge`, `GCP Pub/Sub`, `NATS`, `Azure Service Bus`, `Azure Event Hubs`, `Apache Pulsar`, `Redpanda` |
| storage | `Object Storage`, `AWS S3`, `GCP Cloud Storage`, `Azure Blob Storage`, `MinIO`, `Cloudflare R2`, `AWS EFS` |
| external | `Third Party API`, `Payment Gateway`, `Email Service`, `SMS Service`, `Push Service`, `Auth Service`, `Stripe`, `PayPal`, `Adyen`, `Twilio`, `SendGrid`, `Mailgun`, `Auth0`, `Okta`, `AWS Cognito`, `AWS SES`, `APNs`, `FCM`, `OpenAI`, `Google Maps` |
| other (text) | `Text Note`, `Sticky Note`, `Comment` |

## Use cases: request flows

```proschi
usecase "Place order" "Checkout from the cart" {
  user -> api : POST /orders json {"sku": "A1", "qty": 2}
  alt "Paid" {
    api -> db : INSERT order
    # Steps in a par block run in parallel; par blocks do not nest.
    par {
      api ->> events : OrderPlaced {"id": "o-1"}
      api ->> audit  : RECORD order
    }
    api --> user : 201 {"id": "o-1"}
  } alt "Invalid" when "sku missing" {
    api --> user : 400 {"error": "sku required"}
  } alt "DB down" {
    api  -x db   : INSERT order
    api --> user : 503
  }
}
```

| Arrow | Meaning |
|---|---|
| `a -> b : label` | synchronous request |
| `a ->> b : label` | async, fire-and-forget (publish, enqueue, emit) |
| `b --> a : label` | response to the latest unanswered request from `a` to `b` |
| `a -x b : label` | failed call (timeout, refused); never answered |

- Labels: `GET /orders/{id}` sets method and path (standard verbs only);
  then a JSON body (may span lines until brackets balance) or `json`/`xml`/`text …`.
  Responses start with a status: `201 {"id": 1}`. Other text is a step name:
  `SELECT order`, `INCR rate:42`, `OrderPlaced {…}`.
- Prefixes on requests: `x200` (fan-out: 200 calls per request), `~2MB`
  (payload size): `worker -> feeds : x200 LPUSH feed:{id}`.
- Reads vs writes: POST/PUT/PATCH/DELETE write, GET reads. Without a method
  the first word decides: INSERT, UPDATE, UPSERT, DELETE, CREATE, PUT, SET,
  WRITE, SAVE, STORE, UPLOAD, RECORD, MARK, INCR, LPUSH, ZADD, HSET, XADD,
  PutItem, RESERVE, HOLD, CHARGE, PUBLISH, SEND, ENQUEUE, EMIT, NOTIFY write;
  everything else reads. A request to a queue is always a write.
- Every step should follow an architecture connection (either direction) or
  `check` warns `No connection between 'a' and 'b'`: add `a -> b`.
- `alt` blocks that touch (`} alt "B" {`) are one set of alternatives; steps
  before a set are shared, steps after it are appended to every branch.
  Nested sets multiply (max 32 scenarios). `when "…"` is optional.
- An error path is a scenario whose first request gets a 4xx/5xx or `-x`.
- A consumer reading from a queue: `events ->> worker : OrderPlaced`, with
  the connection `events -> worker` (or `worker -> events`).

## High-level design blocks (all optional, top level)

```proschi fragment
traffic {
  "Place order" 200 rps mix "Paid" 95%, "Invalid" 4%, "DB down" 1%
  # Without mix, all traffic goes to the first scenario.
  "Get order" 2k rps
}
requirements {
  # p50 p90 p95 p99 p999; without a name, every use case.
  p99 "Place order" < 300ms
  p99 "Get order" scenario "Hit" < 20ms
  availability >= 99.9%
  # Writes a durable store before responding.
  durable "Place order"
  # Or: survive failure of db / [Redis] / any cache.
  survive any node failure
  cost <= 2000 usd/month
}
# Per-replica overrides, one line per node.
capacity {
  db    reads 30k rps writes 5k rps shards 2 latency 4ms
  api   2k rps cost 120 usd/month
  cache 150k rps availability 99.95%
  pay   timeout 300ms
}
entity Order in db "One placed order" {
  id     uuid   key
  userId uuid   index
  total  int
  note   string optional
}
decision "Publish OrderPlaced to Kafka" {
  because "Email and analytics must not slow down checkout"
  rejected "Call email service inline" "Adds 200 ms and couples availability"
}
decision "Postgres for orders" because "Transactions across order lines"
test "Checkout never waits for email" {
  "Place order" never waits for any queue or any external
  "Place order" writes db before responding
  "Place order" has scenario "DB down"
  "Get order" calls any cache before any database
  no path from user to any database
  api has replicas >= 2
}
```

Quantities: `200 rps`, `6k rpm`, `1m rpd`, `50ms`, `1.5s`, `99.9%`,
`400 usd/month`, `500 MB/s`, `0.05 usd/GB`; magnitudes `k`, `m`, `b`.

Test assertions (U = `"use case"`, optional `scenario "S"` after it; X/Y =
selector: `id`, `[Tech]`, `any <kind>`, `any strong store`, `any eventual store`,
`X or Y`):
`U calls X`, `U every scenario calls X`, `U never calls X`,
`U calls X before Y`, `U calls Y after X`, `U never waits for X`,
`U writes X before responding`, `U responds 201|2xx|4xx`, `U has scenario S`,
`U handles failure of X` (a *success* scenario survives a `-x` to X: a
fallback), `U starts at X`, `[in U] X calls Y`,
`[in U] X never calls Y`, `no path from X to Y`, `X has replicas >= n`.

## Simulation defaults per replica (override in `capacity`)

| Kind | Capacity | Latency | Availability | Cost/month |
|---|---|---|---|---|
| service | 2k rps | 10 ms | 99.5% | $100 |
| function | 10k | 25 ms | 99.95% | $200 |
| gateway | 10k | 10 ms | 99.95% | $100 |
| loadbalancer | 100k | 2 ms | 99.99% | $50 |
| cdn | 200k | 5 ms | 99.99% | $100 |
| cache | 100k | 1 ms | 99.9% | $150 |
| relational db | 20k reads / 5k writes per shard (replicas add reads only) | 5 ms | 99.95% | $400 |
| NoSQL db | 20k | 5 ms | 99.99% | $500 |
| search | 3k | 15 ms | 99.9% | $400 |
| queue | 50k | 5 ms | 99.99% | $200 |
| storage | 5k | 30 ms | 99.99% | $50 |
| external | 1k | 200 ms | 99.9% | $0 |

Latency of a hop grows as base ÷ (1 − utilisation); p99 ≈ 3 × mean of the
slowest scenario carrying ≥ 1% of traffic. A node at 100% is saturated and
fails every latency requirement it is on. n replicas: availability
1 − (1 − a)ⁿ. A `-x` costs its timeout (1 s default).

## CLI

```sh
npx proschi@latest check file.proschi          # errors + warnings (exit 1 on errors; --strict for warnings)
npx proschi@latest test file.proschi           # requirements and test blocks
npx proschi@latest analyze file.proschi        # capacity table: load, p99, availability, cost, SPOFs
npx proschi@latest fmt file.proschi            # canonical layout
npx proschi@latest render --format hld-md --out docs file.proschi   # HLD document
npx proschi@latest import mermaid diagram.mmd -o file.proschi       # Mermaid → Proschi
npx proschi@latest import openapi openapi.yaml -o file.proschi      # OpenAPI → use cases
npx proschi@latest share-link file.proschi     # link that opens it in the web editor
```

`import` and `share-link` need proschi 0.9 or newer. If your installed CLI
says `Unknown command`, run them with `npx proschi@latest`, or open
<https://proschi.app/app/> and paste the file (*Share* copies the link).
