## What you'll learn

- What a rate limiter protects, and why it must sit **in front of** the service with **no way around it**.
- The classic algorithms: **fixed window, sliding log, sliding window counter, token bucket** and **leaky bucket**, and what each trades.
- Why limiter replicas need **shared counters**, and why the counter must be an **atomic increment** done *before* the decision.
- How cheap a well-placed check is: a millisecond in memory that saves the backend from the requests it should never see.
- How to answer the operational questions: fail open or closed, what to return, how to tell clients when to retry.

## The problem, explained

The Orders API is being hammered by a few noisy clients: a buggy script retrying in a loop, a partner polling far too often, maybe someone scraping. Every request they send takes capacity away from everyone else. A **rate limiter** caps how much each client may send. Here the rule is **100 requests per minute per client**; anything above that gets `429 Too Many Requests` and never reaches the Orders API.

There is one use case, **Call API**, with two scenarios:

- `"Allowed"`: the client is under its limit; the request reaches the Orders API and the client gets `200`.
- `"Limited"`: the client is over its limit and gets `429`; the Orders API never sees the request.

The non-functional requirements:

- **Scale**: 5k requests per second in total, about 5% of them over the limit.
- **Shared state**: the limiter runs on several machines, and a client may hit any of them. A per-machine count would let a client through several times over.
- **Count every call**: the limiter increments the client's counter (an atomic write like `INCR`) *before* deciding. Reading the counter and incrementing later lets bursts slip through.
- **Latency**: p99 of a call under 150 ms, including the limit check.
- **Availability** 99.9%, and losing any single machine doesn't take the API down.
- **No bypass**: no connection from the client straight to the Orders API.
- **Budget**: $3,000 a month for everything, the Orders API included.

`given.proschi` fixes the `client` and the `orders` service: five replicas, already sized for the allowed traffic. You add the limiter, the store for its counters and the connections.

The tests, in plain words:

1. **Limits are checked before the Orders API**: both scenarios exist, and a cache is called before `orders`.
2. **Rejected calls never reach the Orders API**: `"Limited"` never calls `orders` and answers `429`, and there's no path from the client to `orders` at all.
3. **Every call is counted before it is let through**: a write to the cache happens before responding, in every scenario.

## Back-of-the-envelope

| Quantity | Arithmetic | Result |
|---|---|---|
| Limit per client | 100 per minute ÷ 60 | ≈ 1.7 rps |
| Calls rejected | 5,000 × 5% | 250 rps |
| Calls reaching Orders | 5,000 × 95% | 4,750 rps |
| Counter increments | one per call | 5,000 per second |
| Counter keys alive at once | one per active client per minute | e.g. 1 M clients |
| Counter memory | 1 M × ~100 bytes | ≈ 100 MB |
| Worst burst, fixed window | 100 at 0:59 + 100 at 1:00 | 200 in about a second |

The client count is an assumption, there to show that counter memory is small: even a million active clients fit easily in one cache node. What matters is the **rate of increments**, one per call, and that every limiter replica sees the same counter.

Per-component load, with the simulation's defaults per replica:

| Component | Load it sees | Capacity per replica | Replicas at 100% busy |
|---|---|---|---|
| Entry point (`[AWS API Gateway]`) | 5,000 rps | 10,000 rps | 1 |
| Limiter (`[REST API]`) | 5,000 rps | 2,000 rps | 3 (2.5, rounded up) |
| Counters (`[Redis]`) | 5,000 writes | 100,000 rps | 1 |
| Orders API (given, 5 replicas) | 4,750 rps | 2,000 rps | — (≈ 48% busy) |

As in every problem, the right-hand column is the saturation floor, not a design. A node at 100% fails every latency requirement it touches, and the model's queueing makes p99 grow quickly well before that. Keep each node comfortably below 70% busy, and make sure it still holds with one replica fewer, which is what `survive any node failure` checks.

How it shows up in the numbers:

