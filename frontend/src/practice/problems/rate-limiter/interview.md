## Questions

### How many calls a second, and how many are over the limit?
- kind: good
- fact: 5k rps in total, of which about 5% is over the limit

**5k calls a second**, about **5%** over the limit: 250 calls a second to
reject, and 5,000 limit checks a second, because every call is checked.

### Does every limiter machine need to see the same counters?
- kind: good
- fact: Counters must be shared

Yes: the limiter runs on several machines and a client may hit any of them.
Counts kept in each machine's memory would let a client through once per
machine, so they live in one shared store.

### Do rejected calls count against the limit?
- kind: good
- fact: Every call counts, allowed or not

Every call counts: increment atomically (`INCR`) before deciding. Reading
the counter first and incrementing later lets concurrent calls all pass.

### How much latency may the limit check add?
- kind: good
- fact: p99 of a call under 150 ms, including the limit check

p99 of a call under **150 ms**, including the limit check. The check is on
every call, so the counters need a store that answers in about a
millisecond.

### Can clients go around the limiter?
- kind: good
- fact: Nothing reaches the Orders API without passing the limiter

No: nothing reaches the Orders API without passing the limiter. A limiter
with a way around it protects nothing.

### Is there a budget?
- kind: good
- fact: At most $3,000 / month for everything, the Orders API included

At most **$3,000 a month** for everything, the Orders API included.

### What should the 429 response body say?
- kind: weak

A detail; it does not change where the counters live. Ask whether rejected
calls count against the limit, and whether clients can reach the API
another way.

### Which hash function should we use for client ids?
- kind: weak

An implementation detail. Ask how many calls a second arrive and how much
latency the check may add.

### Should limits be configured in YAML or JSON?
- kind: weak

Configuration format does not change the design. Ask whether every
limiter machine must see the same counts.

## Estimates

### How many calls a second are rejected?
- answer: 250
- unit: calls/s
- range: 200 to 300

5k × 5% = **250 a second**. The other 4,750 go on to the Orders API.

### How many counter increments a second hit the shared store?
- answer: 5000
- unit: writes/s
- range: 4500 to 5500

Every call counts, rejected ones too: **5,000 a second**, one atomic write
each. One Redis node takes about 100,000 a second.

### At 100 bytes per counter, how much memory do a million clients' counters take?
- answer: 100M
- unit: bytes
- range: 50M to 200M

1M × 100 bytes = **100 MB**: one small Redis. Memory is not the constraint;
the shared, atomic increment is.

Numbers: [Numbers to know](../docs/numbers/).
