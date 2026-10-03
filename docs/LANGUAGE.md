# Proschi language reference

Proschi documents describe an architecture (nodes, groups, connections) and
use cases (step-by-step request flows) as plain text. The parser lives in
`frontend/src/dsl/` and never throws: problems come back as diagnostics with a
line and column, and everything else still renders.

The parser is the definition of the language. The same code powers the web
editor, the `proschi` command line and the language server, so every editor
reports the same problems. See [Editor support](EDITORS.md) for VS Code,
IntelliJ, Neovim, Helix, Sublime Text and CI, and the [grammar](#grammar) below
for a summary of the syntax.

```
title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway "API Gateway"   [AWS API Gateway] @Platform
  orders  "Order Service" [REST API]        @Orders "Handles order processing"
}
ordersDb "Orders DB"   [PostgreSQL]
events   "OrderEvents" [Kafka]

gateway -> orders   : HTTP
orders  -> ordersDb : SQL

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
and each use case can branch into scenarios (success and error paths) with
`alt`.

## Statements

| Statement | Syntax | Notes |
|---|---|---|
| Title | `title "Text"` | |
| Node | `id ["Name"] [Tech] [@team] ["Description"] [pos x,y]` | Parts after the id may come in any order; the first string is the name, the second the description. |
| Group | `group id ["Name"] [Style] [pos x,y] { … }` | Holds nodes, nested groups and connections. Style is a grouping tech: `Logical Group` (default), `Network Boundary`, `Security Zone`, `Service Group`. |
| Connection | `a -> b [: label]` | Architecture edge. Undeclared ids become plain nodes automatically. |
| Use case | `usecase "Name" ["Description"] { steps }` | Top level only. |
| Parallel steps | `par { steps }` | Inside a use case or an `alt` block; steps in one block run in parallel. Cannot be nested. |
| Scenario | `alt "Name" { steps }` | Inside a use case or another `alt`. See [Scenarios](#scenarios). |
| Comment | `# …` | Anywhere a token can start. A `#` inside quotes or a JSON payload is kept. |

- **Ids** are letters, digits and `_`, starting with a letter or `_`.
- **Tech** is any entry of the component palette, e.g. `[AWS Lambda]` or `[Redis]`. Matching ignores case. An unknown tech gives a warning and draws a rectangle.
- **Annotation tech stacks** (`Text Note`, `Sticky Note`, `Comment`) make text nodes. The description, or else the name, becomes the text.

## Use case steps

| Arrow | Meaning |
|---|---|
| `a -> b : …` | Synchronous request |
| `a ->> b : …` | Asynchronous, fire and forget. It becomes async request/response if a reply follows. |
| `b --> a : …` | Response to the latest unanswered request from `a` to `b` |
| `a -x b : …` | Failed call: the request never gets an answer (timeout, connection refused). It cannot be answered with `-->`. |

How a step label is read:

- `POST /orders` sets the HTTP method and endpoint. Only the standard verbs count: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- After the method and path, `json …`, `xml …` or `text …` sets the payload format and body. A body that starts with `{`, `[` or `<` is recognised without a keyword.
- A JSON payload can span several lines. It continues until its brackets balance.
- Any other text becomes the step name, e.g. `INSERT order` or `OrderCreated {…}`.
- On a response, a leading three-digit number is the status code, e.g. `201 {"id": 1}`.

`proschi check` can compare these steps with the OpenAPI specs of the services
they call: endpoints, status codes and JSON payloads. See
[Checking against OpenAPI](EDITORS.md#checking-against-openapi).

How the protocol is inferred:

| Condition | Protocol |
|---|---|
| `->>` arrow, or a queue target | `MESSAGING` |
| An HTTP method and a `GraphQL`, `gRPC` or `SOAP API` target | `GRAPHQL`, `GRPC` or `SOAP` |
| Any other HTTP method | `REST` |
| Anything else | `OTHER` |

## Scenarios

One endpoint rarely has one outcome. `alt` blocks split a use case into
scenarios without copying the steps they share:

```
usecase "Get order" {
  gateway -> orders : GET /api/orders/42      # shared by every scenario

  alt "Found" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway : 200 {"id": 42}
  } alt "Not found" {
    orders -> ordersDb  : SELECT order 42
    orders --> gateway : 404 {"error": "not_found"}
  } alt "DB timeout" {
    orders -x ordersDb  : SELECT order 42
    orders --> gateway : 504
  }

  gateway ->> audit : OrderViewed               # shared again, after every branch
}
```

- `alt` blocks that follow each other directly are one set of alternatives.
  Close one and open the next on the same line (`} alt "B" {`) or on the next
  line; a step between two blocks starts a new set.
- Each branch becomes a scenario. Steps before a set are shared by all its
  branches, and steps after it are added to every branch.
- `alt` blocks can be nested. Nested sets, and several sets one after another,
  multiply: two sets of two branches give four scenarios, named like
  `A › X`. A use case keeps at most 32 scenarios; the parser warns past that.
- A response inside a branch can answer a request made before the branch.
- A scenario is an **error path** when the use case's first request is answered
  with a 4xx or 5xx status, or fails with `-x`. Playback draws error replies and
  failed calls in red.
- A use case without `alt` has a single scenario.

Scenario ids are the slugged branch names (`not-found`, `a-x`), used in links.

### Grouping by endpoint

The use case picker in the editor groups use cases by the HTTP method and path
of their first step, e.g. all `POST /api/orders` flows together. Use cases
that don't start with an HTTP call are listed under *Other flows*.

## Editing on the canvas

The text is the source of truth. Edits on the diagram are written back into it:

| Canvas action | Text change |
|---|---|
| Drag a node or group | Adds or updates `pos x,y` on its declaration. Positions of group members are relative to the group. |
| Double-click a node | Sets its display name: `id "New name"`. |
| Drag from one node's dot to another's | Adds a connection, `a -> b`. |
| **Auto-layout** button | Removes every `pos x,y`. |

A node that was only referenced, never declared, gets a declaration line above the first use case.

## Links

The address bar always holds the whole document: `#code=…`. While a use case is playing, the link also names the use case, the scenario (for use cases with `alt` blocks) and the step, e.g. `#code=…&uc=create-order&alt=db-down&step=2`, so a shared link opens playback at that step of that scenario.

## Grammar

A summary in EBNF. The language is line-oriented: each statement takes one
line, except a step or connection label whose JSON payload continues until its
brackets balance. Whitespace between tokens is ignored.

```ebnf
document     = { line } ;
line         = [ statement ] [ comment ] newline ;

statement    = title | node | connection
             | group-open | usecase-open | par-open | alt-open | close ;

title        = "title" , ( string | id ) ;
node         = id , { string | tech | team | position } ;  (* 1st string: name, 2nd: description *)
connection   = id , arrow , id , [ ":" , label ] ;
group-open   = "group" , id , [ string ] , [ tech ] , [ position ] , "{" ;
usecase-open = "usecase" , ( string | id ) , [ string ] , "{" ;
par-open     = "par" , "{" ;
alt-open     = "alt" , ( string | id ) , "{" ;
close        = "}" , [ "alt" , ( string | id ) , "{" ] ;

arrow        = "->" | "->>" | "-->" | "-x" ;
position     = "pos" , integer , "," , integer ;
id           = ( letter | "_" ) , { letter | digit | "_" } ;
string       = '"' , { character - '"' | "\" , character } , '"' ;
tech         = "[" , { character - "]" } , "]" ;
team         = "@" , { letter | digit | "_" | "-" } ;
integer      = [ "-" ] , digit , { digit } ;
comment      = "#" , { character } ;            (* only where a token can start *)
label        = { character } ;                  (* to end of line; see below *)
```

Where each statement may appear:

| Statement | Top level | In `group` | In `usecase` / `alt` | In `par` |
|---|---|---|---|---|
| `title` | ✓ | | | |
| node | ✓ | ✓ | | |
| `group` | ✓ | ✓ | | |
| connection (`a -> b`) | ✓ | ✓ | as a step | as a step |
| `usecase` | ✓ | | | |
| `par` | | | ✓ | |
| `alt` | | | ✓ | |

`-x` is only valid as a step. A label is read as described in
[Use case steps](#use-case-steps): an optional HTTP method and path, an optional
`json` / `xml` / `text` payload, and on a response a leading status code.

The grammar describes syntax only. The parser also checks meaning: duplicate
ids, unknown tech stacks, responses without a matching request, and so on.
Those checks are what the language server and `proschi check` report.
