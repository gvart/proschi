# Design: typed components

Status: accepted (iteration 1, the core) · Applies to: language, simulation, tooling, web editor

## Goal

A `[Tech]` on a node names a type. A type says what kind of thing the node is,
what numbers the simulation starts from, which operations it supports (read or
write), and which statuses and headers an HTTP service uses. Built-in types
cover the catalog's techs; users declare their own types in the same syntax
and extend the built-in ones:

```proschi
type LedgerDb extends PostgreSQL {
  latencyMs 8
  op write APPEND latency 2
}
ledger "Ledger" [LedgerDb]
```

This page records the decisions (D1 to D7), the syntax, the format of the
stdlib files, and the API that later iterations build on: iteration 2 writes
the full stdlib tree, iteration 3 resolves step labels against a type's
operations, and the tooling iteration adds hover, completion and go to
definition.

---

## D1. Built-in types are written in Proschi

The built-in types live in a bundled stdlib, `.proschi` files under
`frontend/src/dsl/stdlib/`. User types use the same syntax, so there is one
mechanism, one parser and one resolver for both.

The files are bundled as strings in `stdlib/sources.gen.ts`, which
`npm run gen:stdlib` writes from them (`frontend/scripts/gen-stdlib.mjs`). A
generated module rather than a `?raw` import keeps the stdlib plain
TypeScript to every bundler: Vite here and esbuild in `tooling/`. A test fails
when the generated file is out of date.

## D2. Syntax

At the top level:

```proschi
abstract type Store extends Database {
  kind database                     # one of the 17 kinds
  durable true                      # a profile number, see below
  latencyMs 4
  availability 99.95%
  protocol SQL
  op read  SELECT
  op write INSERT, UPDATE, DELETE
  op read  Scan latency 8 cost 2    # optional multipliers
  status 200, 201, 404              # HTTP status codes
  header Authorization, Content-Type
  icon PostgreSQL                   # a catalog tech; else inherited
  doc "Human description, shown in hover and docs"
}
type LedgerDb extends Store { op write APPEND }
type [Ledger Store] extends [REST API] {}
```

- A header is `[abstract] type Name [extends Parent] {`. A name with spaces is
  written in brackets, as a tech is on a node: `type [REST API] extends Service {`.
  `extends` takes the same forms, and a catalog alias (`extends Postgres`).
- A body is one property per line, or a single property on the header line
  closed with `}` (`{ op write APPEND }`). `{}` is an empty body.
- `type` and `abstract` are keywords only in the shape of a header (a name and
  then `{` or `extends`), so nodes called `type` or `abstract` still parse.
- Types are declared at the top level only, anywhere in the file: a node may
  use a type declared further down or in another file.

Properties:

| Line | Value |
|---|---|
| `kind <kind>` | One of the 17 kinds (dsl/kinds.ts). |
| `rps`, `readRps`, `writeRps` | A rate, `20k` or `20k rps`. `rps` sets reads and writes unless they are set too. |
| `latencyMs` | A number of milliseconds, `4` or `4ms`. |
| `availability` | A percentage, `99.95%`. |
| `costUsd` | USD per month, `400` or `400 usd/month`. |
| `bandwidthMBps`, `egressUsdPerGb` | `500` / `500 MB/s`, `0.09` / `0.09 usd/GB`. |
| `durable` | `true` or `false`. |
| `consistency` | `strong` or `eventual`. |
| `writeScaling` | `replicas` or `shards`. |
| `protocol` | A word or a string: `SQL`, `HTTP`, `RESP`. |
| `op read\|write <names> [latency <n>] [cost <n>]` | Comma-separated names (words or strings); multipliers apply to each. |
| `status <codes>` | Comma-separated codes, 100 to 599. |
| `header <names>` | Comma-separated header names; dashes are allowed (`Content-Type`). In a one-line body, quote a name with dashes. |
| `icon <tech>` | A catalog tech stack: `icon PostgreSQL`, `icon [Amazon DynamoDB]`. |
| `doc "<text>"` | A description. |

The profile numbers are the per-replica row of `sim/profiles.ts`, in its
names; a `capacity { … }` override on a node still wins over them.

## D3. Inheritance

- Single inheritance. A type without `extends` extends `Component`, the root,
  an abstract type with no kind.
