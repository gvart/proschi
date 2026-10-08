# Ticket booking: selling every seat exactly once

```tldr
A cached seat map can be stale, so **a cache never decides who gets a seat**: one **conditional write** in a strongly consistent database does, under its row lock. Holds carry their own **deadline**, confirmation goes **check hold → charge → book**, and 6.45k writes a second mean you **shard**, because read replicas add no write capacity.
```

## What you'll learn

- Why a seat map in a cache can never decide who gets a seat, and which store can.
- How a single **conditional write** turns a race between two fans into a clean winner and a clean `409`.
- How to make holds expire without a cleanup job, and why the order "check hold → charge → book" matters.
- Why read replicas do nothing for a write-bound database, and how to size shards from the write rate.
- How to keep the 75% of traffic that only looks at seats away from the store that decides them.

## The problem, explained

A stadium concert goes on sale at 10:00 and tens of thousands of fans race for seats. Three use cases:

- **View seats**: show an event's seat map. It may be a couple of seconds stale, as long as nobody can actually get a seat taken a second ago.
- **Hold seat**: reserve one seat for one fan for 10 minutes. If the seat was free (or its old hold ran out) the fan gets `201`; if someone else has it, `409 Conflict`.
- **Confirm booking**: the fan pays through an external payment provider. Hold still theirs, card approved: booked (`201`). Card declined: `402`, keeping the hold until it expires. Hold expired: `409`, and **never charged**.

The non-functional requirements are the interesting part: two fans never get the same seat, nobody pays without a valid hold, and no seat is booked without a payment. On top of that:

- p99 under 50 ms for the map, 130 ms for a hold and 1.5 s for a confirmation (the provider alone takes about 250 ms);
- holds and bookings are durable;
- it survives the loss of any machine;
- it costs under $4,500 a month.

The given file fixes two nodes: the `fan` (the client) and the `payments` provider, an external system with a capacity override of 250 ms per call and up to 5k calls a second. You cannot make it faster, only call it less often and at the right moment. The given also fixes the traffic (20k seat-map loads, 6k hold attempts and 500 confirmations a second) and four flow tests:

- Seat maps come from a cache, and a cache hit never touches a database.
- Every hold scenario writes a strongly consistent store, never calls an eventually consistent one (not even to invalidate the map), and "Taken" answers `409`.
- A confirmation reads the strong store before calling `payments`, never waits for an eventual store, and the "Hold expired" scenario never reaches `payments`.
- In "Paid", the strong store is written **after** the payment and before the response.

The latency, failure and cost limits check the design is sized to carry them.

## Back-of-the-envelope

```numbers
6.45k / s | database **writes** (every hold, won or lost, plus bookings)
5k / s | writes one PostgreSQL primary takes
26.5k rps | through the booking service
≈ 19 | service replicas to stay under 70%
≈ 700 ms | p99 of one payment call
```

Split the rates by scenario, because each scenario touches different nodes.

| Flow | Rate | What it costs downstream |
|---|---|---|
| View seats, cache hit (97%) | 19.4k rps | cache reads only |
| View seats, cache miss (3%) | 600 rps | 600 database reads + 600 cache writes |
| Hold seat (all scenarios) | 6k rps | 6k database **writes**, won or lost |
| Confirm, check hold | 500 rps | 500 database reads |
| Confirm, Paid (90%) | 450 rps | 450 payment calls + 450 database writes |
| Confirm, declined (7%) | 35 rps | 35 payment calls |

**Every hold attempt is a write**, even the 60% that lose: the database has to evaluate the condition and decide. With the 450 bookings, that is about 6.45k writes a second. The simulation's PostgreSQL takes 5k writes a second *per primary*, so one primary is at 6.45k ÷ 5k ≈ 1.3: saturated. Two shards bring each to about 65%; read replicas add read capacity only, since every write still lands on its shard's one primary (in the model and in real single-primary databases).

**The service carries everything**: 20k + 6k + 0.5k = 26.5k rps. At about 2k rps per replica, 26.5k ÷ 2k ≈ 13 replicas just stay below 100%. The model adds queueing delay as utilisation (how busy a node is) climbs: a replica at 90% waits about ten times its base latency. Staying under roughly 70% takes 26.5k ÷ (2k × 0.7) ≈ 19, and "survive any node failure" re-runs the analysis with one replica fewer.

**The cache is barely working**: 20.6k operations a second against 100k per Redis replica. Its two replicas are for availability.

**The payment provider is not a bottleneck** (485 calls against 5k), but its 250 ms dominates the confirmation's p99: an idle hop's p99 is about 2.8× its mean, so one call is about 700 ms at p99. Hence the 1.5 s limit, with no room for a second slow call.

**Cost.** Each replica of each shard has a flat monthly price: $100 per service, $150 per cache, $400 per PostgreSQL replica, $50 per load balancer. Two PostgreSQL shards with a replica each are 4 × $400 = $1,600; the service fleet is the other big line. The $4,500 budget fits one sensible design: "just add replicas everywhere" fails on cost.

