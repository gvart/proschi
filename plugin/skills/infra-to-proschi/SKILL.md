---
name: infra-to-proschi
description: Turn an existing architecture description into a Proschi (.proschi) model that renders, simulates and passes `proschi check`. Use when the user asks to diagram, model, visualise or "convert to Proschi" their system from what already exists - prose or wiki docs, a README architecture section, Mermaid diagrams, Terraform, CloudFormation, CDK, Pulumi, Kubernetes manifests, Helm charts or docker-compose files - or asks for an architecture diagram as code of the current repository.
license: MIT
---

# Existing architecture → Proschi

Goal: one `.proschi` file (default `architecture.proschi` at the repo root, or
`docs/architecture.proschi` if a `docs/` folder exists) whose nodes, groups
and connections match what the sources say, with every guess marked, that
passes `npx proschi@latest check`, and a share link for the user.

Read [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md)
first: it has the syntax, the catalog of `[Tech]` names and the CLI.

## 1. Collect the sources

Look for, in this order, and read what you find:

| Source | Where to look |
|---|---|
| Mermaid | `*.mmd`, ` ```mermaid ` blocks in `*.md` |
| Compose | `docker-compose*.yml`, `compose*.yaml` |
| Kubernetes / Helm | `k8s/`, `deploy/`, `manifests/`, `charts/*/templates/`, `values*.yaml`, `kustomization.yaml` |
| Terraform / IaC | `*.tf`, `*.tfvars`, `template.yaml` / `*.template.json` (CloudFormation, SAM), `cdk.json` + `lib/*.ts`, `Pulumi.yaml` |
| Prose | `README*`, `ARCHITECTURE.md`, `docs/`, ADRs, wiki pages the user pastes |

**Mermaid shortcut.** Convert first, then refine the result with the rules below:

```sh
npx proschi@latest import mermaid docs/architecture.md -o architecture.proschi
```

Warnings on stderr name what was dropped (styling, notes, loops); read them.

## 2. Map resources to nodes

One node per deployable thing or managed resource that takes part in
requests. Pick the most specific catalog tech; otherwise the generic tech of
its kind (`[Service]`, `[Database]`, `[Message Queue]`) with the product in
the name.

| Source shape | Proschi |
|---|---|
| Compose service with `image: postgres`, `mysql`, `redis`, `rabbitmq`, `nginx`, … | node with that tech (`[PostgreSQL]`, `[Redis]`, `[RabbitMQ]`, `[nginx]`) |
| Compose service with `build:` | your service: tech from the Dockerfile / language (`[Node.js]`, `[Spring Boot]`, `[Go]`, `[FastAPI]`); a `command:` running a consumer → `[Worker]` or the language |
| k8s `Deployment` / `StatefulSet` | node; `replicas: 3` → `x3`; the image decides the tech |
| k8s `Ingress` / Gateway API | `[Kubernetes Ingress]` (or `[nginx]`, `[Envoy]`, `[Traefik]` from the ingress class) |
| k8s `CronJob` / `Job` | `[Worker]` node |
| `aws_lb` / `AWS::ElasticLoadBalancingV2` | `[AWS Load Balancer]` |
| `aws_api_gateway_*`, `aws_apigatewayv2_*` | `[AWS API Gateway]` |
| `aws_lambda_function` | `[AWS Lambda]` |
| `aws_ecs_service`, `aws_eks_*` | `[AWS ECS]` / `[AWS EKS]` service node; `desired_count` → `xN` |
| `aws_db_instance`, `aws_rds_cluster` | `[AWS RDS]` / `[AWS Aurora]` (or `[PostgreSQL]` from `engine`); read replicas → `xN` |
| `aws_dynamodb_table`, `aws_elasticache_*`, `aws_s3_bucket`, `aws_sqs_queue`, `aws_sns_topic`, `aws_msk_cluster`, `aws_cloudfront_distribution`, `aws_route53_*` | `[DynamoDB]`, `[AWS ElastiCache]`, `[AWS S3]`, `[AWS SQS]`, `[AWS SNS]`, `[AWS MSK]`, `[AWS CloudFront]`, `[AWS Route53]` |
| GCP / Azure equivalents | the `GCP …` / `Azure …` techs in the cheat-sheet |
| Third-party API keys (`STRIPE_*`, `SENDGRID_*`, `TWILIO_*`, `OPENAI_*`) | external node (`[Stripe]`, `[SendGrid]`, `[Twilio]`, `[OpenAI]`) |
| Users, browsers, apps | `[Actor]`, `[Browser]`, `[Mobile App]` |

Leave out what is not on a request path: IAM roles, security groups
themselves, log groups, alarms, CI runners, secrets stores (unless the app
calls them at request time). Ids: snake_case or camelCase from the resource
name (`order-api` → `order_api`). Owner teams from CODEOWNERS or labels →
`@team`. A one-line responsibility → the description string.

## 3. Groups

`group id "Name" [Style] { … }` for the boundaries that matter to a reader:

- VPC / VNet / network → `[Network Boundary]`; private subnets or a DMZ →
  `[Security Zone]`.
- Kubernetes cluster or namespace, Compose project → `[Service Group]`.
- Team or bounded context → plain `group` (Logical Group).

Nest at most two levels; skip a group with a single member.

## 4. Connections

Add `a -> b : label` (caller → callee) for each dependency you can see:

- **Env vars and config**: `DATABASE_URL=postgres://…@db`, `REDIS_HOST`,
  `KAFKA_BROKERS`, `http://orders:8080` → connection to that host's node.
- **Compose** `depends_on` and `links`; **k8s** Service DNS names
  (`orders.default.svc`) in env or ConfigMaps; Ingress rules → backend service.
- **Security groups / NetworkPolicies**: an ingress rule from SG A on port
  5432 to SG B means A's members → B's members. **IAM policies**
  (`sqs:SendMessage` on queue X) → publisher → X.
- **Terraform references**: `aws_lambda_event_source_mapping` → queue → function;
  `aws_sns_topic_subscription` → topic → subscriber; LB target groups → service.
- Labels: the protocol or purpose (`HTTPS`, `SQL`, `gRPC`, `Publish`,
  `Consume`). A consumer reads from a queue: `queue -> worker : Consume`.

## 5. Mark guesses, never invent silently

Everything not stated by a source gets a comment saying so:

```proschi fragment
search "Product search" [Elasticsearch] # GUESS: named in README, no manifest found
api -> search : Query # GUESS: inferred from ELASTIC_URL in api env
```

Prefer leaving a node unconnected (with a `# TODO:` comment) over inventing
a dependency. At the end, list the guesses for the user to confirm.

## 6. Validate and iterate

```sh
npx proschi@latest fmt architecture.proschi
npx proschi@latest check architecture.proschi
```

Fix every error. Fix warnings too: `Unknown tech stack 'X'. Did you mean 'Y'?`
→ use `Y` or a generic tech; `No connection between 'a' and 'b'` → add the
connection. Repeat until `no problems`. If the file has use cases, traffic,
requirements or tests, also run `npx proschi@latest test architecture.proschi`
and make it pass (or report why it cannot). To add request flows next, use the
`code-to-usecases` skill; for load and cost, `proschi-capacity-plan`.

## 7. Hand over

```sh
npx proschi@latest share-link architecture.proschi
```

Give the user: the file path, the link (it opens the diagram in the web
editor; the diagram is inside the link, nothing is uploaded), the list of
guesses to confirm, and what you left out.

## Worked example

`docker-compose.yml` (abridged):

```yaml
services:
  nginx:  { image: nginx:1.27, depends_on: [api] }
  api:    { build: ., environment: { DATABASE_URL: "postgres://db/shop", REDIS_URL: "redis://cache", AMQP_URL: "amqp://rabbit", STRIPE_API_KEY: "…" } }
  worker: { build: ., command: node src/worker.js, environment: { DATABASE_URL: "postgres://db/shop", AMQP_URL: "amqp://rabbit", SENDGRID_API_KEY: "…" } }
  db:     { image: "postgres:16" }
  cache:  { image: "redis:7" }
  rabbit: { image: "rabbitmq:3-management" }
```

`architecture.proschi`:

```proschi
title "Shop" "Online shop: catalogue, checkout and order emails"

user "Customer" [Browser]

group shop "Compose project: shop" [Service Group] {
  nginx  "Reverse proxy" [nginx]
  api    "Shop API"      [Node.js]    "Catalogue and checkout"
  worker "Order worker"  [Node.js]    "Sends order confirmations" # from command: node src/worker.js
  db     "Shop DB"       [PostgreSQL]
  cache  "Product cache" [Redis]
  rabbit "Order events"  [RabbitMQ]
}
stripe   "Stripe"   [Stripe]   # from STRIPE_API_KEY
sendgrid "SendGrid" [SendGrid] # from SENDGRID_API_KEY

user   -> nginx    : HTTPS # GUESS: port 443 published on nginx
nginx  -> api      : HTTP
api    -> db       : SQL
api    -> cache    : GET/SET
api    -> rabbit   : Publish
api    -> stripe   : HTTPS
rabbit -> worker   : Consume
worker -> db       : SQL
worker -> sendgrid : HTTPS
```