- A child inherits everything. Its own scalars (props, `kind`, `protocol`,
  `icon`, `doc`) override; `op`, `status` and `header` lists add up, and an own
  `op` with an inherited op's name replaces it. `abstract` is not inherited.
  There is no removal syntax yet.
- Errors: a type cycle (`Type cycle: A → B → A`), an unknown parent (with a
  suggestion), a duplicate type name, a redeclared built-in type, and a
  concrete type without a kind. A type whose chain is broken is resolved as if
  it extended `Component`, and its missing kind is not reported twice.
- A node of an abstract type gets a warning that names a concrete child, if
  one exists.
- `extends` may name any catalog tech, typed in the stdlib or not: one without
  a stdlib type acts as a type with its catalog kind and icon, right under
  `Component`. This keeps `extends DynamoDB` working before iteration 2 types
  every tech.
- A user type named like a catalog tech gets a warning: `[Kafka]` then means
  the user's type.

## D4. Kinds stay closed

The 17 kinds stay a closed union and keep driving the simulation. Every
concrete type declares or inherits a `kind`. `any <kind>` selectors keep
working on the node's kind, which is its type's kind when it has one.

## D5. Tech names are type names, and the icon key

A built-in type named after a catalog tech (`PostgreSQL`, `Redis`,
`[REST API]`) is drawn with that tech's icon. A declared type gets the icon of
its nearest built-in ancestor, or its own `icon`; with none on the way up, the
generic tech of its kind (`Database`, `Object Storage`, …).

The node's `techStack` and `type` (its ComponentType) are those of the icon,
so the canvas, the HLD and everything else that reads `techStack` keep
working; the declared type's own name is `node.resolvedType.name`. A test
selector `[LedgerDb]` matches nodes by either name.

## D6. Backward compatibility

A diagram without `type` blocks parses and simulates exactly as before:

- A name the catalog knows always means that catalog tech; a built-in type
  never changes it. `[SQL Database]` (an alias of `Database`) stays
  `Database` although a `SqlDatabase` type exists. Lookup order: a declared
  type of that name, else the type of the catalog tech the name refers to,
  else a built-in type of that name.
- Built-in types set no profile numbers that differ from `sim/profiles.ts`
  (in iteration 1 they set none), and each one named after a catalog tech has
  that tech's kind. Tests check both.
- An unknown `[Tech]` keeps today's warning and inferred kind.

Nodes of catalog techs with a stdlib type do carry `resolvedType` now; it adds
a field, and changes nothing else.

## D7. Unknown operations

Iteration 3 resolves step labels against a node's `resolvedType.ops`; an
operation the type does not list becomes a warning. Iteration 1 only exposes
the resolved type, and step labels are read as before.

---

## The stdlib files

`frontend/src/dsl/stdlib/*.proschi`, read `core.proschi` first and then by
file name, as one set: a file may extend a type of another. Rules (repeated at
the top of `core.proschi`):

- Only `type` and `abstract type` blocks, blank lines and comments.
- A type named after a catalog tech has the tech's kind (and so its icon).
- Profile numbers only where they equal what `sim/profiles.ts` gives the tech.
- Run `npm run gen:stdlib` after editing. It also rewrites the built-in type
  reference in `docs/types/` (`npm run gen:type-docs`, plugins/typeReference.ts),
  which the docs build renders from the stdlib and a test keeps current.

Iteration 1's seed held `Component`, `Service`, `DataStore`, `Database`,
`SqlDatabase`, `PostgreSQL`, `Cache`, `Redis` and `[REST API]`. Iteration 2
replaced it with the full tree below; `DataStore` and `SqlDatabase` are gone,
because their names are catalog aliases (`Datastore` is GCP Firestore,
`SQL Database` is Database).

### The tree (iteration 2)

Every catalog tech has a concrete type of the same name, with the catalog's
kind, so its icon and simulation stay as they were. Abstract types hold the
shared vocabulary and carry no catalog name or alias. The files are `core`,
`edge`, `compute`, `data`, `messaging`, `external` and `cloud-aws`,
`cloud-gcp`, `cloud-azure`, `cloud-cloudflare`.

