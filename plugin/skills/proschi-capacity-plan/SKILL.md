---
name: proschi-capacity-plan
description: Size a Proschi design for its load - add `traffic`, `requirements` (p99 latency, availability, durability, failure survival, cost) and replicas, shards and capacity overrides from stated SLOs or expected load, then run `proschi analyze` and `proschi test`, explain the bottlenecks and fix them until the requirements pass. Use when the user asks whether a .proschi design scales, how many replicas or shards it needs, what it costs, what its p99 or availability is, or wants to turn traffic numbers, SLOs or a back-of-the-envelope estimate into a checked capacity plan.
license: MIT
---

# Capacity plan for a Proschi design

Goal: the `.proschi` file carries the load it must handle and the targets it
must meet, its replicas/shards/capacity are sized so `npx proschi@latest test`
passes with headroom, and the user gets a short explanation of what limits
the design, what it costs, and a share link.

Syntax: [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md)
(the `traffic`, `requirements`, `capacity` blocks and the simulation defaults).

Needs a design with use cases. If it has none, write them first (the
`code-to-usecases` skill): traffic is per use case and scenario.

## 1. Get the numbers

Ask for, or find in docs, tickets, dashboards and SLO files:

- **Load per use case** at peak: requests/s, or users × actions per day.
  Convert: 1 day ≈ 100k s (86,400), so 10M requests/day ≈ 115 rps average;
  peak ≈ 2–3× average unless stated.
- **The mix of scenarios** (cache hit rate, error rate, share of each branch).
- **Targets**: p99 (or p95) latency per use case, availability, what must be
  durable, which failures it must survive, a monthly budget.

When a number is missing, assume a round one, say so in a comment
(`# ASSUMPTION: 3x peak over 40 rps average`) and list it in your answer.
Reference figures (throughput per node, latency, cloud costs):
<https://proschi.app/docs/numbers/>. Rules of thumb: a service node does
1k–10k rps; Redis ~100k ops/s; a Postgres primary 10k–50k simple reads and
1k–10k writes/s; one Kafka partition ~10 MB/s; keep nodes 50–70% busy.

## 2. Write traffic and requirements

```proschi fragment
traffic {
  "Get product" 3k rps mix "Cache hit" 90%, "Cache miss" 9%, "Not found" 1%
  "Place order" 50 rps mix "Paid" 95%, "Invalid" 3%, "Payment failed" 2%
}

requirements {
  p99 "Get product" < 100ms
  p99 "Place order" < 1s
  availability "Get product" >= 99.9%
  durable "Place order"
  survive any node failure
  cost <= 3000 usd/month
}
```

- Scenario names in `mix` are the `alt` names (`A › B` when nested); shares add to 100%.
- Only state requirements the user has (or agrees to). Don't loosen a target
  to make a test pass; change the design or report that it can't be met.

## 3. Run, read, fix: loop

```sh
npx proschi@latest test design.proschi
npx proschi@latest analyze design.proschi
```

`analyze` prints per node: reads and writes as load/capacity and
utilisation, latency, availability, cost; then p50–p99.9 per use case and
scenario, single points of failure and warnings. `test` prints each failure
with a hint naming the lever. Apply the smallest change that fixes it, rerun,
repeat:

| Symptom | Lever |
|---|---|
| `X is saturated` / utilisation > 70% on a service | more replicas on its declaration: `api "API" [Go] x4` |
| Relational DB writes saturated | `capacity { db shards 4 }` (replicas only add reads) |
| DB reads hot, high p99 on reads | a cache in front (add a cache hit/miss `alt` and mix), or read replicas `x3` |
| p99 dominated by a slow external or long chain | move work after the response with `->>` (queue + worker), `par { }` for independent calls, a timeout `capacity { pay timeout 300ms }` |
| Availability below target | `x2`+ on the weakest node named in the hint, or a fallback scenario that calls it with `-x` and still succeeds |
| `survive any node failure` fails | `x2` on single-instance nodes; enough replicas that losing one stays under 100% |
| Cost over budget | fewer replicas where utilisation is low, `size S`, cheaper techs; check egress (`~size` steps to clients from storage → a CDN) |
| A hint says the default numbers are wrong for this tech | `capacity { node 5k rps latency 3ms cost 250 usd/month }` from real benchmarks or prices, with a comment citing where they came from |

Prefer topology changes (replicas, cache, async) over `capacity` overrides;
override only with a source for the number. Keep `fmt` and `check` clean.

## 4. Report and hand over

```sh
npx proschi@latest fmt design.proschi
npx proschi@latest check design.proschi
npx proschi@latest test design.proschi
npx proschi@latest share-link design.proschi
```

Tell the user, briefly: the assumptions; the bottleneck you found and the
change that fixed it, with before/after numbers from `analyze` (utilisation,
p99, availability, cost); what still fails and why; and the link (open the
*Results* tab, or turn on *Overlay: load*, to see the load on the diagram).
Remind them the simulation is analytical and right to an order of magnitude,
not a benchmark: <https://proschi.app/docs/model/>.

## Worked example

Before: one replica of everything, 3k rps on `Get product`. `test` reports:

```text
✗ p99 of Get product < 100 ms: api is saturated (3k rps of 2k rps, 153%)
    → Add replicas to api (Node.js): x3 keeps it under 70%, ...
✗ survive any node failure: Losing nginx (nginx) breaks "Get product" (and 8 more)
```

Change: `api … x4` (3 to stay under 70%, one more to survive losing one),
`x2` on nginx, worker, db, cache and rabbit. After: p99 of Get product
≈ 41 ms, survival passes, cost $2,200/month. One failure remains:
`availability >= 99.9%` for "Place order" (99.89%), because Stripe's 99.9%
sits on its synchronous path; the honest answers are a lower target for that use case or
taking the charge off the request path, which is a product decision to
raise with the user, not to hide.

```proschi
title "Catalogue"

user  "Customer" [Browser]
api   "Shop API" [Node.js]    x4
cache "Cache"    [Redis]      x2
db    "Shop DB"  [PostgreSQL] x2

user -> api
api  -> cache
api  -> db

usecase "Get product" {
  user -> api   : GET /products/{id}
  api  -> cache : LOOKUP product:{id}
  alt "Cache hit" {
    api --> user : 200 {"id": "p-1"}
  } alt "Cache miss" {
    api  -> db    : SELECT product
    api  -> cache : SET product:{id}
    api --> user  : 200 {"id": "p-1"}
  }
}

traffic {
  "Get product" 3k rps mix "Cache hit" 90%, "Cache miss" 10%
}

requirements {
  p99 "Get product" < 100ms
  availability >= 99.9%
  survive any node failure
  cost <= 3000 usd/month
}
```