## Concepts

### Conditional writes: let the database pick the winner

The naive hold is *read, then write*: see the seat "free", write "held". Between the two, another fan does the same, and both believe they won: the classic **check-then-act race**.

A **conditional write** puts the check inside the write, so the database does both atomically (as one step) under its own row lock:

```sql
UPDATE seats SET status = 'held', held_by = :fan, hold_expires = now() + interval '10 minutes'
WHERE seat_id = :s AND (status = 'free' OR hold_expires < now());
```

One row changed: you hold the seat; zero rows: someone else got it first. The row lock runs two concurrent `UPDATE`s one after the other, and the second re-checks the `WHERE` clause after the first commits, finding the seat taken.

```callout takeaway
This only works in a **strongly consistent** store, one where a condition sees every write committed before it. In an eventually consistent store, two replicas can each accept a write the other has not seen yet.
```

Trade-off: writers to a very hot row wait in line. Seats are fine, each its own row; a single counter decremented by a whole crowd is not (see the Flash Sale lesson).

````deepdive The pattern in Proschi
A single write whose result splits into scenarios:

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
````

```quiz
conditional-stock-update
cache-cannot-decide
```

### Holds that expire by themselves

A hold is a **lease**: a lock with a deadline. It can end through a background job that scans for expired holds and releases them, or through a deadline in the row that the conditional write treats as free once passed (the `OR hold_expires < now()` above).

The deadline has no moving parts. If a sweeper is late or down, seats stay stuck; with a deadline, the next fan simply overwrites the expired hold. A tidy-up job may still run, but correctness never depends on it.

When not to use it: if expiry must trigger a side effect (refund a deposit, notify someone), something still has to run at expiry time.

### Optimistic versus pessimistic locking, and why not Redis

**Pessimistic locking** takes a lock before acting (`SELECT … FOR UPDATE` in a transaction, or a distributed lock service) and holds it while working. **Optimistic locking** acts without a lock and fails if something changed meanwhile, usually by checking a `version` column in the `WHERE` clause. The conditional `UPDATE` is optimistic in spirit: it never waits for a fan to decide, it accepts or rejects one atomic write.

Holding a database lock for the 10 minutes a fan spends paying would be absurd, so the hold is data (a deadline in the row), not a lock held open.

```callout pitfall The Redis lock shortcut
`SET seat:A-12 fan NX EX 600` (set only if absent, 10-minute TTL) looks like a lock, but Redis replication is asynchronous. If the primary fails before a replica copied the key, the promoted replica has no lock, and the next fan gets the same seat. Kleppmann's essay (below) explains why a lock used for *correctness* needs real consistency guarantees or fencing tokens. The simplest fix: **let the database that stores the seat be the lock**.
```

```quiz
pessimistic-locking-when
```

### Sharding for writes

**Sharding** splits a table across independent databases, each owning a subset of keys with its own primary: the only way to add write capacity to a single-primary database. The price: cross-shard queries get harder, and every shard needs a full replica set.

The key question is the **shard key**. Every operation here touches one seat, so `(eventId, seatId)` is natural: a hold and its booking land on the same shard, and no transaction crosses shards. Sharding by `eventId` alone would put the one hot concert on a single shard.

```proschi
title "Sharded writes"
api "API"   [REST API]   x2
db  "Store" [PostgreSQL] x2 "Partitioned by item id"
api -> db : SQL
capacity {
  db shards 2
}
```

```quiz
replicas-do-not-scale-writes
shards-for-write-rate
```

## Designing it step by step

**1. Scope the problem.** Confirm the three use cases and the guarantees: no double booking, no charge without a hold, no booking without a charge. Ask how stale the map may be (a couple of seconds), how long a hold lasts (10 minutes), and the peak: 20k map loads, 6k holds and 500 confirmations a second. Write those on the board; the design falls out of them.

**2. High-level design.** A load balancer, a stateless booking service, a seat-map cache, one strongly consistent database for seats, holds and bookings, and the payment provider. Draw three flows:

- *View seats*: service → cache; on a miss, read the database and refill the cache with a short TTL, asynchronously.
- *Hold seat*: service → database, one conditional `UPDATE`. Two outcomes, two scenarios. Nothing else on this path.
- *Confirm booking*: service → database to check the hold is still the fan's → payment provider → database again to mark the seat booked and insert the booking.

**3. Deep dive.** This is where you spend most of the interview.

*Who decides?* Walk through the race with two fans and show the conditional write cannot let both win. Then explain why the cache stays off the hold path, even for invalidation: a `DEL` of the cached map on every hold puts an eventually consistent store on the critical path, and buys nothing, since a map rebuilt from a lagging replica can be stale anyway. A short TTL keeps the map close enough.

