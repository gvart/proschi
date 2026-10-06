## Questions

### How many reads and writes a second?
- kind: good
- fact: 1M reads per second and 2k writes per second in this slice

**1M reads** and **2k writes** a second in this slice.

### How many reads does the first cache tier answer?
- kind: good
- fact: 96.4% of reads hit the follower tier

**96.4%** of reads hit the follower tier.

### Who may talk to MySQL?
- kind: good
- fact: Only the leader tier talks to MySQL

Only the leader tier: no connection from the web tier or the followers.

### When is a write committed?
- kind: good
- fact: A write is committed to MySQL before the writer hears back

In MySQL before the writer hears back.

### What latency do reads and writes need?
- kind: good
- fact: p99 of a read under 25 ms, of a write under 60 ms

p99 of a read under **25 ms**, of a write under **60 ms**.

### Which failures must the design survive?
- kind: good
- fact: a MySQL replica included

Losing any single machine, **a MySQL replica included**, must not break a latency limit.

### What does a profile page look like?
- kind: weak

A UI question.

### Should the API be GraphQL?
- kind: weak

The API style does not change the cache tiers.

### Which PHP version does the web tier run?
- kind: weak

An implementation detail.

## Estimates

### How many reads a second miss the follower tier?
- answer: 36k
- unit: reads/s
- range: 30k to 42k

1M × 3.6% = **36,000 a second** reach the leaders.

### If the leaders answer 90% of what reaches them, how many reads a second reach MySQL?
- answer: 3600
- unit: reads/s
- range: 3000 to 4500

36k × 10% = **3,600 a second**.

Numbers: [Numbers to know](../docs/numbers/).
