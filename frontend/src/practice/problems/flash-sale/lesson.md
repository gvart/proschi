# Flash sale: shaping a crowd before it reaches the database

```tldr
The crowd is about **twenty times** what checkout can serve, and checkout sits on one database you cannot split. So **cache product pages at the edge**, run the **waiting room in the edge** so a waiting buyer costs one cheap hop, and let a **conditional `UPDATE` in the same transaction as the order** decide the stock, never a Redis counter.
```

## What you'll learn

- How to reason about a crowd that is a hundred times bigger than what checkout can take.
- **Admission control**: why the place that turns people away matters as much as the decision to turn them away.
- How to serve almost all reads from the edge, and what an edge page cache costs you.
- Why a conditional `UPDATE` in the same database as the order beats a fast counter in Redis.
- How Shopify actually handled celebrity flash sales, and what the simulation can and cannot show about hot rows.

## The problem, explained

A celebrity launches a lip kit on Shopify. Hundreds of thousands of fans arrive at once: tens of thousands of product-page views a second, then a wall of checkout attempts for a stock gone in minutes. In early flash sales the checkout writes knocked over not just the shop but other shops sharing its database.

There are two use cases:

- **View product**: the edge has a cached copy (`"Page cache hit"`) or the app renders it from the database (`"Page cache miss"`).
- **Checkout**: a buyer tries to buy one unit, with three outcomes:

| Scenario | What happens | Answer |
|---|---|---|
| `"Queued"` | Checkout is full: a queue page polls again in a few seconds; once admitted, a signed cookie skips the queue | `429` |
| `"Order placed"` | A unit is taken from the stock and the order stored | `201` |
| `"Sold out"` | Admitted, but too late | `409` |

The non-functional requirements: never sell a unit twice or record a sale without its order, and make the order durable before `201`. Buyers who wait never reach the app or the database. p99 is under 50 ms for the page and 150 ms for a placed order. Pages are available 99.99% of the time, checkout 99.95%. The sale survives losing any machine and costs at most $2,000 a month, database included.

The given fixes the **pod**: the shop's MySQL shard, a primary and a replica. Its write capacity is lowered to **2k writes a second**: every checkout hammers the same few inventory rows, and a real database spends its time waiting on row locks, which the simulation expresses as lower capacity. Nor can you add shards: a shop lives on one pod, and you do not move it mid-sale. The only way out is to send less load.

The tests check:

- Page-cache hits never call a service or database, and the edge is called before any service.
- The `"Queued"` scenario exists, never calls a service or database, and answers `429`.
- Checkout never calls an eventually consistent store (a cache or Redis), `"Order placed"` writes the pod before answering `201`, and `"Sold out"` asks the pod and answers `409`.

This is the sibling of Ticket Booking with one big difference: buyers do not pick a seat. Everybody wants the same thing, which turns a set of rows into one hot counter and the crowd into the main enemy.

## Back-of-the-envelope

```numbers
90k rps | arrive at the edge
850 / s | pod writes once admitted, **≈ 43%** of 2k
≈ 17k / s | pod writes with no throttle
4.5k rps | reach the app
$800 | of the $2,000 is the pod
```

| Flow | Rate | Where it ends |
|---|---|---|
| Page views, cache hit (95%) | 76k rps | edge only |
| Page views, cache miss (5%) | 4k rps | app + 4k pod reads |
| Checkout, queued (95%) | 9.5k rps | edge only |
| Checkout, order placed (3.5%) | 350 rps | app + 2 pod writes each = 700 writes |
| Checkout, sold out (1.5%) | 150 rps | app + 1 pod write each = 150 writes |

**The pod.** Admitted checkouts produce 700 + 150 = 850 writes a second against 2k: about 43% utilisation. With no throttle, all 10k checkout attempts reach the app, and with the same split the pod would see on the order of 17k writes a second, eight or nine times its capacity. No number of app servers fixes that; with an unshardable pod, the only lever is admitting fewer buyers.

**The edge.** Everything arrives here: 80k + 10k = 90k rps. A simulated load balancer takes 100k rps per replica, so even a small fleet sits around 30%: answering here is nearly free.

**The app** sees only page misses plus admitted checkouts: 4k + 500 = 4.5k rps. At about 2k rps per replica that is 2.25 replicas at 100%; with a ~70% target and room to lose one, a handful. Rendering every page in the app takes 80k ÷ 2k = 40 replicas at 100%, well over 50 with headroom, at $100 each: that alone breaks the $2,000 budget.

**Where the time goes.** A page-cache hit is one edge hop of about 2 ms, a few milliseconds at p99. A placed order is edge → app → two pod writes → back: roughly 2 + 10 + 2 × ~8 ms of mean latency. The model's p99 for such a path is a few times its mean, so it fits under 150 ms only if neither the app nor the pod is near saturation.

