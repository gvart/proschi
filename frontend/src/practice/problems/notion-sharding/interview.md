## Questions

### How many page loads and edits a second?
- kind: good
- fact: 200k page loads and 100k block edits per second at peak

**200k page loads and 100k block edits a second** at peak (assumptions for the exercise).

### Can we move the blocks to another database?
- kind: good
- fact: Blocks stay in PostgreSQL

No: blocks stay in PostgreSQL.

### How do the API servers reach the database?
- kind: good
- fact: every query goes through PgBouncer

Every query goes through PgBouncer; there is no connection from the API servers to the database.

### When is an edit saved?
- kind: good
- fact: An edit is written to Postgres before the API answers

An edit is written to Postgres before the API answers.

### What latency do we need?
- kind: good
- fact: p99 of both use cases under 70 ms

p99 of both use cases under **70 ms**.

### What availability do we need?
- kind: good
- fact: Both available 99.95% of the time

Both available **99.95%** of the time, surviving the loss of any single machine.

### Is there a budget?
- kind: good
- fact: At most $30,000 / month, PgBouncer included

At most **$30,000 a month**, PgBouncer included.

### Which ORM do the API servers use?
- kind: weak

An ORM does not change how many writes one primary takes. Ask for the read and write rates instead.

### What does a block look like in the editor?
- kind: weak

A UI question. Ask what a page load reads and how many loads and edits a second there are.

### Can we rewrite the editor in Rust?
- kind: weak

The client is not the bottleneck here; the one Postgres primary is. Ask whether the data must stay in Postgres and what the latency limit is.

## Estimates

### If one Postgres primary takes about 5k writes a second, what is the smallest number of shards that can take 100k edits a second?
- answer: 20
- unit: shards
- range: 20 to 34

100k ÷ 5k = **20 shards**, each primary 100% busy. That is the floor, not the design: with headroom for the p99 you want about 30.

### With 32 shards, each primary taking 5k writes a second, how busy is a primary at 100k edits a second?
- answer: 63
- unit: % utilisation
- range: 58 to 68

32 primaries take 32 × 5k = 160k writes a second; 100k ÷ 160k = **about 63%**, near the two-thirds that keeps the p99 under 70 ms. Replicas do not change this number: only primaries take writes.

### At 1 KB per edit, how much is written in a day at the peak rate?
- answer: 8.6T
- unit: bytes
- range: 5T to 15T

100k × 1 KB × 86,400 s ≈ **8.6 TB a day**.

Numbers: [Numbers to know](../docs/numbers/).
