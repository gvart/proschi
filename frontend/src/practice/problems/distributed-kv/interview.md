## Questions

### How many reads and writes a second, and how big are the values?
- kind: good
- fact: Put: 10k rps and Get: 30k rps at peak, values of about 1 KB

**10k puts and 30k gets a second** at peak, values of about **1 KB**.

### How many copies of each key do we keep, and how many must answer?
- kind: good
- fact: Every key has three replicas (N = 3)

**Three replicas.** A write goes to all three and is acknowledged after two (W = 2); a read asks two (R = 2).

### Must writes keep working when a machine is down?
- kind: good
- fact: A write must succeed when one of its three replicas is down

Yes: **a write must succeed when one of its three replicas is down.** Refusing a write is the one thing the users will not accept.

### How often are replicas out of date?
- kind: good
- fact: about 2% of reads find a replica that missed a write

About **0.2%** of writes find a replica down, and about **2% of reads** find a replica that missed a write. A read that finds one repairs it.

### Can we put a cache in front for the hot keys?
- kind: good
- fact: Reads are served by the replicas, never by a cache

No: **reads are served by the replicas.** A cached value is outside every quorum.

### What does a storage machine take, and what does it cost?
- kind: good
- fact: A storage node takes 20k reads and 20k writes a second at $500 / month

**20k reads and 20k writes a second** each, at **$500 a month**.

### What are the latency and cost limits?
- kind: good
- fact: p99 of Put and of Get under 60 ms

p99 of both **under 60 ms**, available 99.99%, at most **$9,500 a month**, and losing any machine must not break the latency limit.

### Which programming language should the storage engine be written in?
- kind: weak

An implementation detail; ask about the rates, the replication factor and what must survive a failure.

### Should the API be REST or gRPC?
- kind: weak

The protocol does not change partitioning, quorums or sizing; ask about value size and request rates instead.

### Can we use DynamoDB?
- kind: weak

The problem is to build what DynamoDB provides; ask what guarantees the store must give instead.

## Estimates

### How many replica operations a second do the storage nodes perform?
- answer: 90k
- unit: operations/s
- range: 80k to 100k

Writes go to all three replicas: 10k × 3 = 30k. Reads ask two: 30k × 2 = 60k. Together **90k operations a second**, more than twice the 40k client requests.

### With four shards of three nodes, how busy is each storage node?
- answer: 38
- unit: %
- range: 30 to 45

Twelve nodes share 60k reads and 30k writes: 5k reads (25% of 20k) plus 2.5k writes (12.5% of 20k) each, **about 38%**. A group that loses a node runs at about 56%.

### How many coordinators keep 40k requests a second under 70% busy, at 2k each?
- answer: 29
- unit: coordinators
- range: 25 to 35

40,000 ÷ (2,000 × 0.7) ≈ **29**; with one lost the rest must still stay under 100%, so about 30.

Numbers: [Numbers to know](../docs/numbers/).
