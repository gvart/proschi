## Questions

### How many drivers, and how often do they report their location?
- kind: good
- fact: 400k drivers online at peak, one update every 4 seconds

**400k drivers** online at peak, one update every **4 seconds**.

### How many ride requests a second?
- kind: good
- fact: Ride requests: 2k rps at peak; 5% of them find no driver

**2k a second** at peak; **5%** find no driver.

### Can location updates go to the database?
- kind: good
- fact: they must not reach the database

No, location updates (`GEOADD`) must not reach the database.

### How many writes can a relational database take?
- kind: good
- fact: a relational database takes about 5k writes per second on its primary

About **5k writes a second** on its primary; read replicas add no write capacity.

### How do we stop two riders getting the same driver?
- kind: good
- fact: The trip is the driver's lock

The trip is the driver's lock, stored in a strongly consistent relational database.

### How does the offer reach the driver?
- kind: good
- fact: The ride offer goes to the driver through a queue

Through a queue; the rider never waits for it.

### What latency do we need?
- kind: good
- fact: p99 of a location update under 50 ms

p99 of a location update under **50 ms**, of a ride request under **300 ms**.

### Which car models are supported?
- kind: weak

A product detail.

### How is surge pricing computed?
- kind: weak

A different system; stay on matching.

### Which map provider do we use?
- kind: weak

A vendor choice that does not change the design.

## Estimates

### How many location updates a second?
- answer: 100k
- unit: updates/s
- range: 80k to 120k

400k ÷ 4 s = **100,000 a second**.

### How many relational primaries would those updates need at 5k writes a second each?
- answer: 20
- unit: primaries
- range: 15 to 25

100k ÷ 5k = **20 shards**, each a whole cluster: keep locations in memory instead.

### At 50 bytes per driver, how much memory does every driver's latest position take?
- answer: 20M
- unit: bytes
- range: 10M to 40M

400k × 50 bytes = **20 MB**.

Numbers: [Numbers to know](../docs/numbers/).
