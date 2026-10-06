# Your first diagram in 2 minutes

Type a few lines, get a laid-out architecture diagram, then press Play and
watch a request travel through it. No account, no install: every example
below is live, and *Open in editor* takes it to the [editor](https://proschi.app/app/)
with the code in the link.

## 1. Two boxes and an arrow

A node is an id, a name in quotes and a tech stack in brackets. An arrow
connects two nodes.

```proschi
api "Shop API"  [REST API]
db  "Orders DB" [PostgreSQL]

api -> db : SQL
```

That is a diagram already. The tech stack picks the icon, and later the
numbers the simulation uses: `[PostgreSQL]` is a database, `[Redis]` a cache,
`[Kafka]` a queue. About 210 of them are known, with the names people
usually write (`[Postgres]`, `[S3]`, `[k8s]`).

## 2. A request that flows

A **use case** is a request flow, step by step: `->` is a request, `-->` its
response. Press **Play**.

```proschi
user "Shopper"   [Browser]
api  "Shop API"  [REST API]
db   "Orders DB" [PostgreSQL]

user -> api : HTTPS
api  -> db  : SQL

usecase "Place order" {
  user -> api  : POST /orders {"sku": "A1"}
  api  -> db   : INSERT order
  api --> user : 201 {"id": 42}
}
```

## 3. Break it on purpose

Real systems fail. `alt` splits a use case into **scenarios** that share
their first steps, and `-x` is a call that never gets an answer. Pick
*Place order › DB down* and play it: the request dies at the database, in red.

```proschi
user "Shopper"   [Browser]
api  "Shop API"  [REST API]
db   "Orders DB" [PostgreSQL]

user -> api : HTTPS
api  -> db  : SQL

usecase "Place order" {
  user -> api : POST /orders {"sku": "A1"}
  alt "Created" {
    api  -> db   : INSERT order
    api --> user : 201 {"id": 42}
  } alt "DB down" {
    api  -x db   : INSERT order
    api --> user : 503
  }
}
```

## 4. Ask whether it holds up

Say how much traffic comes in and what the design must do. The editor's
**Results** tab checks it as you type, with a deterministic model of load,
latency, availability and cost.

```proschi
user "Shopper"   [Browser]
api  "Shop API"  [REST API]   x2
db   "Orders DB" [PostgreSQL] x2

user -> api : HTTPS
api  -> db  : SQL

usecase "Place order" {
  user -> api  : POST /orders {"sku": "A1"}
  api  -> db   : INSERT order
  api --> user : 201 {"id": 42}
}

traffic {
  "Place order" 500 rps
}

requirements {
  p99 "Place order" < 100ms
  survive any node failure
}
```

Open it in the editor and change `x2` to `x1` on the database: *survive any
node failure* turns red, because one database is a single point of failure.
[How the simulation works](https://proschi.app/docs/model/) explains every
number.

## Where next

- **Learn the language**: groups, async calls, `par`, payloads, imports and
  the high-level design blocks are in the [language reference](LANGUAGE.md).
- **Practise**: [system design problems](https://proschi.app/practice/) whose
  tests tell you in the browser whether your design holds up.
- **Use your own editor**: VS Code, IntelliJ, Neovim and CI support is in
  [Editor support](EDITORS.md).
