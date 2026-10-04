---
title: Ticket Booking without Double-Booking
summary: The database decides holds; the cache only shows seat maps.
difficulty: hard
tags: [consistency, concurrency, caching, sharding, external-api]
hints:
  - Two fans can read "free" from the seat map cache at the same moment. Which store can decide atomically, and consistently, that only one of them wins? Keep every eventually consistent store off the hold path.
  - "Make the hold a single conditional write: UPDATE the seat only WHERE it is free or its hold has expired. One row updated means held, zero rows means taken. Expiry is then just a timestamp in the row."
  - Check the hold in the database before charging the card, and write the booking only after the provider approved (the last database call of "Paid" comes after the payment); give the expired case its own scenario that never reaches the provider.
  - "Count the writes: every hold attempt is one, about 6.5k a second with the bookings. One PostgreSQL primary takes 5k, and replicas do not help: add shards (capacity { db shards 2 }) or pick a partitioned store that is strongly consistent."
  - "Seat maps are three quarters of the traffic: serve them from a cache with a short TTL. The service carries about 26.5k rps, so size it at roughly 2k rps per replica with room to lose one and stay fast."
---

Tickets for a stadium concert go on sale at 10:00 and tens of thousands
of fans race for the same seats. A fan picks a seat on the seat map, the seat
is **held** for them for 10 minutes while they pay, and the booking is
confirmed once the payment goes through. Two fans must **never** end up with
the same seat, and a seat whose hold expired must go back on sale.

## Functional requirements

- **View seats**: a fan loads the seat map of an event. The map may be a
  couple of seconds stale. Name its scenarios `"Cache hit"` and
  `"Cache miss"`.
- **Hold seat**: a fan asks to hold one seat. Two scenarios:
  - `"Held"`: the seat was free (or its hold expired); it is now held by this
    fan until a deadline 10 minutes away, and the fan gets `201`.
  - `"Taken"`: someone else holds or booked the seat; the fan gets `409`.
- **Confirm booking**: the fan pays for a held seat through the external
  payment provider. Three scenarios:
  - `"Paid"`: the hold is still the fan's, the payment is approved, the seat
    is booked and the fan gets `201`.
  - `"Payment declined"`: the provider declines the card; the fan gets
    `402` and the seat stays held until its deadline.
  - `"Hold expired"`: the hold ran out (or was never the fan's); the fan
    gets `409` and is **not** charged.

Use these names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- **20k rps** of seat map loads at the on-sale peak; 97% are served from a
  cache.
- **6k rps** of hold attempts, about 60% of them for seats someone else got
  first. Every attempt, won or lost, is a write: the store has to decide it.
- **500 rps** of confirmations: 90% paid, 7% declined, 3% too late.

## Constraints

- Whether a seat can be held is decided by one **strongly consistent** store,
  with a conditional write. Holding a seat never touches an eventually
  consistent store, not even to invalidate the seat map: a cached copy can be
  seconds stale, and two fans would both read "free".
- A fan is never charged without a valid hold, and a seat is booked only
  after its payment was approved. The booking is a write that comes after the
  payment, even though the same store was read to check the hold before it.
- p99 of a seat map under **150 ms**, of a hold under **200 ms**, of a
  confirmation under **1.5 s** (the payment provider takes about 250 ms).
- Holds and bookings are stored durably before the fan hears back.
- Losing any single machine must not stop the sale.
- At most **$4,500 / month**.

## What is given

`problem.proschi` declares the `fan` and the external `payments` provider
(250 ms per call, up to 5k calls per second) and holds the traffic,
requirements and tests. Add the booking service, where seats, holds and
bookings live, the seat map cache, the connections and the three use cases.

Mind the write path: a relational database (PostgreSQL, MySQL, …) takes about
**5k writes per second per primary**. Read replicas do not add write
capacity; only shards do (`capacity { db shards 2 }`, each shard with its
own primary and replicas), or a partitioned store that is still strongly
consistent.
