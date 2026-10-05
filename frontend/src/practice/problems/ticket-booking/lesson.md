# Ticket booking: selling every seat exactly once

## What you'll learn

- Why a seat map in a cache can never decide who gets a seat, and which store can.
- How a single **conditional write** turns a race between two fans into a clean winner and a clean `409`.
- How to make holds expire without a cleanup job, and why the order "check hold → charge → book" matters.
- Why read replicas do nothing for a write-bound database, and how to size shards from the write rate.
- How to keep the 75% of traffic that only looks at seats away from the store that decides them.

## The problem, explained

A stadium concert goes on sale at 10:00 and tens of thousands of fans race for seats. Three use cases:

- **View seats**: show the seat map of an event. It may be a couple of seconds stale; nobody minds if a seat that was taken one second ago still looks free, as long as they cannot actually get it.
- **Hold seat**: reserve one seat for one fan for 10 minutes. Either the seat was free (or its old hold ran out) and the fan gets `201`, or someone else has it and the fan gets `409 Conflict`.
- **Confirm booking**: the fan pays through an external payment provider. If the hold is still theirs and the card is approved, the seat is booked (`201`). If the card is declined, they get `402` and keep the hold until it expires. If the hold already expired, they get `409` and are **never charged**.

The non-functional requirements are the interesting part. Two fans must never end up with the same seat, a fan must never pay without a valid hold, and a seat must never be booked without a payment. On top of that: p99 under 50 ms for the map, 130 ms for a hold and 1.5 s for a confirmation (the provider alone takes about 250 ms), durable holds and bookings, survive the loss of any machine, and stay under $4,500 a month.

The given file fixes two nodes. The `fan` is the client. The `payments` provider is an external system with a capacity override: 250 ms per call and up to 5k calls a second. You cannot make it faster; you can only call it less often and at the right moment. The given also fixes the traffic (20k seat-map loads, 6k hold attempts and 500 confirmations a second) and four flow tests:

- Seat maps come from a cache, and a cache hit never touches a database.
- Every hold scenario writes a strongly consistent store, never calls an eventually consistent one (not even to invalidate the map), and "Taken" answers `409`.
- A confirmation reads the strong store before calling `payments`, never waits for an eventual store, and the "Hold expired" scenario never reaches `payments`.
- In "Paid", the strong store is written **after** the payment and before the response.

The latency, failure and cost limits then check that the design is sized to carry those ideas.

## Back-of-the-envelope

Start with the rates and split them by scenario, because each scenario touches different nodes.

| Flow | Rate | What it costs downstream |
|---|---|---|
| View seats, cache hit (97%) | 19.4k rps | cache reads only |
| View seats, cache miss (3%) | 600 rps | 600 database reads + 600 cache writes |
| Hold seat (all scenarios) | 6k rps | 6k database **writes**, won or lost |
| Confirm, check hold | 500 rps | 500 database reads |
| Confirm, Paid (90%) | 450 rps | 450 payment calls + 450 database writes |
| Confirm, declined (7%) | 35 rps | 35 payment calls |

A few things jump out.

**Every hold attempt is a write.** Even the 60% that lose: the database has to evaluate the condition and decide. With the bookings, that is about 6.45k writes a second. The simulation's PostgreSQL profile takes 5k writes per second *per primary*. Writes per shard ÷ capacity per primary: 6.45k ÷ 5k = 1.3, so one primary is saturated, and two shards bring it to about 65%. Read replicas add read capacity only; in the model (and in real single-primary databases) every write still lands on the one primary of its shard.

**The service carries everything.** Every request passes through it: 20k + 6k + 0.5k = 26.5k rps. At about 2k rps per service replica, you need 26.5k ÷ 2k ≈ 13 replicas just to stay below 100%. The model adds queueing delay as utilisation climbs (one replica at 90% waits about ten times its base latency), so you want to stay under roughly 70%: 26.5k ÷ (2k × 0.7) ≈ 19. Then remember "survive any node failure" re-runs the analysis with one replica fewer, and the latency limits must still hold.

**The cache is barely working**: 20.6k operations a second against 100k per Redis replica. Two replicas are for availability, not throughput.

**The payment provider is not a bottleneck** (485 calls against 5k), but its 250 ms dominates the confirmation's p99: with the model's tail of roughly 2.8× the mean for an idle hop, one call already lands near a second at p99. Hence the 1.5 s limit, and no room for a second slow call.

**Cost.** Each replica of each shard costs a flat monthly price: $100 per service, $150 per cache, $400 per PostgreSQL replica, $50 per load balancer. A sharded PostgreSQL with a replica per shard is 4 × $400 = $1,600; the service fleet is the other big line. The $4,500 budget leaves room for one sensible design and not much else, which is the point: "just add replicas everywhere" fails on cost.

## Concepts

### Conditional writes: let the database pick the winner

The naive hold is *read, then write*: look at the seat, see "free", write "held". Between the read and the write another fan does exactly the same thing, and both believe they won. This is the classic **check-then-act race**.

