```tldr
Clients retry, and a timeout hides whether the card was charged. **Insert the payment under its idempotency key** in a strong store **before** charging, pass the **same key** to the gateway, **book after approval and mark succeeded after booking**, and when unsure answer **`202` pending** and retry from a queue.
```

A shopper taps "Pay" on a train; the request is slow, and the app gives up and tries again. But your server got the first request, and the card processor approved it. Without care, the shopper is charged twice. A few rules make a payment endpoint safe to retry: record first, key everything, order the writes, and treat "I don't know" as its own outcome.

## What you'll learn

- What an **idempotency key** is and why it belongs under a unique constraint in a strongly consistent, durable store, not in a cache.
- Why the **order of writes** (intent, charge, ledger, mark succeeded) decides what a crash can leave behind.
- How to handle an **ambiguous failure** (a timeout after which you do not know whether the card was charged) with a pending state and a queue-driven retry.
- How a fallback path lifts availability above that of a dependency you cannot control.

## The problem, explained

An online shop charges cards through an external gateway that takes about 250 ms per charge and sometimes times out. Mobile clients retry when they hear nothing back. Every checkout carries a client-chosen `Idempotency-Key`, and a retry sends the same key.

Two use cases:

- **Checkout** (`POST /payments`), in three scenarios:

  | Scenario | What happens | Shopper gets |
  |---|---|---|
  | `"Charged"` | New key; the gateway approves, the money is booked in the ledger, the payment is marked succeeded with its response stored. | `201` |
  | `"Replay"` | Key seen before: the stored result, nothing charged or booked again. | `2xx` |
  | `"Gateway down"` | The charge fails or times out; the payment stays *pending*, retried in the background. | `202` |

- **Retry charge**: a queue hands a pending payment to a worker, which charges again with the same key, books the ledger, marks the payment succeeded, and only then acknowledges the message.

The constraints on correctness:

- Insert the payment (a real write, not a lookup) into a strongly consistent, durable store keyed by the idempotency key **before** calling the gateway.
- Never consult a cache for keys.
- Book the ledger only after approval, and mark the payment succeeded only after booking.

The rest: checkout p99 under 1.5 s including the gateway, a replay under 100 ms; checkout 99.95% available (the gateway alone offers 99.9%), with a durable write before every answer; queue-driven retries, no single point of failure, and $2,500 a month including the finance team's three ledger replicas.

The given file declares the `shopper`, the external `gateway` (250 ms per call, up to 5k calls a second) and the `ledger` API. Its tests check, in words:

- A strong store is called before the gateway, and no eventual store is ever called.
- A replay calls a strong store, never calls the gateway or the ledger, and answers `2xx`.
- The gateway is called before the ledger, and a charged checkout writes the ledger before answering `201`.
- A strong store is called after the ledger, both in checkout and in the retry.
- A gateway failure is handled: it answers `202`, calls a queue and never waits for the ledger.
- The retry starts at a queue, calls a strong store before the gateway, and books the ledger before acknowledging.

## Back-of-the-envelope

```numbers
1k/s | checkouts at peak
≈ 1.95k/s | writes to the payments store, ~40% of one primary
≈ 950/s | gateway calls, about 19% of its limit
≈ $2,000 | a lean design with two of everything
≈ 43 GB | payment rows a day
```

**Mix.** 1k checkouts a second at peak:

| Scenario | Share | Rate |
|---|---|---|
| Charged | 94.5% | 945/s |
| Replay | 5% | 50/s |
| Gateway down | 0.5% | 5/s |

The retry worker handles the 5 a second that went pending.

**Writes to the payments store.** Every checkout inserts its key, replays included (the insert is how a replay is detected), and every charged one marks the row succeeded: 1,000 + 945 ≈ 1.95k writes a second, plus a handful from the retry worker. A relational primary takes about 5k writes a second in the model, so one runs at roughly 40%. Replicas add failover, not write capacity; no sharding needed.

**Gateway.** 945 charges plus 5 retries ≈ 950 calls a second against a 5k limit: about 19% busy. As one external system it follows the single-server queueing curve: at 19% its 250 ms becomes a little over 300 ms on average.

