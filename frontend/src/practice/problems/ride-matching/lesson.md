# Ride matching: a live map of 400,000 moving drivers

## What you'll learn

- Why "only the latest value matters" changes which store you pick for a write-heavy workload.
- How geospatial indexes (geohash, quadtrees, S2, H3, Redis `GEO`) answer "nearest free driver within 3 km" quickly.
- How to separate fast, disposable state (positions) from slow, precious state (trips), and why each gets a different store.
- How to size a fleet for "survive any node failure", where the nodes that are left must carry the whole load.
- Why the driver's offer goes through a queue that the rider never waits for.

## The problem, explained

This is the dispatch core of a ride-hailing app like Uber or Lyft. Two kinds of users talk to it:

- **Drivers** keep the app open while they are online. Every 4 seconds, the phone reports its position (`lat`, `lng`, heading). That is the **Update location** use case. Only the newest position matters; nobody needs the history for matching.
- **Riders** ask for a ride from a pickup point. That is **Request ride**, with two outcomes. `"Matched"`: a free driver is within 3 km, so a trip is created and stored, the rider gets `201` with the trip and driver, and the driver gets the offer through a queue. `"No driver nearby"`: nobody is free within 3 km, the rider gets `404`, and no trip is created.

The non-functional requirements: p99 of a location update under 50 ms and of a ride request under 300 ms; ride requests available 99.9% of the time; a trip is never lost once the rider was told about it and it lives in a database (it is billed later); the trip is the driver's "lock", so it must live in a strongly consistent store; the offer goes through a queue; losing any machine, including a node of the location store, must not stop matching; at most $10,000 a month.

The given file declares only the two actors and the traffic: **100k location updates a second** and **2k ride requests a second**, 5% of which find nobody. Everything else is yours.

The tests encode four ideas:

- Location updates start at the driver, write a cache-kind store (the live map) before answering, and **never** call a database.
- Every ride request searches the live map, does so before touching any database, and the `"No driver nearby"` case never reaches a database and answers `404`.
- A matched ride writes a strongly consistent database before answering `201`.
- The matched ride sends to a queue but never waits for it.

## Back-of-the-envelope

The location rate comes from fleet size and update interval: 400k drivers ÷ 4 s = **100k writes a second**. Ride requests are 2k a second; that is 50 times fewer, and that asymmetry is the whole problem.

| Flow | Rate | Kind of operation |
|---|---|---|
| Location updates | 100k rps | overwrite one key per driver |
| Geo searches (every ride request) | 2k rps | read: nearest within 3 km |
| Trips created (95% of requests) | 1.9k rps | durable, strongly consistent insert |
| Offers to drivers | 1.9k rps | async message |

**Could a relational database take the locations?** The simulation's PostgreSQL takes 5k writes a second on its one primary, and read replicas do not add write capacity. 100k ÷ 5k = 20 shards at 100% utilisation, closer to 30 if you want headroom. Each shard is a full replica set, at least two replicas at $400 each. Even at the bare minimum of 20-odd shards that is well over $16k a month, for data that is stale four seconds after it is written.

**An in-memory geo store.** Redis takes about 100k operations a second per node in the model. 100k updates + 2k searches ≈ 102k on the store. Two nodes run at about 50% each, but "survive any node failure" re-runs the analysis with one node fewer: one node then sees 102k against 100k, saturated. You need a third node so the two survivors stay below 100%. That is the general rule: **capacity after a failure = (n − 1) × per-node capacity must exceed the load**.

**The connection tier dominates the bill.** Every update passes through whatever accepts driver connections. A service replica takes about 2k rps in the model, so 100k ÷ 2k = 50 replicas at 100%. At 70% you need about 72, and you want to stay below 70% with one lost, too. At $100 a replica that is most of the $10k budget, which is why the hint says to keep these servers "just under 70% busy: enough headroom for the p99, no more". The model's queueing grows steeply past that point, while every extra replica is $100.

**Trips.** 1.9k inserts a second against one PostgreSQL primary (5k) is under 40%. A single primary with a replica for failover is enough; no sharding needed for this part.

**Latency.** A location update is load balancer → gateway → one `GEOADD`: a few milliseconds of mean, a p99 in the tens, comfortably under 50 ms if the gateways are not overloaded. A matched ride is load balancer → matching service → `GEOSEARCH` → `INSERT` → enqueue, and the response. The async enqueue counts its own hop but not what the consumer does later.

## Concepts

### Geospatial indexing

