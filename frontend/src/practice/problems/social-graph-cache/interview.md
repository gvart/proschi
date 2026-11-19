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

A UI question. Ask how many objects and associations a page reads, and how many reads a second that makes.

### Should the API be GraphQL?
- kind: weak

The API style does not change the cache tiers. Ask what share of reads the cache answers and who may talk to MySQL.

### Which PHP version does the web tier run?
- kind: weak

An implementation detail of the client. Ask about the read and write rates and the latency limits instead.

## Estimates

### How many reads a second miss the follower tier?
- answer: 36k
- unit: reads/s
- range: 30k to 42k

1M × 3.6% = **36,000 a second** reach the leaders.

### With three MySQL shards, each a primary and a replica taking 20k reads a second each, how busy is the one server left in a shard that lost the other?
- answer: 60
- unit: % utilisation
- range: 55 to 65

Every follower miss is read from MySQL, and each shard gets a third: 36k ÷ 3 = 12k reads a second. On one 20k server that is **60%**. With two shards it would be 18k, 90% busy, and the read p99 breaks: the shard that lost a replica sets the shard count.

### At 100k operations a second per cache server, how many followers keep 1M reads a second under 70% busy?
- answer: 15
- unit: followers
- range: 14 to 18

1M ÷ (100k × 0.7) ≈ 14.3, so **15**. Run 16, and losing one still leaves 15 at 67%.

Numbers: [Numbers to know](../docs/numbers/).