*Ordering in confirm.* Check the hold first, so an expired hold is rejected before any charge (that scenario never calls the provider). Charge next. Book last, with another conditional write (`WHERE holdId = … AND still held by this fan`), so a payment that raced past the deadline cannot overwrite someone else's fresh hold.

```callout tip Idempotency key
Pass the hold id to the provider as the **idempotency key** (a unique id that lets the provider recognise a retry of the same request), so a retried confirmation never charges twice. If the final write finds the hold gone, refund: a rare, recoverable case, whereas booking before paying leaves seats nobody paid for.
```

*Write capacity.* Count writes (about 6.5k a second) against one primary's capacity, explain why read replicas do not help, and shard by seat.

```deepdive Strongly consistent partitioned stores
A partitioned store that is still strongly consistent is the alternative: Spanner, CockroachDB, or DynamoDB with conditional writes and strongly consistent reads. In this exercise the simulation tags DynamoDB as an eventual store, so the test that forbids eventual stores on the hold path rejects it.
```

*Sizing.* Size the service from the total request rate with headroom for one lost replica, keep the cache at two replicas, and check the bill.

**4. Wrap up.** Summarise the guarantees and where each is enforced. With more time: a virtual waiting room for bigger crowds, and a reconciliation job matching payments to bookings.

## Common mistakes

**Checking the cache before holding** (`wrong/hold-checks-cache`). A harmless-looking optimisation: if the seat map shows the seat taken, skip the database. But that cache may be two seconds stale, and it puts an eventually consistent store on the hold path. In production it turns fans away from free seats, and if anyone ever trusts the cached "free" without the conditional write, it sells a seat twice. Caught by **"A strong store, not the cache, decides who holds a seat"** (the hold calls an eventual store).

**Holds in DynamoDB** (`wrong/holds-in-dynamodb`). Partitioned NoSQL stores scale writes well, tempting at 6.5k writes a second. But default reads are eventually consistent, and "who holds this seat" must be read and written consistently. Real DynamoDB offers conditional writes and strongly consistent reads; the simulation tags it as eventual, and this problem wants the decision in a store that is strong by default. Caught by **"A strong store, not the cache, decides who holds a seat"**, and the confirmation tests fail for the same reason.

**Book before charging** (`wrong/book-before-charge`). Write the booking, then call the provider. A declined card leaves a booked seat nobody paid for, and the compensating write to undo it can itself fail. Caught by **"A seat is booked only once it is paid"**, which wants the last strong-store call of "Paid" after `payments`.

**Read replicas instead of shards** (`wrong/replicas-instead-of-shards`). Four PostgreSQL replicas cost the same as two shards of two, but every write still goes to one primary: 6.5k writes on a 5k primary is about 129% utilisation, and a saturated node fails the latency requirement of every use case that touches it. Caught by **p99 of Hold seat < 130 ms** (and the other latency limits and the failure test with it).

Classic mistakes beyond the tests: holding a `SELECT … FOR UPDATE` lock while the fan pays, a cleanup job as the only way holds expire, and no idempotency key on the payment call.

## In the interview

```callout interview Open with the invariant, not the boxes
"Each seat is sold at most once, nobody pays without a hold, nobody gets a seat without paying." Then say which component enforces each one. Interviewers at this level are checking whether you can find the race, not whether you can draw a load balancer.
```

Likely follow-ups and short answers:

- *Two fans click in the same millisecond?* The row lock serialises the updates; the second re-evaluates the condition, changes zero rows and returns `409`.
- *The payment succeeds but the booking write fails?* Retry the write; it is idempotent on the hold id. If the hold is truly gone, refund with the same idempotency key, and log it for reconciliation.
- *The crowd is 10× bigger.* Put a virtual waiting room in front of the sale so only as many fans enter as the booking path can serve (see the Flash Sale lesson), and add shards.
- *Why not one shard per event?* The hottest event is the one that matters, and it would sit on one primary.
- *General admission (no seat numbers)?* Then it is a counter, not a set of rows: flash-sale territory, one hot row, so shape the load before it reaches the database.

## Further reading

- [System Design Primer: Consistency patterns](https://github.com/donnemartin/system-design-primer#consistency-patterns) — weak, eventual and strong consistency in a few paragraphs.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding) — what sharding buys and costs, including lopsided shards.
- [PostgreSQL documentation: Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — row-level locks, `FOR UPDATE` and how concurrent writers to one row are serialised.
- Martin Kleppmann, [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (2016) — why a lock used for correctness needs more than a Redis key with a TTL, and what fencing tokens are.
- Brandur Leach, [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) (Stripe) — idempotency keys for the payment call.
- [Virtual Waiting Room on AWS](https://docs.aws.amazon.com/solutions/latest/virtual-waiting-room-on-aws/welcome.html) — a reference implementation for absorbing on-sale crowds, with ticket sales as a named use case.
- Alex Xu and Sahn Lam, *System Design Interview – An Insider's Guide, Volume 2*, chapter "Hotel Reservation System" — the same reservation-without-double-booking problem with rooms instead of seats.