- **Latency.** Idle latencies are about 10 ms for a gateway, 10 ms for a service and 1 ms for Redis. An allowed call crosses the gateway, the limiter, the counter store and the Orders API, so the check costs one extra service hop plus a millisecond. With p99 around 2.8× the mean for an idle hop, a path in the 30–40 ms range lands comfortably under 150 ms, as long as nothing is running hot.
- **Availability.** A single service replica is up 99.5% of the time in the model, below the 99.9% target on its own. Two of everything gets every node well above it.
- **Cost.** The given Orders API (5 × $100) is already on your bill. A gateway is about $100 per replica, a service $100, Redis $150. Price your design before running it.
- **Protection.** The limiter's payoff appears on `orders`: it receives only the allowed 95%, not the full 5k.

## Concepts

### Rate limiting algorithms

All of them answer the same question, "may this client make another request right now?", with different memory and accuracy.

- **Fixed window counter.** One counter per client per minute (key like `rate:client-42:202610051437`). Increment on each call; reject when it passes 100; let the key expire after the minute. Tiny and simple. The flaw: a client can send 100 at the end of one minute and 100 at the start of the next, 200 in about a second.
- **Sliding window log.** Keep the timestamp of every request in the last minute; count them on each call. Exact, but memory grows with the limit (100 timestamps per client here, far more for high limits).
- **Sliding window counter.** Keep the current and previous minute's counts, and estimate the last 60 seconds as *current + previous × (fraction of the previous window still inside the last 60 s)*. Nearly as smooth as the log, with only two numbers of memory. Cloudflare described using this approach at the edge.
- **Token bucket.** Each client has a bucket of up to *B* tokens, refilled at *r* per second; a request takes a token or is rejected. It allows short bursts up to *B* while enforcing the average rate. Stripe has written about using token buckets in Redis for its API limits.
- **Leaky bucket.** Requests join a fixed-size queue drained at a constant rate. It smooths the output perfectly, but requests wait in the queue (and are rejected only when it is full). That suits traffic shaping more than API limits.

**Trade-offs in one line each:** fixed window is cheapest but bursty at edges; the log is exact but memory-hungry; the sliding counter is the usual compromise; token bucket is the most flexible for APIs.

**When not to bother.** For an internal service with a few well-behaved callers, autoscaling and timeouts may be enough. For "protect the backend from overload" in general (not per client), use *load shedding*: reject work when the service itself is near capacity.

A fixed-window check in Proschi:

```proschi
title "Fixed window"

caller  "Caller"   [Actor]
limiter "Limiter"  [REST API] x2
windows "Windows"  [Redis]    x2

caller  -> limiter
limiter -> windows : INCR / EXPIRE

usecase "Check" {
  caller   -> limiter : request from client-42
  limiter  -> windows : INCR rate:client-42:1437
  windows --> limiter : 37
  limiter  -> windows : EXPIRE rate:client-42:1437 60
  limiter --> caller  : 37 of 100, allow
}
```

### Shared counters and atomic increments

**What it is.** The limiter runs on several machines behind the entry point, and requests from one client land on any of them. If each limiter kept its own in-memory counts, a client spread across *n* replicas could make *n* times its limit. So the counters live in one shared, fast store, typically Redis.

**Why atomic.** Consider "read the counter, decide, then increment". Two requests from the same client arrive at two limiters at the same instant. Both read 99, both allow, and both increment, ending at 101. Under a burst, dozens can slip through that gap. `INCR` does the read and the write in one atomic step and returns the new value, so every caller sees a distinct number and the decision is made on that number. More complex algorithms (token bucket, sliding window) get the same guarantee by running as a Lua script inside Redis, which executes without interruption.

**Trade-offs.** Every call now makes a round trip to the store, about a millisecond inside a data centre. The store becomes a dependency of every request, which raises the question below.

**When not to use a central store.** At very large scale or across regions, a single store's round trip and load become the problem. Then you accept approximate limits: local counters synchronised periodically, or limits enforced per region.

