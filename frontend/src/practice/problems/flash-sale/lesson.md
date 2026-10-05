# Flash sale: shaping a crowd before it reaches the database

## What you'll learn

- How to reason about a crowd that is a hundred times bigger than what checkout can take.
- **Admission control**: why the place that turns people away matters as much as the decision to turn them away.
- How to serve almost all reads from the edge, and what an edge page cache costs you.
- Why a conditional `UPDATE` in the same database as the order beats a fast counter in Redis.
- How Shopify actually handled celebrity flash sales, and what the simulation can and cannot show about hot rows.

## The problem, explained

A celebrity launches a lip kit on Shopify. Hundreds of thousands of fans are waiting, and when the sale opens they all arrive at once: tens of thousands of product-page views a second, then a wall of checkout attempts for a stock that is gone in minutes. In early flash sales the checkout writes knocked over not just the shop but other shops sharing its database.

There are two use cases:

- **View product**: a buyer opens the product page. Either the edge has a cached copy (`"Page cache hit"`) or the app renders it from the database (`"Page cache miss"`).
- **Checkout**: a buyer tries to buy one unit. Three outcomes. `"Queued"`: checkout is at capacity, so the buyer gets `429` and a queue page that polls again in a few seconds; once admitted, a signed cookie lets them skip the queue. `"Order placed"`: a unit was left, it is taken from the stock, the order is stored, `201`. `"Sold out"`: admitted, but too late, `409`.

The non-functional requirements: never sell a unit twice, never record a sale without its order; the order is durable before `201`; buyers who wait never reach the app or the database; p99 under 50 ms for the page and 150 ms for a placed order; 99.99% availability for pages and 99.95% for checkout; survive any machine; at most $2,000 a month, the database included.

The given fixes the **pod**: the shop's MySQL shard, a primary and a replica. Its write capacity is lowered to **2k writes a second**, because every checkout hammers the same few inventory rows and a real database spends its time waiting on row locks. The simulation does not model lock waits, so the problem expresses them as lower capacity. Because the problem sets the pod's capacity, you also cannot add shards to it: a shop lives on one pod, and you do not move it in the middle of a sale. The only way out is to send less load.

The tests say the same in checks: page-cache hits never call a service or database and the edge is called before any service; the `"Queued"` scenario exists, never calls a service or database, and answers `429`; checkout never calls an eventual store, `"Order placed"` writes the pod before answering `201`, and `"Sold out"` asks the pod and answers `409`.

This is the sibling of the Ticket Booking problem with one big difference: buyers do not pick a specific seat. Everybody wants the same thing, which turns a set of rows into one hot counter and a crowd into the main enemy.

## Back-of-the-envelope

| Flow | Rate | Where it ends |
|---|---|---|
| Page views, cache hit (95%) | 76k rps | edge only |
| Page views, cache miss (5%) | 4k rps | app + 4k pod reads |
| Checkout, queued (95%) | 9.5k rps | edge only |
| Checkout, order placed (3.5%) | 350 rps | app + 2 pod writes each = 700 writes |
| Checkout, sold out (1.5%) | 150 rps | app + 1 pod write each = 150 writes |

**The pod.** Admitted checkouts produce 700 + 150 = 850 writes a second against 2k: about 43% utilisation. Now imagine no throttle: all 10k checkout attempts reach the app, and with the same split the pod would see on the order of 17k writes a second, eight or nine times what it can do. No amount of app servers fixes that, and since the pod cannot be sharded, the only lever is to admit fewer buyers.

**The edge.** Everything arrives here: 80k + 10k = 90k rps. A load balancer in the simulation takes 100k rps per replica, so even a small fleet sits around 30%. Answering from the edge is nearly free compared with any other tier.

**The app.** It sees only page misses plus admitted checkouts: 4k + 500 = 4.5k rps. At about 2k rps per replica that is 2.25 replicas at 100% load; with ~70% headroom and room to lose one, you land at a handful. Compare that with rendering every page in the app: 80k ÷ 2k = 40 replicas at 100%, well over 50 with headroom, at $100 each. That alone breaks the $2,000 budget.

**Where the time goes.** A page-cache hit is one edge hop of about 2 ms; its p99 is a few milliseconds. A placed order is edge → app → two pod writes → back: roughly 2 + 10 + 2 × ~8 ms of mean latency, and the model's p99 for such a path is a few times its mean, so it fits under 150 ms only if neither the app nor the pod is close to saturation.

**Cost.** The pod's two MySQL replicas are $800 of the $2,000. Load balancers are $50 each and app replicas $100 each. The budget is calibrated so that "cache the pages and throttle checkout at the edge" fits comfortably and "scale the app" does not.

