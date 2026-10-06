## Questions

### How many datapoints a second, and how do they arrive?
- kind: good
- fact: 40 million datapoints a second into this slice, in batches of 2,000

**40 million datapoints a second** in batches of 2,000: **20k batches a second**.

### Do we keep every datapoint?
- kind: good
- fact: Aggregation keeps about one datapoint in 25

No: aggregation keeps about **one in 25**, 1.6 million a second, written as 800 batches.

### What does the storage cluster look like?
- kind: good
- fact: two shards of three replicas, each replica taking 2k writes and 5k reads a second

The M3DB cluster is fixed: **two shards of three replicas**, each replica taking **2k writes and 5k reads** a second.

### Can a collector wait for storage?
- kind: good
- fact: A collector's batch never waits for storage

No: a collector's batch never waits for storage; the emit path calls no database.

### When is a flush durable?
- kind: good
- fact: A flush is durable once a majority of replicas has it

Once a majority of replicas has it; a replica that is down must not fail it.

### How many queries, and who sends them?
- kind: good
- fact: 1k queries per second from dashboards and alerts

**1k queries a second** from dashboards and alerts, each reading about two series blocks; they never talk to M3DB directly.

### What latency do emits and queries need?
- kind: good
- fact: p99 of Emit metrics under 40 ms, of Query under 80 ms

p99 of **Emit metrics** under **40 ms**, of **Query** under **80 ms**.

### Which language are the collectors written in?
- kind: weak

It does not change the data path.

### Could we use Prometheus instead of M3?
- kind: weak

The store is given; ask what it can take.

### How long do we keep application logs?
- kind: weak

Logs are not metrics, and not part of this problem.

## Estimates

### How many batches a second arrive?
- answer: 20k
- unit: batches/s
- range: 18k to 22k

40M ÷ 2,000 = **20,000 batches a second**.

### How many datapoints a second reach storage after aggregation?
- answer: 1.6M
- unit: datapoints/s
- range: 1.2M to 2M

40M ÷ 25 = **1.6 million a second**.

### How many replica writes a second do 800 batch writes cause?
- answer: 2400
- unit: writes/s
- range: 2000 to 3000

800 × 3 replicas = **2,400 a second**, against 6 × 2k = 12k the cluster takes.

Numbers: [Numbers to know](../docs/numbers/).