A database index on `lat` and `lng` separately does not answer "drivers within 3 km": a B-tree can range-scan one dimension, not a circle. Geospatial indexes map two-dimensional space onto something an ordinary index can handle.

- **Geohash** interleaves the bits of latitude and longitude into a string. Points that share a prefix are in the same rectangular cell, so "nearby" becomes "same prefix", plus the neighbouring cells to handle edges. Redis's `GEO` commands store points in a sorted set keyed by a 52-bit geohash, and `GEOSEARCH … BYRADIUS 3 km ASC` returns members within a radius, nearest first.
- **Quadtrees** split a square into four recursively until each leaf holds few points. They adapt to density: Manhattan gets tiny cells, the desert huge ones.
- **S2** (Google) projects the sphere onto a cube and numbers cells along a space-filling curve, giving each cell a 64-bit id at many resolutions. Uber's early dispatch system used S2 cells to shard supply and demand.
- **H3** (Uber, open source) uses hexagons. A hexagon's neighbours are all the same distance from its centre, which makes "rings" of nearby cells and smoothing across cells simpler than with squares.

Trade-offs: geohash and S2 are simple and fit any key-value store; quadtrees adapt to density but need rebalancing as drivers move; H3 is best for analytics and pricing over areas. For an interview, name one, explain cells plus neighbours, and move on.

### Ephemeral state versus the record

Positions and trips look like "driver data", but they have opposite needs:

| | Driver position | Trip |
|---|---|---|
| Write rate | 100k/s | 1.9k/s |
| Value of old data | none after a few seconds | billed and audited for years |
| On loss | the next update in 4 s fixes it | money and trust lost |
| Consistency | latest wins | two riders must not get one driver |

So they get different stores. Positions go to an **in-memory, overwrite-in-place** store (a key per driver, a TTL so offline drivers disappear). Trips go to a **durable, strongly consistent** database, written before the rider hears back. A unique constraint on "the active trip of driver d7" makes the trip itself the lock: when two matching requests pick the same driver, one insert wins and the other fails cleanly and tries the next candidate.

When not to split: if positions had to be kept for compliance or for route replay, you would also stream them to cheap storage asynchronously, but you still would not make the matching path wait on that.

```proschi
title "Hot state in memory, records in a database"
app    "App"        [REST API]   x2
live   "Live state" [Redis]      x3 "Latest value per key, overwritten"
record "Records"    [PostgreSQL] x2 "Durable, strongly consistent"
app -> live   : SET
app -> record : SQL
```

### Asynchronous hand-off with a queue

The offer must reach the driver's phone, which is connected to some gateway node. Calling the gateway synchronously from the matching service would make the rider wait for the push and fail the request whenever that gateway is busy. Instead, the matching service **publishes** an event (`RideOffered d7`) to a queue and answers the rider; a consumer delivers the offer to the driver's connection.

In Proschi, `->>` is an asynchronous send: the hop counts once for the sender, but nothing after it delays the response.

```proschi
title "Fire and forget"
user   "User"   [Actor]
api    "API"    [REST API] x2
events "Events" [Kafka]    x2
worker "Worker" [Service]  x2
user   -> api
api    -> events : produce
events -> worker : consume

usecase "Do something" {
  user    -> api    : POST /things
  api    ->> events : ThingHappened
  events ->> worker : ThingHappened
  api    --> user   : 202
}
```

When not to use it: when the caller needs the result. Here the rider needs the trip id (from the database, synchronous), not confirmation that the push was delivered.

## Designing it step by step

**1. Scope.** Clarify that you are designing matching, not pricing, ETAs, payments or the trip lifecycle. Confirm the update interval (4 s), the fleet size (400k online at peak), the search radius (3 km) and the requirement that a confirmed trip never disappears. Derive the 100k writes a second out loud; it is the number that shapes everything.

**2. High level.** Drivers keep a long-lived connection (a websocket) to a gateway tier behind a load balancer. The gateway takes location updates and pushes offers. Riders call a matching service over HTTPS. Three stores: the live map (positions), the trips database, and a queue for offers. Draw both use cases as sequences.

**3. Deep dive.**

*Where positions live.* Start from the naive design (`UPDATE drivers SET lat, lng`) and count: it needs dozens of database shards. Then propose an in-memory geo index. Explain `GEOADD` (overwrite one member, about a millisecond) and `GEOSEARCH` (radius, nearest first). Mention partitioning the map by city or by geo cell when one node's memory or throughput runs out; in this exercise the model spreads load evenly over replicas, so you only need enough of them.

