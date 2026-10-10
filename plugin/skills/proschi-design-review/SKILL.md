---
name: proschi-design-review
description: Review an existing Proschi (.proschi) system design like a senior engineer in a design review - run `proschi check`, `test` and `analyze`, then find single points of failure, saturated or oversized nodes, missing failure scenarios, synchronous calls that should be async, data and consistency risks, cost waste and gaps between the diagram and its requirements, and propose concrete edits (and apply them when asked). Use when the user asks to review, critique, sanity-check or improve a .proschi design, asks "will this hold up?", or wants feedback on a system design interview answer written in Proschi.
license: MIT
---

# Review a Proschi design

Goal: a short, prioritised review backed by the simulation's numbers, where
every finding comes with the exact edit that fixes it; edits applied only
when the user wants them; the result validated and shared.

Syntax and the simulation's defaults:
[references/proschi-cheatsheet.md](references/proschi-cheatsheet.md).

## 1. Gather the facts

```sh
npx proschi@latest check --strict design.proschi
npx proschi@latest test design.proschi
npx proschi@latest analyze design.proschi        # needs a traffic block
```

Read the whole file (and the files it imports). Note what the design claims
in `requirements`, `test`, `decision` blocks and descriptions.

## 2. Walk the checklist

Look for each of these; skip what does not apply.

**Correctness of the model**
- Errors and warnings from `check` (unknown techs, steps with no connection,
  responses without requests). Unconnected or unused nodes.
- Use cases that never answer the entry request, or answer without a status.

**Failure handling**
- Use cases with no error scenario at all (only a happy path). Every call to a
  database, queue or external API can fail: is there an `alt` with `-x` and
  what the user gets (`503`, a fallback, a retry later)?
- `Single points of failure` in `analyze`: a node with one replica on a
  synchronous path. Is there a `survive any node failure` requirement? Should there be?
- Fallbacks that claim success after a failed write (data loss).

**Load and latency** (only with `traffic`)
- Utilisation over 70% (hot) or 100% (saturated); write-saturated relational
  stores need `shards`, not replicas.
- Long synchronous chains or slow externals (200 ms) before the response:
  candidates for `->>` + a worker, `par`, a cache, a timeout.
- Fan-out (`x<N>`) and big payloads (`~size`) that dominate load or egress.
- Cache scenarios without a realistic `mix` (a 100% hit rate hides the miss path).

**Data**
- Writes that must survive a crash: `durable "U"` / `writes X before responding`.
- Money or inventory written to an eventual store (`any eventual store`):
  `test "…" { "Pay" never calls any eventual store }`.
- `entity` blocks placed `in` a node that is not a store; stores with no entity.

**Cost**
- Nodes at a few % utilisation with many replicas; `size L` where `S` would do.
- Egress from object storage straight to clients (a CDN in front costs less).
- Total against `cost <=`; if there is no budget, state the monthly total.

**Security and boundaries**
- Clients that reach a database or internal service directly:
  `test "…" { no path from any client to any database }`.
- Missing gateway, auth or rate limiting where the prose says there is one.

**Requirements honesty**
- Targets with no use case behind them, use cases with traffic but no
  latency target, `capacity` overrides with no source for the number.

## 3. Write the review

Order by impact: what breaks under the stated load or a single failure,
then data risks, then latency, then cost and tidiness. For each finding:

```text
[High] api is a single point of failure on every use case (1 replica, 99.5%).
Evidence: analyze → "Single points of failure: api"; availability 99.39% vs 99.9%.
Fix: `api "Shop API" [Node.js] x3` and add `survive any node failure` to requirements.
```

Keep it to the findings that matter (usually 3–8). Say what is good, too,
in one line. Don't invent numbers: quote `analyze` and `test`.

## 4. Apply (when asked) and validate

Make the edits, then:

```sh
npx proschi@latest fmt design.proschi
npx proschi@latest check design.proschi
npx proschi@latest test design.proschi
npx proschi@latest analyze design.proschi
```

Iterate until `check` is clean and the tests that should pass do. Add a
`test` or requirement for each fixed risk so it cannot come back, and a
`decision "…" { because "…" rejected "…" "…" }` for each trade-off the
user chose. Report before/after numbers.

## 5. Hand over

```sh
npx proschi@latest share-link design.proschi
```

Give the user the review, the link (the *Results* tab shows the same checks
and a load overlay), and, if useful, the HLD document:
`npx proschi@latest render --format hld-md --out docs design.proschi`.

## Worked example

Input (abridged): one `api` replica, `Place order` with only a happy path
that calls Stripe and SendGrid synchronously, 50 rps.

Findings:

1. **[High] No failure scenarios.** `Place order` has one scenario; a Stripe
   decline or a database outage is undefined. Fix: add
   `} alt "Payment failed" { … api --> user : 402 … }` and
   `} alt "DB down" { api -x db : INSERT order … api --> user : 503 }`.
2. **[High] SPOF.** `api` x1 on every path (analyze: availability 99.39%).
   Fix: `x2`+ and `survive any node failure`.
3. **[Medium] Email on the request path** adds ~210 ms at p50 and
   SendGrid's 99.9% to checkout. Fix: `api ->> rabbit : OrderPlaced`, a
   worker that sends it, and `test "…" { "Place order" never waits for sendgrid }`.

After the edits, the design under review looks like:

```proschi
title "Checkout"

user     "Customer"     [Browser]
api      "Shop API"     [Node.js]    x2
db       "Shop DB"      [PostgreSQL] x2
rabbit   "Order events" [RabbitMQ]   x2
worker   "Mailer"       [Worker]     x2
stripe   "Stripe"       [Stripe]
sendgrid "SendGrid"     [SendGrid]

user   -> api
api    -> db
api    -> stripe
api    -> rabbit
rabbit -> worker
worker -> sendgrid

usecase "Place order" {
  user -> api    : POST /orders {"sku": "A1"}
  api  -> stripe : CHARGE card
  alt "Paid" {
    api     -> db       : INSERT order
    api    ->> rabbit   : OrderPlaced {"id": "o-1"}
    api    --> user     : 201 {"id": "o-1"}
    rabbit ->> worker   : OrderPlaced
    worker  -> sendgrid : SEND receipt
  } alt "Payment failed" when "card declined" {
    api --> user : 402 {"error": "payment_failed"}
  } alt "DB down" {
    api  -x db   : INSERT order
    api --> user : 503
  }
}

traffic {
  "Place order" 50 rps mix "Paid" 97%, "Payment failed" 2%, "DB down" 1%
}

requirements {
  durable "Place order"
  survive any node failure
}

test "Checkout handles failures and never waits for email" {
  "Place order" never waits for sendgrid
  "Place order" has scenario "DB down"
  "Place order" responds 5xx
  no path from user to any database
}
```
