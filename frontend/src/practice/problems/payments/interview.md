## Questions

### How many checkouts a second?
- kind: good
- fact: 1k checkouts per second at peak

**1k checkouts a second** at peak (a sales event).

### How many of them are retries?
- kind: good
- fact: About 5% of them are retries of an earlier checkout

About **5%** are retries of an earlier checkout.

### How reliable is the payment gateway?
- kind: good
- fact: About 0.5% of gateway calls fail or time out

About **0.5%** of calls fail or time out, and it offers **99.9%** availability.

### Where is the idempotency key kept?
- kind: good
- fact: strongly consistent, durable store, keyed by the idempotency key

The payment is inserted into a **strongly consistent**, durable store, keyed by the idempotency key, before the gateway is called. No cache.

### What latency must a checkout meet?
- kind: good
- fact: p99 of a checkout under 1.5 s, the gateway included

p99 under **1.5 s**, the gateway included; a replay under **100 ms**.

### What availability do we need?
- kind: good
- fact: more than the gateway itself offers (99.9%)

**99.95%**, more than the gateway itself offers (99.9%).

### Who retries a failed gateway call?
- kind: good
- fact: Retries are driven by a queue, never by the shopper's request

A queue, never the shopper's request.

### Which currencies do we show?
- kind: weak

A display detail: it does not change how a retry is recognised. Ask how often clients retry and what a retry must get back.

### Should we build our own card network?
- kind: weak

Far out of scope: the gateway is given. Ask how slow it is and how often its calls fail or time out.

### What does the checkout button look like?
- kind: weak

A UI question. Ask what the shopper should get when the outcome of a charge is unknown.

## Estimates

### How many retried checkouts arrive a second?
- answer: 50
- unit: checkouts/s
- range: 40 to 60

1k × 5% = **50 a second** that must not charge twice.

### How many gateway calls a second fail or time out?
- answer: 5
- unit: calls/s
- range: 4 to 7

1k × 0.5% = **5 a second**, each retried from a queue.

### How many writes a second reach the payments store, if every checkout inserts its key and every charged one is then marked succeeded?
- answer: 1945
- unit: writes/s
- range: 1800 to 2100

Inserts: all **1,000** checkouts, replays included (the insert is how a replay is detected). Updates: the 94.5% that are charged, **945**. Together about **1.95k writes a second**, roughly 40% of the 5k a relational primary takes: one primary is enough, and the replica is for failover.

Numbers: [Numbers to know](../docs/numbers/).
