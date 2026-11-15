## Questions

### How many reads and writes a second?
- kind: good
- fact: 60k catalog reads, 3k orders and 2k order checks per second at peak

**60k catalog reads, 3k orders and 2k order checks a second** at peak (assumptions for the exercise).

### Which reads must see the latest data?
- kind: good
- fact: Writes and reads that must see the latest write go to the primary

The order status page must find the order just placed, so it reads the primary. Catalog pages may be a few seconds old.

### Can the catalog be served from a cache?
- kind: good
- fact: Catalog reads come from MySQL replicas, not from the primary or a cache

Not in this exercise: catalog reads come from MySQL replicas, not from the primary or a cache.

### How does the app reach MySQL?
- kind: good
- fact: Every query goes through ProxySQL

Every query goes through ProxySQL; there is no connection from the app to a database.

### What latency do we need?
- kind: good
- fact: p99 of Read catalog under 40 ms

p99 under **40 ms** for catalog reads, under **80 ms** for placing and checking an order.

### What availability do we need?
- kind: good
- fact: Every use case available 99.95% of the time

**99.95%** for every use case, and losing any single machine must not break a latency limit.

### Is there a budget?
- kind: good
- fact: At most $3,400 / month

At most **$3,400 a month**, the proxies and the primary included.

### Which MySQL version do you run?
- kind: weak

The version does not change how many reads a server takes or how replicas lag; ask about the read and write rates instead.

### Should we rewrite the storefront as a single-page app?
- kind: weak

The front end is not the bottleneck; ask which queries are reads and which must be fresh.

### How are products laid out on the page?
- kind: weak

A UI question; ask how many reads a second the page causes.

## Estimates

### One MySQL server serves about 20k reads a second. How many replicas do 60k catalog reads need at 75% utilisation, with one replica allowed to fail?
- answer: 5
- unit: replicas
- range: 5 to 6

At 75% a replica carries 15k reads, so 60k ÷ 15k = 4 must be running; add one spare: **5 replicas**.

### If the primary and its standby (20k reads each) also served the catalog and the order checks, how busy would they be?
- answer: 155
- unit: % utilisation
- range: 140 to 170

62k reads ÷ 40k of capacity ≈ **155%**: saturated, which is why the catalog moves to replicas.

Numbers: [Numbers to know](../docs/numbers/).