The shape to remember: many stateless limiters, one shared place for the counts.

```proschi
title "Shared counters"

lb     "Load Balancer" [AWS Load Balancer] x2
limits "Limiter"       [REST API]          x4 "Stateless: no counts in memory"
counts "Counters"      [Redis]             x2 "The only copy of every count"

lb     -> limits
limits -> counts : INCR
```

### Placement, no bypass, and failing open

**Where it goes.** The limiter must sit on the only path to the protected service. It can live in an API gateway, as middleware in the service, or as a separate service the gateway asks. Here the gateway asks a limiter service, which keeps the policy (who gets what limit) in one place. If any route reaches the Orders API without passing the check (an old load balancer, a "temporary" direct connection), the noisy clients will find it.

**What to return.** `429 Too Many Requests`, ideally with a `Retry-After` header and headers telling the client its limit and what's left. Well-behaved clients back off; badly behaved ones are at least rejected cheaply.

**Fail open or closed?** If the counter store is down, a limiter can reject everything (fail closed: safe for the backend, but an outage for everyone) or allow everything (fail open: the API stays up, but unprotected for a while). For a limiter whose job is fairness, failing open is the common choice. For one that protects something fragile or expensive, failing closed may be right. Either way, decide on purpose.

A fail-open path, drawn as a fallback scenario:

```proschi
title "Fail open"

caller  "Caller"   [Actor]
gate    "Gateway"  [AWS API Gateway] x2
limiter "Limiter"  [REST API]        x2
counts  "Counters" [Redis]           x2
backend "Backend"  [REST API]        x2

caller  -> gate
gate    -> limiter
limiter -> counts
gate    -> backend

usecase "Request" {
  caller -> gate    : GET /items
  gate   -> limiter : check
  alt "Counted" {
    limiter  -> counts  : INCR rate:c1
    counts  --> limiter : 12
  } alt "Store down" {
    limiter -x counts  : INCR rate:c1
  }
  limiter --> gate    : allow
  gate     -> backend : GET /items
  backend --> gate    : 200
  gate    --> caller  : 200
}
```

## Designing it step by step

### Step 1: Scope

Ask what is being limited and by what key: per user, per API key, per IP? (Per client here.) What's the rule? (100 per minute.) Hard limit or soft? What should a limited client see? (`429`.) Is the limiter shared by many services, or just this one? And the scale: 5k rps, 5% over the limit, several limiter machines.

### Step 2: High-level design

The starter connects the client straight to `orders`. The first move is to put an entry point in front and remove that direct path, so the client talks only to the gateway. The gateway asks a limiter about every call. The limiter increments the client's counter in Redis and returns allow or deny. On allow, the gateway forwards the call to `orders`; on deny, it answers `429` itself.

Draw the use case with the check *before* the `alt`, because every call is counted, and then two scenarios: `"Allowed"` goes on to `orders`, `"Limited"` stops at the gateway.

### Step 3: Deep dive

**Algorithm.** For 100 per minute, a fixed window is the simplest correct answer: `INCR` the key for this client and minute, set it to expire, compare with 100. Say out loud that it allows up to 200 across a window boundary, and that a sliding window counter or token bucket fixes that if the product needs it.

**Atomicity.** The decision is made on the value `INCR` returned, never on an earlier read. If you set the expiry in a separate command, do both in one transaction or script so a crash between them can't leave a counter that never expires.

**Sizing.** Every call passes through the gateway and the limiter, and every call writes the counter store, so all three carry the full 5k rps. Use the load table above, keep each node well under 70% busy, give everything a second replica, and confirm it all survives losing one. The Orders API is given, but check its utilisation in the Analysis tab: it should only see the allowed share.

**Latency budget.** The check adds a service hop and a cache hop to every call. Read p99 in the Analysis tab; if it's close to 150 ms, something is queueing, so look for the hot node rather than the long path.

### Step 4: Wrap up