A **conditional write** folds the check into the write, so the database evaluates both atomically under its own row lock:

```sql
UPDATE seats SET status = 'held', held_by = :fan, hold_expires = now() + interval '10 minutes'
WHERE seat_id = :s AND (status = 'free' OR hold_expires < now());
```

One row changed means you hold the seat; zero rows means someone else got it first. No window in between: the row lock serialises two concurrent `UPDATE`s, and the second re-evaluates the `WHERE` clause after the first commits and finds the seat no longer free.

This only works in a **strongly consistent** store, one where a condition sees every write committed before it. In an eventually consistent store two replicas can each accept a write the other has not seen yet.

Trade-off: a very hot row serialises its writers. Seats are fine, since each seat is its own row; a single counter decremented by a whole crowd is not (see the Flash Sale lesson).

In Proschi, the generic pattern looks like a single write whose result splits into scenarios:

```proschi
title "Conditional write"
user "User"  [Actor]
api  "API"   [REST API] x2
db   "Store" [PostgreSQL] x2
user -> api
api -> db : SQL

usecase "Claim item" {
  user -> api : POST /items/42/claim
  api  -> db  : UPDATE item SET owner WHERE owner IS NULL
  alt "Claimed" when "one row changed" {
    db  --> api  : 1 row
    api --> user : 201
  } alt "Already claimed" when "zero rows changed" {
    db  --> api  : 0 rows
    api --> user : 409
  }
}
```

### Holds that expire by themselves

A hold is a **lease**: a lock with a deadline. There are two ways to end it. One is a background job that scans for expired holds and releases them. The other is to store the deadline in the row and let the conditional write treat an expired hold as free (that is the `OR hold_expires < now()` above).

The deadline approach has no moving parts. If a sweeper is late or down, seats stay stuck; with a deadline in the row, the next fan simply overwrites the expired hold. A tidy-up job may still run, but correctness never depends on it.

When not to use it: if expiry must trigger a side effect (refund a deposit, notify someone), something still has to run at expiry time.

### Optimistic versus pessimistic locking, and why not Redis

**Pessimistic locking** takes a lock before acting (`SELECT … FOR UPDATE` inside a transaction, or a distributed lock service) and holds it while working. **Optimistic locking** acts without a lock and fails if something changed in the meantime, usually by checking a `version` column in the `WHERE` clause. The conditional `UPDATE` is optimistic in spirit: it never waits for a fan to make up their mind, it just accepts or rejects one atomic write.

Holding a database lock for the 10 minutes a fan spends paying would be absurd, which is why the hold is data (a deadline in the row), not a lock held open.

A popular shortcut is `SET seat:A-12 fan NX EX 600` in Redis: set only if absent, with a 10-minute TTL. But Redis replication is asynchronous; if the primary fails before a replica copied the key, the promoted replica has no lock and the next fan gets the same seat. Kleppmann's essay (below) explains why a lock used for *correctness* needs real consistency guarantees or fencing tokens. The simplest fix: let the database that stores the seat be the lock.

### Sharding for writes

**Sharding** splits a table across independent databases, each owning a subset of keys and having its own primary. It is the only way to add write capacity to a single-primary database. The price: queries that span shards get harder, and you pay for a full replica set per shard.

The key question is the **shard key**. Here every operation touches exactly one seat, so `(eventId, seatId)` is a natural key: a hold and its booking always land on the same shard, and no transaction ever crosses shards. Sharding by `eventId` alone would put one entire concert, the hot one, on a single shard and defeat the purpose.

```proschi
title "Sharded writes"
api "API"   [REST API]   x2
db  "Store" [PostgreSQL] x2 "Partitioned by item id"
api -> db : SQL
capacity {
  db shards 2
}
```

## Designing it step by step

**1. Scope the problem.** Confirm the three use cases and the guarantees: no double booking, no charge without a hold, no booking without a charge. Ask how stale the seat map may be (a couple of seconds) and how long a hold lasts (10 minutes). Ask about scale: 20k map loads, 6k holds and 500 confirmations a second at the peak. Write those numbers on the board; the whole design falls out of them.

**2. High-level design.** A load balancer, a stateless booking service, a cache for seat maps, one strongly consistent database for seats, holds and bookings, and the external payment provider. Draw three flows:

- *View seats*: service → cache; on a miss, read the database and refill the cache with a short TTL. Use an async write for the refill so the fan does not wait for it.
- *Hold seat*: service → database, one conditional `UPDATE`. Two outcomes, two scenarios. Nothing else on this path.
- *Confirm booking*: service → database to check the hold is still the fan's → payment provider → database again to mark the seat booked and insert the booking.

**3. Deep dive.** This is where you spend most of the interview.

*Who decides?* Walk through the race with two fans and show that the conditional write cannot let both win. Then explain why the cache must stay off the hold path entirely, even for invalidation: a `DEL` of the cached map on every hold puts an eventually consistent store on the critical path and buys nothing, because the map rebuilt from a lagging replica can be stale anyway. A short TTL keeps the map close enough.

