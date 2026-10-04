---
title: Ride Matching
summary: 100k location updates per second into a geo store, not a database.
difficulty: medium
tags: [geo, caching, write-heavy, resilience]
hints:
  - Only the latest position of a driver matters, and there are 100k of them per second. Which kind of store overwrites a key in a millisecond and can search by distance?
  - Request ride searches that store first, and writes the trip to a strongly consistent, durable database only once a driver is found, before answering 201. The offer to the driver goes through a queue with ->>, so the rider never waits for it.
  - Survive a node failure means the nodes that are left must carry the whole load. 100k updates per second on a store that takes 100k per node needs more than two nodes.
  - "The servers that take location updates dominate the cost: keep them just under 70% busy: enough headroom for the p99, no more."
---

Design the dispatch core of a ride-hailing app. Drivers' phones
report where they are every few seconds; when a rider asks for a ride, the
system finds the nearest free driver, creates the trip and offers it to that
driver.

## Functional requirements

- **Update location**: an online driver's app sends its position
  (`lat`, `lng`, heading) every 4 seconds. Only the latest position
  matters.
- **Request ride**: a rider asks for a ride from a pickup point. Model it with
  two scenarios:
  - `"Matched"`: a free driver is within 3 km. The trip is created and
    stored, the rider gets `201` with the trip and the driver, and the
    driver receives the ride offer through a queue.
  - `"No driver nearby"`: nobody is free within 3 km; the rider gets
    `404` and no trip is created.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **400k drivers** online at peak, one update every 4 seconds: **100k rps**
  of location updates.
- Ride requests: **2k rps** at peak; 5% of them find no driver.

## Constraints

- p99 of a location update under **150 ms**; of a ride request under
  **300 ms**.
- Ride requests available **99.9%** of the time.
- A trip is never lost once the rider was told about it, and it lives in a
  database (it is billed and audited later).
- Location updates are writes (`GEOADD`), and they must not reach the
  database: a relational database takes about 5k writes per second on its
  primary, and read replicas add no write capacity; only shards do, at the
  price of a whole cluster each.
- The trip is the driver's lock: it is stored in a strongly consistent
  database (a relational one, not an eventually consistent NoSQL table), so
  two riders racing for one driver cannot both win.
- The ride offer goes to the driver through a queue; the rider never waits
  for it.
- Losing any single machine, including a node of the store that holds the
  driver locations, must not stop matching.
- At most **$10,000 / month**.

## What is given

`problem.proschi` declares the `rider` and the `driver` and holds the
traffic, requirements and tests. Add the components, the connections and the
two use cases.