**Latency budget.** A charged checkout is load balancer + API + insert + gateway + ledger + update; the gateway dominates, the rest is tens of milliseconds. With a heavy-tailed hop model (an idle hop's p99 is about 2.8× its mean), the charged path lands around a second at p99, inside 1.5 s. A failed gateway call costs a fixed 1,000 ms timeout. A replay must skip the gateway to fit under 100 ms.

**Availability.** The gateway alone is 99.9%, below the 99.95% target. In Proschi a node with a fallback scenario (a success path that calls it with `-x` and still completes) takes the use case down only when the fallback is down too: roughly 1 − (1 − 0.999) × (1 − A(fallback)). A replicated queue on the fallback path lifts that limit. Everything else needs two or more replicas.

```quiz
beat-your-dependency
```

**Cost.** Services are $100 a replica, PostgreSQL $400, a queue $200, a load balancer $50; the ledger's three replicas ($300) count. Two of everything costs about $2,000 and fits; three of everything, about $2,850, does not, so add a third replica only where load needs it (an extra API replica is $100). Anything fancier (distributed SQL, a cache layer) breaks the budget.

**Storage (illustrative).** 1k rows a second is 86.4 million payment rows a day; at around 500 bytes each, about 43 GB a day. Payments must be kept, but idempotency *keys* only need to outlive any client retry; old keys can be archived.

## Concepts

### Idempotency keys under a unique constraint

An operation is **idempotent** if doing it twice has the same effect as once. `GET` and `PUT` are by definition; `POST /payments` is not. An idempotency key makes it so: the client generates a unique value per logical attempt (say, a UUID per checkout) and sends it with every retry. The server stores the key with the outcome and answers a seen key with the stored outcome instead of acting again.

Two details decide whether this works:

- **Insert, do not check.** "`SELECT` the key, then `INSERT` it if it is missing" has a race: two retries arriving together both see nothing and both charge. `INSERT … ON CONFLICT DO NOTHING RETURNING …` on a primary key is atomic: exactly one request wins the insert, the other gets a conflict and reads the stored row.
- **Strong and durable storage.** An asynchronously replicated cache can lose a key on failover, and an evicting one can forget it under memory pressure; the next retry then looks new and charges again. The key belongs in the same transactional store as the payment.

Trade-offs: every request costs a write, keys need a retention policy, and clients must generate keys correctly (a new key per *checkout*, not per *retry*). Naturally idempotent operations (set a value, delete by id) need no keys.

```proschi
title "Idempotent create"

client "Client"    [Actor]
api    "Orders API" [REST API]   x2
db     "Orders DB"  [PostgreSQL] x2

client -> api : HTTPS
api    -> db  : SQL

usecase "Create order" {
  client -> api : POST /orders Idempotency-Key k-91
  api    -> db  : INSERT order ON CONFLICT (key) DO NOTHING RETURNING *
  alt "New" {
    db    --> api    : inserted
    api   --> client : 201
  } alt "Seen before" {
    db    --> api    : conflict, stored response
    api   --> client : 200 stored response
  }
}
```

```quiz
concurrent-idempotency-keys
http-idempotent-methods
```

### Order the writes so every crash is recoverable

A payment touches three systems (your payments table, the gateway, the ledger) with no transaction across them, so the order of operations decides what a crash leaves behind. Walk through each gap:

1. **Insert the intent (status pending), then call the gateway.** After a crash following approval, the pending row tells a reconciler or retry that a charge may exist. Charging first can leave money taken with no record.
2. **Book the ledger only after approval.** Booking first would record money the gateway may decline.
3. **Mark succeeded only after booking.** A crash between charge and booking leaves the row pending, and a retry books it (the ledger deduplicates on the payment id). Marking succeeded first would hide an unbooked charge, and a replay would happily return "succeeded".

```callout takeaway A small state machine
`pending` → `succeeded`, or `pending` → `failed`, where **every transition happens only after the side effect it describes is safe**. When not to bother: if all the data lives in one database, a single transaction does this for you.
```

### Ambiguous failures and queue-driven retries

```callout pitfall A timeout is not a decline
It means "I don't know": the charge may have gone through. A `502` makes the shopper retry or abandon a payment that may have succeeded; retrying inline adds a second timeout and ties checkout availability to the gateway.
```

The robust answer: keep the row pending, answer `202` with a pending status (the app can poll or be notified), and queue a retry message. A worker locks the row, charges again **with the same idempotency key** (the gateway deduplicates, returning the first charge if it happened), books the ledger, marks the row succeeded, and only then acknowledges. If it crashes before the ack, the queue redelivers; every step is idempotent, so that is safe.

One subtlety: the row and the message are two systems, and a crash between them leaves the row pending with nothing queued. The **transactional outbox** fixes that: write the message to an outbox table in the same database transaction, and relay it to the queue afterwards. A periodic sweep of old pending rows is a cheaper safety net.

````deepdive In Proschi: retry from a queue
```proschi
title "Retry from a queue"

queue  "Retry Queue"  [AWS SQS]    x2
worker "Retry Worker" [AWS ECS]    x2
db     "Jobs DB"      [PostgreSQL] x2
ext    "Provider"     [Stripe]

queue  -> worker : deliver
worker -> db     : SQL
worker -> ext    : call

usecase "Retry job" {
  queue   -> worker : RetryJob k-91
  worker  -> db     : SELECT job FOR UPDATE
  db     --> worker : pending
  worker  -> ext    : POST /charges Idempotency-Key k-91
  ext    --> worker : 201
  worker  -> db     : UPDATE job done
  db     --> worker : ok
  worker --> queue  : ack
}
```
````

```quiz
transactional-outbox
idempotent-consumer-crash
```

## Designing it step by step

**Step 1: scope.** Ask what "never twice" covers (one checkout, identified by the client's key), how long retries can arrive (minutes to a day), what the gateway guarantees (it accepts idempotency keys too), and what the shopper sees when the outcome is unknown (pending, not an error). Rates: 1k checkouts a second, 5% retries, 0.5% gateway failures.

**Step 2: high-level design.** Shopper → load balancer → payments API → payments store (insert intent) → gateway → ledger → payments store (mark succeeded) → `201`. Beside it: API → retry queue → worker → same steps. Pick the store by the constraints: strong, durable, unique constraints, transactions. PostgreSQL fits, and the envelope says one primary handles the write rate.

**Step 3: deep dive.**

*The three scenarios.* All start with the same insert. A new key continues to the gateway; a conflict returns the stored response at once (no gateway, no ledger, still a durable write); a failed gateway call (`-x gateway`) leads to an enqueue and `202`, without waiting for the ledger.

*The worker.* It starts at the queue, locks and reads the row, charges with the same key, books, marks succeeded, acks. That ordering is what the retry tests check.

```deepdive Why not a scheduler that polls for pending rows?
It works, and many systems keep one as a safety net. As the main mechanism it adds polling load on the primary, up to one poll interval of delay, and careful locking (`FOR UPDATE SKIP LOCKED`) so two pollers do not take the same row. A queue gives delivery, redelivery and backoff for free.
```

*Sizing.* Start from two replicas of each component you run. Check that the API and the worker stay well under 70%, the primary's writes fit, and the bill including the ledger stays under budget.

**Step 4: wrap-up.** Mention reconciliation (a daily job comparing gateway settlements with the ledger), refunds as their own idempotent operation, key retention, and fraud checks before the charge. Note what the model omits: real gateway retries and rate limits, partitions between your API and the gateway, and double-entry rules in the ledger.

## Common mistakes

**Check, then insert** (`wrong/check-then-insert`). The API `SELECT`s the key and inserts only when it is missing. In production two concurrent retries both see no row and both charge. In Proschi the symptom is related: a replay only reads, so the checkout is not durable on every path, and `Checkout is durable` fails.

**Idempotency keys in Redis** (`wrong/idempotency-keys-in-redis`). Fast and tempting (`SETNX`), but replication is asynchronous and memory evictable: a failover or eviction forgets keys, and the next retry charges again. The test "The payment is recorded in a strong store before the card is charged" fails, along with every test that needs a strong store and `Checkout is durable`.

**Replay asks the gateway** (`wrong/replay-asks-gateway`). A replay looks the charge up at the gateway instead of returning the stored response: mostly correct, but slow (250 ms on the fast path), and it adds gateway load exactly when clients retry. It fails `p99 of Checkout scenario Replay < 100 ms`, and also "A retry returns the stored result and charges nothing", because the replay calls the gateway.

**A scheduler polls pending payments** (`wrong/scheduler-polls-pending`). Workers sweep the table instead of consuming a queue: it works, but gives up the queue's delivery guarantees and adds polling load and lock contention. It fails "Pending charges are retried from a queue with the same key".

**Succeeded before the ledger** (`wrong/succeeded-before-ledger`). Marked succeeded, then booked: a crash in between leaves a payment that replays as succeeded with no money booked, and nothing ever retries it. It fails "The payment is marked succeeded only once the money is booked".

**Also common:** generating the idempotency key on the server (a retry gets a new key), retrying the gateway *without* the key, and treating timeouts as declines.

## In the interview

```callout interview Name the failure, then the four rules
Start with: "The client retries, and a timeout does not tell us whether the card was charged." Then: insert the intent under a unique key first, pass the same key to the gateway, book only after approval and mark succeeded only after booking, and answer pending plus queue a retry when unsure.
```

Likely follow-ups:

- *Two retries arrive at the same millisecond?* The unique constraint lets exactly one insert win; the other reads the stored row (or sees pending and returns `202`/`409`).
- *What if the key is reused with a different amount?* Store a hash of the request with the key and reject a mismatch.
- *Why not Redis for speed?* The insert costs milliseconds next to a 250 ms gateway, and correctness needs durable, strongly consistent storage.
- *How does the shopper learn the result?* Poll the payment, or get a webhook or push when the worker finishes.
- *Exactly-once across services?* Not possible in general; at-least-once delivery plus idempotent steps gives effectively-once.

## Further reading

- [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency), Stripe engineering blog: why idempotency keys, and how clients should retry with backoff and jitter.
- [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys), Brandur Leach: a detailed walk-through of storing and resuming idempotent requests in Postgres.
- [Avoiding Double Payments in a Distributed Payments System](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb), Airbnb Engineering: Orpheus, their idempotency framework.
- [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/), IETF HTTPAPI working group draft: the header standardised.
- [Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox), Chris Richardson: writing a message atomically with a database change.
- [The System Design Primer: Consistency patterns](https://github.com/donnemartin/system-design-primer#consistency-patterns): weak, eventual and strong consistency, and why the key store must be strong.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "Architectures of Finance, Banking, and Payment Systems" list collects payment case studies (Airbnb, Etsy, Monzo and others).
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu and Sahn Lam): the chapters "Payment System" and "Digital Wallet".
