---
title: Flash Sale
summary: "Shopify's flash sales: cache at the edge, throttle checkout, never oversell."
difficulty: hard
company: Shopify
tags: [rate-limiting, caching, consistency, spiky-traffic, real-world]
hints:
  - "Checkout writes, and this shop's database takes about 2k writes a second. Ten thousand buyers a second press Checkout. Where should the ones that cannot be served now stop, and what should they see?"
  - "Most of the crowd is reading the same product page over and over. The load balancer in front of the app can answer from its own page cache: in \"Page cache hit\" the edge replies without calling anything else."
  - "Put the throttle in the edge as well (Shopify used a leaky bucket in nginx with Lua): in \"Queued\" the edge answers 429 with a cached queue page that polls again, and never calls the app or the database. Only \"Order placed\" and \"Sold out\" reach the app."
  - "Let the database decide the stock: UPDATE inventory SET available = available - 1 WHERE available > 0. One row changed means the unit is yours (then INSERT the order in the same transaction and answer 201); zero rows means sold out (409). No Redis counter, no cache on the checkout path. Two writes per order and one per sold-out attempt keep the pod under 50% busy; size the app for the page misses plus the admitted checkouts at about 2k rps per replica."
---

When a celebrity launches a product on Shopify, a crowd that is waiting for
the moment hits one shop at once: tens of thousands of requests a second,
most of them for the same page, then a rush on checkout for a stock that is
gone in minutes. In early sales, checkout writes took down not just
the shop but whole segments of the platform with it.

Shopify's answer was to shape the load before it reaches the database. The
load balancers serve cached pages, and a throttle at the edge lets only as
many buyers into checkout as the database can serve; the rest wait on a
queue page. Checkout itself must never sell a unit twice, and an order must
exist before the buyer is told it was placed.

Design the sale for one shop.

## Functional requirements

- **View product**: a buyer opens the product page. Two scenarios:
  `"Page cache hit"`, answered from a cached copy, and `"Page cache miss"`,
  rendered by the app from the database.
- **Checkout**: a buyer checks out one unit. Three scenarios:
  - `"Queued"`: checkout is at capacity and the buyer has not been let in
    yet. They get `429` with a queue page that polls again in a few seconds;
    once through, a signed cookie lets them skip the queue.
  - `"Order placed"`: the buyer is let in, a unit is left, it is taken
    from the stock and the order is stored. The buyer gets `201`.
  - `"Sold out"`: the buyer is let in but the last unit is gone. The buyer
    gets `409`.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **80k page views a second** at the start of the sale, 95% of them for
  pages the edge has cached.
- **10k checkout attempts a second**, counting every poll from the queue
  page. Checkout can take about **500 a second** (30k a minute): 350 orders
  and 150 buyers who arrive too late.
- The shop lives on one **pod**: one MySQL shard, a primary and a replica.
  Every checkout takes a unit from the same few inventory rows, so the
  primary manages only about **2k writes a second** for this sale.

## Constraints

- A unit is never sold twice, and a sold unit always has its order. The
  shop's database decides both, in one place. No eventually consistent
  store (a cache, Redis) is on the checkout path.
- The order is written before the buyer hears `201`.
- Buyers who wait must not reach the app servers or the database at all.
- p99 of a product page under **50 ms**, of a placed order under **150 ms**.
- Product pages available **99.99%** of the time, checkout **99.95%**.
- Losing any single machine must not stop the sale.
- At most **$2,000 / month**, the pod included.

The simulation sees the hot inventory rows only as the lower write capacity
the problem sets for the pod; it does not model lock waits. Because the
problem sets the pod's capacity, it cannot be split into shards here
(`capacity { pod shards N }` is a duplicate): a shop's data lives on one
pod, and a flash sale is no time to move it.

## What is given

`problem.proschi` declares the `buyer` and `pod`, the shop's MySQL shard
with its write limit, and holds the traffic, requirements and tests. Add the
edge (load balancers with a page cache and the throttle), the app servers,
the connections and the two use cases.

Unlike **Ticket Booking**, buyers do not pick a particular item and hold it:
the problem is a crowd a hundred times bigger than checkout can take.

## Based on

- Emil Stolarsky, [Surviving Flashes of High-Write Traffic Using Scriptable Load Balancers (Part I)](https://shopify.engineering/surviving-flashes-of-high-write-traffic-using-scriptable-load-balancers-part-i),
  Shopify Engineering, 2017: checkout writes taking down shards in flash
  sales (every checkout creates a MySQL record and every step changes it),
  a leaky bucket throttle in the nginx load balancers written in Lua, the
  queue page cached in nginx that polls `/checkout`, and the signed cookie
  that lets an admitted buyer skip the throttle.
- Simon Eskildsen, [Shopify's Architecture to Handle 80K RPS Celebrity Sales](https://gotopia.tech/sessions/161/shopifys-architecture-to-handle-80k-rps-celebrity-sales),
  GOTO Copenhagen 2017: the request rates of celebrity sales, throttling
  and serving cache hits from the load balancers, and isolating shops in
  pods to limit the blast radius.
- [A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale),
  Shopify Engineering: a pod is a set of shops on fully isolated MySQL
  datastores, sharded by shop, so a shop's data lives on one pod.
- [We replaced Redis with MySQL for inventory reservations, and it scaled](https://shopify.engineering/scaling-inventory-reservations),
  Shopify Engineering, 2026: reservations that keep two checkouts from
  claiming the same unit, the hot-row problem in flash sales, and why
  keeping reservations next to the orders in MySQL fixes the cases where
  one is recorded without the other.
