import type { Problem } from '../types';

export const rideMatching: Problem = {
  id: 'ride-matching',
  title: 'Ride Matching',
  difficulty: 'medium',
  tags: ['geo', 'caching', 'write-heavy', 'resilience'],
  statement: `Design the dispatch core of a ride-hailing app. Drivers' phones
report where they are every few seconds; when a rider asks for a ride, the
system finds the nearest free driver, creates the trip and offers it to that
driver.

## Functional requirements

- **Update location**: an online driver's app sends its position
  (\`lat\`, \`lng\`, heading) every 4 seconds. Only the latest position
  matters.
- **Request ride**: a rider asks for a ride from a pickup point. Model it with
  two scenarios:
  - \`"Matched"\`: a free driver is within 3 km. The trip is created and
    stored, the rider gets \`201\` with the trip and the driver, and the
    driver receives the ride offer through a queue.
  - \`"No driver nearby"\`: nobody is free within 3 km; the rider gets
    \`404\` and no trip is created.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

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
- Location updates are writes (\`GEOADD\`), and they must not reach the
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

\`problem.proschi\` declares the \`rider\` and the \`driver\` and holds the
traffic, requirements and tests. Add the components, the connections and the
two use cases.`,
  given: `title "Ride Matching" "Matches riders with the nearest free driver from a live map of driver locations"

rider  "Rider"  [Actor]
driver "Driver" [Actor]

traffic {
  "Update location" 100k rps
  "Request ride"    2k rps mix "Matched" 95%, "No driver nearby" 5%
}

requirements {
  p99 "Update location" < 150ms
  p99 "Request ride" < 300ms
  availability "Request ride" >= 99.9%
  durable "Request ride"
  survive any node failure
  cost <= 10000 usd/month
}

test "Location updates are writes to the live map, never the database" {
  "Update location" starts at driver
  "Update location" writes any cache before responding
  "Update location" never calls any database
}

test "Matching searches the live map first" {
  "Request ride" every scenario calls any cache
  "Request ride" calls any cache before any database
  "Request ride" scenario "No driver nearby" never calls any database
  "Request ride" scenario "No driver nearby" responds 404
}

test "Trips are stored strongly before the rider hears back" {
  "Request ride" scenario "Matched" writes any database before responding
  "Request ride" scenario "Matched" writes any strong store before responding
  "Request ride" scenario "Matched" responds 201
}

test "The driver's offer never holds up the rider" {
  "Request ride" scenario "Matched" calls any queue
  "Request ride" never waits for any queue
}
`,
  starter: `import "problem.proschi"

# Add the components and the use cases "Update location" and "Request ride".
api "Dispatch API" [REST API]
db  "Dispatch DB"  [PostgreSQL]

driver -> api
rider  -> api
api    -> db

usecase "Update location" {
  driver -> api : PUT /drivers/d7/location json {"lat": 52.52, "lng": 13.40}
  api    -> db  : UPDATE drivers SET lat, lng
  db    --> api : ok
  api   --> driver : 204
}
`,
  solution: `import "problem.proschi"

lb      "Load Balancer"    [AWS Load Balancer] x3
gateway "Driver Gateway"   [WebSocket]         x75 @dispatch "Keeps a connection to every online driver; takes location updates, pushes offers"
geo     "Live Map"         [Redis]             x3 @dispatch "Latest position of every online driver in a geo index"
match   "Matching Service" [REST API]          x3 @dispatch "Finds the nearest free driver and creates the trip"
trips   "Trips DB"         [PostgreSQL]        x2 @dispatch "Every trip: rider, driver, pickup, status"
offers  "Ride Offers"      [Kafka]             x2 @dispatch "Ride offers on their way to drivers"

driver  -> lb      : WebSocket
rider   -> lb      : HTTPS
lb      -> gateway : WebSocket
lb      -> match   : HTTP
gateway -> geo     : GEOADD
match   -> geo     : GEOSEARCH
match   -> trips   : SQL
match   -> offers  : produce
offers  -> gateway : consume
gateway -> driver  : push

entity DriverPosition in geo "Where an online driver is now; expires 30 s after the last update" {
  driverId string key
  lat      float
  lng      float
  heading  int
}

entity Trip in trips "One ride from request to drop-off" {
  id        uuid key
  riderId   uuid index
  driverId  uuid index
  pickup    json
  status    string
  createdAt time
}

decision "Driver locations live in Redis, not the database" {
  because "100k updates per second of which only the latest matters: GEOADD overwrites in ~1 ms, and GEOSEARCH answers 'nearest within 3 km' from the same index"
  rejected "UPDATE a drivers table" "Every write goes to one PostgreSQL primary (5k writes per second); read replicas do not help, and 20+ shards with a replica each cost over $16k a month for positions nobody needs to keep"
}
decision "Three Live Map nodes" {
  because "One node takes 100k operations per second; with three, the two left after a failure still carry the ~102k rps"
  rejected "Two nodes" "Losing one leaves a single node saturated, and matching stops"
}
decision "The trip row is the driver's lock" {
  because "A unique index on the driver's active trip makes two riders racing for one driver fail cleanly in a strongly consistent database"
  rejected "Trips in DynamoDB" "Eventually consistent reads could show a driver as free after another rider got them"
}

usecase "Update location" "A driver's app reports where it is" {
  driver   -> lb      : location {"lat": 52.52, "lng": 13.40, "heading": 90}
  lb       -> gateway : location
  gateway  -> geo     : GEOADD drivers 13.40 52.52 d7
  geo     --> gateway : 1
  gateway --> lb      : ack
  lb      --> driver  : ack
}

usecase "Request ride" "Match a rider with the nearest free driver" {
  rider -> lb    : POST /rides json {"pickup": {"lat": 52.52, "lng": 13.41}}
  lb    -> match : POST /rides
  match -> geo   : GEOSEARCH drivers 3 km ASC

  alt "Matched" when "a free driver is within 3 km" {
    geo     --> match   : [d7, d12]
    match    -> trips   : INSERT Trip driver=d7
    trips   --> match   : ok
    match   ->> offers  : RideOffered d7
    offers  ->> gateway : RideOffered d7
    gateway ->> driver  : ride offer
    match   --> lb      : 201 {"tripId": "t91", "driverId": "d7", "etaMinutes": 4}
    lb      --> rider   : 201 {"tripId": "t91", "driverId": "d7", "etaMinutes": 4}
  } alt "No driver nearby" when "nobody is free within 3 km" {
    geo   --> match : []
    match --> lb    : 404 {"error": "no_driver_nearby"}
    lb    --> rider : 404 {"error": "no_driver_nearby"}
  }
}
`,
  hints: [
    'Only the latest position of a driver matters, and there are 100k of them per second. Which kind of store overwrites a key in a millisecond and can search by distance?',
    'Request ride searches that store first, and writes the trip to a strongly consistent, durable database only once a driver is found, before answering 201. The offer to the driver goes through a queue with ->>, so the rider never waits for it.',
    'Survive a node failure means the nodes that are left must carry the whole load. 100k updates per second on a store that takes 100k per node needs more than two nodes.',
    'The servers that take location updates dominate the cost: keep them just under 70% busy: enough headroom for the p99, no more.',
  ],
};
