# Proschi language reference

A Proschi document describes an architecture (nodes, groups and the
connections between them) and its use cases (request flows, step by step) as
plain text. A mistake never stops the diagram: each problem is reported with
its line and column, and everything else still renders.

The web editor, the command line and the editor plugins all read documents
the same way, so they report the same problems. See
[Editor support](EDITORS.md) for VS Code, IntelliJ, Neovim and CI, and the
[grammar](#grammar) at the end of this page for the whole syntax at a glance.

```proschi
title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway "API Gateway"   [AWS API Gateway] @Platform
  orders  "Order Service" [REST API]        @Orders "Handles orders"
}
ordersDb "Orders DB"   [PostgreSQL]
events   "OrderEvents" [Kafka]

gateway -> orders   : HTTP
orders  -> ordersDb : SQL
orders  -> events   : Publish

usecase "Create order" {
  gateway -> orders : POST /api/orders json {
    "sku": "A1"
  }
  alt "Created" {
    par {
      orders -> ordersDb : INSERT order
      orders ->> events  : OrderCreated {"orderId": "o-1"}
    }
    orders --> gateway : 201 {"status": "pending"}
  } alt "Invalid payload" {
    orders --> gateway : 400 {"error": "sku required"}
  } alt "DB down" {
    orders -x ordersDb : INSERT order
    orders --> gateway : 503
  }
}
```

The architecture is written once. Any number of use cases can play over it,
and each use case can branch into [scenarios](#scenarios), such as a success
path and its error paths. A document can also carry a
[high-level design](#high-level-design): traffic, requirements, capacity, the
data model, decisions and tests.

The usual layout is two spaces per block, with similar lines lined up in
columns. *Format code* in the editor (or [proschi fmt](EDITORS.md#formatting))
does it for you.

## Statements

Each line of a document is one statement. The syntax column uses square
brackets around optional parts; the brackets of a tech stack, such as
`[Redis]`, are literal.

| Statement | Syntax | Notes |
|---|---|---|
| Title | `title "Text" ["Summary"]` | The optional second string is a one-line summary of the system. |
| Import | `import "infra.proschi"` | Top level only. Adds everything that file declares. See [Imports](#imports). |
| System | `system id ["Name"] [@team] [pos x,y] [color c] [.tag] [rank N] { … }` | A team's design as one box, with its own scope and a contract. At the top level or inside a group. See [Systems](#systems). |
| Node | `id ["Name"] [Tech] [@team] ["Description"] [pos x,y] [x3] [color c] [.tag] [critical] [rank N]` | The parts after the id may come in any order. The first string is the name, the second the description; x3 means three replicas. See [Colors and legend](#colors-and-legend) for color, tag and critical, and [Steering the layout](#steering-the-layout) for rank. |
| Group | `group id ["Name"] [Style] [pos x,y] [color c] [.tag] [rank N] { … }` | Holds nodes, nested groups and connections, and optionally a `direction`. The style is Logical Group (the default), Network Boundary, Security Zone or Service Group. |
| Connection | `a -> b [.tag] [: label]` | An edge of the architecture. An id that was never declared becomes a plain node. The tag goes before the colon, because the label runs to the end of the line. |
| Legend | `legend { … }` | Top level only. Named styles that `.tag` applies. See [Colors and legend](#colors-and-legend). |
| Direction | `direction down\|right\|up\|left` | At the top level, where edges flow in the whole diagram (default down). Inside a group, where they flow among its members. See [Steering the layout](#steering-the-layout). |
| Ordered layout | `layout ordered` | Top level only. Edges follow declaration order, so what is declared first sits higher. See [Steering the layout](#steering-the-layout). |
| Use case | `usecase "Name" ["Description"] { … }` | Top level only. A request flow, step by step. See [Use case steps](#use-case-steps). |
| Parallel steps | `par { … }` | Inside a use case or a scenario. See [Parallel steps](#parallel-steps). |
| Scenario | `alt "Name" [when "condition"] { … }` | Inside a use case or another scenario. See [Scenarios](#scenarios). |
| Traffic, requirements, capacity | `traffic { … }` and the like | Top level only. See [High-level design](#high-level-design). |
| Entity | `entity Name [in store] { … }` | Top level only. Part of the data model. |
| Decision | `decision "Title" { … }` | Top level only. Why the design is this way. |
| Test | `test "Name" { … }` | Top level only. Checks on the request flows. |
| Comment | `# …` | Anywhere, to the end of the line. A # inside quotes or a JSON payload is just text, and so is a hex color right after `color` (`color #3b82f6`). |

- **Ids** are letters, digits and underscores, and don't start with a digit.
- **The tech stack** names a technology from the catalog (about 210 of them,
  see [Tech stacks](#tech-stacks)), such as AWS Lambda, Redis or Spring Boot.
  It decides the node's icon, its [kind](#selectors-and-kinds) and its default
  numbers in the simulation.
- **Notes.** The tech stacks Text Note, Sticky Note and Comment make text
  nodes. The description, or else the name, becomes the text.

### Tech stacks

The editor and the language server complete the whole catalog. Each entry
also answers to the names people usually write, so S3, Amazon S3 and AWS S3
are the same tech, and so are Postgres and PostgreSQL, ALB and AWS Load
Balancer, k8s and Kubernetes. Case, spaces and punctuation don't matter
(route 53, pubsub, nodejs), and neither does a version at the end
(PostgreSQL 16, Redis 7.2).

| Group | Examples |
|---|---|
| Generic, one per kind | `Service`, `Worker`, `Database`, `NoSQL Database`, `Cache`, `Message Queue`, `Object Storage`, `CDN`, `Load Balancer`, `API Gateway`, `DNS`, `WAF`, `Function`, `Search Engine`, `Data Warehouse` |
| Services and runtimes | `REST API`, `gRPC`, `GraphQL`, `WebSocket`, `Spring Boot`, `Kotlin`, `Java`, `Go`, `Node.js`, `Python`, `Django`, `FastAPI`, `.NET`, `Kubernetes`, `Docker`, `AWS ECS`, `AWS EKS`, `GCP GKE`, `Azure AKS` |
| Functions | `AWS Lambda`, `GCP Cloud Functions`, `GCP Cloud Run`, `Azure Functions`, `Cloudflare Workers` |
| Relational and NoSQL | `PostgreSQL`, `MySQL`, `MariaDB`, `SQL Server`, `Oracle`, `AWS Aurora`, `AWS RDS`, `GCP Cloud SQL`, `CockroachDB`, `GCP Spanner`, `DynamoDB`, `Cassandra`, `ScyllaDB`, `MongoDB`, `Azure Cosmos DB`, `Neo4j`, `etcd` |
| Caches | `Redis`, `Valkey`, `Memcached`, `AWS ElastiCache`, `GCP Memorystore`, `Hazelcast` |
| Queues and brokers | `AWS SQS`, `Kafka`, `AWS Kinesis`, `AWS SNS`, `RabbitMQ`, `GCP Pub/Sub`, `NATS`, `AWS EventBridge`, `Azure Service Bus`, `Apache Pulsar`, `Redpanda` |
| Search and analytics | `Elasticsearch`, `OpenSearch`, `Solr`, `GCP BigQuery`, `Snowflake`, `AWS Redshift`, `ClickHouse`, `InfluxDB`, `TimescaleDB` |
| Storage | `AWS S3`, `GCP Cloud Storage`, `Azure Blob Storage`, `MinIO`, `Cloudflare R2` |
| Edge | `AWS CloudFront`, `Fastly`, `Akamai`, `Cloudflare`, `AWS Load Balancer`, `nginx`, `Envoy`, `HAProxy`, `Kubernetes Ingress`, `AWS API Gateway`, `Kong`, `AWS Route53`, `AWS WAF` |
| External | `Stripe`, `PayPal`, `Twilio`, `SendGrid`, `Auth0`, `Okta`, `APNs`, `FCM`, `Payment Gateway`, `Third Party API` |

A tech the catalog does not know is a warning, not an error, so a document
that uses one still renders and simulates. The node keeps the text you wrote
and is drawn and simulated as the kind its name suggests: `[TigerBeetle DB]`
is a database, `[Acme Queue]` a queue, `[In-house Search Index]` a search
node. Without a telling word it takes the kind of the closest catalog tech
(`[Postgress]` is a database), and otherwise it is a service. It is never a
client: an unknown node has a finite capacity, a latency and a price. The
warning names the closest catalog tech when there is one, and the language
server offers to replace the name with it:

```text
Unknown tech stack 'Postgress'. Did you mean 'PostgreSQL'?
Until then it is simulated as a generic database, like [Database]
```

To keep a product name the catalog lacks without the warning, use the generic
tech of its kind instead (`[Database]`, `[Message Queue]`) and put the product
in the node's name or description.

## Colors and legend

Nodes are tinted by their category, so a diagram reads at a glance without any
styling: clients gray, edge components (CDN, load balancer, gateway, DNS, WAF)
purple, services and functions blue, data stores green, queues and brokers
orange, external services pink. Groups and notes stay neutral. The tints are
soft and follow the light and dark theme; text keeps the theme's ink color.

`color` sets a node's or group's color by hand. It takes a palette name (gray,
blue, teal, green, yellow, orange, red, purple, pink) or a hex value (`#3b82f6`
or `#38f`). From a hex value Proschi derives a fill light enough for the text
and a matching border, in both themes.

```proschi
api    "Order API" [REST API] color teal
vendor "Vendor"    [Third Party API] color #0891b2
group retail "Point of Sale" color blue {
  store [REST API]
}
```

A `legend` block names styles and explains them. Each line is an id, a label,
and optionally a color and `dashed` or `dotted`. `.id` applies the style to a
node, a group or a connection, and the legend is drawn in a corner of the
canvas and in exported images. On a node or group the color sets the fill and
the border, and the dash applies to the border; on a connection they set the
line.

```proschi
legend {
  owned      "Owned by Order Fulfillment" green
  handover   "Handed over to POS in Q4"   blue
  planned    "Planned flow"               blue dashed
  deprecated "Deprecated"                 red dashed
}

group fulfillment "Order Fulfillment" .owned {
  orders "Order Service" [REST API] critical
}
legacy "Legacy ERP" [SOAP API] .deprecated

orders -> legacy .deprecated : sync orders
```

- An explicit `color` wins over the tag's color, and the tag's color wins over
  the category's. While the load overlay is on, it colors the nodes instead.
- A hex color in a legend line needs the word: `old "Old" color #ef4444`. A
  bare `#` starts a comment.
- One tag per node, group or connection. Tags style the architecture, so use
  case steps take none.
- An unknown tag or color name is an error that names the closest match.
- The Mermaid export keeps the colors and dashes but not the legend, which
  Mermaid cannot draw.
- `critical` draws a warning badge on the node's top-right corner, for the
  parts whose failure matters most.

## Steering the layout

The diagram is laid out automatically, top to bottom along the edges.
Nodes side by side in a row come in the order they are declared, left to
right, wherever that doesn't add crossings: members of a group always do
when nothing else is in the way, and a layout that would come out mirrored
is turned round. Declare things in reading order and the diagram reads the
same way. Three hints steer the layout further. They only change positions
and routes, not what the diagram means.

```proschi
title "Order Fulfillment"
layout ordered

shopper "Shopper" [Actor]       rank 0
pricing "Pricing" [Third Party API] rank 0

group core "Core services" rank 1 {
  orders "Order Service" [REST API]
}

group kafka "Kafka cluster" rank 2 {
  direction right
  placed  "Order placed"  [Kafka]
  shipped "Order shipped" [Kafka]
}

group data "Data" rank 3 {
  db [PostgreSQL]
}

shopper -> orders
orders  -> pricing : quote
orders  -> placed
orders  -> shipped
orders  -> db
```

- `layout ordered` lays every edge out in declaration order: of two
  connected nodes, the one declared first sits higher, even when the edge
  points up (`orders -> pricing` above). Declare things in reading order,
  for example clients and external systems, then services, then data. By
  default only edges that close a cycle are turned like this, and the
  others point down.
- `rank N` on a node or a group header pins it to a layer among the nodes
  and groups that share its parent: top-level nodes and groups with each
  other, members of a group with each other. A lower rank sits higher, and
  equal ranks line up in one row. `rank first` and `rank last` put a node
  above or below everything else in its parent. Ranks order the layers, they
  don't count them: nodes without a rank still go where their edges pull
  them, which can be between two ranks or above rank 0.
- `direction down|right|up|left` at the top level turns the whole diagram.
  Inside a group it sets where edges flow among its members. Members with no
  edge between them line up the same way, so `direction right` in a Kafka
  cluster puts its topics in one row.

A few things the layout can't do:

- Two connected nodes can't share a row, because an edge always runs from
  one layer to another. Of two connected nodes with the same rank, the target
  goes one layer lower, so give them different ranks.
- A group with its own direction is laid out separately and placed as one
  box. Its members keep the order a layout without that hint would give
  them. An edge into it ends at its border, straight across from the member
  it reaches, and runs on in a straight line to that member. Several edges
  to one member share that way in and part just before the member.
- Fewer crossings come first: when declaration order would cost a crossing,
  the row keeps the order with fewer crossings.
- In a parent where something has a rank, every label sits on its edge in a
  layer of its own, and the diagram gets a little taller.

## Use case steps

A use case is a list of steps. Each step is an arrow between two nodes and a
label, and the kind of arrow says what happens:

| Arrow | Meaning |
|---|---|
| `a -> b : …` | A synchronous request: a waits for the answer. |
| `a ->> b : …` | An asynchronous message, fire and forget. If a reply follows, it is an async request and response. |
| `b --> a : …` | The response to the latest unanswered request from a to b. |
| `a -x b : …` | A failed call: the request never gets an answer (a timeout, a refused connection). Nothing can answer it. |

The label is free text, but some shapes mean something:

```proschi fragment
api -> orders  : POST /orders {"sku": "A1"}   # method, path, JSON body
orders -> db   : INSERT order                 # a step name
orders --> api : 201 {"id": 42}               # status code and body
feed -> cache  : x200 LPUSH feed:{follower}   # 200 times per request
web -> blobs   : ~2MB PUT /files/{id}         # a 2 MB payload
```

- **HTTP.** A label that starts with a standard method (GET, POST, PUT,
  PATCH, DELETE, HEAD or OPTIONS) and a path sets the endpoint. The path may
  have placeholders such as /orders/{id}.
- **Payload.** After the path, a body that starts with a brace, a square
  bracket or an angle bracket is read as JSON or XML. You can also name the
  format with the words json, xml or text. A JSON body may span several
  lines; it continues until its brackets balance.
- **Step name.** Any other text names the step, such as INSERT order or
  OrderCreated.
- **Status.** On a response, a leading three-digit number is the status code.
- **Fan-out and size.** A request label may start with a count (x200) and a
  payload size (~2MB), in either order. See
  [Fan-out and payload size](#fan-out-and-payload-size).

The command line can compare these steps with the OpenAPI specs of the
services they call: endpoints, status codes and JSON payloads. See
[Checking against OpenAPI](EDITORS.md#checking-against-openapi).

### Fan-out and payload size

Two optional prefixes on a request label tell the simulation how much work a
step really is:

| Prefix | Meaning |
|---|---|
| `x<N>` | The step happens N times per request (N is 1 or more). Load counts all N calls; latency counts the step once, as if they were batched or parallel. |
| `~<size>` | The payload size: a number and B, KB, MB, GB or TB. Units are decimal (1 MB is 1000 KB). It adds transfer time and egress cost. |

A prefix counts only at the very start of a request label and only when a
space or the end of the label follows, so labels such as "xml payload",
"x-request-id" or "GET /x200" are read as written. A zero count, a prefix
given twice and a malformed size (lower-case units, a missing unit or number)
are errors. Responses and connection labels never have prefixes.

### Reads and writes

The simulation counts reads and writes separately, because a store usually
handles far fewer writes than reads. Each request step is one or the other:

1. **With an HTTP method:** POST, PUT, PATCH and DELETE write; GET, HEAD
   and OPTIONS read.
2. **Otherwise the first word of the label decides** (after any prefixes,
   ignoring case, whole words only). The verbs in the table below write.
3. **Everything else reads:** GET, SELECT, QUERY, SCAN, FETCH, LOOKUP, an
   event name such as OrderPlaced, and so on.

| Write verbs | Typical labels |
|---|---|
| INSERT, UPDATE, UPSERT, DELETE, CREATE | INSERT order, UPDATE seat SET held |
| PUT, SET, WRITE, APPEND, SAVE, STORE, UPLOAD, COMMIT, RECORD, MARK | PUT pastes/k7Qz2, STORE body, MARK paid |
| PUTITEM, UPDATEITEM, DELETEITEM, BATCHWRITEITEM | DynamoDB: PutItem Url |
| INCR, INCRBY, DECR, HINCRBY, LPUSH, RPUSH, ZADD, HSET, SADD, XADD, MSET, GEOADD | Redis: INCR rate:42, ZADD feed:7 p_981 |
| RESERVE, HOLD, BOOK, CHARGE | claiming a resource or money: HOLD seat 12A, CHARGE card |
| PUBLISH, SEND, ENQUEUE, PRODUCE, EMIT, NOTIFY | handing something on: EMIT OrderShipped, NOTIFY bob |

Words that only start like a verb (Stored, Booking, Notification) read.
Requirements about durable writes count write steps only.

The protocol of a step is inferred too: an async arrow, or a queue or broker
as the target means messaging; an HTTP method means REST, or GraphQL, gRPC
or SOAP when the target's tech stack says so; anything else is "other".

### Steps follow the architecture

When a step goes between two nodes that no connection joins (in either
direction), you get a warning that suggests the connection to add, and the
language server can add it for you. A node calling itself is fine, and a
document without any connections (only use cases) is not checked.

## Scenarios

One endpoint rarely has one outcome. Scenario blocks, written with the word
alt, split a use case into its outcomes without copying the steps they share.
Pick a scenario in the example and press Play:

```proschi
gateway  "API Gateway"   [AWS API Gateway]
orders   "Order Service" [REST API]
ordersDb "Orders DB"     [PostgreSQL]
audit    "Audit log"     [AWS SQS]

gateway -> orders   : HTTP
orders  -> ordersDb : SQL
gateway -> audit    : Publish

usecase "Get order" {
  gateway -> orders : GET /api/orders/42   # shared by every scenario

  alt "Found" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway  : 200 {"id": 42}
  } alt "Not found" when "no order has that id" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway  : 404 {"error": "not_found"}
  } alt "DB timeout" {
    orders -x ordersDb  : SELECT order 42
    orders --> gateway  : 504
  }

  gateway ->> audit : OrderViewed          # shared again, after them
}
```

- **A set of alternatives.** Scenario blocks that follow each other directly
  are one set: close one and open the next on the same line, as above, or on
  the next line. A step between two blocks starts a new set.
- **Shared steps.** Each branch becomes a scenario. Steps before a set are
  shared by all its branches, and steps after it are added to every branch.
  A response inside a branch may answer a request made before it.
- **Nesting.** Scenario blocks can be nested. Nested sets, and several sets
  in a row, multiply: two sets of two branches give four scenarios, named
  like "A › X". A use case keeps at most 32 scenarios.
- **Error paths.** A scenario is an error path when the use case's first
  request is answered with a 4xx or 5xx status, or fails. Playback draws
  error replies and failed calls in red.
- **When.** A branch can say when it happens, as "Not found" does above. The
  condition is free text; the editor shows it on the scenario's tooltip and
  during playback. For nested branches the conditions are joined with a dot,
  such as "cache miss · db down".
- A use case without scenario blocks has a single scenario. In links, a
  scenario is named by its name in lower case with dashes (not-found).

### Parallel steps

Steps in a par block run at the same time, for example a write to the
database and an event to a queue. The use case waits for the slowest of
them, so its latency is the longest step in the block, not the sum. Use one
when a service fans work out and doesn't need one result to start the next.

```proschi
user   "Shopper"      [Browser]
api    "Checkout API" [REST API]
db     "Orders DB"    [PostgreSQL]
events "Order events" [AWS SNS]
mail   "Email"        [SendGrid]

user -> api   : HTTPS
api -> db     : SQL
api -> events : Publish
api -> mail   : HTTPS

usecase "Checkout" {
  user -> api : POST /checkout
  par {
    api -> db      : INSERT order
    api ->> events : OrderPlaced
    api -> mail    : SEND receipt
  }
  api --> user : 201
}
```

A par block goes inside a use case or a scenario block. It holds steps only:
it cannot contain another par block or a scenario block.

### Grouping by endpoint

The use case picker in the editor groups use cases by the HTTP method and
path of their first step, so all the flows of one endpoint sit together.
Use cases that don't start with an HTTP call are listed under *Other flows*.

Calls to the same endpoint with different ids share a group:

1. A path with a placeholder groups by itself: GET /orders/{id}.
2. Otherwise, a concrete path joins a placeholder path of another use case
   with the same method that it matches, where a placeholder stands for
   exactly one path segment: GET /orders/order-789 joins GET /orders/{id}.
3. Otherwise, segments that are all digits or a UUID count as an id, so
   GET /orders/42 and GET /orders/43 group as GET /orders/{id}.

## Imports

Write the infrastructure once and keep use cases in other files, for example
one per domain:

```proschi
# infra.proschi
title "Shop infrastructure"
gateway "API Gateway" [AWS API Gateway]
orders "Order Service" [REST API] @Orders
ordersDb [PostgreSQL]
gateway -> orders
orders -> ordersDb
```

```proschi fragment
# checkout.proschi
title "Checkout"
import "infra.proschi"

usecase "Place order" {
  gateway -> orders : POST /orders
  orders -> ordersDb : INSERT order
  orders --> gateway : 201
}
```

- **Paths** are relative to the importing file. An imported file can import
  others in turn. A path may also name a file in a git repository or at an
  https URL; see [Remote sources](#remote-sources).
- **Inside the project.** On disk, every imported file must be inside the
  [project root](#the-project-root).
- **Everything is shared.** Everything an imported file declares (nodes,
  groups, connections, use cases) becomes part of the diagram. The importing
  document's title names it; titles of imported files are ignored.
- **Once only.** A file imported along several paths is included once. An
  import cycle is an error on the import that closes it, and so is a file
  that does not exist.
- **Ids stay unique across files.** Declaring the same id in two files is an
  error at the later one, naming the file and line of the first.
- **Undeclared ids** become plain nodes only after every file is read, so a
  use case file may use nodes its imports declare.
- Problems in an imported file are reported with that file's path.

Where imports are found:

- **In the web editor**, among the diagrams saved in your browser, by file
  name. A diagram opened from a .proschi file keeps its name; a new one is
  named after its title (Shop Infra becomes shop-infra.proschi) and keeps that
  name when the title changes. Rename it with the pencil in the *Diagrams*
  menu.
- **On the command line, in editor plugins and in the Claude Code plugin**,
  on disk, inside the project root. The language server prefers the text of
  open, unsaved documents. Remote files come from the local cache that
  `proschi imports sync` fills.

In the web editor, nodes and connections from imported files are drawn like
any other, but canvas edits only change the open document: moving, renaming or
deleting something declared in an imported file is refused with a short
message. Edit that file instead. The problems panel lists problems in imported
files with the file name in front; clicking one opens that diagram.

The same rules apply to the `from` file of a [system](#systems): it is found
the same way, and must be inside the same project root.

### The project root

On disk, imports are confined to the project root. It is the first of these
that exists:

1. the folder of the nearest `proschi.json`, in the entry file's folder or
   above it;
2. the root of the git repository the entry file is in;
3. the folder of the entry file itself.

The entry file is the one you check, render or open. Inside the root, `../`
works as usual, so in a monorepo `services/orders/design.proschi` can import
`../../shared/infra.proschi`. These are errors:

- an absolute path, such as `/etc/infra.proschi` or `C:\infra.proschi`;
- a path that leaves the root, such as `../../../elsewhere.proschi`;
- a symlink inside the root that points to a file outside it.

A project with neither a `proschi.json` nor a git repository can import only
from the entry file's folder and below. Earlier versions followed any
relative path, so such a project that imports from a folder above the entry
file now gets an error. Fix it by putting a `proschi.json` in the folder that
holds both files. An empty object is enough:

```json
{}
```

### Remote sources

An import (or a `from`) can name a file in a git repository or at an https
URL:

```proschi fragment
import "git:github.com/acme/platform//diagrams/infra.proschi@v1.4.0"
import "https://example.com/diagrams/shared.proschi"
```

| Source | Form | Notes |
|---|---|---|
| Git | `git:<host>/<org>/<repo>//<path>@<ref>` | The `//` separates the repository from the path inside it. The ref is a tag, a branch or a commit. More path segments before `//` are fine (GitLab subgroups). |
| HTTPS | `https://…` | `http://` is refused. A URL with a user name or password is refused, and so is one with a `#fragment`. |

- **Relative imports inside a remote file stay in that source.** An
  `import "./db.proschi"` in a git file reads `db.proschi` from the same
  repository and ref; in an https file, from the same origin. A path that
  climbs out of the repository or to another origin is an error.
- **Only one command uses the network**: `proschi imports sync`. Everything
  else reads remote files from the local cache it fills. See below.
- **The web editor never fetches.** In the browser, a remote import resolves
  only when the file came along in a share link, which
  [`proschi share-link`](EDITORS.md#imports) makes.

### Syncing remote imports

```sh
proschi imports sync              # every .proschi file below the current folder
proschi imports sync docs/org.proschi
proschi imports sync --frozen     # in CI: fail instead of changing proschi.lock
```

`proschi imports sync [--frozen] [<file|dir>…]` follows the imports of the
files, downloads every git and https file, and writes two things at the
project root:

- **`proschi.lock`**: for each git source, the commit its ref resolved to and
  a sha256 of each file read from it; for each https URL, a sha256. Commit
  this file.
- **`.proschi/cache/`**: the downloaded files, named by their sha256. Add
  `.proschi/` to `.gitignore`.

The first sync trusts what it downloads and pins it (trust on first use).
After that, a ref stays on its locked commit, even when the branch or tag
moves, and a file whose content no longer matches its sha256 is an error. To
take a newer version, change the ref, or delete that source's entry from
`proschi.lock`, and sync again.

`--frozen` never writes. It fails when `proschi.lock` is missing, when an
import is not in it, when a file does not match its pin, or when the lock
holds entries no file uses any more. Run it in CI, after the checkout.

Git sources are fetched with the `git` on your `PATH` and your own
credentials, so private repositories work over SSH keys, a credential helper
or a token, and your `url.<base>.insteadOf` settings apply (to fetch from a
mirror, or over SSH). By default `git:github.com/acme/platform//…` fetches
`https://github.com/acme/platform.git`. Credentials never go in the diagram
or in `proschi.lock`.

### Limits

| Limit | Value |
|---|---|
| Size of one imported file | 1 MB |
| Imported files per document, local and remote | 500 |
| Depth of the import chain | 32 files |
| Length of a git or https source | 1024 characters |

### Security model for imports

A diagram is data. Proschi never runs anything in an imported file. These
are the guarantees:

- **No network, except on request.** Only `proschi imports sync` downloads
  anything. `proschi check`, `render`, `test`, `analyze`, `share-link`, the
  language server, the VS Code preview and the Claude Code plugin read local
  files and the cache only. The browser never fetches imports.
- **Nothing outside the project.** Local imports and `from` files cannot
  leave the project root: no absolute paths, no `../` past the root, no
  symlinks to files outside it. `proschi share-link` reads through the same
  check, so a link never carries a file from outside the project.
- **Pinned content.** Every remote file is pinned in `proschi.lock` to a
  sha256, and every git file to a commit. A changed file, or an altered cache
  copy, is an error until you accept the change on purpose. Review changes to
  `proschi.lock` in pull requests like code.
- **HTTPS only.** `http://` imports are refused, and so are redirects to
  `http://` or to a URL with credentials. At most five redirects are
  followed.
- **Your credentials stay yours.** A URL with a user name or password is an
  error. Git uses your own configured credentials.
- **Git runs locked down.** The repository is fetched shallowly into a
  temporary bare repository that is deleted afterwards. Nothing is checked
  out. Hooks, submodules, the fsmonitor and the `ext::` transport are
  disabled, objects are checked as they arrive, and only regular files are
  read: a symlink or a submodule in the repository is an error. Arguments go
  to `git` directly, never through a shell.
- **Bounded work.** The limits above stop a huge or deeply nested import from
  hanging the editor.
- **A checked lockfile.** `proschi.lock` arrives in pull requests like any
  other file, so every value in it is checked before use. An invalid one is
  an error.

One known gap: the Claude Code plugin's file API has no way to resolve a
symlink, so the plugin cannot tell a symlink that points outside the project
from a plain file. It keeps paths inside the project root, but follows such a
symlink. `proschi check` reports it.

### Import errors

The message says what is wrong; this table says what to do.

| Message (shortened) | What to do |
|---|---|
| `'…' is outside the project root …` | Move the file into the project, or put a `proschi.json` in a folder that holds both files. |
| `'…' is a symlink to a file outside the project root …` | Copy the file into the project, or import it from git. |
| `'…' is an absolute path; imports must be relative to the importing file` | Write the path relative to the importing file. |
| `'…' uses http://; only https:// imports are allowed` | Use the https URL. |
| `'…' contains credentials; …` | Remove the user name and password from the URL; configure git or the server instead. |
| `'…' is not a git source; write git:<host>/<org>/<repo>//<path/in/repo>@<ref>` | Add the `//` before the path and the `@ref` at the end. |
| `'…' is a remote import and there is no proschi.lock; run proschi imports sync` | Run `proschi imports sync` and commit `proschi.lock`. |
| `'…' is not in proschi.lock; run proschi imports sync` | A new remote import: run `proschi imports sync`. |
| `'…' is not in the import cache (.proschi/cache); run proschi imports sync` | A fresh checkout: run `proschi imports sync` (or `--frozen` in CI). |
| `'…' does not match its sha256 in proschi.lock …; its content changed` | Find out why it changed. If the change is expected, delete its entry from `proschi.lock` and sync again. |
| `The cached copy of '…' does not match its hash in proschi.lock` | Run `proschi imports sync`; it downloads the file again. |
| `proschi.lock is out of date: …` | From `--frozen`: run `proschi imports sync` locally and commit `proschi.lock`. |
| `Invalid proschi.lock: …` | Delete `proschi.lock` and run `proschi imports sync`. |
| `git fetch failed: …` | Check that `git` can reach the repository with your credentials, and that the ref exists. |
| `Cannot download '…': HTTP 404` | Check the URL. |
| `'…' leaves the repository …` | A relative import in a remote file climbs out of its repository; fix it there. |
| `'…' is larger than 1 MB`, `More than 500 imported files`, `Imports nest more than 32 files deep` | Split the file, or import less. |

## Systems

A system is another team's design drawn as one box. Each team keeps its own
`.proschi` file with its own nodes, traffic and requirements. An org diagram
links those files with `system` blocks and connects the boxes. The simulation
then tells you, on the org diagram, when one team sends another more than its
design can take. [Org diagrams and team systems](SYSTEMS.md) walks through a
full example.

```proschi fragment
system orders "Order Processing" @Orders {
  from "teams/orders.proschi"
  expose api "Orders API" -> "Place order"
}

web -> orders.api : place order
```

The header is `system id ["Name"] [@team] [pos x,y] [color c] [.tag] [rank N] {`,
at the top level or inside a group. The parts after the id may come in any
order, as on a node. `system` is a keyword only in that shape, on a line that
ends with `{`, so a node may still be called `system`. Inside the block:

| Line | Meaning |
|---|---|
| `from "path"` | The team's design. It is found like an [import](#imports), so it can be a local path inside the project root, a `git:` source or an `https://` URL. |
| `expose id ["Name"] [-> "Use case"]` | An entry point that others connect to, and the team's use case it enters. You may leave the use case out when the team file has exactly one. |
| `capacity { … }` | A stub contract, for a system without a `from`: a rate, `p99` (or `latency`, a mean) and `availability`, written like a [capacity](#capacity) line without the node id. On one line or over several. |

### Names and scope

Outside the block, `orders.api` names the entry point `api` of the system
`orders`, and `orders` names the whole box. Write it without a space:
`orders .planned` with a space is still a [tag](#colors-and-legend), and so is
`b.planned` on a connection to a node that is not a system. `orders` alone may
be used in a connection, and in a step only when the system has exactly one
entry point.

The team file has its own scope. It is read as a document of its own: its
ids, title, summary, layout, traffic, requirements, capacity and tests stay
inside it. An `api` in the team file never clashes with an `api` in the org
diagram. Team files may have systems of their own. A file used by several
systems is read once.

### The contract

The collapsed box shows a contract, derived from the team file:

- **Promise**: the team's own `requirements` for the use case each entry
  point enters (a requirement for that use case, else one for every use
  case): its latency limits and availability.
- **Headroom**: how much more load on that use case the team's design takes,
  on top of its own traffic, before one of its nodes runs hot (over 70%) and
  before one saturates (100%), and which node that is.

You don't write the contract: change the team's design and it follows. The
`capacity { … }` stub is for a team that has no design file yet. Its rate is
where it saturates, and its `p99` and `availability` are the promise:

```proschi
title "Checkout"

shop "Shop" [REST API]

system payments "Payments" @Payments {
  expose charge "Charge"
  capacity { 5k rps p99 120ms availability 99.95% }
}

shop -> payments.charge : charge

usecase "Pay" {
  shop -> payments.charge : POST /charges
  payments --> shop : 201
}

traffic {
  "Pay" 800 rps
}
```

### In the simulation

When a step of your use case reaches `orders.api`, its rate (traffic, times
the scenario's share, times any fan-out) is added to the team's own traffic
for the use case `api` enters. The team's design is then simulated under the
combined load. Two systems that use the same team file share one design, so
what they are sent adds up. In your diagram the system behaves like one hop:
its latency and availability are those of the team's use case under that
load.

For each system the simulation reports, on the box and in the *Results* tab:

- **saturated**: a node of the team's design is past 100%, and which one;
- **runs hot**: a node is past 70%;
- **breaks its SLA**: one of the team's own requirements fails under the
  combined load.

Each system that is sent load also gets a result `system:<id>` next to your
requirements and tests, in the editor, in `proschi test` and in the language
server. It fails when the system saturates or breaks its SLA, and its hint
says to send less or to ask that team for more capacity. Running hot is a
warning only.

### Checks

These are errors:

- a connection or step from outside to a node of the team file that is not
  exposed, such as `web -> orders.db`: expose it, or connect to an entry
  point;
- an entry point the system does not expose, such as `orders.apii` (the
  message lists the ones it has);
- `x.y` where `x` is not a system and not a connection target with a tag;
- an `expose … -> "Use case"` that names no use case of the team file (the
  message suggests the closest);
- an `expose` without a use case when the team file has several;
- a step to `orders` alone when the system has several entry points;
- a cycle of `import` and `from` files.

These are warnings:

- a `from` and a `capacity` stub together (the file wins, the stub is
  ignored);
- neither a `from` nor a `capacity` stub (the box is drawn but not
  simulated);
- no `expose` line (nobody can connect to it).

Problems inside the team file are reported with its path, like problems in
an imported file.

### Viewing systems

- **Web editor.** Double-click a box, or press *Open*, to go into the team's
  design. Breadcrumbs above the canvas lead back. The team's design is
  read-only there: edit its own file. *Expand* unfolds the design in place,
  inside a frame, and *Collapse* folds it again. The *Results* tab has a
  *Systems* table: what each system is sent against what it takes, its
  promise, the p99 your diagram sees, and its status.
- **Command line.** `proschi render` draws each system as one box with its
  promise and its load. `--expand orders,feed` opens systems in place, and
  `--focus orders` draws one system's design alone. See
  [Rendering and export](EDITORS.md#rendering-and-export).
- **Claude Code.** In the plugin's pane, `s` selects the next system, `o`
  opens or closes it in place, `f` goes into it and `u` goes back out. See
  [Diagrams in the terminal](AGENT-SKILLS.md#diagrams-in-the-terminal).

## High-level design

The architecture says what talks to what. A high-level design adds the rest
of what a design review asks about: how much traffic comes in, how fast and
reliable the system must be, what each node can take, what data lives where,
why it is built this way, and checks that keep it that way. Add these blocks
when you want the simulation to test the design, not only draw it. How the
simulation turns them into numbers, and how far to trust those numbers, is on
[How the simulation works](https://proschi.app/docs/model/).

Each one is a block at the top level of the document. Here is a complete URL
shortener that uses all of them; open it in the editor to see its results:

```proschi
title "URL Shortener" "Short codes that redirect to long URLs"

user  "Visitor"       [Browser]
api   "Shortener API" [REST API]   x12
cache "Code cache"    [Redis]      x3
db    "URL store"     [PostgreSQL] x3

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Redirect" {
  user -> api : GET /{code}
  alt "Cache hit" {
    api -> cache : GET code
    api --> user : 301
  } alt "Cache miss" {
    api -> cache : GET code
    api -> db    : SELECT url
    api -> cache : SET code
    api --> user : 301
  }
}

usecase "Shorten" {
  user -> api  : POST /urls {"target": "https://example.com"}
  api  -> db   : INSERT url
  api --> user : 201 {"code": "k7Qz2"}
}

traffic {
  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%
  "Shorten"  1k rps
}

requirements {
  p99 "Redirect" < 100ms
  availability >= 99.9%
  durable "Shorten"
  survive any node failure
  cost <= 3000 usd/month
}

capacity {
  api 15k rps
  db  20k rps latency 4ms
}

entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}

decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1; p99 must stay under 100 ms"
  rejected "Read replicas only" "5 ms a read, many replicas at 100k rps"
}

test "Redirects are served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}
```

The *URL shortener HLD* example in the editor is a larger version of the
same design.

Some rules hold for every block:

- **The opening words are keywords only in that shape** (traffic followed by
  a brace, entity followed by a name, and so on), so older documents that use
  them as node ids still work.
- **A broken line is skipped, not the block.** A malformed line inside a
  block is an error on that line, and the rest of the block is still read. A
  block inside a group or a use case is an error, and its lines are skipped.
- **Imported files** contribute their blocks too.

### Quantities

Every number in these blocks is a quantity: a number, an optional magnitude
(k, m or b for thousand, million and billion) and a unit. You need them for
rates, latencies, percentages, costs and bandwidth.

| Kind | Units | Examples |
|---|---|---|
| Rate | rps, rpm, rpd (requests per second, minute, day) | `100k rps`, `6k rpm` |
| Duration | ms, s | `50ms`, `1.5s` |
| Share or availability | % | `99.9%` |
| Cost | usd/month, usd/GB (egress price) | `3000 usd/month` |
| Bandwidth | MB/s, GB/s | `500 MB/s` |

The unit may be attached or one space away (50ms or 50 ms). Rates become
requests per second (6k rpm is 100 rps), durations milliseconds, bandwidth
megabytes per second. A quantity without the unit a statement expects is an
error that says which unit it wants.

### Traffic

**What it is for:** the load. It says how many requests per second each use
case gets, and how they split over its scenarios. Without traffic the
simulation has nothing to measure, so add it before requirements or capacity.

```proschi fragment
traffic {
  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%
  "Shorten"  1k rps
}
```

- One line per use case: its name in quotes, then a rate.
- **mix** splits that traffic over the scenarios, by their full names (with
  "A › B" for nested ones). Without it, all the traffic goes to the first
  scenario.
- The shares should add up to 100%; otherwise they are scaled to fit, with a
  warning.
- An unknown use case or scenario name is a warning. Two lines for the same
  use case are an error.

### Requirements

**What it is for:** the targets the design must meet, such as a latency, an
availability, a budget or surviving a failure. Each requirement becomes a
check that passes or fails in the editor's *Results* tab and on the command
line, so you see at once when a change breaks one.

```proschi fragment
requirements {
  p99 "Redirect" < 50ms
  p99 "Redirect" scenario "Cache hit" < 10ms
  p95 < 300ms                 # every use case
  availability "Redirect" >= 99.95%
  availability >= 99.9%       # every use case
  durable "Shorten"
  survive any node failure
  survive failure of cache    # a node id, [Tech], or any <kind>
  cost <= 3000 usd/month
}
```

| Requirement | Holds when |
|---|---|
| Latency: `p99 "U" < 50ms` | That percentile of the use case's latency, over all its scenarios mixed by their shares, is under the limit. p50, p90, p95, p99 and p999 work; leave out the use case to check every use case that has traffic, or add `scenario "S"` to check one scenario. |
| Availability: `availability "U" >= 99.9%` | The computed availability of the use case (or of every use case) is at least that. |
| Durability: `durable "U"` | Every success scenario writes to a durable store, synchronously, before the first request is answered. |
| Failures: `survive any node failure` | Losing any single node instance keeps every use case working: nothing saturates and every latency target that held still holds. `survive failure of` a [selector](#selectors-and-kinds) checks only those nodes. |
| Budget: `cost <= 3000 usd/month` | Replicas plus egress cost at most that much. |

### Capacity

**What it is for:** your own numbers. Every node starts with the default
profile of its tech stack (on [How the simulation works](https://proschi.app/docs/model/#profiles)).
When you know better, from a benchmark, a vendor's limits or production,
put it here, one line per node id, the parts in any order. The numbers are
per replica.

```proschi fragment
capacity {
  db    20k rps latency 4ms availability 99.95% cost 400 usd/month
  cache 150k rps volatile
  users reads 30k rps writes 8k rps shards 4 consistency strong
  blobs bandwidth 500 MB/s egress 0.05 usd/GB
  pay   timeout 300ms
}
```

| Part | Meaning |
|---|---|
| a rate | Requests per second per replica, reads and writes alike |
| reads, writes | Separate read and write capacity per replica |
| shards | Number of shards. A store with a single primary scales writes with shards, not replicas. |
| size S, M or L | The instance size: the default capacity ×1, ×2 or ×4, for ×1, ×1.8 or ×3.5 the cost. An explicit rate or cost wins. |
| latency | Latency per call |
| availability | Availability per replica |
| cost | Monthly cost per replica |
| durable, volatile | Whether a write there survives a crash |
| consistency strong, consistency eventual | Which of the selectors any strong store and any eventual store match it |
| bandwidth | Network bandwidth per replica, for transfer time |
| egress | Price per GB the node sends to clients and third parties |
| timeout | What a failed call to the node costs; 1 s by default |

An unknown node id is a warning, and so are shards or consistency on a node
that is not a data store. A part given twice, a rate together with reads or
writes, and a second line for the same node are errors.

### Entities

**What it is for:** the data model. An entity names a kind of record, its
fields and the store that holds it, so a reader sees what lives where.
Entities are documentation: the simulation does not use them.

```proschi fragment
entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}
```

- The first line is the entity's name, then optionally **in** and the id of
  the node that stores it, and a description in quotes.
- Then one field per line: a name, a type and any of the flags key, index,
  unique and optional. Types are free words, such as string, int, time or
  uuid.
- Placing an entity in a node that is not a data store (a cache, database,
  search, analytics, queue, broker or storage node, see
  [kinds](#selectors-and-kinds)) is a warning.

### Decisions

**What it is for:** the reasons behind the design. A decision records what
was chosen, why, and which options were rejected and why, next to the
diagram they explain. Like entities, decisions are documentation.

```proschi fragment
decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1; p99 must stay under 50 ms"
  rejected "Read replicas only" "5 ms a read, many replicas at 100k rps"
  rejected "Memcached" "No replication; losing a node empties the cache"
}
decision "Base62 codes from a counter" because "Short and unique"
```

A decision has at most one **because** and any number of **rejected** lines,
each with the option and the reason. The one-line form takes only because.

### Tests

**What it is for:** rules about how requests flow, which pictures can't
enforce. Requirements check numbers; tests check structure, such as "the
redirect reads the cache before the database" or "clients never reach a
database directly". Every line in a test must hold, and they run with the
requirements.

```proschi fragment
test "Redirect is served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}
test "Clients only enter through the gateway" {
  no path from client to any database
}
test "Checkout answers before slow work" {
  "Checkout" never waits for any queue or any external
  "Checkout" calls ledger after gateway
  any service never calls blobs
  "Retry charge" starts at any queue
}
```

In the table, U is a use case and S a scenario, each a name in quotes, and X
and Y are [selectors](#selectors-and-kinds). After U you may add
`scenario "S"` to check one scenario only.

| Assertion | Holds when |
|---|---|
| `U calls X` | Some scenario of U has a step to X. |
| `U every scenario calls X` | Every scenario of U calls X. |
| `U never calls X` | No scenario of U calls X. |
| `U calls X before Y` | In every scenario that calls Y, X is called earlier, and some scenario calls Y. |
| `U calls Y after X` | In every scenario that calls both, the last call to Y comes after the first call to X, and some scenario calls both. |
| `U never waits for X` | No synchronous call to X happens before U's first request is answered. Async sends and later calls are fine. |
| `U writes X before responding` | Every success scenario has a synchronous, successful step to X before the answer. |
| `U responds 201` | Some scenario answers with that status, or a class such as 4xx. |
| `U has scenario S` | The scenario exists. |
| `U handles failure of X` | Some success scenario of U contains a failed call to X. |
| `U starts at X` | U's first request is sent by X. |
| `X calls Y` | Some step, in any use case, is sent by X to Y. Start with `in "U"` to look at one use case. |
| `X never calls Y` | No step is sent by X to Y. |
| `no path from X to Y` | No connection or step goes directly from X to Y. |
| `X has replicas >= 2` | Every node matching X has at least that many replicas. |

An assertion that starts with a use case is about steps that reach X; one
that starts with a selector is about the sender. Order is the order of the
sequence, requests and responses interleaved. Unknown use cases, scenarios
and nodes are warnings, a test without assertions is a warning, and two tests
with one name are an error.

### Selectors and kinds

**What it is for:** naming several nodes at once. Tests and the failure
requirement take a selector instead of a single node, so a rule such as
"never calls any database" keeps holding when you add a database.

| Selector | Matches |
|---|---|
| `db` | The node with that id |
| `[PostgreSQL]` | Every node with that tech stack |
| `any database` | Every node of that kind (see the table below) |
| `any strong store`, `any eventual store` | Every data store with that consistency. Relational databases and queues are strong; caches, most NoSQL stores, search, CDNs and object storage are eventual. A capacity line can change it. |
| `X or Y` | A node matching any of them, as in never calls any cache or any database |

A node's kind comes from its tech stack, or for an unknown tech, from its
name (see [Tech stacks](#tech-stacks)):

| Kind | Tech stacks (examples) |
|---|---|
| `client` | Actor, Browser, Mobile App, shapes and nodes without a tech |
| `edge` | WAF, AWS WAF, Global Accelerator; `any edge` also selects the four kinds below |
| `cdn` | CDN, CloudFront, Fastly, Akamai, Cloudflare, Azure CDN, Cloud CDN, Front Door |
| `loadbalancer` | Load Balancer, AWS Load Balancer (ALB, NLB, ELB), nginx, Envoy, HAProxy, Traefik, Ingress |
| `gateway` | API Gateway, AWS API Gateway, Azure API Management, Apigee, Kong |
| `dns` | DNS, Route53, Azure DNS, Cloud DNS |
| `service` | Service, Worker, REST API, gRPC, GraphQL, WebSocket, Spring Boot, Go, Node.js, Kubernetes, EC2, ECS, EKS, Fargate, VMs |
| `function` | Function, Lambda, Cloud Functions, Azure Functions, Cloud Run, App Engine, Cloudflare Workers |
| `cache` | Cache, Redis, Valkey, ElastiCache, Memcached, Memorystore, Hazelcast, Aerospike |
| `database` | Database, PostgreSQL, MySQL, Aurora, RDS, CockroachDB, Spanner, DynamoDB, Cassandra, ScyllaDB, MongoDB, Cosmos DB, Neo4j, … |
| `search` | Search Engine, Elasticsearch, OpenSearch, Solr, Algolia |
| `analytics` | Data Warehouse, BigQuery, Snowflake, Redshift, ClickHouse, InfluxDB, TimescaleDB |
| `queue` | Message Queue, SQS, Azure Queue Storage, Redis Queue, ZeroMQ; `any queue` also selects brokers |
| `broker` | Message Broker, Kafka, Redpanda, Pulsar, Kinesis, MSK, SNS, EventBridge, Pub/Sub, RabbitMQ, NATS, Service Bus, Event Hubs; simulated like a queue |
| `storage` | Object Storage, S3, Blob Storage, Cloud Storage, MinIO, R2, EFS, EBS |
| `external` | Third Party API, Payment Gateway, Stripe, Twilio, SendGrid, Auth0, Email/SMS Service |
| `other` | groups, text nodes and the Note shape |

## Editing on the canvas

The text is the source of truth. What you do on the diagram is written back
into it, and each edit changes only the part of the line it is about, so
comments and alignment survive:

| On the canvas | In the text |
|---|---|
| Drag a node or group | Its position is added or updated (`pos x,y`). Positions inside a group are relative to the group. |
| Double-click a node | Its display name changes. |
| Drag from one node's dot to another's | A connection is added. |
| **Add component**, then pick one | A declaration is added above the first use case, with a position if you dropped it on the canvas. |
| Select a node, then change its settings | Name, tech stack, replicas, owner and description change its declaration. Capacity, latency, availability, cost and shards change its line in the capacity block, which is added when there is none. |
| Select a connection, then change its label | The label changes. A label with a JSON or XML payload is edited in the text. |
| Select, then **Delete** | The node and its connections, or the connection, are removed. |
| **Auto-layout** | Every position is removed. |

A node that was only referenced, never declared, gets a declaration line
above the first use case.

Without positions, the layout flows top-down along the connections and
routes each one at right angles around the boxes. Declaration order breaks
ties: nodes declared earlier go further left, and in a cycle of connections
the node declared first goes higher. A node with `pos x,y` keeps its place,
and its connections take a simple right-angled path to it.

With traffic in the document, **Overlay: load** draws the simulation on the
canvas: each node is coloured by how busy it is, shows its replicas, shards
and utilisation, and requests flow along the connections (hollow dots for
async work, red ones falling off a node past 100%).

## Links

The address bar always holds the whole document, so copying it shares the
diagram. Imported files travel along in the link, so it renders the same for
someone who has none of them. While a use case is playing, the link also
names the use case, the scenario and the step, so a shared link opens
playback right there:

```text
https://proschi.app/app/#code=…&uc=create-order&alt=db-down&step=2
```

To open one of the bundled examples, add its name to the editor's address:
app/?example=url-shortener. The examples are hello, ecommerce, serverless,
login, events, url-shortener and styled.

## Grammar

A summary in EBNF. The language is line-oriented: each statement takes one
line, except a step or connection label whose JSON payload continues until its
brackets balance. Whitespace between tokens is ignored.

```ebnf
document     = { line } ;
line         = [ statement ] [ comment ] newline ;

statement    = title | import | node | connection
             | group-open | system | usecase-open | par-open | alt-open | close
             | traffic | requirements | capacity | entity | decision | test | legend
             | direction | layout ;

title        = "title" , ( string | id ) , [ string ] ;   (* 2nd string: summary *)
import       = "import" , string ;                      (* a relative path, git: or https:// source *)
node         = id , { string | tech | team | position | replicas | color | tag | "critical" | rank } ;  (* 1st string: name, 2nd: description *)
connection   = ref , arrow , ref , [ tag ] , [ ":" , label ] ;
ref          = id | id , "." , id ;                      (* orders.api: an entry point; one token, no spaces *)
group-open   = "group" , id , [ string ] , [ tech ] , { position | color | tag | rank } , "{" ;
system       = "system" , id , { string | team | position | color | tag | rank } , "{" ,
               { "from" , string
               | "expose" , id , [ string ] , [ "->" , ( string | id ) ]
               | "capacity" , "{" , { stub-part } , "}" } , "}" ;   (* one line each *)
stub-part    = quantity | ( "p99" | "latency" | "availability" ) , quantity ;
direction    = "direction" , ( "down" | "right" | "up" | "left" ) ;   (* alone on its line *)
layout       = "layout" , "ordered" ;                   (* alone on its line *)
rank         = "rank" , ( digit , { digit } | "first" | "last" ) ;
legend       = "legend" , "{" , { id , [ string ] , { color-value | color | "dashed" | "dotted" } } , "}" ;
color        = "color" , ( color-value | hex ) ;
color-value  = "gray" | "blue" | "teal" | "green" | "yellow" | "orange" | "red" | "purple" | "pink" ;
hex          = "#" , hex-digit , hex-digit , hex-digit , [ hex-digit , hex-digit , hex-digit ] ;  (* only after "color" *)
tag          = "." , id ;                                (* one token, e.g. .planned *)
usecase-open = "usecase" , ( string | id ) , [ string ] , "{" ;
par-open     = "par" , "{" ;
alt-open     = "alt" , ( string | id ) , [ "when" , string ] , "{" ;
close        = "}" , [ alt-open ] ;

traffic      = "traffic" , "{" , { string , quantity , [ "mix" , share , { "," , share } ] } , "}" ;
share        = string , quantity ;                       (* "Cache hit" 90% *)
requirements = "requirements" , "{" , { requirement } , "}" ;
requirement  = percentile , [ string , [ "scenario" , string ] ] , "<" , quantity
             | "availability" , [ string ] , ">=" , quantity
             | "durable" , string
             | "survive" , ( "any" , "node" , "failure" | "failure" , "of" , selector )
             | "cost" , "<=" , quantity ;
percentile   = "p50" | "p90" | "p95" | "p99" | "p999" ;
capacity     = "capacity" , "{" , { id , { capacity-part } } , "}" ;
capacity-part = quantity | "reads" , quantity | "writes" , quantity | "shards" , integer | "size" , ( "S" | "M" | "L" )
             | "latency" , quantity | "availability" , quantity | "cost" , quantity
             | "durable" | "volatile" | "consistency" , ( "strong" | "eventual" )
             | "bandwidth" , quantity | "egress" , quantity | "timeout" , quantity ;
entity       = "entity" , id , [ "in" , id ] , [ string ] , "{" , { id , id , { flag } } , "}" ;
flag         = "key" | "index" | "unique" | "optional" ;
decision     = "decision" , string , ( "because" , string
             | "{" , { "because" , string | "rejected" , string , string } , "}" ) ;
test         = "test" , string , "{" , { assertion } , "}" ;
assertion    = string , [ "scenario" , string ] , ( "calls" , selector , [ ( "before" | "after" ) , selector ]
             | "every" , "scenario" , "calls" , selector | "never" , "calls" , selector
             | "never" , "waits" , "for" , selector
             | "writes" , selector , "before" , "responding" | "responds" , status )
             | string , "has" , "scenario" , string
             | string , "handles" , "failure" , "of" , selector
             | string , "starts" , "at" , selector
             | [ "in" , string ] , selector , [ "never" ] , "calls" , selector
             | "no" , "path" , "from" , selector , "to" , selector
             | selector , "has" , "replicas" , ">=" , integer ;
selector     = selector-atom , { "or" , selector-atom } ;
selector-atom = id | tech | "any" , kind | "any" , ( "strong" | "eventual" ) , "store" ;
kind         = "client" | "edge" | "service" | "function" | "cache" | "database"
             | "search" | "analytics" | "queue" | "storage" | "external" | "other" ;
status       = digit , digit , digit | digit , "xx" ;     (* 201, 4xx *)

arrow        = "->" | "->>" | "-->" | "-x" ;
position     = "pos" , integer , "," , integer ;
replicas     = "x" , digit , { digit } ;               (* one token, e.g. x3 *)
quantity     = number , [ magnitude ] , [ unit ] ;     (* 50ms, 100k rps, 99.9% *)
number       = digit , { digit } , [ "." , digit , { digit } ] ;
magnitude    = "k" | "m" | "b" ;
unit         = "rps" | "rpm" | "rpd" | "ms" | "s" | "%" | "usd/month" | "MB/s" | "GB/s" | "usd/GB" ;
id           = ( letter | "_" ) , { letter | digit | "_" } ;
string       = '"' , { character - '"' | "\" , character } , '"' ;
tech         = "[" , { character - "]" } , "]" ;
team         = "@" , { letter | digit | "_" | "-" } ;
integer      = [ "-" ] , digit , { digit } ;
comment      = "#" , { character } ;            (* only where a token can start *)
label        = [ label-prefix , [ label-prefix ] ] , { character } ;  (* to end of line; see below *)
label-prefix = ( "x" , digit , { digit } | "~" , number , size-unit ) , whitespace ;  (* requests only *)
size-unit    = "B" | "KB" | "MB" | "GB" | "TB" ;
```

Where each statement may appear:

| Statement | Top level | In `group` | In `usecase` / `alt` | In `par` |
|---|---|---|---|---|
| `title` | ✓ | | | |
| `import` | ✓ | | | |
| node | ✓ | ✓ | | |
| `group` | ✓ | ✓ | | |
| `system` | ✓ | ✓ | | |
| `direction` | ✓ | ✓ | | |
| `layout ordered` | ✓ | | | |
| connection (`a -> b`) | ✓ | ✓ | as a step | as a step |
| `usecase` | ✓ | | | |
| `par` | | | ✓ | |
| `alt` | | | ✓ | |
| `traffic`, `requirements`, `capacity`, `entity`, `decision`, `test` | ✓ | | | |

`-x` is only valid as a step. A label is read as described in
[Use case steps](#use-case-steps): optional `x<N>` / `~<size>` prefixes on a request, an optional HTTP method and path, an optional
`json` / `xml` / `text` payload, and on a response a leading status code.

The grammar describes syntax only. The parser also checks meaning: duplicate
ids, unknown tech stacks (a warning), responses without a matching request, steps between
nodes the architecture does not connect, import cycles and missing imported
files, imports outside the project root, edges to a system's internal nodes,
unknown use cases, scenarios and nodes in the high-level design
sections, and so on.
Those checks are what the language server and `proschi check` report.
