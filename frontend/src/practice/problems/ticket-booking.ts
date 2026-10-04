import type { Problem } from '../types';

export const ticketBooking: Problem = {
  id: 'ticket-booking',
  title: 'Ticket Booking without Double-Booking',
  difficulty: 'hard',
  tags: ['consistency', 'concurrency', 'caching', 'sharding', 'external-api'],
  statement: `Tickets for a stadium concert go on sale at 10:00 and tens of thousands
of fans race for the same seats. A fan picks a seat on the seat map, the seat
is **held** for them for 10 minutes while they pay, and the booking is
confirmed once the payment goes through. Two fans must **never** end up with
the same seat, and a seat whose hold expired must go back on sale.

## Functional requirements

- **View seats**: a fan loads the seat map of an event. The map may be a
  couple of seconds stale. Name its scenarios \`"Cache hit"\` and
  \`"Cache miss"\`.
- **Hold seat**: a fan asks to hold one seat. Two scenarios:
  - \`"Held"\`: the seat was free (or its hold expired); it is now held by this
    fan until a deadline 10 minutes away, and the fan gets \`201\`.
  - \`"Taken"\`: someone else holds or booked the seat; the fan gets \`409\`.
- **Confirm booking**: the fan pays for a held seat through the external
  payment provider. Three scenarios:
  - \`"Paid"\`: the hold is still the fan's, the payment is approved, the seat
    is booked and the fan gets \`201\`.
  - \`"Payment declined"\`: the provider declines the card; the fan gets
    \`402\` and the seat stays held until its deadline.
  - \`"Hold expired"\`: the hold ran out (or was never the fan's); the fan
    gets \`409\` and is **not** charged.

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

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

\`problem.proschi\` declares the \`fan\` and the external \`payments\` provider
(250 ms per call, up to 5k calls per second) and holds the traffic,
requirements and tests. Add the booking service, where seats, holds and
bookings live, the seat map cache, the connections and the three use cases.

Mind the write path: a relational database (PostgreSQL, MySQL, …) takes about
**5k writes per second per primary**. Read replicas do not add write
capacity; only shards do (\`capacity { db shards 2 }\`, each shard with its
own primary and replicas), or a partitioned store that is still strongly
consistent.`,
  given: `title "Ticket Booking" "Sells each seat exactly once while thousands of fans race for it"

fan      "Fan"              [Actor]
payments "Payment Provider" [Payment Gateway] "External card payments"

capacity {
  payments 5k rps latency 250ms
}

traffic {
  "View seats"      20k rps mix "Cache hit" 97%, "Cache miss" 3%
  "Hold seat"       6k rps  mix "Held" 40%, "Taken" 60%
  "Confirm booking" 500 rps mix "Paid" 90%, "Payment declined" 7%, "Hold expired" 3%
}

requirements {
  p99 "View seats" < 150ms
  p99 "Hold seat" < 200ms
  p99 "Confirm booking" < 1500ms
  durable "Hold seat"
  durable "Confirm booking"
  survive any node failure
  cost <= 4500 usd/month
}

test "Seat maps are served from the cache" {
  "View seats" calls any cache before any database
  "View seats" scenario "Cache hit" never calls any database
}

test "A strong store, not the cache, decides who holds a seat" {
  "Hold seat" every scenario calls any database
  "Hold seat" writes any strong store before responding
  "Hold seat" never calls any eventual store
  "Hold seat" scenario "Taken" responds 409
}

test "Nobody pays without a valid hold" {
  "Confirm booking" calls any strong store before payments
  "Confirm booking" never waits for any eventual store
  "Confirm booking" scenario "Hold expired" never calls payments
  "Confirm booking" scenario "Hold expired" responds 409
}

test "A seat is booked only once it is paid" {
  "Confirm booking" scenario "Paid" calls any strong store after payments
  "Confirm booking" scenario "Paid" writes any strong store before responding
  "Confirm booking" scenario "Paid" responds 201
  "Confirm booking" scenario "Payment declined" responds 402
}
`,
  starter: `import "problem.proschi"

# Add where seats, holds and bookings live, the seat map cache, and the use
# cases "View seats", "Hold seat" and "Confirm booking".
api   "Booking API" [REST API]
cache "Seat Maps"   [Redis]

fan -> api
api -> cache

usecase "Hold seat" {
  fan    -> api   : POST /events/e1/holds json {"seat": "A-12"}
  api    -> cache : GET seatmap:e1
  cache --> api   : A-12 free
  api   --> fan   : 201 {"holdId": "h-77"}
}
`,
  solution: `import "problem.proschi"

lb    "Load Balancer" [AWS Load Balancer] x2 @platform
api   "Booking API"   [REST API]          x20 @tickets "Seat maps, holds and bookings"
cache "Seat Maps"     [Redis]             x2 @tickets "Rendered seat map per event, 2 s TTL"
db    "Seats DB"      [PostgreSQL]        x2 @tickets "Seats, holds and bookings, sharded by seat; the only source of truth"

capacity {
  db shards 2
}

fan -> lb
lb  -> api      : HTTPS
api -> cache    : GET / SET / DEL
api -> db       : SQL
api -> payments : charge

entity Seat in db "One seat of one event; held or booked by at most one fan" {
  eventId     string key
  seatId      string key
  status      string
  holdId      uuid   optional unique
  heldBy      string optional
  holdExpires time   optional index
  bookingId   uuid   optional
  version     int
}

entity Booking in db "A paid seat, on the shard of its seat" {
  bookingId uuid   key
  holdId    uuid   unique
  eventId   string index
  seatId    string
  fanId     string index
  paymentId string unique
  createdAt time
}

decision "Holds are conditional writes in PostgreSQL" {
  because "UPDATE … WHERE status = 'free' OR holdExpires < now() is atomic and strongly consistent: of two fans racing for a seat exactly one row update wins, the other gets 409"
  rejected "Check the seat map cache, then write" "The cache is seconds stale and two fans read 'free' at the same moment; both would get the seat"
  rejected "Redis SET NX with a TTL as the lock" "Fast and expires by itself, but a failover can drop the lock and the seat sells twice"
}
decision "Shard the seats by (eventId, seatId)" {
  because "Every hold attempt is a write: 6.5k writes a second at the peak against 5k a PostgreSQL primary takes. Two shards give 10k, and a hold or a booking touches one seat, so it never spans shards"
  rejected "More read replicas" "Replicas only serve reads; every write still lands on the one primary, which saturates"
  rejected "DynamoDB" "Partitioned and cheap to scale, but its default reads are eventually consistent; the decision must come from a strongly consistent read-and-write"
}
decision "Holds expire by a deadline, not by a cleanup job" {
  because "A hold is valid while holdExpires is in the future; an expired hold is simply overwritten by the next fan, so no sweeper has to run on time"
  rejected "A scheduled job that releases holds" "Seats stay locked whenever the job is late or down"
}
decision "Confirm with a conditional update after the payment" {
  because "The booking is written only if the hold is still this fan's; a payment that raced past the deadline is refunded instead of double-selling the seat"
  rejected "Book first, then charge" "A declined card leaves a booked seat nobody paid for"
}
decision "Seat maps from a short-TTL cache, never invalidated by holds" {
  because "Maps take three quarters of the traffic and may be two seconds stale; the TTL alone keeps them close enough, so the hold path touches only the database"
  rejected "Read seat maps from the database" "20k rps on the database that must serve every hold with low latency"
  rejected "Delete the cached map on every hold" "Puts the cache on the hold path, and a map rebuilt from a replica can still be stale"
}

usecase "View seats" "Load the seat map of an event" {
  fan -> lb    : GET /events/e1/seats
  lb  -> api   : GET /events/e1/seats
  api -> cache : GET seatmap:e1

  alt "Cache hit" when "the map was rendered in the last 2 seconds" {
    cache --> api : seat map
  } alt "Cache miss" when "the map expired" {
    cache --> api   : nil
    api    -> db    : SELECT seats of e1
    db    --> api   : 48,000 rows
    api   ->> cache : SET seatmap:e1 EX 2
  }
  api --> lb  : 200 {"seats": []}
  lb  --> fan : 200 {"seats": []}
}

usecase "Hold seat" "Hold one seat for 10 minutes" {
  fan -> lb  : POST /events/e1/holds json {"seat": "A-12"}
  lb  -> api : POST /events/e1/holds
  api -> db  : UPDATE seat SET held, holdExpires = now() + 10 min WHERE free OR holdExpires < now()

  alt "Held" when "the seat was free or its hold expired" {
    db  --> api : 1 row
    api --> lb  : 201 {"holdId": "h-77", "expiresAt": "10:10:00"}
    lb  --> fan : 201 {"holdId": "h-77", "expiresAt": "10:10:00"}
  } alt "Taken" when "another fan holds or booked it" {
    db  --> api : 0 rows
    api --> lb  : 409 {"error": "seat_taken"}
    lb  --> fan : 409 {"error": "seat_taken"}
  }
}

usecase "Confirm booking" "Pay for a held seat and book it" {
  fan -> lb  : POST /holds/h-77/confirm json {"card": "tok_visa"}
  lb  -> api : POST /holds/h-77/confirm
  api -> db  : SELECT hold h-77 WHERE heldBy = fan AND holdExpires > now()

  alt "Paid" when "the hold is valid and the card is approved" {
    db       --> api      : valid
    api       -> payments : POST /charges Idempotency-Key h-77
    payments --> api      : 201 approved
    api       -> db       : UPDATE seat SET booked WHERE holdId = h-77; INSERT booking
    db       --> api      : 1 row
    api      --> lb       : 201 {"bookingId": "b-301"}
    lb       --> fan      : 201 {"bookingId": "b-301"}
  } alt "Payment declined" when "the provider declines the card" {
    db       --> api      : valid
    api       -> payments : POST /charges Idempotency-Key h-77
    payments --> api      : 402 declined
    api      --> lb       : 402 {"error": "card_declined"}
    lb       --> fan      : 402 {"error": "card_declined"}
  } alt "Hold expired" when "the deadline passed or the hold is not the fan's" {
    db  --> api : no valid hold
    api --> lb  : 409 {"error": "hold_expired"}
    lb  --> fan : 409 {"error": "hold_expired"}
  }
}
`,
  hints: [
    'Two fans can read "free" from the seat map cache at the same moment. Which store can decide atomically, and consistently, that only one of them wins? Keep every eventually consistent store off the hold path.',
    'Make the hold a single conditional write: UPDATE the seat only WHERE it is free or its hold has expired. One row updated means held, zero rows means taken. Expiry is then just a timestamp in the row.',
    'Check the hold in the database before charging the card, and write the booking only after the provider approved (the last database call of "Paid" comes after the payment); give the expired case its own scenario that never reaches the provider.',
    'Count the writes: every hold attempt is one, about 6.5k a second with the bookings. One PostgreSQL primary takes 5k, and replicas do not help: add shards (capacity { db shards 2 }) or pick a partitioned store that is strongly consistent.',
    'Seat maps are three quarters of the traffic: serve them from a cache with a short TTL. The service carries about 26.5k rps, so size it at roughly 2k rps per replica with room to lose one and stay fast.',
  ],
};