**Cost.** The pod's two MySQL replicas are $800 of the $2,000; load balancers are $50 each, app replicas $100. "Cache the pages and throttle checkout at the edge" fits comfortably; "scale the app" does not.

## Concepts

### Admission control and virtual waiting rooms

**Admission control** means deciding at the door how much work you accept, so the accepted work finishes quickly. Accepting everything lets every request slow down together until timeouts start, retries pile on and the system collapses. Under overload, serving 500 buyers a second and politely telling 9,500 to wait beats trying to serve 10,000 and serving nobody.

A **virtual waiting room** is admission control with a user interface: a page that says "you are in line", polls, and lets you through when there is room. The admitted buyer gets a signed token (Shopify used a signed cookie) so the next step does not throttle them again.

```deepdive Leaky bucket or token bucket
The throttle itself is usually a **leaky bucket**: requests fill a bucket that drains at a fixed rate (the rate checkout can handle); when it is full, new arrivals are queued or rejected. A **token bucket** is the mirror image (tokens refill at a fixed rate and each request spends one) and allows short bursts.
```

```callout takeaway Where the waiting room runs matters
If the app decides who waits, every rejected buyer costs an app request, and 9.5k rejections a second need more app servers than the real work. With the throttle and the cached queue page in the load balancer, **a waiting buyer costs one cheap edge hop**.
```

When not to use it: when demand never exceeds capacity by much, a waiting room is friction for nothing; autoscaling or a per-client rate limiter is enough. Nor does it replace correctness: the throttle limits load, the database still prevents overselling.

````deepdive The throttle in Proschi
```proschi
title "Throttle at the edge"
user "User" [Actor]
edge "Edge" [nginx] x2
app  "App"  [REST API] x2
user -> edge
edge -> app

usecase "Enter" {
  user -> edge : POST /enter
  alt "Wait" when "the bucket is full" {
    edge --> user : 429 waiting page
  } alt "Admitted" when "the bucket has room" {
    edge  -> app  : POST /enter
    app  --> edge : 200
    edge --> user : 200
  }
}
```
````

```quiz
leaky-bucket
```

### Caching at the edge

When thousands of people a second request the same page, the cheapest place to answer is the first box they hit. A load balancer with a **page cache** (nginx can do this, and Shopify did) or a CDN keeps rendered pages briefly and answers repeats without the app.

The trade-off is staleness: a cached page can show "in stock" for a few seconds after the last unit sold. That is fine because the decision is made at checkout, not on the page. Keep personalised fragments (cart count, login state) out of the cached page, or load them separately.

When not to use it: for pages that differ per user, or where stale data is itself harmful (say, prices that legally must be exact at display time).

### The stock decision: one store, one transaction

To avoid overselling, decrement the stock with a **conditional write** in the database that also stores the order:

```sql
UPDATE inventory SET available = available - 1
WHERE variant_id = 42 AND available > 0;
-- 1 row: the unit is yours, INSERT the order and COMMIT
-- 0 rows: sold out
```

The condition `available > 0` is checked and applied atomically, so two buyers cannot both take the last unit. With the decrement and the order insert in the **same transaction**, a crash never leaves a unit taken without its order, or an order without its unit.

```callout pitfall A Redis counter is a second source of truth
`DECR stock:42` is atomic and very fast, but Redis and MySQL can disagree. Redis sells a unit, the process crashes before MySQL stores the order, and the unit is gone with no order. Or a failover loses the last few decrements and you sell more than you have. Shopify's own 2026 write-up on inventory reservations describes replacing Redis with MySQL for reservations, keeping them next to the orders, for exactly this kind of disagreement.
```

The price of keeping it in the database is the **hot row**: every checkout locks the same inventory row, so the effective write rate drops far below the usual capacity. Hence the pod's 2k writes a second, and why admission control is what makes the database approach viable.

```quiz
conditional-stock-update
cache-cannot-decide
```

## Designing it step by step

**1. Scope.** One shop, one product drop, one unit per checkout, no seat selection. Confirm the guarantees (no overselling, no unit without an order, order durable before `201`) and the numbers: 80k page views and 10k checkout attempts a second, checkout capacity about 500 a second, the pod's 2k writes.

**2. High level.** Buyers hit an edge tier (load balancers), which forwards to the app servers (the Rails monolith), which talk to the pod. Draw both flows end to end without optimisation, then ask of each arrow "how many requests a second cross this?" The answers (80k to the app, 17k writes to the pod) show the naive design fails by an order of magnitude.

**3. Deep dive.** Take the load away tier by tier.

*Pages.* Most of the 80k views are one page. Cache it in the edge, where a hit calls nothing; only misses reach the app, which reads the pod and returns the page for the edge to keep.

*Checkout admission.* Add a leaky bucket in the edge sized to checkout's capacity. Buyers over the limit get a `429` with a queue page (also cached in the edge) that polls again; admitted buyers get a signed pass. Explain why it must be the edge, not the app.

