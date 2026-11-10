# Component types

The tech stack in a node's brackets names a type. The type says what kind
of component the node is, which numbers the simulation starts from, and
which operations its clients may send it.

Proschi has a built-in type for every tech in the catalog, and you declare
your own in the same syntax:

```proschi annotated
title "Payments"

# @note A type of your own. `extends PostgreSQL` keeps the icon, kind,
# @note numbers and operations of the built-in type.
type LedgerDb extends PostgreSQL {
  doc "Append-only payments ledger"
  # @note A property overrides the inherited number: 8 ms per request.
  latencyMs 8
  # @note A new operation. A step whose label starts with `APPEND` is a
  # @note write.
  op write APPEND
  # @note A read that takes twice the node's usual time.
  op read BALANCE latency 2
}

user   "Customer"     [Browser]
api    "Payments API" [REST API] x2
# @note The node uses the type like any tech stack. It is drawn with the
# @note PostgreSQL icon.
ledger "Ledger"       [LedgerDb] x2

user -> api    : HTTPS
api  -> ledger : SQL

usecase "Pay" {
  user -> api    : POST /payments
  # @note `APPEND` names an operation of `LedgerDb`, so the step writes.
  api  -> ledger : APPEND payment
  api  -> ledger : BALANCE of the account
  api --> user   : 201
}
```

> **Try it:** change `APPEND payment` to `persist payment`. Proschi warns
> that `LedgerDb` has no operation `persist`.

## Why types exist

A type is the vocabulary of a component. PostgreSQL answers `SELECT` and
`INSERT`, Kafka takes `PUBLISH`, a REST API takes `GET` and `POST`. When a
step names one of these, Proschi knows whether it reads or writes, and the
editor completes the names after the colon. A label the type does not know
is likely a typo or the wrong component, and you get a warning.