*Ordering in confirm.* Check the hold first, so an expired hold is rejected before anyone is charged (and that scenario never calls the provider). Charge next. Book last, with another conditional write (`WHERE holdId = … AND still held by this fan`) so that a payment that raced past the deadline does not overwrite someone else's fresh hold. Pass the hold id as the **idempotency key** to the provider, so a retried confirmation never charges twice. If the final write finds the hold gone, refund: that is a rare, recoverable case, whereas booking before paying leaves seats nobody paid for.

*Write capacity.* Now count writes (about 6.5k a second) against what one primary takes. Explain that read replicas do not help and that you shard by seat. Mention the alternative: a partitioned store that is still strongly consistent (Spanner, CockroachDB, or DynamoDB with conditional writes and strongly consistent reads). In this exercise the simulation tags DynamoDB as an eventual store, so the test that forbids eventual stores on the hold path rejects it.

*Sizing.* Size the service from the total request rate with headroom for one lost replica, keep the cache at two replicas, and check the bill.

**4. Wrap up.** Summarise the guarantees and where each is enforced. With more time: a virtual waiting room for a bigger crowd, and a reconciliation job matching payments to bookings.

## Common mistakes

**Checking the cache before holding** (`wrong/hold-checks-cache`). It looks like a harmless optimisation: read the seat map, and if the seat is shown as taken, skip the database. But it is the same cache that may be two seconds stale, and it adds an eventually consistent store to the hold path. In production it occasionally turns away fans for seats that are free, and if anyone ever trusts the cached "free" without the conditional write, it sells a seat twice. Caught by **"A strong store, not the cache, decides who holds a seat"** (the hold calls an eventual store).

**Holds in DynamoDB** (`wrong/holds-in-dynamodb`). Partitioned NoSQL stores scale writes beautifully, which is tempting with 6.5k writes a second. But default reads are eventually consistent, and the decision "who holds this seat" must be read and written consistently. Real DynamoDB does offer conditional writes and strongly consistent reads; in the simulation it is tagged as an eventual store, and this problem asks you to put the decision in a store that is strong by default. Caught by **"A strong store, not the cache, decides who holds a seat"**, and the confirmation tests fail for the same reason.

**Book before charging** (`wrong/book-before-charge`). Write the booking, then call the provider. When the card is declined you now have a booked seat nobody paid for, and you need a compensating write to undo it, which can itself fail. Caught by **"A seat is booked only once it is paid"**, which wants the last strong-store call of "Paid" after `payments`.

**Read replicas instead of shards** (`wrong/replicas-instead-of-shards`). Four PostgreSQL replicas cost the same as two shards of two, but every write still goes to one primary: 6.5k writes on a 5k primary is about 129% utilisation, and a saturated node fails every latency requirement of the use cases that touch it. Caught by **p99 of Hold seat < 130 ms** (and the other latency limits and the failure test along with it).

Classic mistakes beyond the tests: holding a `SELECT … FOR UPDATE` lock while the fan pays, a cleanup job as the only way holds expire, and no idempotency key on the payment call.

## In the interview

Open with the invariant, not the boxes: "Each seat is sold at most once, nobody pays without a hold, nobody gets a seat without paying." Then say which component enforces each one. Interviewers at this level are checking whether you can find the race, not whether you can draw a load balancer.

Likely follow-ups and short answers:

- *What if two fans click at exactly the same millisecond?* The row lock serialises the two updates; the second re-evaluates the condition and changes zero rows, so it returns `409`.
- *What if the payment succeeds but the booking write fails?* Retry the write; it is idempotent on the hold id. If the hold is truly gone, refund using the same idempotency key. Log it for reconciliation.
- *The crowd is 10× bigger.* Put a virtual waiting room in front of the sale so only as many fans enter as the booking path can serve (see the Flash Sale lesson), and add shards.
- *Why not one shard per event?* The hottest event is the one that matters, and it would sit on one primary.
- *How about general admission (no seat numbers)?* Then it is a counter, not a set of rows, and you are in flash-sale territory: one hot row, so you need to shape the load before it reaches the database.

## Further reading

- [System Design Primer: Consistency patterns](https://github.com/donnemartin/system-design-primer#consistency-patterns) — weak, eventual and strong consistency in a few paragraphs.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding) — what sharding buys and costs, including lopsided shards.
- [PostgreSQL documentation: Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — row-level locks, `FOR UPDATE` and how concurrent writers to one row are serialised.
- Martin Kleppmann, [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (2016) — why a lock used for correctness needs more than a Redis key with a TTL, and what fencing tokens are.
- Brandur Leach, [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) (Stripe) — idempotency keys for the payment call.
- [Virtual Waiting Room on AWS](https://docs.aws.amazon.com/solutions/latest/virtual-waiting-room-on-aws/welcome.html) — a reference implementation for absorbing on-sale crowds, with ticket sales as a named use case.
- Alex Xu and Sahn Lam, *System Design Interview – An Insider's Guide, Volume 2*, chapter "Hotel Reservation" — the same reservation-without-double-booking problem with rooms instead of seats.