*The stock.* For admitted buyers, the app runs the conditional `UPDATE`, then inserts the order, in one transaction on the pod. One row changed → order placed; zero rows → sold out. No cache or Redis on this path.

*Sizing and failure.* Size the edge for 90k rps with one replica lost and the app for misses plus admitted checkouts with headroom; check the pod stays well below 2k writes, and check the bill.

**4. Wrap up.** Mention fairness (Shopify's queue compared the timestamp of a buyer's first attempt so early arrivals were not starved), bot protection, isolating the shop's pod so a sale spares other shops, and monitoring the admission rate to tune the bucket mid-sale.

## Common mistakes

**No throttle** (`wrong/no-throttle`). Everyone enters checkout, and the design doubles the app servers to cope. The app can take it; the pod cannot: thousands of writes a second land on hot rows, lock waits pile up, and in production the shard falls over, taking neighbouring shops with it. Caught by **"The throttle keeps the crowd out of checkout"** (there is no `"Queued"` scenario) and **p99 of Checkout scenario Order placed < 150 ms**, because the saturated pod fails every latency requirement that sends it load.

**Throttle in the app** (`wrong/throttle-in-the-app`). Right idea, wrong place: every rejected buyer still costs an app request, so 9.5k rejections a second swamp the app tier, and page misses queue behind them. Caught by **"The throttle keeps the crowd out of checkout"** (the queued scenario calls a service) and **p99 of View product < 50 ms**.

**Uncached storefront** (`wrong/uncached-storefront`). Render every page in the app, maybe with an in-app fragment cache. It works with dozens of app servers: around 56 replicas to stay out of saturation. Caught by **"Product pages are served from the edge cache"** and **cost ≤ $2,000/month**.

**Stock in Redis** (`wrong/stock-in-redis`). `DECR` in Redis, order in MySQL: fast, until a crash or a failover makes them disagree, with units sold without orders or more orders than units. Caught by **"The pod's database decides the stock and records the order"** (checkout calls an eventual store).

Classic mistakes beyond the tests:

- Read-then-write stock checks (`SELECT available`, then an unconditional `UPDATE`), which oversell under concurrency.
- Queue pages that are not cached, so the queue itself becomes the hot path.
- No pass for admitted buyers, so every checkout step throttles them again.
- Trying to shard a single product's inventory row in the middle of a sale.

## In the interview

```callout interview Lead with the ratio
"The crowd is about twenty times what checkout can serve, and checkout is bounded by one database we cannot split. So the design is about shaping load before it gets there, and making the one decision that matters correct." Then present the three layers: edge cache, edge throttle, conditional write.
```

Likely follow-ups:

- *Why not a message queue in front of checkout?* A queue smooths writes but the buyer still waits for an answer: a waiting room with worse feedback. The edge throttle answers immediately and keeps the database at a steady, safe rate.
- *How do you keep the queue fair?* Record the time of a buyer's first attempt (in the signed cookie) and prefer earlier arrivals when admitting.
- *What if the edge fails?* Several replicas behind DNS or anycast, each enforcing its share of the bucket, so the total admission rate is approximate. Fine: the database's conditional write is the real guard.
- *What about the hot row itself?* Split stock into sub-counter rows and pick one at random, or reserve batches of units. Each adds complexity; at 500 checkouts a second one row behind admission control is enough.
- *Bots?* Challenge at the edge before admitting, limit per account and per card, and cap units per order.

## Further reading

- Emil Stolarsky, [Surviving Flashes of High-Write Traffic Using Scriptable Load Balancers (Part I)](https://shopify.engineering/surviving-flashes-of-high-write-traffic-using-scriptable-load-balancers-part-i) (Shopify Engineering) — the throttle in nginx with Lua, the cached queue page and the pass cookie.
- Simon Eskildsen, [Shopify's Architecture to Handle 80K RPS Celebrity Sales](https://gotopia.tech/sessions/161/shopifys-architecture-to-handle-80k-rps-celebrity-sales) (GOTO 2017) — request rates of celebrity sales, edge caching and pods.
- [A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale) (Shopify Engineering) — why a shop's data lives on one isolated pod.
- [We replaced Redis with MySQL for inventory reservations, and it scaled](https://shopify.engineering/scaling-inventory-reservations) (Shopify Engineering) — reservations next to the orders, and hot rows in flash sales.
- [System Design Primer: Back pressure](https://github.com/donnemartin/system-design-primer#back-pressure) — limiting what you accept so the work you accept stays fast.
- [Virtual Waiting Room on AWS](https://docs.aws.amazon.com/solutions/latest/virtual-waiting-room-on-aws/welcome.html) — a reference waiting room for sale launches and other bursts.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability) — a curated list that links Shopify's 80K RPS talk alongside many other real-world scaling write-ups.
