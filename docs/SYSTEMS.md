# Org diagrams and team systems

A design review rarely covers one team. Orders calls Warehouse, Warehouse
calls Payments, and each team owns its part. This guide builds an org
diagram for a small drone startup: one box per team, connected the way
requests flow between them. You raise the traffic, and the simulation tells
you which team's design cannot take it, without opening any box.

The language details are in [Systems](LANGUAGE.md#systems) and
[Imports](LANGUAGE.md#imports) in the language reference.

## 1. Declare the teams

The startup has five teams: Frontend, Orders, Warehouse, Feed and Payments.
Each is a `system` block. Start with stubs: a `capacity` line per team that
says how much it takes and what it promises. You can write that down before
any team has a design file.

```proschi
title "Drone startup" "Teams and what they promise each other"

shopper "Customer" [Browser]

system frontend "Frontend" @Frontend {
  expose web "Shop"
  capacity { 20k rps p99 300ms availability 99.95% }
}
system orders "Order Processing" @Orders {
  expose api "Orders API"
  capacity { 1.2k rps p99 150ms availability 99.9% }
}
system warehouse "Warehouse" @Warehouse {
  expose stock "Stock API"
  capacity { 3k rps p99 200ms availability 99.9% }
}
system feed "Feed" @Feed {
  expose events "Events"
  capacity { 10k rps p99 50ms availability 99.5% }
}
system payments "Payments" @Payments {
  expose charge "Charge"
  capacity { 5k rps p99 120ms availability 99.95% }
}

shopper  -> frontend.web
frontend -> orders.api
orders   -> warehouse.stock
orders   -> payments.charge
orders   -> feed.events
```

- `expose web "Shop"` is the team's entry point. Other parts of the diagram
  connect to `frontend.web`, never to what is inside the team.
- `@Frontend` names the owning team. The simulation uses it when it tells you
  whom to ask for more capacity.
- `capacity { … }` is a stub: the rate where the team saturates, and its
  promised p99 and availability.

## 2. Connect them with a use case

A use case says how one request travels through the teams. Add traffic, and
a requirement for the whole flow:

```proschi
title "Drone startup" "Teams and what they promise each other"

shopper "Customer" [Browser]

system frontend "Frontend" @Frontend {
  expose web "Shop"
  capacity { 20k rps p99 300ms availability 99.95% }
}
system orders "Order Processing" @Orders {
  expose api "Orders API"
  capacity { 1.2k rps p99 150ms availability 99.9% }
}
system warehouse "Warehouse" @Warehouse {
  expose stock "Stock API"
  capacity { 3k rps p99 200ms availability 99.9% }
}
system feed "Feed" @Feed {
  expose events "Events"
  capacity { 10k rps p99 50ms availability 99.5% }
}
system payments "Payments" @Payments {
  expose charge "Charge"
  capacity { 5k rps p99 120ms availability 99.95% }
}

shopper  -> frontend.web    : HTTPS
frontend -> orders.api      : place order
orders   -> warehouse.stock : reserve
orders   -> payments.charge : charge
orders   -> feed.events     : order placed

usecase "Buy drone" {
  shopper  -> frontend.web    : open shop
  frontend -> orders.api      : place order
  orders   -> warehouse.stock : reserve
  orders   -> payments.charge : charge
  orders  ->> feed.events     : order placed
  orders  --> frontend        : 201
  frontend --> shopper        : 200
}

traffic {
  "Buy drone" 100 rps
}

requirements {
  p99 "Buy drone" < 1s
}
```

Press Play to watch the request move from team to team. Then open it in the
editor: there each box shows its promise and its load, and at 100 rps every
team is well inside what it takes.

## 3. Raise the traffic

Marketing plans a launch at 2,000 purchases a second. Change one line:

```proschi
title "Drone startup" "Teams and what they promise each other"

shopper "Customer" [Browser]

system frontend "Frontend" @Frontend {
  expose web "Shop"
  capacity { 20k rps p99 300ms availability 99.95% }
}
system orders "Order Processing" @Orders {
  expose api "Orders API"
  capacity { 1.2k rps p99 150ms availability 99.9% }
}
system warehouse "Warehouse" @Warehouse {
  expose stock "Stock API"
  capacity { 3k rps p99 200ms availability 99.9% }
}
system feed "Feed" @Feed {
  expose events "Events"
  capacity { 10k rps p99 50ms availability 99.5% }
}
system payments "Payments" @Payments {
  expose charge "Charge"
  capacity { 5k rps p99 120ms availability 99.95% }
}

shopper  -> frontend.web    : HTTPS
frontend -> orders.api      : place order
orders   -> warehouse.stock : reserve
orders   -> payments.charge : charge
orders   -> feed.events     : order placed

usecase "Buy drone" {
  shopper  -> frontend.web    : open shop
  frontend -> orders.api      : place order
  orders   -> warehouse.stock : reserve
  orders   -> payments.charge : charge
  orders  ->> feed.events     : order placed
  orders  --> frontend        : 201
  frontend --> shopper        : 200
}

traffic {
  "Buy drone" 2k rps
}

requirements {
  p99 "Buy drone" < 1s
}
```

Open it in the editor. Order Processing is now flagged as saturated: it is
sent 2k rps and takes 1.2k. The other teams still hold. In the *Results*
tab:

- the *Systems* table lists each team with what it is sent against what it
  takes, its promise, the p99 your diagram sees and its status;
- the check `system:orders` fails, and its hint says to send it less or to
  ask the Orders team for more capacity.

A team that passes 70% is shown as running hot. That is a warning, not a
failed check.

## 4. Link the teams' real designs

A stub is a promise someone wrote down. A team's own design is better: the
contract then follows from it. The Orders team keeps its design in its own
file, with its own traffic and requirements:

```proschi
title "Order Processing" "Takes and tracks orders"
direction right

caller  "Callers"           [Actor]
gateway "Orders API"        [AWS API Gateway] x2
api     "Order Service"     [REST API]        x3
db      "Orders DB"         [PostgreSQL]      x2
events  "Order Events"      [Kafka]           x3
worker  "Fulfilment Worker" [Microservice]    x2

caller  -> gateway
gateway -> api
api     -> db
api     -> events
events  -> worker

usecase "Place order" {
  caller  -> gateway : POST /orders
  gateway -> api     : place order
  api     -> db      : INSERT order
  api    ->> events  : order placed
  api    --> gateway : 201
}

traffic {
  "Place order" 300 rps
}

capacity {
  db 1.5k rps
}

requirements {
  p99 "Place order" < 150ms
  availability "Place order" >= 99.9%
}
```

`caller` is the team's stand-in for whoever calls it. In the org diagram,
replace the stub with `from`, and map the entry point to the use case it
enters:

```proschi fragment
system orders "Order Processing" @Orders {
  from "teams/orders.proschi"
  expose api "Orders API" -> "Place order"
}
```

Now the box shows a derived contract:

- **Promise**: the Orders team's own requirements on "Place order": p99 under
  150 ms and 99.9% availability.
- **Headroom**: how much more the design takes on "Place order", on top of
  its own 300 rps, before a node runs hot and before one saturates. Here the
  Orders DB is the limit.

What your diagram sends to `orders.api` is added to the team's own 300 rps,
and the Orders design is simulated under the sum. If the DB saturates, or
the team's p99 goes over 150 ms, Order Processing is flagged on the org
diagram, with the node that gave out. The ids in the team file stay in its
own scope: the `api` and `db` in `orders.proschi` never clash with ids in
the org diagram, and `frontend -> orders.db` is an error, because `db` is
not an entry point.

Keep Payments as a stub until that team has a design. A system with both a
`from` and a stub gets a warning, and the file wins.

## 5. Open, expand and focus

A linked team can be explored without leaving the org diagram.

- **In the web editor**, double-click Order Processing (or press *Open*) to go
  into its design. Its own use cases play there. The breadcrumbs above the
  canvas lead back. The design is read-only in this view; edit the team's
  file to change it. *Expand* unfolds the design inside the box, with the
  edges rerouted to where "Place order" starts, and *Collapse* folds it
  again.
- **On the command line**, `proschi render` draws each team as one box with
  its promise and load:

  ```sh
  proschi render org.proschi --out docs/diagrams
  proschi render org.proschi --expand orders --out docs/diagrams
  proschi render org.proschi --focus orders --out docs/diagrams
  ```

  `--expand` takes a comma-separated list (`--expand orders,feed`), and a
  nested id such as `orders.billing` opens its parents too. `--focus` draws
  one team's design alone. An id that names no linked system exits with 2.
- **In Claude Code**, `/proschi view --expand orders org.proschi` opens the
  pane with Orders expanded. In the pane, `s` selects the next system, `o`
  opens or closes it, `f` goes into it and `u` goes back out.

To open the whole org in the browser, with every team file inside the link:

```sh
proschi share-link org.proschi
```

## 6. Use a design from another repository

Teams often keep their designs in their own repositories. A `from` (or an
`import`) can name a file in a git repository at a tag, branch or commit:

```proschi fragment
system warehouse "Warehouse" @Warehouse {
  from "git:github.com/drone-startup/warehouse//design/warehouse.proschi@v2.3.0"
  expose stock "Stock API" -> "Reserve stock"
}
```

The form is `git:<host>/<org>/<repo>//<path in the repo>@<ref>`. An
`https://` URL works too. Fetch it once with:

```sh
proschi imports sync
```

`sync` is the only command that uses the network. It fetches with your own
`git` and credentials, so a private repository works when you can clone it.
It writes `proschi.lock`, which pins the commit and a sha256 of each file, and
puts the files in `.proschi/cache/`. Commit the lock and ignore the cache:

```sh
echo ".proschi/" >> .gitignore
git add proschi.lock .gitignore
```

From then on `proschi check`, `render`, the language server, the VS Code
preview and the Claude Code plugin read the cached copy, and never the
network. Before a sync, they report that the import needs
`proschi imports sync`. When the Warehouse team ships `v2.4.0`, change
the ref and sync again. If a pinned file changes under the same ref, sync
stops with an error until you delete its entry from `proschi.lock`.

In CI, after the checkout, fill the cache without changing the lock:

```sh
proschi imports sync --frozen
proschi test .
```

`--frozen` fails when the lock is missing, out of date or does not match what
the source serves. The rules, the limits and the security guarantees are in
[Imports](LANGUAGE.md#security-model-for-imports).

## 7. Keep local files inside the project

Local `from` and `import` paths must stay inside the project root: the
folder of the nearest `proschi.json`, else the git repository, else the
entry file's folder. In a monorepo, `../` works as long as it stays inside
the repository:

```text
platform/
  proschi.json
  org.proschi              from "teams/orders.proschi"
  teams/
    orders.proschi
    warehouse.proschi      import "../shared/infra.proschi"
  shared/
    infra.proschi
```

A path that climbs above the root, an absolute path, or a symlink to a file
outside the root is an error. Outside a git repository, add a `proschi.json`
(`{}` is enough) to the folder that holds all the files.