## Concepts

### Admission control and virtual waiting rooms

**Admission control** means deciding, at the door, how much work you accept, so the work you do accept finishes quickly. The alternative is accepting everything and letting every request slow down together until timeouts start, retries pile on and the system collapses. Under overload, a system that serves 500 buyers a second and politely tells 9,500 to wait is far better than one that tries to serve 10,000 and serves nobody.

A **virtual waiting room** is admission control with a user interface: a page that says "you are in line", polls, and lets you through when there is room. The admitted buyer gets a signed token (Shopify used a signed cookie) so they are not throttled again on the next step.

The throttle itself is usually a **leaky bucket**: requests fill a bucket that drains at a fixed rate (the rate checkout can handle); when it is full, new arrivals are queued or rejected. A **token bucket** is the mirror image (tokens refill at a fixed rate and each request spends one) and allows short bursts.

The crucial detail is *where* the waiting room runs. If the app decides who waits, every rejected buyer still costs an app request, and 9.5k rejections a second need more app servers than the real work. Put the throttle in the load balancer and the cached queue page with it, and a waiting buyer costs one cheap edge hop.

When not to use it: when demand never exceeds capacity by much, a waiting room adds friction for nothing; plain autoscaling or a rate limiter per client is enough. And it is no substitute for correctness: the throttle limits load, the database still has to prevent overselling.

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

### Caching at the edge

When thousands of people a second request the same page, the cheapest place to answer is the first box they hit. A load balancer with a **page cache** (nginx can do this, and Shopify did) or a CDN stores rendered pages for a short time and answers repeats without touching the app.

The trade-off is staleness: a cached page can show "in stock" for a few seconds after the last unit sold. That is acceptable here because the page is not where the decision is made; checkout is. Keep personalised fragments (cart count, login state) out of the cached page, or load them separately.

When not to use it: for pages that differ per user, or where showing stale data is itself harmful (prices that legally must be exact at display time, for instance).

### The stock decision: one store, one transaction

To avoid overselling, decrement the stock with a **conditional write** in the database that also stores the order:

```sql
UPDATE inventory SET available = available - 1
WHERE variant_id = 42 AND available > 0;
-- 1 row: the unit is yours, INSERT the order and COMMIT
-- 0 rows: sold out
```

The condition `available > 0` is checked and applied atomically, so two buyers cannot both take the last unit. Doing the decrement and the order insert in the **same transaction** means a crash can never leave a unit taken without its order or an order without its unit.

The tempting alternative is a Redis counter: `DECR stock:42` is atomic and blindingly fast. But it creates **two sources of truth**. Redis says a unit is sold, then the process crashes before MySQL stores the order, and the unit is gone with no order. Or Redis loses the last few decrements in a failover and sells more than you have. Shopify's own 2026 write-up on inventory reservations describes replacing Redis with MySQL for reservations, keeping them next to the orders, for exactly this kind of disagreement.

The price of keeping it in the database is the **hot row**: every checkout locks the same inventory row, so the database's effective write rate for this sale drops far below its usual capacity. That is why the problem's pod takes only 2k writes a second, and why admission control is what makes the database approach viable.

## Designing it step by step

**1. Scope.** Clarify: one shop, one product drop, single unit per checkout, no seat selection. Confirm the guarantees (no overselling, no unit without an order, order durable before `201`) and the numbers: 80k page views and 10k checkout attempts a second, checkout capacity about 500 a second, and the pod's 2k writes.

**2. High level.** Buyers hit an edge tier (load balancers), which forwards to the app servers (the Rails monolith), which talk to the pod. Draw the two flows end to end without any optimisation first. Then ask, for each arrow, "how many requests a second cross this?" The answers (80k to the app, 17k writes to the pod) show that the naive design fails by an order of magnitude.

**3. Deep dive.** Take the load away tier by tier.

*Pages.* Most of the 80k views are the same page. Cache it in the edge, where a hit answers without calling anything. Only misses reach the app, which reads the pod and returns the page for the edge to keep.

*Checkout admission.* Add a leaky bucket in the edge sized to what checkout can take. Buyers over the limit get a `429` with a queue page (also cached in the edge) that polls again; admitted buyers get a signed pass. Walk through why it has to be the edge and not the app.

*The stock.* For admitted buyers, the app runs the conditional `UPDATE` on the inventory row, then inserts the order, in one transaction on the pod. One row changed → order placed; zero rows → sold out. No cache or Redis anywhere on this path.

*Sizing and failure.* Size the edge for 90k rps with one replica lost, the app for misses plus admitted checkouts with headroom, and check that the pod stays well below its 2k write ceiling. Check the bill.