Types also carry the simulation's starting numbers. A type of your own can
change them for every node that uses it, where a
[`capacity` block](HLD.md#capacity) changes one node.

## Declare a type

```proschi fragment
abstract type Store extends Data {
  kind database
}
type OrderStore extends Store { op write RESERVE }
type [Order Archive] extends [Object Storage] {}
```

- `type Name extends Parent { … }` declares a type. Without `extends`, it
  extends `Component`, the root.
- `abstract type` declares a type that only exists to be extended. A node
  of an abstract type gets a warning that suggests a type extending it.
- A name with spaces goes in brackets, as on a node. `extends` takes any
  built-in type, a catalog alias (`extends Postgres`) or a type of yours.
- The body holds one property per line. A single property may sit on the
  header line (`{ op write RESERVE }`), and `{}` is an empty body.
- Types go at the top level, anywhere in the file. A node may use a type
  declared further down or in an [imported file](#share-types-through-imports).

A concrete type needs a `kind`, declared or inherited. Every concrete
[built-in type](#built-in-types) has one, so extending it settles that.

## Properties and overrides

| Line | Example | Meaning |
|---|---|---|
| `kind` | `kind cache` | One of the [kinds](TESTS.md#selectors-and-kinds). It drives the simulation. |
| `rps`, `readRps`, `writeRps` | `rps 20k` | Requests per second one replica takes. |
| `latencyMs` | `latencyMs 4` | Milliseconds per request. |
| `availability` | `availability 99.95%` | Availability of one replica. |
| `costUsd` | `costUsd 400` | USD per month per replica. |
| `bandwidthMBps`, `egressUsdPerGb` | `bandwidthMBps 500` | Network throughput and egress price. |
| `durable`, `consistency`, `writeScaling` | `consistency eventual` | `true`/`false`, `strong`/`eventual`, `replicas`/`shards`. |
| `protocol` | `protocol SQL` | The protocol the type speaks. |
| `op` | `op read Scan latency 8 cost 2` | Operations, see [below](#operations-reads-and-writes). |
| `status`, `header` | `status 200, 404` | HTTP statuses and headers, see [below](#statuses-and-headers). |
| `icon` | `icon [AWS S3]` | A catalog tech whose icon the type is drawn with. |
| `doc` | `doc "Holds the carts"` | A description. |

A type inherits everything from its parent. Its own `kind`, numbers,
`protocol`, `icon` and `doc` replace the inherited ones. Its `op`, `status`
and `header` lines add to the inherited lists, and an `op` with an
inherited op's name (in any case) replaces that op. `abstract` is not inherited. A
`capacity` block on a node still wins over every number of its type.

## Operations: reads and writes

```proschi fragment
op read  SELECT, "full scan"
op write INSERT, UPDATE latency 2 cost 3
```

`op read` and `op write` list operation names, separated by commas. A name
with spaces or symbols goes in quotes. A step names an operation with the
first words of its label (`INSERT order`), or with its HTTP method
(`GET /orders`). Case does not matter, and the longest name wins.

The operation decides whether the step reads or writes, which is what the
simulation counts as load on [reads and writes](USE-CASES.md#reads-and-writes).
The multipliers apply to each name on the line:

- `latency 2` doubles the target's service time for that step.
- `cost 3` makes the step count as three requests of load on the target,
  so it needs more replicas, and those cost more.

`op forward` is the third access, for an edge that passes a WebSocket
frame on: the load balancers and gateways list `op forward MESSAGE`. A
forwarded step reads or writes as the next step from its target does, the
one that handles the frame. `MESSAGE CURSOR moved` to nginx, then
`CURSOR moved` to a server whose type says `op read CURSOR`, is a read.

## Statuses and headers

```proschi fragment
type [Cart API] extends [REST API] {
  status 409
  header X-Cart-Id
}
```

`status` lists HTTP status codes, `header` lists header names. A response
such as `cart --> user : 299` is checked against the statuses of the
type that answers it. A request can name its headers after the path:
`GET /cart header Authorization, X-Cart-Id`. Each one is checked against
the target's headers. The HTTP types (`[REST API]`, the gateways, the
external APIs) list the standard statuses and headers already.

## Icons

A built-in type named after a catalog tech is drawn with that tech's icon.
A type of yours takes the icon of its nearest built-in ancestor, or the one
its `icon` line names. With neither on the way up, it gets the generic icon
of its kind:

```proschi
title "Three stores"

type Ledger extends PostgreSQL {}
type Archive extends Ledger { icon [AWS S3] }
type Bag extends Data { kind storage }

ledger  "Ledger"  [Ledger]
archive "Archive" [Archive]
bag     "Bag"     [Bag]
```

> **Try it:** add `icon Redis` to the body of `Bag`, and its box gets the
> Redis icon.

## Document a type

`doc "…"` describes the type. The editor shows it when it completes the
type's name, and the language server shows it on hover with the type's
chain, kind and operations. Every built-in type has one, and the
[built-in type reference](#built-in-types) lists them.

## Share types through imports

Types travel with [imports](IMPORTS.md). Declare them once in a file and
import it wherever a diagram uses them:

```proschi fragment
# types.proschi
type LedgerDb extends PostgreSQL {
  op write APPEND
}
```

```proschi fragment
# payments.proschi
import "types.proschi"
ledger "Ledger" [LedgerDb]
```

A type name must be unique across the files of a diagram. Declaring it
twice is an error at the second declaration, naming the first.

## Types without operations

A type that lists no operations accepts any label. The service types
(`[Service]`, `[Go]`, `[Spring Boot]` and the like) list none, because a
service's requests are yours to name: `api -> billing : charge card` is
fine. To close one, extend it with operations and use your type: from then
on a label that names none of them warns. Nodes whose tech stack is not in
the catalog have no type, and their labels are free text too.

## Fix an unknown operation

A step to a typed component that names none of its operations gets a
warning at the word:

```text
PostgreSQL has no operation 'persist'. Its operations are LISTEN, NOTIFY, COPY, VACUUM, SELECT, WITH, EXPLAIN, SHOW, …. Treated as a comment.
```

When the word is a near miss (`INSRT`), the warning says `Did you mean
INSERT?` instead of listing the operations. The step still plays. Without
a matching operation it counts as a read, or as a write when its verb wrote
before types (`APPEND`, `INCR`), and the warning then ends "Treated as a
write, as before." To fix it, pick one:

1. Use an operation the type lists. The warning suggests a close one, or
   lists them, and the editor completes them after the colon.
2. Add the operation: declare a type that extends the built-in one with
   `op write persist`, and use it on the node.
3. Use a type without operations, such as `[Service]`, if the label is
   free text on purpose.

Unknown statuses and headers get the same kind of warning.

## Strict mode

A practice problem with `strict: true` in its front matter turns these
warnings into errors, so a solution must name a real operation in every
step. See [writing practice problems](PRACTICE.md).

## Type errors

| Message starts with | Cause |
|---|---|
| `Type cycle: A → B → A` | Two types extend each other. |
| `Unknown parent type` | `extends` names no type; the message suggests a close one. |
| `Duplicate type` | The same name is declared twice. |
| `Type 'Redis' is built in` | A built-in type is declared again. Extend it under another name. |
| `Type 'X' needs a kind` | A concrete type has no kind, declared or inherited. |
| `'Store' is an abstract type` | A node uses an abstract type (a warning). |
| `Type 'Postgres' has the name of the catalog tech` | Your type now takes over that tech's name (a warning). |
| `Unknown icon` | `icon` names no catalog tech; the type keeps its inherited icon. |

## Built-in types

The reference lists every built-in type with its parents, kind, protocol,
operations, statuses and headers, generated from the stdlib:

| Area | Types |
|---|---|
| [Clients, shapes, notes and groups](types/core.md) | `Component`, `Browser`, `Mobile App`, `Rectangle`, `Logical Group` |
| [Edge](types/edge.md) | `DNS`, `CDN`, `Load Balancer`, `API Gateway`, `WAF`, `nginx` |
| [Compute](types/compute.md) | `Service`, `Worker`, `Function`, `REST API`, `GraphQL`, `Kubernetes` |
| [Data](types/data.md) | `Database`, `PostgreSQL`, `DynamoDB`, `Redis`, `Elasticsearch`, `Object Storage` |
| [Messaging](types/messaging.md) | `Message Queue`, `Message Broker`, `Kafka`, `RabbitMQ`, `SQS` |
| [External services](types/external.md) | `Payment Gateway`, `Stripe`, `Auth Service`, `Email Service`, `OpenAI` |
| [Cloud providers](types/cloud.md) | The AWS, Google Cloud, Azure and Cloudflare products |

A generic type has the standard operations of its family, and its products
inherit them next to their own API's names:

| Type | Reads | Writes |
|---|---|---|
| `NoSQL Database` (`Key-Value Store`, `Document Store`, …) | `GET`, `SCAN` | `PUT`, `SET`, `DELETE` |
| `Cache` | `GET`, `MGET` | `SET`, `DELETE`, `EXPIRE` |
| `Message Queue`, `Message Broker` | `RECEIVE`, `SUBSCRIBE` | `SEND`, `PUBLISH`, `ACK` |
| `Object Storage` | `GET`, `HEAD`, `LIST` | `PUT`, `DELETE`, `UPLOAD` |
| `Search Engine` | `Search`, `Get`, `KNN` | `Index`, `Upsert`, `Delete` |
| `CDN` | `GET`, `HEAD`, `OPTIONS` | `POST`, `PUT`, `PATCH`, `DELETE`, `PURGE` |

So `GET settings` to a `[Key-Value Store]` reads, and the same label works
on DynamoDB, MongoDB or Cassandra. Types whose requests are your own API
have no operations and take any label: `Service`, `Worker`, `gRPC`,
`WebSocket`, the languages, the platforms and the functions. To check the
labels of one, [declare a type](#declare-a-type) with its operations.

The abstract types in between are named like the catalog techs, and one
that narrows another ends with its name: `[Document NoSQL Database]` under
`NoSQL Database`, `[HTTP Service]` under `Service`. The top levels are one
word: `Edge`, `Compute`, `Data`, `Messaging` and `External`, and `Caller`,
`Shape`, `Annotation` and `Group` for what is drawn.

## Go further

- [Nodes and connections](NODES.md): tech stacks, replicas and owners.
- [Use cases](USE-CASES.md): the steps that name operations.
- [Grammar](GRAMMAR.md): the language in EBNF.