"All traffic enters through a gateway; there's no direct path to Orders. For every call, a limiter atomically increments a per-client, per-minute counter in Redis and decides on the returned value. Allowed calls go on; limited ones get `429` at the gateway, so the Orders API only sees allowed traffic." Then mention what you'd add: per-plan limits from configuration, `Retry-After` headers, fail-open with alerting, and a sliding window if the boundary burst matters.

## Common mistakes

**The client can bypass the limiter** (`wrong/client-bypasses-limiter`). The design is otherwise perfect, but there's still a `client -> orders` connection. In production, this is the forgotten internal hostname or an old route that skips the gateway; abusive clients find it quickly, and your limiter protects nothing. Caught by **Rejected calls never reach the Orders API** (`no path from client to orders`).

**Incrementing after the decision** (`wrong/increment-after-decision`). The limiter `GET`s the counter, decides, and increments afterwards, asynchronously, and only for allowed calls. Two things go wrong. Concurrent requests read the same value and all pass (the race described above), so bursts exceed the limit. And rejected calls aren't counted, so the counter never shows how hard a client is really hammering the API. Caught by **Every call is counted before it is let through**.

**Counters in each limiter's memory.** Fast and simple, but a client spread over five replicas gets five times its limit, and a restart resets everyone's count. The tests require the check to go to a cache: without one, **Limits are checked before the Orders API** and **Every call is counted before it is let through** fail.

**Calling Orders in the Limited scenario.** For example, forwarding the request and filtering the answer. The point is that the backend never does the work. Caught by **Rejected calls never reach the Orders API**.

**One limiter or one Redis.** A single limiter replica falls short of 99.9% on its own and is a single point of failure. So is a single Redis. Caught by `survive any node failure` and the availability requirement.

**Too few limiter replicas.** Three can carry 5k rps on paper, but at that utilisation queueing pushes up p99, and losing one saturates the rest. Caught by the p99 limit or `survive any node failure`.

## In the interview

**How to present it.** Start with the requirements: the key (per client), the rule (100/min), the response (`429`), and the scale. Draw the gateway and the "no other path" rule first; it shows you understand that a limiter is only as good as its placement. Then pick an algorithm and justify it, and walk through the atomic `INCR`. Finish with failure handling.

Follow-up questions:

- **"Which algorithm would you choose?"** Fixed window for simplicity; sliding window counter if boundary bursts matter; token bucket if you want to allow short bursts while capping the average.
- **"How do you make it work across many limiter servers?"** Shared counters in Redis with atomic operations; for complex algorithms, a Lua script so the read-modify-write is one step.
- **"What happens if Redis is down?"** Fail open with an alert (the usual choice for fairness limits), or fail closed when the backend is fragile. Run Redis with a replica so this is rare.
- **"How does the client know when to retry?"** `429` with `Retry-After`, plus headers for the limit and remaining calls.
- **"How would you limit across regions?"** Enforce per region with a share of the global limit, or sync counts asynchronously and accept a little overshoot.
- **"Rate limiting vs load shedding?"** Rate limiting is per-client fairness. Load shedding protects the service as a whole when it's near capacity, no matter who is sending.

## Further reading

- [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) (Stripe): how Stripe combines several limiters and load shedders, with token buckets in Redis.
- [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) (Cloudflare): rate limiting at the edge and the sliding window approximation.
- [Redis INCR command](https://redis.io/docs/latest/commands/incr/): the official docs include a rate-limiter pattern built on `INCR` and `EXPIRE`, and the race conditions to avoid.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A Rate Limiter": all five algorithms compared, with a distributed design in interview format.
- [System Design Primer: Additional system design interview questions](https://github.com/donnemartin/system-design-primer#additional-system-design-interview-questions): lists "Design an API rate limiter" with the Stripe post as its reference.
- [awesome-scalability: rate limiting](https://github.com/binhnguyennus/awesome-scalability): its Rate Limiting entries collect real write-ups from Stripe, Cloudflare, Figma and others.