- `Component`
  - `Caller` (client): Actor, Browser, Mobile App. `Shape` (client):
    Rectangle, Circle, Diamond, Cylinder, Cloud.
  - `Annotation` and `Group` (other): the notes and the group boxes.
  - `Edge` (edge): DNS, AWS Global Accelerator, and `HttpEdge` (the HTTP
    methods, statuses and headers): CDN, Load Balancer, API Gateway, WAF and
    their products. The ones that carry WebSockets (API Gateway, AWS Load
    Balancer, Cloudflare, nginx, Envoy, HAProxy, …) add `MESSAGE`, a write
    that forwards a WebSocket message.
  - `Compute` (service; statuses and headers, no ops): Service, Worker,
    `Platform` (VM, Docker, Kubernetes and the clouds' versions of them),
    Function (and the serverless products). Under Service: the languages and
    frameworks, gRPC, WebSocket, SOAP API, and `HttpService` (the HTTP
    methods): REST API, GraphQL. Their own requests are named freely.
  - `DataComponent` (plain verbs: READ, FETCH, LOOKUP; WRITE, SAVE, STORE,
    RECORD, MARK, RESERVE, HOLD, BOOK): Database (SQL) with the relational
    products and `DistributedSql`; NoSQL Database with DynamoDB,
    `DocumentNoSql`, `WideColumnNoSql` and `GraphNoSql`; `CoordinationStore`
    (etcd, ZooKeeper); Cache (Redis and the Redis-compatible stores,
    Memcached, …); Search Engine; Data Warehouse and `TimeSeriesStore`;
    Object Storage (S3, GCS, Azure Blob, R2, MinIO, …), `SharedFileSystem`
    and `BlockStorage`.
  - `Messaging` (SEND, PUBLISH, ENQUEUE, …; RECEIVE, SUBSCRIBE, …): Message
    Queue (SQS, Azure Queue Storage, Redis Queue, ZeroMQ) and Message Broker
    (Kafka, RabbitMQ, NATS, Pub/Sub, Kinesis, SNS, EventBridge, …).
  - `External` (the HTTP methods, statuses and headers): Third Party API,
    Payment Gateway, Auth Service, `Notifier` (email, SMS, push), Analytics
    Service, Google Maps, OpenAI and their products.

Op names are unique along a chain, ignoring case. Each verb of
`WRITE_VERBS` (dsl/access.ts) is a write op of some type. Where an op of the
target's type matches a practice step, its access is the step's access today,
except for Redis LPOP, PFADD and ZINCRBY: these are writes that the verb list
reads (`stdlib.test.ts` lists them). No type sets profile numbers or op
multipliers yet, so the simulation is unchanged.

## Public API

From `frontend/src/dsl` (`index.ts`):

```ts
interface ResolvedType {
  name: string;
  abstract: boolean;
  builtin: boolean;               // from the stdlib (or a catalog tech used with extends)
  parents: string[];              // parent first, ending with 'Component'
  kind?: Kind;                    // always set on a concrete type
  props: TypeProps;               // profile numbers, own over inherited
  ops: { name: string; access: 'read' | 'write'; latency?: number; cost?: number }[];
  statuses: number[];
  headers: string[];
  protocol?: string;
  icon?: string;                  // catalog tech stack
  doc?: string;
  loc: SourceLoc;                 // the name in its header; stdlib types have file 'stdlib/<name>.proschi'
}
```

- `DiagramNode.resolvedType?: ResolvedType`: the type `[Tech]` names.
- `Diagram.types?: ResolvedType[]`: the declared (not built-in) types of the
  document and its imports, in order.
- `builtinTypes(): TypeTable`: the stdlib, resolved once per process.
- `lookupType(table, name)`: the type `[name]` on a node means (D6 order).
- `resolveTypes(decls, base?)`: resolves `TypeDecl`s over a base table;
  returns `{ table, types, diagnostics }`.
- `parseTypeDecls(source, path)`: the unresolved type blocks of one file.
- `typeKey(name)`: the normalised key types are found by (case, spaces and
  punctuation ignored, like tech names). `techNamed(name)`: the catalog tech a
  type is named after, if any.
- `kindOf(node)` prefers the type's kind; `profileOf(node)` (sim/profiles.ts)
  lays the type's props over the tech's row (or the kind's row, when the type
  changes the kind) before any `capacity` override.