*Survive a failure.* Show the n − 1 arithmetic for the live map. Mention that a lost node loses at most a few seconds of positions, which the next round of updates restores; that is why an in-memory store is acceptable here and not for trips.

*Matching and the lock.* The matching service searches, picks the nearest candidates, and inserts the trip with a uniqueness rule on the driver's active trip. If the insert fails because another rider just got that driver, try the next candidate. Write before responding, in a strongly consistent store.

*The offer.* Publish to the queue with an async send; the gateway that holds the driver's connection consumes and pushes.

*Sizing.* The gateways carry 100k updates a second and cost the most; size them to stay under about 70% busy with one replica lost, and no further. Everything else is small.

**4. Wrap up.** Mention what you skipped: drivers declining offers (timeouts, re-offer to the next driver), surge pricing by cell, batching riders and drivers for globally better matches instead of greedy nearest-first, and multi-region (cities are natural partitions).

## Common mistakes

**Locations in the database** (`wrong/locations-in-database`). The starter does this, and it feels natural: drivers are rows, so update the row. 100k writes a second land on a PostgreSQL primary built for 5k, which saturates and drags down both use cases that touch it. Caught by **"Location updates are writes to the live map, never the database"** and **p99 of Update location < 50 ms**.

**Locations in a heavily sharded database** (`wrong/locations-in-sharded-database`). The fix for the previous one if you only look at utilisation: 22 shards. It works, at roughly twice the budget, for data nobody needs to keep. Caught by the same flow test and **cost ≤ $10,000/month**.

**The ride request waits for the offer queue** (`wrong/request-waits-for-offer-queue`). A synchronous publish with an ack. It adds latency and couples the rider's success to the queue and, in real systems, often to the downstream push. Caught by **"The driver's offer never holds up the rider"**.

**Trips in an eventually consistent NoSQL table** (`wrong/trips-in-nosql`). Scales nicely, but a lagging read can show a driver as free right after another rider got them, and two trips for one driver follow. Caught by **"Trips are stored strongly before the rider hears back"**.

Classic mistakes beyond the tests:

- Two live-map nodes "for redundancy" that cannot carry the load alone after one fails.
- Searching only the rider's own geohash cell and missing a driver 50 m away across the cell boundary.
- Polling for offers from the driver app instead of pushing over the open connection.
- Keeping every position forever in the hot store, instead of a TTL and an async archive.

## In the interview

Start with the asymmetry: "100k tiny writes a second where only the latest value matters, against 2k searches and 2k precious inserts." Then say that the design separates the two kinds of state, and justify each store by its numbers.

Likely follow-ups:

- *A Redis node dies; what is lost?* At most the last few seconds of positions on that node; drivers resend within 4 s. Matching continues on the survivors, which is why there are three.
- *How do you avoid offering one driver to two riders?* The trip insert is the lock: a unique constraint on the driver's active trip in a strongly consistent database. The loser retries with the next candidate.
- *A driver ignores the offer.* The offer carries a deadline; on timeout, release the driver and offer the trip to the next candidate.
- *How would you shard the live map at 10× scale?* By region or by geo cell (geohash prefix, S2 or H3 cell), with searches fanning out to the neighbouring cells. Cities are natural boundaries.
- *Why not let the database's geo extension do it (PostGIS)?* It answers the search well, but every update is still a durable write on a primary; the write rate, not the query, is the problem.

## Further reading

- [How Uber Scales Their Real-time Market Platform](https://highscalability.com/how-uber-scales-their-real-time-market-platform/) (High Scalability, 2015) — notes on Matt Ranney's talk: the dispatch system, S2 cells and availability.
- Isaac Brodsky, [H3: Uber's Hexagonal Hierarchical Spatial Index](https://www.uber.com/blog/h3/) (Uber Engineering, 2018) — why hexagons, and how Uber uses them for pricing and dispatch.
- [uber/h3 on GitHub](https://github.com/uber/h3) — the open-source library itself.
- [Redis GEOSEARCH](https://redis.io/docs/latest/commands/geosearch/) — radius and box searches over a geo set, sorted by distance.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism) — message queues and why the user should not wait for background work.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding) — what splitting a database costs, for comparison with the in-memory approach.
- Alex Xu and Sahn Lam, *System Design Interview – An Insider's Guide, Volume 2*, chapters "Proximity Service" and "Nearby Friends" — geohash, quadtrees and moving-location updates in depth.
