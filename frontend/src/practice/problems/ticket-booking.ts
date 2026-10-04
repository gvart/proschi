import type { Problem } from '../types';

export const ticketBooking: Problem = {
  id: 'ticket-booking',
  title: 'Ticket Booking without Double-Booking',
  difficulty: 'hard',
  tags: ['consistency', 'concurrency', 'caching', 'external-api'],
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
- **3k rps** of hold attempts, about 30% of them for seats that are already
  taken.
- **500 rps** of confirmations: 90% paid, 7% declined, 3% too late.

## Constraints

- Whether a seat can be held is decided by one consistent source of truth,
  never by a cached copy of the seat map.
- A fan is never charged without a valid hold, and a seat is booked only
  after its payment was approved.
- p99 of a seat map under **150 ms**, of a hold under **200 ms**, of a
  confirmation under **1.5 s** (the payment provider takes about 250 ms).
- Holds and bookings are stored durably before the fan hears back.
- Losing any single machine must not stop the sale.
- At most **$3,500 / month**.

## What is given

\`problem.proschi\` declares the \`fan\` and the external \`payments\` provider
(250 ms per call, up to 5k calls per second) and holds the traffic,
requirements and tests. Add the booking service, where seats, holds and
bookings live, the seat map cache, the connections and the three use cases.`,
  given: `title "Ticket Booking" "Sells each seat exactly once while thousands of fans race for it"

fan      "Fan"              [Actor]
payments "Payment Provider" [Payment Gateway] "External card payments"

capacity {
  payments 5k rps latency 250ms
}

traffic {
  "View seats"      20k rps mix "Cache hit" 97%, "Cache miss" 3%
  "Hold seat"       3k rps  mix "Held" 70%, "Taken" 30%
  "Confirm booking" 500 rps mix "Paid" 90%, "Payment declined" 7%, "Hold expired" 3%
}

requirements {
  p99 "View seats" < 150ms
  p99 "Hold seat" < 200ms
  p99 "Confirm booking" < 1500ms
  durable "Hold seat"
  durable "Confirm booking"
  survive any node failure
  cost <= 3500 usd/month
}

test "Seat maps are served from the cache" {
  "View seats" calls any cache before any database
  "View seats" scenario "Cache hit" never calls any database
}

test "The database, not the cache, decides who holds a seat" {
  "Hold seat" every scenario calls any database
  "Hold seat" calls any database before any cache
  "Hold seat" scenario "Taken" responds 409
}

test "Nobody pays without a valid hold" {
  "Confirm booking" calls any database before payments
  "Confirm booking" scenario "Hold expired" never calls payments
  "Confirm booking" scenario "Hold expired" responds 409
}

test "A seat is booked only once it is paid" {
  "Confirm booking" scenario "Paid" calls payments
  "Confirm booking" scenario "Paid" writes any database before responding
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
api   "Booking API"   [REST API]          x18 @tickets "Seat maps, holds and bookings"
cache "Seat Maps"     [Redis]             x2 @tickets "Rendered seat map per event, 2 s TTL"
db    "Seats DB"      [PostgreSQL]        x2 @tickets "Seats, holds and bookings; the only source of truth"

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

entity Booking in db "A paid seat" {
  bookingId uuid   key
  holdId    uuid   unique
  eventId   string index
  seatId    string
  fanId     string index
  paymentId string unique
  createdAt time
}

decision "Holds are conditional writes in PostgreSQL" {
  because "UPDATE … WHERE status = 'free' OR holdExpires < now() is atomic: of two fans racing for a seat exactly one row update wins, the other gets 409"
  rejected "Check the seat map cache, then write" "The cache is seconds stale and two fans read 'free' at the same moment; both would get the seat"
  rejected "Redis SET NX with a TTL as the lock" "Fast and expires by itself, but a failover can drop the lock and the seat sells twice"
}
decision "Holds expire by a deadline, not by a cleanup job" {
  because "A hold is valid while holdExpires is in the future; an expired hold is simply overwritten by the next fan, so no sweeper has to run on time"
  rejected "A scheduled job that releases holds" "Seats stay locked whenever the job is late or down"
}
decision "Confirm with a conditional update after the payment" {
  because "The booking is written only if the hold is still this fan's; a payment that raced past the deadline is refunded instead of double-selling the seat"
  rejected "Book first, then charge" "A declined card leaves a booked seat nobody paid for"
}
decision "Seat maps from a short-TTL cache" {
  because "Maps take 85% of the traffic and may be two seconds stale; holds invalidate the map so it catches up quickly"
  rejected "Read seat maps from the database" "20k rps on the database that must serve every hold with low latency"
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
    db  --> api   : 1 row
    api ->> cache : DEL seatmap:e1
    api --> lb    : 201 {"holdId": "h-77", "expiresAt": "10:10:00"}
    lb  --> fan   : 201 {"holdId": "h-77", "expiresAt": "10:10:00"}
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
    api      ->> cache    : DEL seatmap:e1
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
    'Two fans can read "free" from the seat map cache at the same moment. Which store can decide atomically that only one of them wins?',
    'Make the hold a single conditional write: UPDATE the seat only WHERE it is free or its hold has expired. One row updated means held, zero rows means taken. Expiry is then just a timestamp in the row.',
    'Check the hold in the database before charging the card, and write the booking only after the provider approved; give the expired case its own scenario that never reaches the provider.',
    'Seat maps are 85% of the traffic: serve them from a cache with a short TTL. The service carries about 23.5k rps, so size it at roughly 2k rps per replica with room to lose one.',
  ],
};
