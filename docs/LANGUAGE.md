# Proschi language reference

Proschi documents describe an architecture (nodes, groups, connections) and
use cases (step-by-step request flows) as plain text. The parser lives in
`frontend/src/dsl/` and never throws: problems come back as diagnostics with a
line and column, and everything else still renders.

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
  par {
    orders -> ordersDb : INSERT order
    orders ->> events  : OrderCreated {"orderId": "o-1"}
  }
  orders --> gateway : 201 {"status": "pending"}
}
```

## Statements

| Statement | Syntax | Notes |
|---|---|---|
| Title | `title "Text"` | |
| Node | `id ["Name"] [Tech] [@team] ["Description"] [pos x,y]` | Parts after the id may come in any order; the first string is the name, the second the description. |
| Group | `group id ["Name"] [Style] [pos x,y] { … }` | Holds nodes, nested groups and connections. Style is a grouping tech: `Logical Group` (default), `Network Boundary`, `Security Zone`, `Service Group`. |
| Connection | `a -> b [: label]` | Architecture edge. Undeclared ids become plain nodes automatically. |
| Use case | `usecase "Name" ["Description"] { steps }` | Top level only. |
| Parallel steps | `par { steps }` | Inside a use case; steps in one block run in parallel. |
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

How a step label is read:

- `POST /orders` sets the HTTP method and endpoint. Only the standard verbs count: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- After the method and path, `json …`, `xml …` or `text …` sets the payload format and body. A body that starts with `{`, `[` or `<` is recognised without a keyword.
- A JSON payload can span several lines. It continues until its brackets balance.
- Any other text becomes the step name, e.g. `INSERT order` or `OrderCreated {…}`.
- On a response, a leading three-digit number is the status code, e.g. `201 {"id": 1}`.

How the protocol is inferred:

| Condition | Protocol |
|---|---|
| `->>` arrow, or a queue target | `MESSAGING` |
| An HTTP method and a `GraphQL`, `gRPC` or `SOAP API` target | `GRAPHQL`, `GRPC` or `SOAP` |
| Any other HTTP method | `REST` |
| Anything else | `OTHER` |

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

The address bar always holds the whole document: `#code=…`. While a use case is playing, the link also names the use case and the step, e.g. `#code=…&uc=create-order&step=3`, so a shared link opens playback at that step.