**4. Wrap up.** Mention fairness (Shopify's queue compared the timestamp of a buyer's first attempt so early arrivals were not starved), bot protection, isolating the shop's pod so a sale does not hurt other shops, and observability on the admission rate so you can tune the bucket during the sale.

## Common mistakes

**No throttle** (`wrong/no-throttle`). Everyone goes into checkout, and the design doubles the app servers to cope. The app can take it; the pod cannot. Thousands of writes a second land on hot rows, lock waits pile up, and in production the shard falls over and takes neighbouring shops with it. Caught by **"The throttle keeps the crowd out of checkout"** (there is no `"Queued"` scenario) and **p99 of Checkout scenario Order placed < 150 ms**, because the saturated pod fails every latency requirement that sends it load.

**Throttle in the app** (`wrong/throttle-in-the-app`). The idea is right, the place is wrong: every rejected buyer still costs an app request, so 9.5k rejections a second swamp the app tier, and product pages that miss the cache queue behind them. Caught by **"The throttle keeps the crowd out of checkout"** (the queued scenario calls a service) and **p99 of View product < 50 ms**.

**Uncached storefront** (`wrong/uncached-storefront`). Render every page in the app, maybe with an in-app fragment cache. It works if you buy dozens of app servers, which is exactly what happens: around 56 replicas to stay out of saturation. Caught by **"Product pages are served from the edge cache"** and **cost ≤ $2,000/month**.

**Stock in Redis** (`wrong/stock-in-redis`). `DECR` in Redis, order in MySQL. Fast, and fine until a crash or a failover makes the two disagree: units sold with no order, or more orders than units. Caught by **"The pod's database decides the stock and records the order"** (checkout calls an eventual store).

Classic mistakes beyond the tests:

- Read-then-write stock checks (`SELECT available`, then `UPDATE`) without a condition, which oversell under concurrency.
- Queue pages that are not cached, so the queue itself becomes the hot path.
- Forgetting the admitted buyer's pass, so they are throttled again on every step of checkout.
- Trying to shard a single product's inventory row in the middle of a sale.

## In the interview

Lead with the ratio: "The crowd is about twenty times what checkout can serve, and checkout is bounded by one database we cannot split. So the design is about shaping load before it gets there, and making the one decision that matters correct." Then present the three layers: edge cache, edge throttle, conditional write.

Likely follow-ups:

- *Why not a message queue in front of checkout?* A queue smooths writes but the buyer still waits for an answer; you would be building a waiting room with worse feedback. The edge throttle answers immediately and keeps the database at a steady, safe rate.
- *How do you keep the queue fair?* Record the time of a buyer's first attempt (in the signed cookie) and prefer earlier arrivals when admitting.
- *What if the edge fails?* Several replicas behind DNS or anycast; each enforces its share of the bucket, so the total admission rate is approximate. That is fine because the database's conditional write is the real guard.
- *What about the hot row itself?* Options include splitting stock into several rows (sub-counters) and picking one at random, or reserving batches of units. Each adds complexity; at 500 checkouts a second a single row with admission control is enough.
- *Bots?* Challenge at the edge before admitting, limit per account and per card, and cap units per order.

## Further reading

- Emil Stolarsky, [Surviving Flashes of High-Write Traffic Using Scriptable Load Balancers (Part I)](https://shopify.engineering/surviving-flashes-of-high-write-traffic-using-scriptable-load-balancers-part-i) (Shopify Engineering) — the throttle in nginx with Lua, the cached queue page and the pass cookie.
- Simon Eskildsen, [Shopify's Architecture to Handle 80K RPS Celebrity Sales](https://gotopia.tech/sessions/161/shopifys-architecture-to-handle-80k-rps-celebrity-sales) (GOTO 2017) — request rates of celebrity sales, edge caching and pods.
- [A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale) (Shopify Engineering) — why a shop's data lives on one isolated pod.
- [We replaced Redis with MySQL for inventory reservations, and it scaled](https://shopify.engineering/scaling-inventory-reservations) (Shopify Engineering) — reservations next to the orders, and hot rows in flash sales.
- [System Design Primer: Back pressure](https://github.com/donnemartin/system-design-primer#back-pressure) — limiting what you accept so the work you accept stays fast.
- [Virtual Waiting Room on AWS](https://docs.aws.amazon.com/solutions/latest/virtual-waiting-room-on-aws/welcome.html) — a reference waiting room for sale launches and other bursts.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability) — a curated list that links Shopify's 80K RPS talk alongside many other real-world scaling write-ups.
